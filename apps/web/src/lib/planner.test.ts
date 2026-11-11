import { describe, expect, it } from 'vitest';
import {
  type BoardPerson,
  type EligResponse,
  axisFor,
  chunksToLoad,
  combine,
  dayStatus,
  dragSpan,
  emptyHistory,
  endMinuteOf,
  filterPeople,
  hhmm,
  lanes,
  mergeElig,
  minuteOf,
  minutesToX,
  periodOf,
  positionFor,
  rankFor,
  record,
  redo,
  remap,
  shiftStatus,
  snap,
  stepAnchor,
  suggestTimes,
  undo,
  xToMinutes,
} from './planner';

const person = (id: string, over: Partial<BoardPerson> = {}): BoardPerson => ({
  id,
  name: id,
  initials: id.slice(0, 2).toUpperCase(),
  employmentStatus: 'PART_TIME',
  positionIds: ['g'],
  primaryPositionId: 'g',
  certifications: [],
  fromDepartment: null,
  scheduledHours: 0,
  targetHours: null,
  availability: {},
  timeOff: {},
  hasAvailability: true,
  confirmedThrough: null,
  availabilityCurrent: false,
  ...over,
});

describe('periods', () => {
  it('a month grid is whole weeks from the Monday before the 1st', () => {
    const p = periodOf('month', '2026-11-18');
    expect(p.from).toBe('2026-10-26');
    expect(p.days.length % 7).toBe(0);
    expect(p.days).toContain('2026-11-30');
    expect(p.days.length).toBeLessThanOrEqual(42);
    expect(p.to).toBe('2026-12-07');
  });
  it('February 2027 (starts Monday) is exactly four weeks', () => {
    expect(periodOf('month', '2027-02-10').days.length).toBe(28);
  });
  it('a week starts on Monday; a day is itself', () => {
    expect(periodOf('week', '2026-11-15')).toMatchObject({ from: '2026-11-09', to: '2026-11-16' });
    expect(periodOf('day', '2026-11-15').days).toEqual(['2026-11-15']);
  });
  it('steps by month, week and day, across years', () => {
    expect(stepAnchor('month', '2026-12-31', 1)).toBe('2027-01-01');
    expect(stepAnchor('month', '2026-03-31', -1)).toBe('2026-02-01');
    expect(stepAnchor('week', '2026-11-11', -1)).toBe('2026-11-04');
    expect(stepAnchor('day', '2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('timeline', () => {
  it('snaps to 15 minutes', () => {
    expect(snap(7)).toBe(0);
    expect(snap(8)).toBe(15);
    expect(snap(367)).toBe(360);
    expect(snap(-8)).toBe(-15);
  });
  it('maps minutes to pixels and back', () => {
    const a = { startHour: 5, endHour: 23, pxPerHour: 60 };
    expect(minutesToX(6 * 60, a)).toBe(60);
    expect(xToMinutes(90, a)).toBe(6 * 60 + 30);
  });
  it('reads local times, including past midnight', () => {
    expect(minuteOf('2026-11-16T09:30:00.000-08:00')).toBe(570);
    expect(endMinuteOf('2026-11-16T22:00:00.000-08:00', '2026-11-17T02:00:00.000-08:00')).toBe(26 * 60);
    expect(hhmm(26 * 60 + 15)).toBe('02:15');
  });
  it('widens the axis for early or late shifts', () => {
    expect(axisFor([], 60)).toMatchObject({ startHour: 5, endHour: 23 });
    expect(axisFor([{ localStartsAt: '2026-11-16T04:30:00.000-08:00', localEndsAt: '2026-11-17T01:00:00.000-08:00' }], 60)).toMatchObject({ startHour: 4, endHour: 24 });
  });
  it('moves and resizes bars in 15-minute steps within the day', () => {
    expect(dragSpan([540, 780], 38, 'move', [300, 1380])).toEqual([585, 825]);
    expect(dragSpan([540, 780], -500, 'move', [300, 1380])).toEqual([300, 540]);
    expect(dragSpan([540, 780], 230, 'start', [300, 1380])).toEqual([750, 780]);
    expect(dragSpan([540, 780], 22, 'end', [300, 1380])).toEqual([540, 795]);
  });
  it('packs overlapping bars into lanes', () => {
    const r = lanes([
      { id: 'a', start: 540, end: 780 },
      { id: 'b', start: 600, end: 700 },
      { id: 'c', start: 780, end: 900 },
    ]);
    expect(r.lane).toEqual({ a: 0, b: 1, c: 0 });
    expect(r.count).toBe(2);
  });
});

describe('people', () => {
  const people = [
    person('Zoé', { scheduledHours: 10, targetHours: 20, availability: { '2026-11-16': [[360, 840]] } }),
    person('Alex', { scheduledHours: 30, targetHours: 20, positionIds: ['i'] }),
    person('Ben', { scheduledHours: 4, timeOff: { '2026-11-16': [[0, 1440]] }, availability: { '2026-11-16': [[0, 1440]] } }),
  ];
  it('searches without accents, filters by position, availability and target', () => {
    expect(filterPeople(people, { query: 'zoe', positionId: '', availableOn: null, underTarget: false }, 'name').map((p) => p.id)).toEqual(['Zoé']);
    expect(filterPeople(people, { query: '', positionId: 'i', availableOn: null, underTarget: false }, 'name').map((p) => p.id)).toEqual(['Alex']);
    expect(filterPeople(people, { query: '', positionId: '', availableOn: '2026-11-16', underTarget: false }, 'name').map((p) => p.id)).toEqual(['Zoé']);
    expect(filterPeople(people, { query: '', positionId: '', availableOn: null, underTarget: true }, 'name').map((p) => p.id)).toEqual(['Zoé']);
  });
  it('sorts by fewest hours or by name', () => {
    expect(filterPeople(people, { query: '', positionId: '', availableOn: null, underTarget: false }, 'hours').map((p) => p.id)).toEqual(['Ben', 'Zoé', 'Alex']);
    expect(filterPeople(people, { query: '', positionId: '', availableOn: null, underTarget: false }, 'name').map((p) => p.id)).toEqual(['Alex', 'Ben', 'Zoé']);
  });
  it('suggests the usual shift that fits availability, else availability, else the usual one', () => {
    const usual = { g: [{ start: '16:00', end: '20:00', count: 5 }, { start: '06:00', end: '10:00', count: 3 }] };
    expect(suggestTimes(usual, 'g', [[360, 840]])).toEqual({ start: 360, end: 600 });
    expect(suggestTimes({ g: [{ start: '16:00', end: '20:00', count: 1 }] }, 'g', [[360, 840]])).toEqual({ start: 360, end: 840 });
    expect(suggestTimes(usual, 'g', undefined)).toEqual({ start: 960, end: 1200 });
    expect(suggestTimes({}, 'g', undefined)).toEqual({ start: 540, end: 1020 });
    // Dropped at 13:07 on the timeline: starts at 13:00, keeps the length.
    expect(suggestTimes(usual, 'g', undefined, 787)).toEqual({ start: 780, end: 1020 });
  });
  it('picks the position asked for when the person holds it', () => {
    expect(positionFor({ positionIds: ['g', 'i'], primaryPositionId: 'g' }, 'i')).toBe('i');
    expect(positionFor({ positionIds: ['g', 'i'], primaryPositionId: 'g' }, 'x')).toBe('g');
  });
});

describe('status from the API', () => {
  const r: EligResponse = {
    users: ['a', 'b', 'c'],
    reasons: [[{ code: 'OVERTIME', n: [2] }], [{ code: 'ON_APPROVED_TIME_OFF' }]],
    shifts: { s1: { ok: [0], warn: [[1, 0]], block: [] } },
    days: { '2026-11-16': { ok: [], warn: [], block: [[2, 1]] } },
    evaluations: 4,
    ms: 3,
  };
  const cache = mergeElig({}, r);
  it('maps cells per person', () => {
    expect(shiftStatus(cache, 'a', 's1').status).toBe('ok');
    expect(shiftStatus(cache, 'b', 's1')).toEqual({ status: 'warn', reasons: [{ code: 'OVERTIME', n: [2] }] });
    // Loaded but not evaluated for this shift: not approved for its position.
    expect(shiftStatus(cache, 'c', 's1')).toEqual({ status: 'block', reasons: [{ code: 'NOT_QUALIFIED_FOR_POSITION' }] });
    expect(shiftStatus(cache, 'zz', 's1').status).toBe('unknown');
    expect(dayStatus(cache, 'c', '2026-11-16').status).toBe('block');
  });
  it('a later chunk replaces a person’s cells', () => {
    const again = mergeElig(cache, { users: ['b'], reasons: [], shifts: { s1: { ok: [0], warn: [], block: [] } }, days: {}, evaluations: 1, ms: 1 });
    expect(shiftStatus(again, 'b', 's1').status).toBe('ok');
    expect(shiftStatus(again, 'a', 's1').status).toBe('ok');
  });
  it('combines a group to its worst', () => {
    expect(combine([shiftStatus(cache, 'a', 's1'), shiftStatus(cache, 'b', 's1')]).status).toBe('warn');
    expect(combine([shiftStatus(cache, 'a', 's1'), shiftStatus(cache, 'c', 's1')]).status).toBe('block');
  });
  it('ranks ok first, then warnings, then refusals', () => {
    expect(rankFor([person('c'), person('b'), person('a')], cache, 's1').map((x) => x.person.id)).toEqual(['a', 'b', 'c']);
  });
  it('loads people not yet checked, in order, in chunks', () => {
    expect(chunksToLoad(['a', 'b', 'c', 'd', 'e'], new Set(['b']), 2)).toEqual([['a', 'c'], ['d', 'e']]);
  });
});

describe('undo stack', () => {
  it('undoes and redoes in order; a new change clears redo', () => {
    let h = emptyHistory();
    h = record(h, { kind: 'assign', shiftId: 's1', from: null, to: 'a', label: '1' });
    h = record(h, { kind: 'assign', shiftId: 's2', from: null, to: 'b', label: '2' });
    const u = undo(h);
    expect(u.op?.label).toBe('2');
    expect(u.history.past.map((o) => o.label)).toEqual(['1']);
    const r = redo(u.history);
    expect(r.op?.label).toBe('2');
    expect(r.history.future).toEqual([]);
    const n = record(undo(r.history).history, { kind: 'assign', shiftId: 's3', from: null, to: 'c', label: '3' });
    expect(n.future).toEqual([]);
    expect(undo(emptyHistory()).op).toBeNull();
  });
  it('remaps ids after a redo re-creates shifts', () => {
    let h = emptyHistory();
    h = record(h, { kind: 'create', ids: ['old'], body: { facilityId: 'f', positionId: 'g', startsAt: 'x', endsAt: 'y', userIds: [] }, label: 'c' });
    h = record(h, { kind: 'assign', shiftId: 'old', from: null, to: 'a', label: 'a' });
    const m = remap(h, ['old'], ['new']);
    expect(m.past.map((o) => (o.kind === 'create' ? o.ids[0] : o.kind === 'assign' ? o.shiftId : ''))).toEqual(['new', 'new']);
  });
});
