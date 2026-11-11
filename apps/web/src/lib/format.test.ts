import { afterEach, describe, expect, it } from 'vitest';
import { dateFormat, formatDate, formatDuration, formatElapsed, formatHours, formatInstant, formatSpan, formatMoney, formatNumber, formatTime, formatTimeRange, setTimeFormat } from './format';

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
    expect(formatDate(at, 'en-CA')).toBe(`Sat,${NBSP}Nov${NBSP}14`);
    expect(formatDate(at, 'fr-CA')).toBe(`sam.${NBSP}14${NBSP}nov.`);
    expect(formatDate(at, 'en-CA', 'long')).toBe('Saturday, November 14');
    expect(formatDate(at, 'fr-CA', 'long')).toBe('samedi 14 novembre');
    expect(formatDate(at, 'en-CA', 'dated')).toBe(`Nov${NBSP}14,${NBSP}2026`);
    expect(formatDate(at, 'fr-CA', 'dated')).toBe(`14${NBSP}nov.${NBSP}2026`);
  });
  it('calendar days and moments', () => {
    expect(formatInstant('2026-11-01', 'en-CA')).toBe(`Nov${NBSP}1,${NBSP}2026`);
    expect(formatInstant('2026-11-01', 'fr-CA')).toBe(`1${NBSP}nov.${NBSP}2026`);
    expect(formatInstant(new Date(2026, 10, 14, 23, 30), 'en-CA', 'short')).toBe(`Sat,${NBSP}Nov${NBSP}14`);
  });
  it('spans that end on another day repeat the date', () => {
    expect(formatSpan('2026-11-09T13:33:00-08:00', '2026-11-09T18:01:00-08:00', 'en-CA')).toBe(`1:33${NBSP}p.m.–6:01${NBSP}p.m.`);
    expect(formatSpan('2026-11-09T13:33:00-08:00', '2026-11-10T18:01:00-08:00', 'en-CA')).toBe(`Mon,${NBSP}Nov${NBSP}9, 1:33${NBSP}p.m. – Tue,${NBSP}Nov${NBSP}10, 6:01${NBSP}p.m.`);
  });
  it('durations and elapsed time', () => {
    expect(formatDuration(28.47, 'en-CA')).toBe(`28${NBSP}h${NBSP}28${NBSP}min`);
    expect(formatDuration(7.5, 'fr-CA')).toBe(`7${NBSP}h${NBSP}30${NBSP}min`);
    expect(formatDuration(8, 'en-CA')).toBe(`8${NBSP}h`);
    expect(formatDuration(0.75, 'en-CA')).toBe(`45${NBSP}min`);
    expect(formatElapsed(35, 'en-CA')).toBe(`35${NBSP}min`);
    expect(formatElapsed(2112, 'en-CA')).toBe(`35${NBSP}h`);
    expect(formatElapsed(3000, 'en-CA')).toBe(`2${NBSP}days`);
    expect(formatElapsed(3000, 'fr-CA')).toBe(`2${NBSP}jours`);
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

describe('city time format', () => {
  afterEach(() => setTimeFormat('auto'));
  const at = '2026-11-14T14:30:00.000-07:00';
  it('follows the language by default', () => {
    expect(formatTime(at, 'en-CA')).toBe('2:30 p.m.');
    expect(formatTime(at, 'fr-CA')).toBe('14 h 30');
  });
  it('uses the city’s 24-hour or 12-hour choice in either language', () => {
    setTimeFormat('24h');
    expect(formatTime(at, 'en-CA')).toBe('14:30');
    expect(dateFormat('en-CA', { timeStyle: 'short', timeZone: 'UTC' }).format(new Date('2026-11-14T14:30:00Z'))).toBe('14:30');
    setTimeFormat('12h');
    expect(formatTime(at, 'fr-CA')).toMatch(/^2 h 30/);
  });
  it('leaves dates alone', () => {
    setTimeFormat('24h');
    expect(dateFormat('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date('2026-11-14T12:00:00Z'))).toBe('Nov 14');
  });
});
