/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Shiv brand palette: graphite logo, warm paper, restrained metal accent.
        shiv: {
          green: '#B9924B',
          red: '#9F1D20',
          graphite: '#151515',
          charcoal: '#24211D',
          paper: '#F5F2EA',
          gold: '#B9924B',
        },
      },
      fontFamily: {
        // The Excel sheets use Arial throughout
        print: ['Arial', 'Helvetica', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
