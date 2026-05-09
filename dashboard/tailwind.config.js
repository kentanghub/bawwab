/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        black: '#000000',
        surface: {
          DEFAULT: '#111111',
          raised: '#1a1a1a',
          overlay: '#222222',
        },
        subtle: {
          DEFAULT: '#2a2a2a',
          light: '#3a3a3a',
        },
        muted: '#888888',
        faint: '#555555',
      }
    },
  },
  plugins: [],
}
