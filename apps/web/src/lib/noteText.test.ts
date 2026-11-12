import { describe, expect, it } from 'vitest';

import { parseNoteBody, pick } from './noteText';

describe('What’s new note text', () => {
  it('paragraphs, bulleted and numbered lists', () => {
    expect(parseNoteBody('The week view is faster.\nIt opens at once.\n\n- Swipe between weeks\n* Tap a shift\n\n1. Open Schedule\n2) Pick a week\nDone.')).toEqual([
      { type: 'p', text: 'The week view is faster. It opens at once.' },
      { type: 'ul', items: ['Swipe between weeks', 'Tap a shift'] },
      { type: 'ol', items: ['Open Schedule', 'Pick a week'] },
      { type: 'p', text: 'Done.' },
    ]);
  });

  it('markup stays text', () => {
    expect(parseNoteBody('<img src=x onerror=alert(1)>\n- <b>bold</b>')).toEqual([
      { type: 'p', text: '<img src=x onerror=alert(1)>' },
      { type: 'ul', items: ['<b>bold</b>'] },
    ]);
    expect(parseNoteBody('\r\n\r\n')).toEqual([]);
  });

  it('picks the reader’s language', () => {
    expect(pick('fr-CA', { en: 'New', fr: 'Nouveau' })).toBe('Nouveau');
    expect(pick('en-CA', { en: 'New', fr: 'Nouveau' })).toBe('New');
  });
});
