import { dateFormat } from './format';

/** What's new notes as text (lib/whatsNew.ts): no hooks, so tests and the Dev console preview share it. */
export type Block = { type: 'p'; text: string } | { type: 'ul' | 'ol'; items: string[] };

/**
 * A note's plain text as paragraphs and lists: lines starting with "- ", "* " or "• " make a
 * bulleted list, "1. " or "1) " a numbered one, and a blank line ends a paragraph. Everything stays
 * text (rendered by React, never as HTML), so whatever was typed shows as typed.
 */
export function parseNoteBody(text: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ type: 'p', text: para.join(' ') });
    para = [];
  };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d{1,3}[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flush();
      const type = bullet ? 'ul' : 'ol';
      const item = (bullet ?? numbered)![1]!;
      const last = out[out.length - 1];
      if (last && last.type === type) last.items.push(item);
      else out.push({ type, items: [item] });
    } else if (!line) flush();
    else para.push(line);
  }
  flush();
  return out;
}

/** A moment (UTC ISO) as a date on this device: "November 12, 2026". */
export const noteDate = (iso: string, lang: string) => dateFormat(lang, { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(iso));

/** The note's words in the reader's language. */
export const pick = (lang: string, v: { en: string; fr: string }) => (lang.startsWith('fr') ? v.fr : v.en);
