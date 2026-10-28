/**
 * The default price set (C1) is protected: editing a rate anywhere copies the
 * set into a new one (C2, C3 …) and changes that copy, saved as you type.
 * C1 itself changes only after the shop code is typed, until the screen's
 * edit mode is switched off. A counter convenience, not security — the code is
 * in the app.
 */
export const DEFAULT_RATES_PASS = '2611'

let unlocked = false
export const defaultRatesUnlocked = () => unlocked
export const lockDefaultRates = () => { unlocked = false }
export function unlockDefaultRates(typed: string): void {
  if (typed.trim() !== DEFAULT_RATES_PASS) throw new Error('Wrong code.')
  unlocked = true
}
