import { describe, expect, it } from 'vitest';
import { calendarMove, easterSunday, JURISDICTION_HOLIDAYS, PROVINCES, seedStatHolidays, seedYears, statHolidays, type Jurisdiction } from '../../src/services/payroll/statHolidays.js';

const dates = (j: Jurisdiction, y: number) => Object.fromEntries(statHolidays(j, y).map((h) => [h.key, h.date]));
const names = (j: Jurisdiction, y: number) => statHolidays(j, y).map((h) => h.name);

describe('statutory holidays', () => {
  it('works out Easter', () => {
    expect(easterSunday(2026)).toEqual({ month: 4, day: 5 });
    expect(easterSunday(2027)).toEqual({ month: 3, day: 28 });
    expect(easterSunday(2024)).toEqual({ month: 3, day: 31 });
    expect(easterSunday(2038)).toEqual({ month: 4, day: 25 });
  });

  it('matches BC 2026 exactly', () => {
    expect(statHolidays('BC', 2026).map((h) => h.date)).toEqual([
      '2026-01-01', '2026-02-16', '2026-04-03', '2026-05-18', '2026-07-01', '2026-08-03', '2026-09-07', '2026-09-30', '2026-10-12', '2026-11-11', '2026-12-25',
    ]);
    expect(names('BC', 2026)).toContain('British Columbia Day');
  });

  it('moves the floating days correctly in 2027', () => {
    const on = dates('ON', 2027);
    expect(on.FAMILY_DAY).toBe('2027-02-15');
    expect(on.GOOD_FRIDAY).toBe('2027-03-26');
    expect(on.VICTORIA_DAY).toBe('2027-05-24');
    expect(on.LABOUR_DAY).toBe('2027-09-06');
    expect(on.THANKSGIVING).toBe('2027-10-11');
    expect(on.BOXING_DAY).toBe('2027-12-26');
    expect(dates('YT', 2027).DISCOVERY_DAY).toBe('2027-08-16');
    expect(dates('NT', 2027).CIVIC_HOLIDAY).toBe('2027-08-02');
  });

  it('has each province’s own days', () => {
    expect(dates('QC', 2026)).toMatchObject({ PATRIOTS_DAY: '2026-05-18', FETE_NATIONALE: '2026-06-24' });
    expect(dates('QC', 2026).VICTORIA_DAY).toBeUndefined();
    expect(names('MB', 2026)).toContain('Louis Riel Day');
    expect(names('PE', 2027)).toContain('Islander Day');
    expect(names('NS', 2026)).toContain('Heritage Day');
    expect(dates('NU', 2026).NUNAVUT_DAY).toBe('2026-07-09');
    expect(dates('YT', 2026).INDIGENOUS_PEOPLES_DAY).toBe('2026-06-21');
    expect(dates('NT', 2026).INDIGENOUS_PEOPLES_DAY).toBe('2026-06-21');
    expect(names('SK', 2026)).toContain('Saskatchewan Day');
    expect(names('NB', 2026)).toContain('New Brunswick Day');
  });

  it('includes Truth and Reconciliation and Remembrance Day only where statutory', () => {
    const withTR = PROVINCES.filter((p) => JURISDICTION_HOLIDAYS[p].includes('TRUTH_RECONCILIATION')).sort();
    expect(withTR).toEqual(['BC', 'MB', 'NT', 'NU', 'PE', 'YT']);
    expect(JURISDICTION_HOLIDAYS.FED).toContain('TRUTH_RECONCILIATION');
    for (const p of ['ON', 'QC', 'MB'] as const) expect(JURISDICTION_HOLIDAYS[p]).not.toContain('REMEMBRANCE_DAY');
    expect(JURISDICTION_HOLIDAYS.ON).not.toContain('CIVIC_HOLIDAY');
    expect(JURISDICTION_HOLIDAYS.AB).not.toContain('CIVIC_HOLIDAY');
  });

  it('has the federal Canada Labour Code list', () => {
    expect(statHolidays('FED', 2026)).toHaveLength(10);
    expect(dates('FED', 2026).BOXING_DAY).toBe('2026-12-26');
  });

  it('counts per jurisdiction', () => {
    const count = Object.fromEntries(PROVINCES.map((p) => [p, statHolidays(p, 2026).length]));
    expect(count).toEqual({ BC: 11, AB: 9, SK: 10, MB: 9, ON: 9, QC: 8, NB: 8, NS: 7, PE: 8, NL: 6, YT: 11, NT: 11, NU: 11 });
  });

  it('every day has a French name and no duplicate dates', () => {
    for (const p of PROVINCES)
      for (const y of [2026, 2027]) {
        const list = statHolidays(p, y);
        expect(new Set(list.map((h) => h.date)).size).toBe(list.length);
        for (const h of list) expect(h.nameFr.length).toBeGreaterThan(3);
      }
  });

  it('seeds every province for each year, idempotently by province and date', async () => {
    const rows = new Map<string, unknown>();
    const db = { statutoryHoliday: { upsert: async (a: { where: { province_date: { province: string; date: Date } }; create: unknown }) => void rows.set(`${a.where.province_date.province}:${a.where.province_date.date.toISOString()}`, a.create) } };
    const n = await seedStatHolidays(db, [2026, 2027]);
    await seedStatHolidays(db, [2026, 2027]);
    expect(rows.size).toBe(n);
    expect(rows.has('QC:2027-06-24T00:00:00.000Z')).toBe(true);
  });

  describe('weekends', () => {
    const one = (j: Jurisdiction, y: number, key: string) => statHolidays(j, y).find((h) => h.key === key)!;

    it('moves Canada Day on a Sunday to July 2 by law (2029), except in Nova Scotia and Newfoundland and Labrador', () => {
      for (const j of ['QC', 'FED', 'ON', 'BC', 'AB', 'MB'] as const) expect(one(j, 2029, 'CANADA_DAY')).toMatchObject({ date: '2029-07-01', kind: 'MOVED', observedOn: '2029-07-02', weekdayOn: null });
      for (const j of ['NS', 'NL'] as const) expect(one(j, 2029, 'CANADA_DAY')).toMatchObject({ date: '2029-07-01', kind: 'ACTUAL', observedOn: null, weekdayOn: '2029-07-02' });
      // A Saturday Canada Day isn't moved by law; organizations that observe weekdays get Monday.
      expect(one('ON', 2028, 'CANADA_DAY')).toMatchObject({ kind: 'ACTUAL', observedOn: null, weekdayOn: '2028-07-03' });
    });

    it('moves the Fête nationale on a Sunday to June 25 only for people who don’t work Sundays', () => {
      expect(one('QC', 2029, 'FETE_NATIONALE')).toMatchObject({ date: '2029-06-24', kind: 'MOVED_IF_OFF', observedOn: '2029-06-25' });
      expect(one('QC', 2028, 'FETE_NATIONALE')).toMatchObject({ date: '2028-06-24', kind: 'ACTUAL', observedOn: null, weekdayOn: '2028-06-26' });
      expect(calendarMove('ON', 'FETE_NATIONALE', '2029-06-24').kind).toBe('ACTUAL');
    });

    it('observes Christmas on a Saturday and Boxing Day on the Sunday on Monday and Tuesday (2027)', () => {
      expect(one('ON', 2027, 'CHRISTMAS')).toMatchObject({ date: '2027-12-25', kind: 'ACTUAL', weekdayOn: '2027-12-27' });
      expect(one('ON', 2027, 'BOXING_DAY')).toMatchObject({ date: '2027-12-26', kind: 'ACTUAL', weekdayOn: '2027-12-28' });
      expect(one('FED', 2027, 'BOXING_DAY').weekdayOn).toBe('2027-12-28');
      // Without Boxing Day, Christmas alone takes Monday.
      expect(one('BC', 2027, 'CHRISTMAS').weekdayOn).toBe('2027-12-27');
      // New Year's Day 2028 is a Saturday: Monday January 3.
      expect(one('ON', 2028, 'NEW_YEAR').weekdayOn).toBe('2028-01-03');
    });

    it('gives Remembrance Day on a weekend a weekday only where it is statutory', () => {
      for (const j of ['BC', 'AB', 'SK', 'NB', 'NS', 'PE', 'NL', 'YT', 'NT', 'NU', 'FED'] as const) expect(one(j, 2029, 'REMEMBRANCE_DAY')).toMatchObject({ date: '2029-11-11', kind: 'ACTUAL', weekdayOn: '2029-11-12' });
      for (const j of ['ON', 'QC', 'MB'] as const) expect(one(j, 2029, 'REMEMBRANCE_DAY')).toBeUndefined();
    });

    it('leaves weekday holidays alone and never gives two holidays the same weekday', () => {
      expect(one('BC', 2026, 'CANADA_DAY')).toMatchObject({ kind: 'ACTUAL', observedOn: null, weekdayOn: null });
      for (const p of PROVINCES)
        for (let y = 2026; y <= 2035; y++) {
          const days = statHolidays(p, y).map((h) => h.weekdayOn ?? (h.kind === 'MOVED' ? h.observedOn : h.date));
          expect(new Set(days).size).toBe(days.length);
          for (const h of statHolidays(p, y)) if (h.weekdayOn) expect([0, 6]).not.toContain(new Date(`${h.weekdayOn}T00:00:00Z`).getUTCDay());
        }
    });

    it('seeds through three years ahead, so 2029 is there', () => {
      expect(seedYears(new Date('2026-11-11T00:00:00Z'))).toEqual([2026, 2027, 2028, 2029]);
    });

    it('stores the observed dates when seeding', async () => {
      const rows = new Map<string, Record<string, unknown>>();
      const db = { statutoryHoliday: { upsert: async (a: { where: { province_date: { province: string; date: Date } }; create: Record<string, unknown> }) => void rows.set(`${a.where.province_date.province}:${a.where.province_date.date.toISOString().slice(0, 10)}`, a.create) } };
      await seedStatHolidays(db, [2029]);
      expect(rows.get('QC:2029-07-01')).toMatchObject({ key: 'CANADA_DAY', kind: 'MOVED', observedOn: new Date('2029-07-02T00:00:00Z'), weekdayOn: null });
      expect(rows.get('QC:2029-06-24')).toMatchObject({ kind: 'MOVED_IF_OFF', observedOn: new Date('2029-06-25T00:00:00Z') });
    });
  });
});
