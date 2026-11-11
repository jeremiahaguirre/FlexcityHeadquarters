import { describe, expect, it } from 'vitest';
import { easterSunday, JURISDICTION_HOLIDAYS, PROVINCES, seedStatHolidays, statHolidays, type Jurisdiction } from '../../src/services/payroll/statHolidays.js';

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
});
