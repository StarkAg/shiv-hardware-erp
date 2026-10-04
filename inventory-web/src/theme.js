/** URL overrides: ?light / ?dark. Otherwise day is 06:00–17:59 local time. */
export function themeFor(search, hour) {
  const params = new URLSearchParams(search)
  if (params.has('light')) return 'light'
  if (params.has('dark')) return 'dark'
  return hour >= 6 && hour < 18 ? 'light' : 'dark'
}

export function startTheme() {
  const update = () => { document.documentElement.dataset.theme = themeFor(location.search, new Date().getHours()) }
  update()
  const timer = setInterval(update, 30_000)
  addEventListener('popstate', update)
  document.addEventListener('visibilitychange', update)
  return () => {
    clearInterval(timer)
    removeEventListener('popstate', update)
    document.removeEventListener('visibilitychange', update)
  }
}
