/** The switch for every phone, kept in Convex. Goes in Stats, under Manage staff. */
export function ThemeSwitch({ theme, unlockThen }) {
  const { shared, tryOut, setCricket } = theme
  return (
    <div className="themeswitch">
      <div>
        <div className="themeswitch-name">Cricket theme</div>
        <div className="savednote">
          {tryOut === null
            ? 'For every phone. Off is the plain look. Needs the password.'
            : `This tab is trying it ${tryOut ? 'on' : 'off'} by itself. Every phone is ${shared ? 'on' : 'off'}.`}
        </div>
      </div>
      <button
        className="themeswitch-key"
        role="switch"
        aria-checked={shared}
        aria-label="Cricket theme for every phone"
        data-on={shared ? 'true' : undefined}
        onClick={() => unlockThen(() => setCricket(!shared))}
      >
        <span>{shared ? 'On' : 'Off'}</span>
      </button>
    </div>
  )
}
