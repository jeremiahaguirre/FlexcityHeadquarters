import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * WCAG 2.1 AA for both colour schemes, read straight from the stylesheet:
 * text 4.5:1 (1.4.3), and 3:1 for what identifies controls and focus (1.4.11).
 */
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const block = (selector: string) => {
  const i = css.indexOf(selector);
  const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(\d+) (\d+) (\d+)/g)].map((m) => [m[1]!, [Number(m[2]), Number(m[3]), Number(m[4])] as const]));
};
const light = block(':root {\n  /* Softer');
const dark = block(':root[data-theme="dark"]');
const lum = ([r, g, b]: readonly number[]) => {
  const f = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
};
const ratio = (a: readonly number[], b: readonly number[]) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

describe.each([['light', light], ['dark', dark]] as const)('%s scheme', (_name, t) => {
  const grounds = ['page', 'panel', 'surface'] as const;
  it('text is at least 4.5:1 on every background', () => {
    for (const text of ['ink', 'muted', 'brand-text', 'ok', 'warn', 'danger', 'new']) {
      for (const g of grounds) expect(ratio(t[text]!, t[g]!), `${text} on ${g}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('status text is at least 4.5:1 on its own tint', () => {
    for (const s of ['ok', 'warn', 'danger', 'new']) expect(ratio(t[s]!, t[`${s}-bg`]!), s).toBeGreaterThanOrEqual(4.5);
  });
  it('focus rings and field borders are at least 3:1 where they sit', () => {
    for (const g of grounds) expect(ratio(t.focus!, t[g]!), `focus on ${g}`).toBeGreaterThanOrEqual(3);
    expect(ratio(t['field-border']!, t.panel!), 'field border on cards').toBeGreaterThanOrEqual(3);
  });
});

it('the dark scheme is the same whether chosen or from the device', () => {
  const fromDevice = block(':root:not([data-theme="light"])');
  expect(fromDevice).toEqual(dark);
});
