/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        shiv: {
          green: '#B9924B',
          red: '#9F1D20',
        },
      },
      fontFamily: {
        print: ['Arial', 'Helvetica', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
