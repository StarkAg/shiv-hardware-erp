"use node";
/**
 * Signs the token a trusted device carries. Node, because it needs the
 * private key's signature (ES256) and the deployment's own URL as issuer.
 *
 * The key pair is made once with `node scripts/device-keys.mjs` and kept in
 * the deployment's environment, never in git:
 *   DEVICE_JWT_KEY  the private key, PKCS#8 PEM
 *   DEVICE_JWKS     the public half, served at /.well-known/jwks.json
 */
import { v } from "convex/values";
import { createPrivateKey, sign } from "node:crypto";
import { internalAction } from "./_generated/server";

const b64url = (data: Buffer | string) =>
  Buffer.from(data).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** The audience every device token carries; auth.config.ts checks it. */
export const AUDIENCE = "shiv-devices";

export const signToken = internalAction({
  args: { deviceId: v.string(), name: v.string() },
  handler: async (_ctx, { deviceId, name }) => {
    const pem = process.env.DEVICE_JWT_KEY;
    const issuer = process.env.CONVEX_SITE_URL;
    if (!pem || !issuer) throw new Error("DEVICE_JWT_KEY is not set on this deployment.");
    const key = createPrivateKey(pem.replace(/\\n/g, "\n"));
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "ES256", typ: "JWT", kid: "shiv-devices-1" };
    // Long-lived on purpose: the PIN is asked once per device. Removing the
    // device from the list is what ends it, and that is checked on every call.
    const payload = { iss: issuer, aud: AUDIENCE, sub: deviceId, name, iat: now, exp: now + 10 * 365 * 86400 };
    const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
    const signature = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
    return `${input}.${b64url(signature)}`;
  },
});
