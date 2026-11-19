/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './passageiro/index.html', './motorista/index.html', './admin/index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Paleta Leva Já: #31466F (azul), #206178 (petróleo), #FF5755 (coral), #38D1D5 / #40C0CE (cianos)
        navy: { DEFAULT: '#31466F', 950: '#18233B', 900: '#1F2D4A', 800: '#283A5E', 700: '#31466F', 600: '#45598A', 500: '#5D6E92', 400: '#8592AD', 300: '#A9B3C8', 100: '#DDE2EC', 50: '#F2F4F8' },
        brand: { DEFAULT: '#38D1D5', 600: '#40C0CE', 700: '#206178', 400: '#6ADDE0', 100: '#CDF3F4', 50: '#ECFAFB' },
        petrol: { DEFAULT: '#206178', 600: '#1A5164', 400: '#2C7C96' },
        coral: { DEFAULT: '#FF5755', 600: '#E94947', 400: '#FF7A78', 50: '#FFF0F0' },
        lime: { brand: '#38D1D5', neon: '#40C0CE' },
        mist: '#F3F6F9',
        royal: { DEFAULT: '#FF5755', 400: '#FF7A78' },
        sun: '#FFC53D',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans Variable"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(49,70,111,.06), 0 8px 24px rgba(49,70,111,.08)',
        sheet: '0 -8px 32px rgba(49,70,111,.18)',
        glow: '0 6px 16px -6px rgba(32,97,120,.45)',
        'glow-lg': '0 12px 28px -8px rgba(32,97,120,.5)',
        float: '0 12px 32px -8px rgba(24,35,59,.30)',
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
