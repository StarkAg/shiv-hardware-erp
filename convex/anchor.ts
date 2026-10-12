"use node";
/**
 * The day's fingerprint of the books, written into Bitcoin.
 *
 * The nightly check (convex/chain.ts `verify`) ends on one fingerprint that
 * stands for every entry in the books' history. Kept only here, someone able
 * to rewrite the whole database could write a new history and a new chain to
 * match. Kept in Bitcoin, they cannot: the fingerprint of that night is in a
 * public block for good, and a rewritten chain ends somewhere else.
 *
 * It goes through OpenTimestamps (lib/ots.ts): free, no wallet, no account.
 * Nothing about the shop leaves: what is sent is the SHA-256 of the
 * fingerprint, which says nothing of what it stands for.
 *
 *   stamp    sends the fingerprint to three calendars; the proof comes back
 *            pending (each calendar writes to Bitcoin a few times a day)
 *   upgrade  asks the calendars again for proofs still pending, and once one
 *            leads into a Bitcoin block, checks that block's own record
 *            (blockstream.info) before calling it written
 *
 * To check a proof without this app: save the fingerprint (64 characters, no
 * line break) as a file, its proof beside it as the same name plus ".ots",
 * and run `ots verify <file>.ots` (pip install opentimestamps-client).
 */
import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type Hash, blockHeight, hex, isBitcoin, isPending, leaves, merge, pendingUrl, readProof,
  readTimestamp, writeProof,
} from "./lib/ots";

const CALENDARS = [
  "https://alice.btc.calendar.opentimestamps.org",
  "https://bob.btc.calendar.opentimestamps.org",
  "https://finney.calendar.eternitywall.com",
];
const HEADERS = { Accept: "application/vnd.opentimestamps.v1", "User-Agent": "shiv-hardware-books" };

const hash: Hash = (name, data) => new Uint8Array(createHash(name).update(data).digest());
const bytesOf = async (res: Response) => new Uint8Array(await res.arrayBuffer());
const toBuffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/** Sends a fingerprint of the books to the calendars and keeps the pending proof. */
export const stamp = internalAction({
  args: { head: v.string(), headSeq: v.number() },
  handler: async (ctx, { head, headSeq }) => {
    // What is stamped is the fingerprint itself, as text: the file anyone can
    // save and check the proof against.
    const digest = hash("sha256", new TextEncoder().encode(head));
    const answers = [];
    for (const calendar of CALENDARS) {
      try {
        const res = await fetch(`${calendar}/digest`, { method: "POST", headers: HEADERS, body: toBuffer(digest), signal: AbortSignal.timeout(20_000) });
        if (res.ok) answers.push(readTimestamp(await bytesOf(res), digest, hash));
      } catch { /* one calendar down is not a reason to stop */ }
    }
    if (!answers.length) {
      await ctx.runMutation(internal.chain.saveAnchor, { head, headSeq, error: "No timestamp server answered. It is tried again tomorrow night." });
      return;
    }
    const proof = writeProof(digest, merge(digest, answers));
    await ctx.runMutation(internal.chain.saveAnchor, { head, headSeq, digest: hex(digest), proof: toBuffer(proof), calendars: answers.length });
  },
});

/** The record of a Bitcoin block, from a public explorer: its merkle root and time. */
async function block(height: number): Promise<{ merkleRoot: string; time: number } | null> {
  for (const base of ["https://blockstream.info/api", "https://mempool.space/api"]) {
    try {
      const id = await (await fetch(`${base}/block-height/${height}`, { signal: AbortSignal.timeout(15_000) })).text();
      const info = await (await fetch(`${base}/block/${id.trim()}`, { signal: AbortSignal.timeout(15_000) })).json();
      if (info?.merkle_root) return { merkleRoot: String(info.merkle_root), time: Number(info.timestamp) * 1000 };
    } catch { /* the other explorer */ }
  }
  return null;
}

/** Asks for the proofs still waiting; writes down those now in a Bitcoin block. */
export const upgrade = internalAction({
  args: {},
  handler: async (ctx) => {
    const waiting: { _id: Id<"chainAnchors">; proof: ArrayBuffer }[] = await ctx.runQuery(internal.chain.pendingAnchors, {});
    for (const anchor of waiting) {
      try {
        const { digest, root } = readProof(new Uint8Array(anchor.proof), hash);
        let grew = false;
        for (const { node, attestation } of leaves(root)) {
          if (!isPending(attestation)) continue;
          const url = pendingUrl(attestation);
          if (!CALENDARS.includes(url)) continue; // only calendars we chose are asked
          try {
            const res = await fetch(`${url}/timestamp/${hex(node.msg)}`, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
            if (!res.ok) continue; // not in a block yet
            const more = readTimestamp(await bytesOf(res), node.msg, hash);
            // The pending mark gives way to the steps that lead into the block.
            node.attestations = node.attestations.filter((a) => a !== attestation).concat(more.attestations);
            node.ops.push(...more.ops);
            grew = true;
          } catch { /* asked again next time */ }
        }
        // Written only once a block's own record agrees: its merkle root is
        // the message the proof arrives at (stored byte-reversed).
        let height: number | undefined;
        let blockTime: number | undefined;
        for (const { node, attestation } of leaves(root)) {
          if (!isBitcoin(attestation)) continue;
          const found = await block(blockHeight(attestation));
          if (found && found.merkleRoot === hex(Uint8Array.from(node.msg).reverse())) {
            if (height === undefined || blockHeight(attestation) < height) { height = blockHeight(attestation); blockTime = found.time; }
          }
        }
        if (grew || height !== undefined) {
          await ctx.runMutation(internal.chain.upgradeAnchor, {
            id: anchor._id, proof: toBuffer(writeProof(digest, root)),
            ...(height !== undefined ? { height, blockTime } : {}),
          });
        }
      } catch (err) {
        await ctx.runMutation(internal.chain.upgradeAnchor, { id: anchor._id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  },
});
