/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  // .jsx included: the ledger's components live there, and a Tailwind class
  // in a file outside this glob is silently no styling at all.
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Read through variables (src/index.css) so Shiv Counter can wear the
        // Signs look (src/counter-signs.css) while the panel keeps these exact
        // colours: the defaults there are the same numbers as before.
        shiv: {
          green: 'rgb(var(--shiv-green-rgb) / <alpha-value>)',
          red: 'rgb(var(--shiv-red-rgb) / <alpha-value>)',
        },
        stone: Object.fromEntries(
          [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
            .map((step) => [step, `rgb(var(--stone-${step}) / <alpha-value>)`]),
        ),
        // The panel's half of the shared palette in src/index.css. Both halves
        // read the same variables, so the theme cannot drift apart again.
        surface: 'var(--bg)',
        card: 'var(--card)',
        card2: 'var(--card2)',
        ink: 'var(--fg)',
        muted: 'var(--muted)',
        line: 'var(--line)',
        brass: 'var(--brass)',
        'brass-ink': 'var(--brass-ink)',
        'brass-text': 'var(--brass-text)',
        danger: 'var(--red)',
        warn: 'var(--amber-text)',
        good: 'var(--green-text)',
      },
      fontFamily: {
        print: ['Arial', 'Helvetica', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
