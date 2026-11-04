/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        tf: {
          lime: '#B8F28B',
          green: '#8BD66B',
          orange: '#FF9F43',
          peach: '#FFD09B',
          bg: '#101713',
          card: '#19231D',
          text: '#F4F8F3',
          muted: '#AAB8AA',
        },
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
