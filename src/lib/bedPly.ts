import type { BedPly, BedPlyGrade, GuaranteeYears } from './types'
import { round } from './pricing'

/**
 * Bed Inner Ply: the quotation written by hand at the counter (owner's ask,
 * 1 Nov 2026). The boards a bed needs, their total sq ft, then what that comes
 * to in each grade. A rate can be changed for one quotation on the screen; these
 * are what it opens on, for 19mm.
 */
export const BED_GRADES: { name: string; huskPercent: number; rate: number; guaranteeYears: GuaranteeYears }[] = [
  { name: 'Commercial', huskPercent: 5, rate: 52, guaranteeYears: 0 },
  { name: 'Semi Waterproof', huskPercent: 0, rate: 65, guaranteeYears: 0 },
  { name: 'Waterproof', huskPercent: 0, rate: 78, guaranteeYears: 7 },
]

export const BED_THICKNESS_MM = 19

export interface BedPieceInput { thicknessMm: number; length: number; width: number; qty: number }

/** The sum, kept on the quotation so the print server draws exactly what the screen shows. */
export function buildBedPly(pieces: BedPieceInput[], grades: Omit<BedPlyGrade, 'amount'>[]): BedPly {
  const filled = pieces
    .filter((p) => p.length > 0 && p.width > 0 && p.qty > 0)
    .map((p) => ({ ...p, sqft: round(p.length * p.width * p.qty, 2) }))
  const totalSqft = round(filled.reduce((sum, p) => sum + p.sqft, 0), 2)
  return {
    pieces: filled,
    totalSqft,
    grades: grades.map((g) => ({ ...g, amount: Math.round(g.rate * totalSqft) })),
  }
}
