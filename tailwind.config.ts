import type { Config } from 'tailwindcss'
import rtl from 'tailwindcss-rtl'

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Heebo', 'Roboto', 'Arial', 'system-ui', 'sans-serif'],
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
        yt: {
          bg: 'rgb(var(--yt-bg) / <alpha-value>)',
          surface: 'rgb(var(--yt-surface) / <alpha-value>)',
          surfaceHover: 'rgb(var(--yt-surface-hover) / <alpha-value>)',
          border: 'rgb(var(--yt-border) / <alpha-value>)',
          input: 'rgb(var(--yt-input) / <alpha-value>)',
          searchBtn: 'rgb(var(--yt-search-btn) / <alpha-value>)',
          text: 'rgb(var(--yt-text) / <alpha-value>)',
          textMuted: 'rgb(var(--yt-text-muted) / <alpha-value>)',
          red: '#ff0000',
        },
      },
      keyframes: {
        'logo-hover-pulse': {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.05)' },
        },
        'child-proof-shake': {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-4px)' },
          '40%': { transform: 'translateX(4px)' },
          '60%': { transform: 'translateX(-3px)' },
          '80%': { transform: 'translateX(3px)' },
        },
        'child-proof-hint': {
          '0%': { opacity: '0', transform: 'translate(-50%, 6px)' },
          '12%': { opacity: '1', transform: 'translate(-50%, 0)' },
          '88%': { opacity: '1', transform: 'translate(-50%, 0)' },
          '100%': { opacity: '0', transform: 'translate(-50%, -4px)' },
        },
      },
      animation: {
        'logo-hover-pulse': 'logo-hover-pulse 2.5s ease-in-out infinite',
        'child-proof-shake': 'child-proof-shake 0.45s ease-in-out',
        'child-proof-hint': 'child-proof-hint 2.6s ease-out forwards',
      },
    },
  },
  plugins: [rtl],
} satisfies Config
