/**
 * The shop's name rule, the half of it that is safe on every keystroke.
 *
 * Mirrored from convex/lib/text.ts, the same way match.js mirrors the panel's
 * matching: this site deploys on its own from this folder, so it cannot reach
 * up into the repo for a shared module.
 *
 * Only `properTyping` is copied, and deliberately so. The full rule —
 * codes to capitals, spacing, a caps-locked name set right — changes the
 * length of the text, which would move the caret mid-word. It does not need
 * to run here anyway: `filing.nameIt` puts every new account through
 * `properText` server-side before it is stored, so what a name ends up
 * written as in the books does not depend on this file. This is only so the
 * box reads the way the name will.
 */

/**
 * While typing: only first letters are raised, so the length never changes
 * and the caret stays where it is.
 */
export function properTyping(input) {
  return String(input ?? '')
    .replace(/(^|[^A-Za-z0-9'’])([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase())
    .replace(/(['’])([a-z])([a-z]{2,})/g, (_, quote, first, rest) => quote + first.toUpperCase() + rest)
}
