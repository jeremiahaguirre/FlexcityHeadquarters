import { describe, expect, it } from 'vitest';
import type { Board, BoardShift } from './planner';
import type { FillWeek } from './fill';
import { assign, assignMany, boardFor, cancel, copyRange, create, emptyPlan, fillAccept, fillUndo, fillWeek, localIso, move, publish, shiftsOf } from './demoPlanner';

const TZ = 'America/Vancouver';
const facility = { id: 'f1', name: 'Lakeview Aquatic Centre', timezone: TZ };
const guard = { id: 'p-guard', name: 'Lifeguard', nameFr: 'Sauveteur' };
const instructor = { id: 'p-wsi', name: 'Swim Instructor', nameFr: 'Moniteur de natation' };

function shift(id: string, day: string, start: string, end: string, userId: string | null = null, positionId = guard.id): BoardShift {
  const pos = positionId === guard.id ? guard : instructor;
  return {
    id, facilityId: facility.id, positionId, userId,
    localStartsAt: `${day}T${start}:00.000-07:00`, localEndsAt: `${day}T${end}:00.000-07:00`,
    status: 'DRAFT', shiftType: 'STANDARD', customTitle: null, conflictReason: null, version: 1,
    hours: (Number(end.slice(0, 2)) - Number(start.slice(0, 2))), unpaidBreakMinutes: 0, ownBreakMinutes: null,
    facility, position: pos, assignee: userId ? { id: userId, name: userId === 'u1' ? 'Jordan Singh' : 'Maya Fischer' } : null,
  };
}
const person = (id: string, name: string, positionIds: string[], targetHours: number | null) => ({
  id, name, initials: name.split(' ').map((x) => x[0]).join(''), employmentStatus: 'PART_TIME', positionIds, primaryPositionId: positionIds[0] ?? null,
  certifications: [], fromDepartment: null, scheduledHours: 0, targetHours, availability: {}, timeOff: {}, hasAvailability: true, confirmedThrough: null,
});

const base: Board = {
  range: { from: '2026-11-02', to: '2026-11-30', timezone: TZ, today: '2026-11-12' },
  hoursScope: 'period',
  planAheadThrough: '2026-11-25',
  departments: [{ id: 'd1', name: 'Aquatics', nameFr: 'Aquatique' }],
  positions: [guard, instructor],
  facilities: [facility],
  people: [person('u1', 'Jordan Singh', [guard.id, instructor.id], null), person('u2', 'Maya Fischer', [guard.id], 128)] as Board['people'],
  shifts: [
    shift('s1', '2026-11-09', '06:00', '13:00', 'u1'),
    shift('s2', '2026-11-12', '06:00', '13:00'),
    shift('s3', '2026-11-12', '13:00', '21:00', 'u2'),
    shift('s4', '2026-11-17', '16:00', '19:00', null, instructor.id),
  ],
  usual: {},
};

describe('demo planner', () => {
  it('cuts the recorded board to the days asked for and counts hours from the shifts as they stand', () => {
    const week = boardFor(base, emptyPlan(), '2026-11-09', '2026-11-16');
    expect(week.shifts.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(week.hoursScope).toBe('period');
    expect(week.people.find((p) => p.id === 'u2')).toMatchObject({ scheduledHours: 8, targetHours: 32 });
    // One day: hours for the week around it.
    const day = boardFor(base, emptyPlan(), '2026-11-12', '2026-11-13');
    expect(day.shifts.map((s) => s.id)).toEqual(['s2', 's3']);
    expect(day.hoursScope).toBe('week');
    expect(day.people.find((p) => p.id === 'u1')?.scheduledHours).toBe(7);
  });

  it('keeps drafts made by hand, in the facility’s own time', () => {
    const { plan, ids } = create(base, emptyPlan(), { facilityId: 'f1', positionId: guard.id, startsAt: '2026-11-13T15:00:00.000Z', endsAt: '2026-11-13T20:00:00.000Z', userIds: ['u2'] });
    const made = boardFor(base, plan, '2026-11-09', '2026-11-16').shifts.find((s) => s.id === ids[0]);
    expect(made).toMatchObject({ status: 'DRAFT', userId: 'u2', localStartsAt: '2026-11-13T08:00:00.000-07:00', hours: 5, assignee: { name: 'Maya Fischer' } });
    expect(localIso('2026-11-13T15:00:00Z', 'America/Toronto')).toBe('2026-11-13T10:00:00.000-05:00');
  });

  it('assigns, refusing someone already working then or not in the position', () => {
    const plan = assign(base, emptyPlan(), 's2', 'u2');
    expect(shiftsOf(base, plan).find((s) => s.id === 's2')?.assignee?.name).toBe('Maya Fischer');
    expect(() => assign(base, emptyPlan(), 's4', 'u2')).toThrow(expect.objectContaining({ status: 422, details: { blocks: [{ code: 'NOT_QUALIFIED_FOR_POSITION' }] } }));
    const busy = create(base, emptyPlan(), { facilityId: 'f1', positionId: guard.id, startsAt: '2026-11-12T14:00:00.000Z', endsAt: '2026-11-12T16:00:00.000Z', userIds: ['u1'] }).plan;
    expect(() => assign(base, busy, 's2', 'u1')).toThrow(expect.objectContaining({ details: { blocks: [{ code: 'OVERLAPPING_SHIFT' }] } }));
  });

  it('moves, copies, assigns several and cancels', () => {
    const moved = move(base, emptyPlan(), 's2', { startsAt: '2026-11-13T14:00:00.000Z', endsAt: '2026-11-13T19:00:00.000Z' });
    expect(moved.created).toBe(false);
    expect(shiftsOf(base, moved.plan).find((s) => s.id === 's2')?.localStartsAt).toBe('2026-11-13T07:00:00.000-07:00');
    const many = assignMany(base, emptyPlan(), 's2', ['u1', 'u2']);
    expect(many.results.map((r) => !!r.shiftId)).toEqual([true, true]);
    expect(many.results[0]!.shiftId).toBe('s2');
    expect(shiftsOf(base, many.plan)).toHaveLength(5);
    const gone = cancel(base, many.plan, ['s1', many.results[1]!.shiftId!]);
    expect(shiftsOf(base, gone).map((s) => s.id)).toEqual(['s2', 's3', 's4']);
  });

  it('copies last week onto this one, skipping what is already there', () => {
    const r = copyRange(base, emptyPlan(), { from: '2026-11-09', to: '2026-11-16', days: 7, withPeople: true });
    expect(r.created).toHaveLength(3);
    expect(r.assigned).toBe(2);
    const again = copyRange(base, r.plan, { from: '2026-11-09', to: '2026-11-16', days: 7 });
    expect(again.created).toHaveLength(0);
    expect(again.skippedExisting).toBe(3);
  });

  it('publishes drafts in the range', () => {
    const r = publish(base, emptyPlan(), { facilityId: 'f1', from: '2026-11-12T07:00:00.000Z', to: '2026-11-13T07:00:00.000Z' });
    expect(r.published).toBe(2);
    expect(r.postedToBoard).toBe(1);
    expect(shiftsOf(base, r.plan).filter((s) => s.status === 'PUBLISHED').map((s) => s.id)).toEqual(['s2', 's3']);
  });

  it('replays Fill the schedule, accepts and undoes', () => {
    const slot = (id: string, currentUserId: string | null) => ({ id, version: 1, facilityId: 'f1', facilityName: facility.name, positionId: guard.id, position: guard, customTitle: null, localStartsAt: '2026-11-12T06:00:00.000-07:00', localEndsAt: '2026-11-12T13:00:00.000-07:00', hours: 7, currentUserId, tentative: false });
    const week = { week: { start: '2026-11-09', index: 0, tentative: false, beyondWindowFrom: '2026-11-23' }, slots: [slot('s2', null), slot('gone', null)], proposals: [{ slotId: 's2', userId: 'u2' }, { slotId: 'gone', userId: 'u1' }], unfilled: [], people: {}, carry: [] } as unknown as FillWeek;
    expect(fillWeek(base, emptyPlan(), week).proposals.map((p) => p.slotId)).toEqual(['s2']);
    // Filled by hand meanwhile: no longer proposed.
    expect(fillWeek(base, assign(base, emptyPlan(), 's2', 'u1'), week).proposals).toHaveLength(0);
    const a = fillAccept(base, emptyPlan(), [{ shiftId: 's2', userId: 'u2' }, { newShift: { facilityId: 'f1', positionId: guard.id, startsAt: '2026-11-14T16:00:00.000Z', endsAt: '2026-11-14T20:00:00.000Z' }, key: 'new:1', userId: null }]);
    expect(a.applied).toBe(2);
    expect(a.created).toHaveLength(1);
    expect(shiftsOf(base, a.plan)).toHaveLength(5);
    const u = fillUndo(base, a.plan, a.undoIds);
    expect(u.restored).toBe(2);
    expect(shiftsOf(base, u.plan)).toHaveLength(4);
    expect(shiftsOf(base, u.plan).find((s) => s.id === 's2')?.userId).toBeNull();
  });
});
