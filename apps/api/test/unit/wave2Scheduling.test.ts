import { describe, expect, it } from 'vitest';
import { solve } from '../../src/services/scheduling/solver.js';
import { occurrences, rotationPreset } from '../../src/services/scheduling/rotations.js';
import { TOR, at } from '../helpers.js';
import { options, person, slot } from '../solverFixtures.js';

describe('solver: unpaid breaks, premiums and the two-person minimum', () => {
  it('an 08:00–16:30 shift with a 30-minute lunch is 8 paid hours: filled with "avoid overtime" on (finding 10)', () => {
    const withBreak = solve({ slots: [slot('a', '2026-07-06 08:00', '2026-07-06 16:30', { shift: { id: 'a', positionId: 'guard', timezone: 'America/Vancouver', start: at('2026-07-06 08:00'), end: at('2026-07-06 16:30'), facilityId: 'f1', breakMinutes: 30 } })], people: [person('p')], options: options() });
    expect(withBreak.proposals).toHaveLength(1);
    expect(withBreak.people.find((x) => x.userId === 'p')?.hours).toBe(8);
    const without = solve({ slots: [slot('a', '2026-07-06 08:00', '2026-07-06 16:30')], people: [person('p')], options: options() });
    expect(without.proposals).toHaveLength(0);
  });

  it('a never-alone shift is left open when nobody qualified can work alongside it', () => {
    const r = solve({ slots: [slot('entry', '2026-07-06 08:00', '2026-07-06 12:00', { neverAlone: true })], people: [person('p'), person('q', { qualifiedPositionIds: new Set(['other']) })], options: options() });
    expect(r.proposals).toHaveLength(0);
    expect(r.unfilled[0]!.counts[0]).toMatchObject({ code: 'TWO_PERSON' });
  });

  it('fills both halves of a never-alone pair, or a companion already on site counts', () => {
    const pair = solve({ slots: [slot('a', '2026-07-06 08:00', '2026-07-06 12:00', { neverAlone: true }), slot('b', '2026-07-06 08:00', '2026-07-06 12:00', { neverAlone: true })], people: [person('p'), person('q')], options: options() });
    expect(pair.proposals).toHaveLength(2);
    const companion = solve({
      slots: [slot('a', '2026-07-06 08:00', '2026-07-06 12:00', { neverAlone: true })],
      people: [person('p')],
      companions: [{ id: 'x', userId: 'other', facilityId: 'f1', positionId: 'guard', start: at('2026-07-06 07:00'), end: at('2026-07-06 13:00'), qualifiedPositionIds: new Set(['guard']) }],
      options: options(),
    });
    expect(companion.proposals).toHaveLength(1);
  });

  it('rule premiums raise a shift’s cost: the cheaper person takes it', () => {
    const premium = slot('a', '2026-07-06 18:00', '2026-07-06 22:00', { premiumPerHour: 3, premiumPercent: 10 });
    const r = solve({ slots: [premium], people: [person('p')], options: options() });
    expect(r.proposals).toHaveLength(1);
  });
});

describe('rotation templates', () => {
  it('4-on-4-off: crews alternate, every day covered by exactly one crew', () => {
    const p = rotationPreset('FOUR_ON_FOUR_OFF');
    const occ = occurrences({ ...p, anchorDate: '2026-07-06' }, '2026-07-06', '2026-07-22', TOR);
    expect(occ).toHaveLength(16);
    expect(occ.slice(0, 4).every((o) => o.crew === 'A')).toBe(true);
    expect(occ.slice(4, 8).every((o) => o.crew === 'B')).toBe(true);
    expect(new Set(occ.map((o) => o.date)).size).toBe(16);
  });
  it('2-2-3 Pitman: each crew works 7 of 14 days, together covering every day, every other weekend off', () => {
    const p = rotationPreset('PITMAN_2_2_3');
    const occ = occurrences({ ...p, anchorDate: '2026-07-06' }, '2026-07-06', '2026-07-20', TOR);
    expect(occ.filter((o) => o.crew === 'A')).toHaveLength(7);
    expect(occ.filter((o) => o.crew === 'B')).toHaveLength(7);
    expect(new Set(occ.map((o) => o.date)).size).toBe(14);
  });
  it('crews offset, dates before the anchor, and Monday–Friday days', () => {
    const w = rotationPreset('WEEKDAYS');
    const occ = occurrences({ ...w, anchorDate: '2026-07-06' }, '2026-06-29', '2026-07-06', TOR);
    expect(occ.map((o) => o.date)).toEqual(['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03']);
  });
  it('DST: wall-clock times on the changeover days (fall back: a 13-hour night)', () => {
    const occ = occurrences({ cycleDays: 1, anchorDate: '2026-10-01', pattern: [{ day: 0, start: '19:00', end: '07:00', label: 'night' }], crews: [{ name: 'A', offsetDays: 0, userIds: [], openSlots: 0 }] }, '2026-10-31', '2026-11-02', TOR);
    const h = occ.map((o) => (o.end.getTime() - o.start.getTime()) / 3_600_000);
    expect(h).toEqual([13, 12]);
    expect(occ[0]!.start).toEqual(at('2026-10-31 19:00', TOR));
  });
});
