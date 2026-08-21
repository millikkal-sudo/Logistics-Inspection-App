import type { Config } from 'tailwindcss';

/**
 * Calo Healthy UI, exposed to Tailwind.
 *
 * Every colour here points at a CSS custom property defined in globals.css.
 * Components use these names only; a raw hex in a component is a styling leak
 * that a token change will never reach.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        content: {
          DEFAULT: 'var(--content-primary)',
          secondary: 'var(--content-secondary)',
          tertiary: 'var(--content-tertiary)',
          contrast: 'var(--content-contrast)',
          invert: 'var(--content-invert)',
          'invert-strong': 'var(--content-invert-strong)',
          'invert-secondary': 'var(--content-invert-secondary)',
          'invert-tertiary': 'var(--content-invert-tertiary)',
        },
        surface: {
          page: 'var(--background-elevated)',
          card: 'var(--fill-white)',
          subtle: 'var(--background-white)',
        },
        brand: {
          bold: 'var(--fill-brand-bold)',
          DEFAULT: 'var(--fill-brand-regular)',
          light: 'var(--fill-brand-light)',
          action: 'var(--fill-brand-action)',
          hero: 'var(--brand-50)',
        },
        line: {
          DEFAULT: 'var(--border-default)',
          brand: 'var(--border-brand)',
        },
        pass: {
          DEFAULT: 'var(--fill-success-strong)',
          soft: 'var(--fill-success-weak)',
        },
        fail: {
          DEFAULT: 'var(--fill-error-strong)',
          soft: 'var(--fill-error-weak)',
        },
        hold: {
          DEFAULT: 'var(--fill-warning-strong)',
          soft: 'var(--fill-warning-weak)',
        },
        disabled: 'var(--fill-disabled)',
        'invert-subtle': 'var(--fill-invert-subtle)',
        scrim: {
          DEFAULT: 'var(--scrim-regular)',
          strong: 'var(--scrim-strong)',
        },
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      boxShadow: {
        1: 'var(--elevation-1)',
        2: 'var(--elevation-2)',
        3: 'var(--elevation-3)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
      },
      fontWeight: {
        heavy: '800',
        black: '900',
      },
    },
  },
  plugins: [],
};

export default config;
