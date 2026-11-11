import { describe, expect, it } from 'vitest';
import enCA from '../locales/en-CA.json';
import frCA from '../locales/fr-CA.json';
import { emptySections, parseRecord } from './recordSections';

const fill = (tpl: string, facts: string, name = 'Sam Lee', level = 'Verbal warning') =>
  tpl.replaceAll('{{name}}', name).replaceAll('{{level}}', level).replace('{{facts}}', facts);

describe('discipline record sections', () => {
  it('finds the empty headings of an English draft saved as is', () => {
    const text = fill(enCA.people.draft, '• Late, Nov 3');
    const parsed = parseRecord(text)!;
    expect(parsed.preamble).toBe('Verbal warning: Sam Lee');
    expect(parsed.sections.map((s) => s.heading)).toEqual([
      'What happened',
      'Impact',
      'What we discussed (including Sam Lee’s explanation)',
      'Expectation going forward',
      'Support offered',
      'Next step if this continues',
    ]);
    expect(parsed.sections[0]).toMatchObject({ body: '• Late, Nov 3', empty: false });
    expect(emptySections(text)).toHaveLength(5);
  });

  it('keeps filled sections, including multi-line bodies, and works in French', () => {
    const text = fill(frCA.people.draft, '• Retard, 3 nov.', 'Marie Roy', 'Avertissement verbal')
      .replace('Attente pour la suite\n', 'Attente pour la suite\nArriver à l’heure.\nAppeler si en retard.\n');
    const parsed = parseRecord(text)!;
    const expectation = parsed.sections.find((s) => s.heading === 'Attente pour la suite')!;
    expect(expectation).toMatchObject({ body: 'Arriver à l’heure.\nAppeler si en retard.', empty: false });
    expect(emptySections(text)).toEqual([
      'Conséquences',
      'Ce dont nous avons discuté (y compris l’explication de Marie Roy)',
      'Soutien offert',
      'Prochaine étape si la situation se répète',
    ]);
  });

  it('treats the “describe the facts” placeholder as empty', () => {
    expect(emptySections(fill(enCA.people.draft, enCA.people.draftNoFacts))).toContain('What happened');
  });

  it('accepts straight apostrophes and Windows line endings', () => {
    const text = fill(enCA.people.draft, 'x').replace('’s', "'s").replace(/\n/g, '\r\n');
    expect(emptySections(text)).toContain("What we discussed (including Sam Lee's explanation)");
  });

  it('gives up (shows as is) when the text isn’t the template', () => {
    expect(parseRecord('Spoke with Sam about lateness. Expected on time from now on.')).toBeNull();
    // A single heading-like line isn't enough to be sure.
    expect(parseRecord('Impact\nThe pool opened late.')).toBeNull();
    // Headings out of order: someone rewrote it; don't guess.
    expect(parseRecord('Support offered\nEAP\n\nWhat happened\nLate')).toBeNull();
    expect(parseRecord('')).toBeNull();
  });

  it('never alters the text it splits: every non-empty line survives in order', () => {
    const text = fill(enCA.people.draft, '• Late').replace('Support offered\n', 'Support offered\nEAP referral\n');
    const parsed = parseRecord(text)!;
    const shown = [parsed.preamble, ...parsed.sections.filter((s) => !s.empty).flatMap((s) => [s.heading, s.body])].join('\n');
    const kept = (s: string) => s.split('\n').filter((l) => l.trim());
    const dropped = parsed.sections.filter((s) => s.empty).map((s) => s.heading);
    expect(kept(shown)).toEqual(kept(text).filter((l) => !dropped.includes(l)));
  });
});
