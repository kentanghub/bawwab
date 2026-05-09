/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        gray: {
          950: '#0a0a0f',
          900: '#12121a',
          850: '#1a1a25',
          800: '#1e1e2e',
          750: '#252535',
          700: '#2a2a3c',
        }
      }
    },
  },
  plugins: [],
}
