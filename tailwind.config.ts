import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0F1C28',
        sub: '#5B6B7A',
        line: '#DDE5EB',
        steel: '#EEF2F5',
        fleet: { DEFAULT: '#0E6BA8', dark: '#08466F' },
        pass: { DEFAULT: '#1F9D55', soft: '#E4F5EC' },
        fail: { DEFAULT: '#D64545', soft: '#FBE9E9' },
        hold: { DEFAULT: '#C77700', soft: '#FCF2E0' },
      },
      fontFamily: {
        sans: ['var(--font-archivo)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
