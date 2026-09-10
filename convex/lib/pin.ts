/**
 * The gate on anything that destroys.
 *
 * Every function in this deployment answers whoever has the URL, and the URL
 * ships inside the app's own JavaScript — there is no login to hide behind.
 * That is tolerable for writing a sale: it is what the shop does all day, and
 * the trash can undo it. It is not tolerable for erasing the books, emptying
 * the trash, or renumbering a voucher series, none of which can be undone.
 *
 * So those ask for the PIN. The PIN itself lives in the deployment's
 * environment and never in this file, because source goes to git and a secret
 * in git is not a secret:
 *
 *   npx convex env set LEDGER_PIN <pin>
 */
import { ConvexError } from "convex/values";

/**
 * ConvexError rather than Error throughout: a plain Error reaches the browser
 * as "Server Error" with the message stripped, so a mistyped code and a broken
 * deployment look exactly alike to whoever is standing at the counter.
 */
export function requirePin(pin: string) {
  const expected = process.env.LEDGER_PIN;
  if (!expected) {
    throw new ConvexError(
      "No code is set on this deployment — run: npx convex env set LEDGER_PIN <code>"
    );
  }
  // Compared character by character all the way to the end. `===` stops at the
  // first character that differs, and how long that takes tells someone
  // guessing how much of the PIN they already have right.
  let diff = pin.length ^ expected.length;
  for (let i = 0; i < pin.length; i++) {
    diff |= pin.charCodeAt(i) ^ expected.charCodeAt(i % expected.length);
  }
  if (diff !== 0) throw new ConvexError("Wrong code.");
}
