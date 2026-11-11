import enCA from '../locales/en-CA.json';
import frCA from '../locales/fr-CA.json';

/**
 * Discipline records are drafted from a template of headings (people.draft).
 * A supervisor can save with some sections left blank, which reads like an
 * unfilled form. This splits a record's text by the template's headings so a
 * reader can see it without the empty ones.
 *
 * The signed text never changes: this is display only, and anything it isn't
 * sure about comes back as null so the caller shows the text exactly as is.
 */

export type RecordSection = { heading: string; body: string; empty: boolean };
export type ParsedRecord = { preamble: string; sections: RecordSection[] };

type Template = { headings: RegExp[]; placeholder: string };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const apostrophes = (s: string) => s.replace(/[’']/g, "['’]");

/** Builds heading matchers from a draft template, so they track the locale text. */
export function templateFrom(draft: string, placeholder: string): Template {
  const lines = draft.split('\n').slice(1); // first line is "{{level}}: {{name}}"
  const headings = lines
    .map((l) => l.trim())
    .filter((l) => l && !l.includes('{{facts}}'))
    .map((l) => {
      const pattern = apostrophes(escape(l)).replace(/\\\{\\\{name\\\}\\\}/g, '.+');
      return new RegExp(`^${pattern}\\s*:?$`, 'i');
    });
  return { headings, placeholder: placeholder.trim() };
}

const TEMPLATES: Template[] = [
  templateFrom(enCA.people.draft, enCA.people.draftNoFacts),
  templateFrom(frCA.people.draft, frCA.people.draftNoFacts),
];

function parseWith(text: string, tpl: Template): ParsedRecord | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  // Each line that is a heading, with which template heading it matched.
  const hits: { line: number; idx: number }[] = [];
  lines.forEach((l, i) => {
    const idx = tpl.headings.findIndex((re) => re.test(l.trim()));
    if (idx >= 0) hits.push({ line: i, idx });
  });
  // Be conservative: at least two headings, each once, in the template's order.
  if (hits.length < 2) return null;
  for (let i = 1; i < hits.length; i++) if (hits[i].idx <= hits[i - 1].idx) return null;

  const preamble = lines.slice(0, hits[0].line).join('\n').trimEnd();
  const sections = hits.map((h, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].line : lines.length;
    const body = lines.slice(h.line + 1, end).join('\n').replace(/^\s*\n/, '').trimEnd();
    const empty = !body.trim() || body.trim() === tpl.placeholder;
    return { heading: lines[h.line].trim(), body, empty };
  });
  return { preamble, sections };
}

/** Splits a record by its template headings (English or French), or null when unsure. */
export function parseRecord(text: string): ParsedRecord | null {
  if (!text) return null;
  for (const tpl of TEMPLATES) {
    const parsed = parseWith(text, tpl);
    if (parsed) return parsed;
  }
  return null;
}

/** Headings left empty, for the drafting form's warning. */
export function emptySections(text: string): string[] {
  return parseRecord(text)?.sections.filter((s) => s.empty).map((s) => s.heading) ?? [];
}
