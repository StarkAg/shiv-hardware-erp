/**
 * The icons this app draws itself.
 *
 * Same hand as the tab row in App.jsx — a 24 unit box, stroked in the colour
 * the button is already using, never filled. Shared rather than inlined twice
 * because the bin is the one button in here that destroys something, and the
 * two places it appears should not be able to drift apart.
 */
const box = (size) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '1.7',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
})

/**
 * The arrow that goes back on itself: send this bill back to be named again.
 *
 * It sits where the bin used to, and the difference is the whole point — the
 * bin ended a bill, this one only puts it back in the tray.
 */
export function RevertIcon({ size = 20 }) {
  return (
    <svg {...box(size)}>
      <path d="M4 5v6h6" />
      <path d="M4 11a8 8 0 1 1 2 6" />
    </svg>
  )
}

export function TrashIcon({ size = 20 }) {
  return (
    <svg {...box(size)}>
      <path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6" />
    </svg>
  )
}

export function CheckIcon({ size = 20 }) {
  return (
    <svg {...box(size)} strokeWidth="2.4">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}
