/** @type {import('tailwindcss').Config} */
// Content globs must cover every place a Tailwind class can appear. The whole
// UI is rendered as HTML template-literals inside src/**/*.js (views.js,
// dynamic.js, shell.js, skeleton.js, main.js), so those MUST be scanned or the
// compiled CSS will be missing classes that only exist in JS strings.
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './splash.html',
    './src/**/*.js',
  ],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: {
        reddit: { DEFAULT: '#ff4500', hi: '#ff5700', soft: '#ff8b60' },
        brand: '#0079d3',
      },
    },
  },
  plugins: [],
};
