/**
 * Deck rotation planner. Lifeguards move station to station on a fixed
 * cadence (commonly 20–30 minutes) so scanning stays sharp, and come off the
 * chair for a break after a continuous stretch. The plan is a suggestion a
 * head guard applies; the log proves rotations happened.
 */
import type { Tx } from '../../lib/db.js';
import { badRequest } from '../../lib/errors.js';

const MIN = 60_000;
/** Gap that still counts as continuous chair time when someone moves straight to the next station. */
const CONTINUOUS_GAP_MS = 2 * MIN;

export interface PlanStation { id: string; occupant: string | null }
export interface Rested { userId: string; since: Date }
export interface Suggestion {
  assignments: Array<{ stationId: string; userId: string | null }>;
  toBreak: string[];
  /** People past the fatigue limit with nobody free to relieve them. */
  stillNeedBreak: string[];
  unstaffed: string[];
}

/**
 * The classic "push" rotation: the most-rested guard takes the first station,
 * everyone moves one station along, and whoever leaves the last station goes
 * on break. Anyone past the fatigue limit comes off instead of moving on, and
 * the next rested guard takes their place.
 */
export function suggestRotation(stations: PlanStation[], rested: Rested[], chainMinutes: Map<string, number>, maxOnChairMinutes: number): Suggestion {
  const queue = [...rested].sort((a, b) => a.since.getTime() - b.since.getTime()).map((r) => r.userId);
  const tired = (u: string) => (chainMinutes.get(u) ?? 0) >= maxOnChairMinutes;
  const assignments: Suggestion['assignments'] = [];
  const toBreak: string[] = [];
  const stillNeedBreak: string[] = [];
  let carry: string | null = queue.shift() ?? null;
  for (const st of stations) {
    const occ = st.occupant;
    // The station before was empty: the next rested guard steps in.
    if (carry === null) carry = queue.shift() ?? null;
    if (carry === null) {
      // Nobody to push in: the occupant stays (if they must break, flag it).
      assignments.push({ stationId: st.id, userId: occ });
      if (occ && tired(occ)) stillNeedBreak.push(occ);
      continue;
    }
    assignments.push({ stationId: st.id, userId: carry });
    carry = occ;
    if (carry && tired(carry)) {
      toBreak.push(carry);
      carry = queue.shift() ?? null;
    }
  }
  if (carry) toBreak.push(carry);
  return { assignments, toBreak, stillNeedBreak, unstaffed: assignments.filter((a) => !a.userId).map((a) => a.stationId) };
}

/** Continuous minutes on stations, walking back from now through back-to-back station logs. */
export function chainMinutesFor(logs: Array<{ stationId: string | null; startedAt: Date; endedAt: Date | null }>, now: Date): number {
  const sorted = [...logs].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  let total = 0;
  let edge = now.getTime();
  for (const l of sorted) {
    const end = (l.endedAt ?? now).getTime();
    if (l.stationId === null || edge - end > CONTINUOUS_GAP_MS) break;
    total += end - l.startedAt.getTime();
    edge = l.startedAt.getTime();
  }
  return Math.round(total / MIN);
}

export async function loadPlan(tx: Tx, facilityId: string, now = new Date()) {
  const facility = await tx.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { id: true, name: true, timezone: true, rotationMinutes: true, maxOnChairMinutes: true } });
  const [stations, open, punches] = await Promise.all([
    tx.deckStation.findMany({ where: { facilityId, archivedAt: null }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    tx.rotationLog.findMany({ where: { facilityId, endedAt: null } }),
    tx.timePunch.findMany({ where: { facilityId, clockOut: null }, select: { userId: true, clockIn: true } }),
  ]);
  const onDutyIds = [...new Set([...punches.map((p) => p.userId), ...open.map((o) => o.userId)])];
  const [people, recent] = await Promise.all([
    tx.user.findMany({ where: { id: { in: onDutyIds } }, select: { id: true, firstName: true, lastName: true } }),
    tx.rotationLog.findMany({ where: { facilityId, userId: { in: onDutyIds }, startedAt: { gte: new Date(now.getTime() - 10 * 60 * MIN) } } }),
  ]);
  const name = (id: string) => {
    const p = people.find((x) => x.id === id);
    return p ? `${p.firstName} ${p.lastName}` : '—';
  };
  const chain = new Map(onDutyIds.map((id) => [id, chainMinutesFor(recent.filter((r) => r.userId === id), now)]));
  const atStation = new Map(open.filter((o) => o.stationId).map((o) => [o.stationId!, o]));
  const onStation = new Set([...atStation.values()].map((o) => o.userId));
  const rested: Rested[] = onDutyIds
    .filter((id) => !onStation.has(id))
    .map((id) => {
      const lastOn = recent.filter((r) => r.userId === id && r.stationId && r.endedAt).sort((a, b) => b.endedAt!.getTime() - a.endedAt!.getTime())[0];
      const punch = punches.find((p) => p.userId === id);
      return { userId: id, since: lastOn?.endedAt ?? punch?.clockIn ?? now };
    });
  const planStations = stations.map((s) => ({ id: s.id, occupant: atStation.get(s.id)?.userId ?? null }));
  const suggestion = suggestRotation(planStations, rested, chain, facility.maxOnChairMinutes);
  return {
    facility,
    stations: stations.map((s) => {
      const cur = atStation.get(s.id);
      const dueAt = cur ? new Date(cur.startedAt.getTime() + facility.rotationMinutes * MIN) : null;
      return {
        id: s.id,
        name: s.name,
        poolBodyId: s.poolBodyId,
        current: cur ? { userId: cur.userId, name: name(cur.userId), startedAt: cur.startedAt, dueAt, overdue: !!dueAt && dueAt < now } : null,
      };
    }),
    onDuty: onDutyIds.map((id) => ({
      userId: id,
      name: name(id),
      stationId: open.find((o) => o.userId === id && o.stationId)?.stationId ?? null,
      chainMinutes: chain.get(id) ?? 0,
      needsBreak: (chain.get(id) ?? 0) >= facility.maxOnChairMinutes,
      restedSince: rested.find((r) => r.userId === id)?.since ?? null,
    })),
    suggestion: { ...suggestion, assignments: suggestion.assignments.map((a) => ({ ...a, name: a.userId ? name(a.userId) : null })) },
  };
}

/** Apply a rotation: close every open log at the facility and start the new ones in one step. */
export async function applyRotation(tx: Tx, tenantId: string, facilityId: string, actorId: string, assignments: Array<{ stationId: string; userId: string | null }>, now = new Date()) {
  const stations = await tx.deckStation.findMany({ where: { facilityId, archivedAt: null }, select: { id: true } });
  const valid = new Set(stations.map((s) => s.id));
  if (assignments.some((a) => !valid.has(a.stationId))) throw badRequest('A station is not on this deck.');
  const people = assignments.map((a) => a.userId).filter((u): u is string => !!u);
  if (new Set(people).size !== people.length) throw badRequest('Someone is on two stations at once.');
  const open = await tx.rotationLog.findMany({ where: { facilityId, endedAt: null } });
  await tx.rotationLog.updateMany({ where: { facilityId, endedAt: null }, data: { endedAt: now } });
  const assigned = new Set(people);
  const data = [
    ...assignments.filter((a) => a.userId).map((a) => ({ tenantId, facilityId, stationId: a.stationId, userId: a.userId!, startedAt: now, recordedById: actorId })),
    // People who were on deck and aren't assigned now go on break, so the log has no gaps.
    ...[...new Set(open.map((o) => o.userId))].filter((u) => !assigned.has(u)).map((u) => ({ tenantId, facilityId, stationId: null, userId: u, startedAt: now, recordedById: actorId })),
  ];
  if (data.length) await tx.rotationLog.createMany({ data });
  return { started: data.length };
}

/** Station logs past their rotation time (plus 2 minutes' grace) that nobody has been told about yet. */
export async function overdueRotations(tx: Tx, now = new Date()) {
  const open = await tx.rotationLog.findMany({ where: { endedAt: null, stationId: { not: null }, overdueNotifiedAt: null } });
  if (!open.length) return [];
  const facilities = await tx.facility.findMany({ where: { id: { in: [...new Set(open.map((o) => o.facilityId))] } }, select: { id: true, rotationMinutes: true } });
  const minutes = new Map(facilities.map((f) => [f.id, f.rotationMinutes]));
  return open.filter((o) => o.startedAt.getTime() + ((minutes.get(o.facilityId) ?? 30) + 2) * MIN < now.getTime());
}
