import { describe, expect, it } from 'vitest';
import { formatDate, formatHours, formatMoney, formatNumber, formatTime, formatTimeRange } from './format';

const NBSP = ' ';
const at = '2026-11-14T06:30:00.000-07:00';

describe('format helpers (FH Typography doc examples)', () => {
  it('times', () => {
    expect(formatTime(at, 'en-CA')).toBe(`6:30${NBSP}a.m.`);
    expect(formatTime(at, 'fr-CA')).toBe(`6${NBSP}h${NBSP}30`);
  });
  it('time ranges', () => {
    expect(formatTimeRange('2026-11-14T06:00:00-07:00', '2026-11-14T14:00:00-07:00', 'en-CA')).toBe(`6:00${NBSP}a.m.–2:00${NBSP}p.m.`);
    expect(formatTimeRange('2026-11-14T06:00:00-07:00', '2026-11-14T14:00:00-07:00', 'fr-CA')).toBe(`6${NBSP}h – 14${NBSP}h`);
  });
  it('dates', () => {
    expect(formatDate(at, 'en-CA')).toBe('Sat, Nov 14');
    expect(formatDate(at, 'fr-CA')).toBe('sam. 14 nov.');
    expect(formatDate(at, 'en-CA', 'long')).toBe('Saturday, November 14');
    expect(formatDate(at, 'fr-CA', 'long')).toBe('samedi 14 novembre');
  });
  it('hours, money and numbers', () => {
    expect(formatHours(7.5, 'en-CA')).toBe(`7.5${NBSP}h`);
    expect(formatHours('7.5', 'fr-CA', 'payroll')).toBe(`7,50${NBSP}h`);
    expect(formatMoney(22.5, 'en-CA')).toBe('$22.50');
    expect(formatMoney('22.50', 'fr-CA')).toBe(`22,50${NBSP}$`);
    expect(formatNumber(1250, 'fr-CA')).toBe(`1${NBSP}250`);
  });
  it('ignores the offset: wall-clock time is what the facility sees', () => {
    expect(formatTime('2026-11-14T06:30:00.000-05:00', 'en-CA')).toBe(`6:30${NBSP}a.m.`);
  });
});
