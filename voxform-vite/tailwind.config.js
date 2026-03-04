/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink:          '#141414',
        paper:        '#F2F0EB',
        warm:         '#E8E4DC',
        dim:          '#9A9490',
        ghost:        '#C8C4BC',
        mark:         '#2A2A2A',
        violet:       '#6B5BD6',
        'violet-dim': '#8B7DD8',
      },
      fontFamily: {
        serif: ['"Instrument Serif"', 'Georgia', 'serif'],
        sans:  ['"Instrument Sans"', 'system-ui', 'sans-serif'],
        mono:  ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}
