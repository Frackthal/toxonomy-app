/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dark mode
        'dm-bg': '#6c7680',
        'dm-surface': '#ccd3db',
        'dm-sidebar': '#5e6770',
        'dm-text': '#1f2a37',
        'dm-border': '#9ba4af',

        // Light mode
        'lm-bg': '#f8fafc',
        'lm-surface': '#ffffff',
        'lm-sidebar': '#f1f5f9',
        'lm-text': '#1f2937',
        'lm-border': '#e2e8f0',
      },
    },
  },
  plugins: [],
};
