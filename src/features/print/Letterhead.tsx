// The shop letterhead. Uses the exact banner artwork extracted from the
// Excel files so printed output is identical to the current stationery.

import { assetPath } from '../../lib/assets'

export function Letterhead() {
  return (
    <div className="px-[8mm] pt-[6mm]">
      <img
        src={assetPath('assets/letterhead/shiv-letterhead.png')}
        alt="Shiv Hardware Store"
        className="w-full"
        // The banner is 1024x369; full A4 content width keeps proportions.
      />
    </div>
  )
}
