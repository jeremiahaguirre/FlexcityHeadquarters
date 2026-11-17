import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '../locales/en-CA.json';
import fr from '../locales/fr-CA.json';
import { ApiError, errorText } from './apiError';

describe('errorText', async () => {
  const i18n = i18next.createInstance();
  await i18n.init({ lng: 'fr-CA', fallbackLng: 'en-CA', resources: { 'en-CA': { translation: en }, 'fr-CA': { translation: fr } }, interpolation: { escapeValue: false } });
  const t = i18n.t.bind(i18n) as unknown as Parameters<typeof errorText>[0];

  it('shows the code’s message in the reader’s language, filled from the details', () => {
    expect(errorText(t, new ApiError(400, 'KM_REQUIRED', 'Line 2: enter the kilometres driven.', { line: 2 }))).toBe('Ligne 2 : indiquez les kilomètres parcourus.');
    expect(errorText(t, new ApiError(400, 'RANGE_TOO_LONG', 'Choose a range of up to 62 days.', { maxDays: 62 }))).toBe('Choisissez une période d’au plus 62 jours.');
  });

  it('falls back to the server’s message for a code it doesn’t know, and to a general one for other errors', () => {
    expect(errorText(t, new ApiError(400, 'SOMETHING_NEW', 'Server words'))).toBe('Server words');
    expect(errorText(t, new Error('boom'))).toBe(fr.common.error);
    expect(errorText(t, new Error('boom'), 'X')).toBe('X');
  });

  it('ignores details that can’t fill a sentence (lists, objects, count)', () => {
    expect(errorText(t, new ApiError(400, 'READING_INVALID', 'x', { errors: ['a'], count: 3 }))).toBe(fr.errors.READING_INVALID);
  });
});
