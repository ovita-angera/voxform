/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink:          'rgb(var(--ink)          / <alpha-value>)',
        paper:        'rgb(var(--paper)        / <alpha-value>)',
        warm:         'rgb(var(--warm)         / <alpha-value>)',
        dim:          'rgb(var(--dim)          / <alpha-value>)',
        ghost:        'rgb(var(--ghost)        / <alpha-value>)',
        mark:         'rgb(var(--mark)         / <alpha-value>)',
        violet:       'rgb(var(--violet)       / <alpha-value>)',
        'violet-dim': 'rgb(var(--violet-dim)   / <alpha-value>)',
      },
      fontFamily: {
        serif: ['"Instrument Serif"', 'Georgia', 'serif'],
        sans:  ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono:  ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}
