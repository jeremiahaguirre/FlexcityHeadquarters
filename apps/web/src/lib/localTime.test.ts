import { describe, expect, it } from 'vitest';
import { formatLocal } from './localTime';

describe('formatLocal', () => {
  it('shows the facility wall-clock time regardless of offset', () => {
    expect(formatLocal('2026-11-13T07:00:00.000-07:00', 'en-CA', { hour: 'numeric', minute: '2-digit' })).toBe('7:00 a.m.');
    expect(formatLocal('2026-11-13T07:00:00.000-08:00', 'en-CA', { hour: 'numeric', minute: '2-digit' })).toBe('7:00 a.m.');
  });
  it('formats in Canadian French', () => {
    expect(formatLocal('2026-11-13T17:00:00.000-07:00', 'fr-CA', { hour: 'numeric', minute: '2-digit' })).toBe('17 h 00');
  });
});
