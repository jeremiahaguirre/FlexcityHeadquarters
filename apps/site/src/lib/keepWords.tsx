import { Fragment, type ReactNode } from 'react';

/**
 * Keeps hyphenated words ("main-d’œuvre", "Colombie-Britannique") on one line in headings.
 * A non-breaking hyphen (U+2011) would do it in plain text, but the self-hosted font has no glyph
 * for it, so the browser would draw that one character in a fallback font.
 */
export function keepHyphenated(text: string): ReactNode {
  const parts = text.split(/(\S*\p{L}-\p{L}\S*)/u);
  if (parts.length === 1) return text;
  return parts.map((p, i) => (i % 2 ? <span key={i} className="whitespace-nowrap">{p}</span> : <Fragment key={i}>{p}</Fragment>));
}
