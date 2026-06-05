// Theme managed outside React so route changes never lose or re-apply it.
const KEY = 'shiv-panel:theme'

export function initTheme() {
  const saved = localStorage.getItem(KEY)
  document.documentElement.classList.toggle('dark', saved === 'dark')
}

export function toggleTheme(): boolean {
  const isDark = document.documentElement.classList.toggle('dark')
  localStorage.setItem(KEY, isDark ? 'dark' : 'light')
  return isDark
}

export function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark')
}
