/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      screens: {
        'custom': '950px',
      },
      colors: {
        pf: {
          primary: 'var(--pf-primary)',
          secondary: 'var(--pf-secondary)',
          tertiary: 'var(--pf-tertiary)',
        },
      },
    },
  },
  plugins: [],
}

