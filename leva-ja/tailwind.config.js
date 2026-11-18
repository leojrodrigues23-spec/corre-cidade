/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './passageiro/index.html', './motorista/index.html', './admin/index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#102A43', 950: '#0A1B2C', 900: '#102A43', 800: '#1B3A5A', 700: '#243B53', 600: '#334E68', 500: '#486581', 300: '#9FB3C8', 100: '#D9E2EC' },
        brand: { DEFAULT: '#00C896', 600: '#00A87E', 700: '#008A68', 400: '#33D3AB', 100: '#CCF4EA', 50: '#E6FAF4' },
        lime: { brand: '#7ED321' },
        mist: '#F4F6F8',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,42,67,.06), 0 8px 24px rgba(16,42,67,.08)',
        sheet: '0 -8px 32px rgba(16,42,67,.18)',
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        pulseRing: { '0%': { transform: 'scale(.6)', opacity: '.8' }, '100%': { transform: 'scale(2.2)', opacity: '0' } },
        rise: { '0%': { transform: 'translateY(8px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
      },
      animation: {
        shimmer: 'shimmer 1.4s infinite',
        pulseRing: 'pulseRing 1.8s ease-out infinite',
        rise: 'rise .28s ease-out both',
      },
    },
  },
  plugins: [],
};
