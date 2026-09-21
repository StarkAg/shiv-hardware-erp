/**
 * The icons this app draws itself.
 *
 * Same hand as the tab row in App.jsx — a 24 unit box, stroked in the colour
 * the button is already using, never filled. Shared rather than inlined twice
 * because the bin is the one button in here that destroys something, and the
 * two places it appears should not be able to drift apart.
 */
export function TrashIcon({ size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6" />
    </svg>
  )
}
