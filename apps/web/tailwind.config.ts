import type { Config } from 'tailwindcss';

// Tenant branding is injected as CSS variables (see src/app/layout.tsx), so
// white-labelling needs no rebuild: Tailwind classes resolve to the variables.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Named type styles (FH Typography doc). Use these, never one-off sizes.
      fontSize: {
        display: ['var(--t-display)', { lineHeight: 'var(--t-display-lh)', letterSpacing: '-0.03em', fontWeight: '800' }],
        stat: ['var(--t-stat)', { lineHeight: 'var(--t-stat-lh)', letterSpacing: '-0.02em', fontWeight: '700' }],
        title: ['var(--t-title)', { lineHeight: 'var(--t-title-lh)', letterSpacing: '-0.025em', fontWeight: '800' }],
        heading: ['var(--t-heading)', { lineHeight: 'var(--t-heading-lh)', letterSpacing: '-0.015em', fontWeight: '700' }],
        subheading: ['1.0625rem', { lineHeight: '1.5rem', letterSpacing: '-0.01em', fontWeight: '700' }],
        body: ['1rem', { lineHeight: '1.5rem' }],
        'body-strong': ['1rem', { lineHeight: '1.5rem', fontWeight: '600' }],
        small: ['0.875rem', { lineHeight: '1.25rem' }],
        caption: ['0.8125rem', { lineHeight: '1.125rem', fontWeight: '500' }],
        label: ['0.75rem', { lineHeight: '1rem', letterSpacing: '0.08em', fontWeight: '600' }],
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['var(--font-sans)', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        brand: {
          DEFAULT: 'rgb(var(--brand) / <alpha-value>)',
          hover: 'rgb(var(--brand-hover) / <alpha-value>)',
          contrast: 'rgb(var(--brand-contrast) / <alpha-value>)',
          text: 'rgb(var(--brand-text) / <alpha-value>)',
        },
        accent: 'rgb(var(--accent) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        ok: 'rgb(var(--ok) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};

export default config;
