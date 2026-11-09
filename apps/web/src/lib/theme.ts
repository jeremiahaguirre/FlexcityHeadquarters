/**
 * Converts a tenant's stored brand colours into CSS variables.
 * Colours are validated (hex only) so tenant data can never inject CSS.
 */
export interface ThemeColors {
  primary?: string;
  primaryHover?: string;
  primaryContrast?: string;
  accent?: string;
}

const DEFAULTS: Required<ThemeColors> = {
  primary: '#0b5fa5',
  primaryHover: '#084b83',
  primaryContrast: '#ffffff',
  accent: '#0d9488',
};

const HEX = /^#([0-9a-f]{6})$/i;

export function hexToRgbTriplet(hex: string): string | null {
  const m = HEX.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** Relative luminance contrast ratio (WCAG 2.1). */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const t = hexToRgbTriplet(hex)!.split(' ').map(Number);
    const [r, g, bl] = t.map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export function themeVars(input: ThemeColors | null | undefined): Record<string, string> {
  const pick = (k: keyof ThemeColors) => (input?.[k] && hexToRgbTriplet(input[k]!) ? input[k]! : DEFAULTS[k]);
  let primary = pick('primary');
  let contrast = pick('primaryContrast');
  // Keep button text readable (WCAG AA 4.5:1) even if a tenant picks a poor pairing.
  if (contrastRatio(primary, contrast) < 4.5) {
    contrast = contrastRatio(primary, '#ffffff') >= contrastRatio(primary, '#000000') ? '#ffffff' : '#000000';
    if (contrastRatio(primary, contrast) < 4.5) {
      primary = DEFAULTS.primary;
      contrast = DEFAULTS.primaryContrast;
    }
  }
  return {
    '--brand': hexToRgbTriplet(primary)!,
    '--brand-hover': hexToRgbTriplet(pick('primaryHover'))!,
    '--brand-contrast': hexToRgbTriplet(contrast)!,
    '--accent': hexToRgbTriplet(pick('accent'))!,
  };
}
