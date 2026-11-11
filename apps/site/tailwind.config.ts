import type { Config } from 'tailwindcss';

// Same tokens as the app (apps/web), fixed to the FH palette.

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
      boxShadow: {
        card: '0 1px 2px rgb(11 31 34 / 0.04), 0 1px 3px rgb(11 31 34 / 0.06)',
        lift: '0 8px 24px rgb(11 31 34 / 0.12)',
        device: '0 34px 60px -28px rgb(11 31 34 / 0.5), 0 14px 26px -14px rgb(11 31 34 / 0.3)',
      },
      borderRadius: { xl2: '1.125rem' },
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
        page: 'rgb(var(--page) / <alpha-value>)',
        panel: 'rgb(var(--panel) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        ok: { DEFAULT: 'rgb(var(--ok) / <alpha-value>)', bg: 'rgb(var(--ok-bg) / <alpha-value>)' },
        warn: { DEFAULT: 'rgb(var(--warn) / <alpha-value>)', bg: 'rgb(var(--warn-bg) / <alpha-value>)' },
        danger: { DEFAULT: 'rgb(var(--danger) / <alpha-value>)', bg: 'rgb(var(--danger-bg) / <alpha-value>)' },
        new: { DEFAULT: 'rgb(var(--new) / <alpha-value>)', bg: 'rgb(var(--new-bg) / <alpha-value>)' },
        chartreuse: 'rgb(var(--chartreuse) / <alpha-value>)',
        overlay: 'rgb(var(--overlay) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};

export default config;
