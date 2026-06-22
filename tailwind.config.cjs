/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: 'var(--bg-base)',
        'surface-1': 'var(--bg-surface-1)',
        'surface-2': 'var(--bg-surface-2)',
        'surface-3': 'var(--bg-surface-3)',
        'text-1': 'var(--text-primary)',
        'text-2': 'var(--text-secondary)',
        'text-3': 'var(--text-tertiary)',
        'text-4': 'var(--text-muted)',
        'bd': 'var(--border-default)',
        'bd-strong': 'var(--border-strong)',
        accent: {
          DEFAULT: 'var(--accent)',
          light: 'var(--accent-light)',
          dark: 'var(--accent-dark)',
          '5': 'var(--accent-5)',
          '10': 'var(--accent-10)',
          '15': 'var(--accent-15)',
          '20': 'var(--accent-20)',
          '25': 'var(--accent-25)',
          '30': 'var(--accent-30)',
          '40': 'var(--accent-40)',
          '50': 'var(--accent-50)',
          '60': 'var(--accent-60)',
          '80': 'var(--accent-80)',
          '85': 'var(--accent-85)',
        },
        cloud: {
          DEFAULT: 'var(--cloud)',
          light: 'var(--cloud-light)',
          dim: 'var(--cloud-dim)',
          '25': 'var(--cloud-25)',
          '40': 'var(--cloud-40)',
        },
        success: {
          DEFAULT: 'var(--success)',
          bg: 'var(--success-bg)',
          ring: 'var(--success-ring)',
        },
        warning: {
          DEFAULT: 'var(--warning)',
          bg: 'var(--warning-bg)',
          ring: 'var(--warning-ring)',
        },
        info: {
          DEFAULT: 'var(--info)',
          bg: 'var(--info-bg)',
          ring: 'var(--info-ring)',
        },
        danger: {
          DEFAULT: 'var(--danger)',
          bg: 'var(--danger-bg)',
          ring: 'var(--danger-ring)',
        },
        task: {
          done: 'var(--task-done-bg)',
          downloading: 'var(--task-downloading-bg)',
          paused: 'var(--task-paused-bg)',
          error: 'var(--task-error-bg)',
          queue: 'var(--queue)',
        },
      },
      fontFamily: {
        sans: [
          'system-ui',
          '"Segoe UI"',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          '"Noto Sans SC"',
          'sans-serif'
        ]
      },
      fontSize: {
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
      boxShadow: {
        glow: '0 10px 40px -10px var(--accent-40)',
        'glow-sm': '0 4px 20px -6px var(--accent-30)',
        'glow-cloud': '0 8px 30px -8px var(--cloud-40)',
        'card': '0 2px 12px rgba(0,0,0,0.15), 0 0 0 1px var(--border-default)',
        'card-hover': '0 8px 30px rgba(0,0,0,0.2), 0 0 0 1px var(--border-strong)'
      },
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
