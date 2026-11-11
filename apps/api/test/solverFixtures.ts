/** Seeded random scheduling weeks for the solver's tests and benchmark. */
import { Decimal } from '../src/lib/money.js';
import { resolveRules } from '../src/services/compliance/provincialRules.js';
import type { PositionSpec } from '../src/services/scheduling/eligibility.js';
import type { SolverInput, SolverOptions, SolverPerson, SolverSlot } from '../src/services/scheduling/solver.js';
import { DEFAULT_WEIGHTS } from '../src/services/scheduling/solverSettings.js';
import { VAN, at } from './helpers.js';

export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const WEEK = '2026-07-05'; // a Sunday (pay week starts Sunday)
export const DAYS = ['2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11'];
export const RULES = resolveRules('BC', '2026-07-01');

export function position(id: string, certs: string[] = []): PositionSpec {
  return { id, minimumAge: null, requiredCertIds: certs, prerequisites: new Map() };
}

export const allWeek = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startMinute: 0, endMinute: 1440, effectiveFrom: '2026-01-01', effectiveTo: null }));

export function person(id: string, over: Partial<SolverPerson> = {}): SolverPerson {
  return {
    userId: id,
    status: 'ACTIVE',
    dateOfBirth: '1995-01-01',
    weeklyMaxHours: null,
    qualifiedPositionIds: new Set(['guard']),
    certExpiry: new Map([['nls', '2030-01-01']]),
    existingShifts: [],
    approvedTimeOff: [],
    availability: allWeek,
    employmentStatus: 'PART_TIME',
    seniorityDate: '2020-01-01',
    seniorityHours: 0,
    targetHours: null,
    primaryPositionId: 'guard',
    rates: new Map([['guard', 25]]),
    overtimeCharged: 0,
    prior: { hours: 0, weekends: 0, evenings: 0, weeks: 0 },
    confirmedThrough: null,
    ...over,
  };
}

export function slot(id: string, s: string, e: string, over: Partial<SolverSlot> & { positionId?: string; facilityId?: string; pos?: PositionSpec } = {}): SolverSlot {
  const positionId = over.positionId ?? 'guard';
  return {
    id,
    shift: { id, positionId, timezone: VAN, start: at(s), end: at(e), facilityId: over.facilityId ?? 'f1' },
    position: over.pos ?? position(positionId, positionId === 'guard' ? ['nls'] : []),
    rules: RULES,
    ...over,
  };
}

export function options(over: Partial<SolverOptions> = {}): SolverOptions {
  return {
    weights: { ...DEFAULT_WEIGHTS },
    useSeniority: false,
    avoidOvertime: true,
    payWeekStartDay: 0,
    travelMinutes: 30,
    maxConsecutiveDays: 6,
    maxDailyHours: 12,
    windowStart: at(`${WEEK} 00:00`),
    windowEnd: at('2026-07-12 00:00'),
    seed: 7,
    timeBudgetMs: 3000,
    ...over,
  };
}

/** A random city week: `nPeople` staff across positions and facilities, `nSlots` open shifts. */
export function randomWeek(seed: number, nPeople: number, nSlots: number, over: Partial<SolverOptions> = {}): SolverInput {
  const r = prng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
  const positions = [
    position('guard', ['nls']),
    position('instructor', ['wsi']),
    position('front'),
    position('ice', ['oro']),
    position('camp', ['hsfa']),
    position('maint'),
  ];
  const certFor: Record<string, string | undefined> = { guard: 'nls', instructor: 'wsi', ice: 'oro', camp: 'hsfa' };
  const facilities = ['f1', 'f2', 'f3', 'f4'];
  const statuses = ['FULL_TIME', 'PART_TIME', 'PART_TIME', 'CASUAL', 'CASUAL', 'ON_CALL'] as const;
  const people: SolverPerson[] = [];
  for (let k = 0; k < nPeople; k++) {
    const main = pick(positions).id;
    const second = r() < 0.35 ? pick(positions).id : null;
    const held = [main, ...(second && second !== main ? [second] : [])];
    const certs = new Map<string, string | null>();
    for (const pId of held) {
      const c = certFor[pId];
      // Most valid; a few expire mid-week or are missing.
      if (c && r() > 0.06) certs.set(c, r() < 0.08 ? '2026-07-08' : r() < 0.3 ? null : '2027-06-30');
    }
    const days = [0, 1, 2, 3, 4, 5, 6].filter(() => r() < 0.75);
    const availability = days.map((d) => (r() < 0.6 ? { dayOfWeek: d, startMinute: 0, endMinute: 1440, effectiveFrom: '2026-01-01', effectiveTo: null } : { dayOfWeek: d, startMinute: r() < 0.5 ? 6 * 60 : 12 * 60, endMinute: r() < 0.5 ? 18 * 60 : 23 * 60, effectiveFrom: '2026-01-01', effectiveTo: null }));
    const status = pick([...statuses]);
    const young = r() < 0.08;
    const timeOff = r() < 0.12 ? (() => {
      const d = pick(DAYS);
      return [{ start: at(`${d} 00:00`), end: at(`${d} 23:59`) }];
    })() : [];
    const existing = r() < 0.2 ? (() => {
      const d = pick(DAYS);
      return [{ start: at(`${d} 09:00`), end: at(`${d} 13:00`), positionId: main, facilityId: pick(facilities) }];
    })() : [];
    people.push({
      userId: `p${String(k).padStart(4, '0')}`,
      status: 'ACTIVE',
      dateOfBirth: young ? '2010-03-01' : `19${70 + Math.floor(r() * 30)}-0${1 + Math.floor(r() * 9)}-15`,
      weeklyMaxHours: r() < 0.2 ? new Decimal(pick([16, 20, 24, 32])) : null,
      qualifiedPositionIds: new Set(held),
      certExpiry: certs,
      existingShifts: existing,
      approvedTimeOff: timeOff,
      availability,
      employmentStatus: status,
      seniorityDate: `20${String(Math.floor(r() * 25)).padStart(2, '0')}-0${1 + Math.floor(r() * 9)}-01`,
      seniorityHours: Math.floor(r() * 5000),
      targetHours: status === 'FULL_TIME' ? 37.5 : status === 'PART_TIME' && r() < 0.5 ? 20 : null,
      primaryPositionId: main,
      rates: new Map(held.map((p) => [p, 18 + Math.floor(r() * 20)])),
      overtimeCharged: Math.floor(r() * 30),
      prior: { hours: 0, weekends: 0, evenings: 0, weeks: 0 },
      confirmedThrough: r() < 0.5 ? '2026-07-20' : null,
    });
  }
  const slots: SolverSlot[] = [];
  const starts = [6, 7, 8, 10, 12, 14, 16, 17];
  for (let k = 0; k < nSlots; k++) {
    const d = pick(DAYS);
    const st = pick(starts);
    const len = pick([4, 5, 6, 8]);
    const p = pick(positions);
    const end = Math.min(st + len, 23);
    slots.push({
      id: `s${String(k).padStart(4, '0')}`,
      shift: { id: `s${k}`, positionId: p.id, timezone: VAN, start: at(`${d} ${String(st).padStart(2, '0')}:00`), end: at(`${d} ${String(end).padStart(2, '0')}:00`), facilityId: pick(facilities) },
      position: p,
      rules: RULES,
      tentative: r() < 0.1,
    });
  }
  for (const s of slots) s.shift.id = s.id;
  return {
    slots,
    people,
    coverage: [{ id: 'oro', name: 'Refrigeration operator on site', facilityId: 'f3', certificationId: 'oro', minCount: 1, windows: DAYS.map((d) => ({ start: at(`${d} 08:00`), end: at(`${d} 20:00`) })) }],
    options: options(over),
  };
}
