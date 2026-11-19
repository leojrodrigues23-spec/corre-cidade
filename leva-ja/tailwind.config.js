/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './passageiro/index.html', './motorista/index.html', './admin/index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#102A43', 950: '#0A1B2C', 900: '#102A43', 800: '#1B3A5A', 700: '#243B53', 600: '#334E68', 500: '#486581', 400: '#7B8FA6', 300: '#9FB3C8', 100: '#D9E2EC', 50: '#F0F4F8' },
        brand: { DEFAULT: '#00C896', 600: '#00A87E', 700: '#008A68', 400: '#33D3AB', 100: '#CCF4EA', 50: '#E6FAF4' },
        lime: { brand: '#7ED321', neon: '#9BE33A' },
        mist: '#F4F6F8',
        royal: { DEFAULT: '#1B4FD8', 400: '#4C7DFF' },
        sun: '#FFC53D',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans Variable"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,42,67,.06), 0 8px 24px rgba(16,42,67,.08)',
        sheet: '0 -8px 32px rgba(16,42,67,.18)',
        glow: '0 8px 24px -6px rgba(0,200,150,.55)',
        'glow-lg': '0 16px 40px -8px rgba(0,200,150,.6)',
        float: '0 12px 32px -8px rgba(10,27,44,.35)',
      },
      backgroundImage: {
        'brand-grad': 'linear-gradient(135deg, #9BE33A 0%, #00C896 100%)',
        'night-grad': 'linear-gradient(160deg, #0A1B2C 0%, #102A43 45%, #163E6B 100%)',
        'aurora': 'radial-gradient(1200px 500px at 10% -10%, rgba(155,227,58,.35), transparent 60%), radial-gradient(900px 500px at 110% 10%, rgba(0,200,150,.35), transparent 55%), radial-gradient(800px 600px at 50% 120%, rgba(27,79,216,.45), transparent 60%)',
        'price-grad': 'linear-gradient(135deg, #102A43 0%, #163E6B 55%, #00A87E 140%)',
      },
      keyframes: {
        radar: { '0%': { transform: 'scale(.4)', opacity: '.9' }, '100%': { transform: 'scale(2.6)', opacity: '0' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        spinSlow: { to: { transform: 'rotate(360deg)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        pulseRing: { '0%': { transform: 'scale(.6)', opacity: '.8' }, '100%': { transform: 'scale(2.2)', opacity: '0' } },
        rise: { '0%': { transform: 'translateY(8px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
      },
      animation: {
        shimmer: 'shimmer 1.4s infinite',
        pulseRing: 'pulseRing 1.8s ease-out infinite',
        rise: 'rise .28s ease-out both',
        radar: 'radar 2.4s ease-out infinite',
        float: 'float 3s ease-in-out infinite',
        'spin-slow': 'spinSlow 8s linear infinite',
      },
    },
  },
  plugins: [],
};
