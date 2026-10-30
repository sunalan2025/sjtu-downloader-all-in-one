/** @type {import('tailwindcss').Config} */
const sharedTheme = require('./src/shared/theme/tailwind-theme.cjs')
// Keep the background token out of text colors: text-base is the 16px font utility.
const { base: baseBackground, ...semanticColors } = sharedTheme.colors

module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // A semantic DEFAULT must not replace Tailwind's numbered palette (sky-500, etc.).
      colors: {
        ...semanticColors,
        ...Object.fromEntries(['amber', 'emerald', 'sky', 'rose'].map(name => [name, { DEFAULT: semanticColors[name] }]))
      },
      backgroundColor: { base: baseBackground },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"SF Pro Display"',
          '"PingFang SC"',
          'Inter',
          '"Segoe UI"',
          '"Microsoft YaHei"',
          '"Noto Sans SC"',
          'sans-serif'
        ]
      },
      fontSize: {
        '3xs': ['0.625rem', { lineHeight: '1.4' }],
        '2xs': ['0.6875rem', { lineHeight: '1.4' }],
        xs: ['0.75rem', { lineHeight: '1.5' }],
        sm: ['0.875rem', { lineHeight: '1.5' }],
        base: ['1rem', { lineHeight: '1.6' }],
        lg: ['1.125rem', { lineHeight: '1.5', fontWeight: '600' }],
        xl: ['1.375rem', { lineHeight: '1.4', fontWeight: '600' }],
        '2xl': ['1.75rem', { lineHeight: '1.3', fontWeight: '700' }],
        '3xl': ['2.25rem', { lineHeight: '1.2', fontWeight: '700' }],
        caption: ['0.75rem', { lineHeight: '1.5' }],
        body: ['0.875rem', { lineHeight: '1.5' }],
        display: ['1.25rem', { lineHeight: '1.4', fontWeight: '700' }]
      },
      backgroundImage: {
        'hero-radial':
          'radial-gradient(1200px 600px at 20% -10%, var(--accent-15), transparent 60%), radial-gradient(900px 500px at 100% 20%, var(--bg-surface-2), transparent 60%)'
      },
      boxShadow: { ...sharedTheme.boxShadow, '2xs': '0 1px 2px rgb(0 0 0 / 0.05)' },
      spacing: { 0.2: '0.05rem' },
      backdropBlur: { xs: '2px' },
      keyframes: {
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' }
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' }
        },
        breathe: {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' }
        }
      },
      animation: {
        shimmer: 'shimmer 2s ease-in-out infinite',
        fadeIn: 'fadeIn 0.3s ease-out',
        fadeInUp: 'fadeInUp 0.4s ease-out',
        pulse: 'pulse 2s ease-in-out infinite',
        breathe: 'breathe 3s ease-in-out infinite'
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.25rem'
      }
    }
  },
  plugins: []
}
