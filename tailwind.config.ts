import type { Config } from 'tailwindcss'
import rtl from 'tailwindcss-rtl'

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Heebo', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#fff1f2',
          100: '#ffe4e6',
          200: '#fecdd3',
          300: '#fda4af',
          400: '#fb7185',
          500: '#FF0000',
          600: '#FF0000',
          700: '#d60000',
          800: '#b30000',
          900: '#7f0000',
          950: '#450a0a',
        },
        danger: {
          500: '#ef4444',
          600: '#dc2626',
        },
      },
    },
  },
  plugins: [rtl],
} satisfies Config
