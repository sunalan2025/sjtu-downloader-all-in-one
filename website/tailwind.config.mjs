/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        sjtu: {
          navy: '#004098',
          blue: '#165DFF',
          dark: '#070B14',
          night: '#0D1527',
          cyan: '#00D2D3'
        }
      }
    }
  },
  plugins: []
};
