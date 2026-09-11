/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  // .jsx included: the ledger's components live there, and a Tailwind class
  // in a file outside this glob is silently no styling at all.
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        shiv: {
          green: '#B9924B',
          red: '#9F1D20',
        },
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
