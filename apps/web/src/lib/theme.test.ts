import { describe, expect, it } from 'vitest';
import { contrastRatio, hexToRgbTriplet, themeVars } from './theme';

describe('tenant theming', () => {
  it('converts hex to an RGB triplet for CSS variables', () => {
    expect(hexToRgbTriplet('#0b5fa5')).toBe('11 95 165');
  });
  it('ignores anything that is not a hex colour (no CSS injection)', () => {
    expect(themeVars({ primary: 'red; background:url(x)' })['--brand']).toBe('13 95 89');
  });
  it('fixes unreadable button text to meet WCAG AA', () => {
    const v = themeVars({ primary: '#ffeb3b', primaryContrast: '#ffffff' });
    expect(v['--brand-contrast']).toBe('0 0 0');
  });
  it('computes WCAG contrast', () => {
    expect(Math.round(contrastRatio('#000000', '#ffffff'))).toBe(21);
  });
});
