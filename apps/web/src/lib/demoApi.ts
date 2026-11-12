/**
 * In-browser stand-in for the API, used only by the static demo build.
 * GET requests replay responses recorded from a real local stack
 * (demoFixtures.ts); changes are accepted but not kept. The shift board is
 * simulated so claiming, overtime approval and refusal reasons can be tried; a few everyday
 * actions (a sent message, an answered survey, saved preferences or bids) last for the visit
 * (demoSession.ts).
 * Real eligibility and overtime decisions are made server-side by the API.
 */
import { ApiError } from './apiError';
import { demoConsoleNotes, demoWhatsNew } from './demoUpdates';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, type DemoAccount } from './demo';
import { type DemoRole, type Fixtures, loadFixtures } from './demoFixtures';
import * as plan from './demoPlanner';
import { loadSession, saveSession, sessionRead, sessionWrite } from './demoSession';
import type { Board } from './planner';
import type { FillWeek } from './fill';
import type { TemplatesView } from './shiftTemplates';

const FACILITY = { name: 'Lakeview Aquatic Centre', timezone: 'America/Vancouver' };
const OFFSET = '-07:00';
const STORE_KEY = 'flexcity-demo-v2';
const PLATFORM_KEY = 'flexcity-demo-platform';

interface DemoShift {
  offerId: string;
  day: number; // days from today
  start: string; // HH:MM facility-local
  end: string;
  position: { name: string; nameFr: string };
  /** A refusal this demo shift always returns, to show how reasons are explained. */
  alwaysBlocked?: string;
}

const LIFEGUARD = { name: 'Lifeguard', nameFr: 'Sauveteur' };
const INSTRUCTOR = { name: 'Swim Instructor', nameFr: 'Moniteur de natation' };

const SHIFTS: DemoShift[] = [
  { offerId: 'o1', day: 2, start: '15:00', end: '19:00', position: LIFEGUARD },
  { offerId: 'o2', day: 2, start: '16:00', end: '20:00', position: INSTRUCTOR },
  { offerId: 'o3', day: 3, start: '06:00', end: '17:00', position: LIFEGUARD },
  { offerId: 'o4', day: 5, start: '09:00', end: '13:00', position: INSTRUCTOR, alwaysBlocked: 'CERTIFICATION_EXPIRES' },
  { offerId: 'o5', day: 6, start: '12:00', end: '16:00', position: LIFEGUARD },
];

interface State {
  signedIn: boolean;
  account?: string;
  read?: boolean;
  claimed: string[]; // offer ids assigned to the demo user
  pending: string[]; // offer ids awaiting supervisor approval
}

function load(): State {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch {
    /* storage unavailable — fall through */
  }
  return { signedIn: false, claimed: [], pending: [] };
}

function save(s: State) {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* demo still works for this page view */
  }
}

function localDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const hours = (s: DemoShift) => (minutes(s.end) - minutes(s.start)) / 60;
const overlaps = (a: DemoShift, b: DemoShift) => a.day === b.day && minutes(a.start) < minutes(b.end) && minutes(a.end) > minutes(b.start);

function toOffer(s: DemoShift, state: State) {
  const date = localDay(s.day);
  const localStartsAt = `${date}T${s.start}:00.000${OFFSET}`;
  const localEndsAt = `${date}T${s.end}:00.000${OFFSET}`;
  return {
    id: s.offerId,
    status: state.pending.includes(s.offerId) ? 'PENDING_APPROVAL' : 'OPEN',
    shift: {
      id: `s-${s.offerId}`,
      version: 0,
      startsAt: new Date(localStartsAt).toISOString(),
      endsAt: new Date(localEndsAt).toISOString(),
      localStartsAt,
      localEndsAt,
      facility: FACILITY,
      position: s.position,
    },
  };
}

const delay = () => new Promise((r) => setTimeout(r, 200));
const roleOf = (email: string) => email.split('@')[0] as DemoRole;

const cache = new Map<string, Promise<Fixtures>>();
const fixtures = (role: DemoRole | 'public' | 'platform') => {
  if (!cache.has(role)) cache.set(role, loadFixtures(role));
  return cache.get(role)!;
};

const SAMPLE_CSV = [
  'employee_number,pay_code,hours,rate,amount,cost_centre,period_start,period_end',
  'E101,REG,62.50,24.75,1546.88,CC-405-AQUATICS,{{start}},{{end}}',
  'E103,REG,48.00,22.50,1080.00,CC-405-AQUATICS,{{start}},{{end}}',
  'E103,OT_1.5,3.00,33.75,101.25,CC-405-AQUATICS,{{start}},{{end}}',
  'E103,VAC_PAY_4,0.00,0.00,47.25,CC-405-AQUATICS,{{start}},{{end}}',
].join('\r\n');

export async function demoApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  await delay();
  const state = load();
  const method = init.method ?? 'GET';

  if (path === '/api/public/jobs' || path === '/api/public/signup') return (await fixtures('public')).get(path) as T;
  // Public sign-up: open times from the recorded sample whatever date is picked; sign-ups aren't sent anywhere.
  const slots = /^\/api\/public\/services\/([^/]+)\/slots/.exec(path);
  if (slots) return (((await fixtures('public')).get('slots') as Record<string, unknown[]> | undefined)?.[slots[1]!] ?? []) as T;
  if (path === '/api/public/registrations' && method === 'POST') return { reference: 'R-DEMO42', status: 'ENROLLED', priceCents: 9500 } as T;
  if (path === '/api/public/bookings' && method === 'POST') return { reference: 'B-DEMO42' } as T;

  if (path === '/api/auth/login' && method === 'POST') {
    const { email, password } = (init.body ?? {}) as { email?: string; password?: string };
    const account = String(email).toLowerCase() as DemoAccount;
    if (!DEMO_ACCOUNTS.includes(account) || password !== DEMO_PASSWORD) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    const me = (await fixtures(roleOf(account))).get('/api/me') as { id: string; firstName: string; roles: string[] };
    save({ signedIn: true, account, claimed: [], pending: [] });
    plan.savePlan(null);
    saveSession(null);
    return { accessToken: 'demo', user: { id: me.id, firstName: me.firstName, roles: me.roles, locale: 'en-CA' } } as T;
  }
  if (path === '/api/auth/logout') {
    save({ signedIn: false, claimed: [], pending: [] });
    plan.savePlan(null);
    saveSession(null);
    return undefined as T;
  }
  if (path.startsWith('/api/auth/')) throw new ApiError(404, 'NOT_IN_DEMO', 'This feature is not available in the demo.');

  if (!state.signedIn || !state.account) throw new ApiError(401, 'UNAUTHENTICATED', 'Not signed in');
  const data = await fixtures(roleOf(state.account));
  // What's new: a sample note (lib/demoUpdates.ts), not part of the recordings.
  const updates = demoWhatsNew(path, method);
  if (updates !== undefined) return updates as T;

  if (path === '/api/shiftboard/offers') {
    return SHIFTS.filter((s) => !state.claimed.includes(s.offerId)).map((s) => toOffer(s, state)) as T;
  }
  const claim = /^\/api\/offers\/([^/]+)\/claim$/.exec(path);
  if (claim && method === 'POST') {
    const shift = SHIFTS.find((s) => s.offerId === claim[1]);
    if (!shift || state.claimed.includes(shift.offerId) || state.pending.includes(shift.offerId)) {
      throw new ApiError(409, 'SHIFT_ALREADY_CLAIMED', 'This shift has already been claimed.');
    }
    const blocks: Array<{ code: string }> = [];
    if (shift.alwaysBlocked) blocks.push({ code: shift.alwaysBlocked });
    const mine = SHIFTS.filter((s) => state.claimed.includes(s.offerId) || state.pending.includes(s.offerId));
    if (mine.some((m) => overlaps(m, shift))) blocks.push({ code: 'OVERLAPPING_SHIFT' });
    if (blocks.length) throw new ApiError(422, 'NOT_ELIGIBLE', 'You are not eligible for this shift.', { blocks });
    // BC: overtime after 8 hours in a day.
    const ot = hours(shift) - 8;
    if (ot > 0) {
      save({ ...state, pending: [...state.pending, shift.offerId] });
      return { outcome: 'PENDING_APPROVAL', overtimeHours: ot.toFixed(2) } as T;
    }
    save({ ...state, claimed: [...state.claimed, shift.offerId] });
    return { outcome: 'ASSIGNED' } as T;
  }

  if (path.startsWith('/api/notifications/read')) {
    save({ ...state, read: true });
    return { updated: 1 } as T;
  }
  if (path.startsWith('/api/notifications') && method === 'GET') {
    const r = data.get('/api/notifications') as { items: Array<{ readAt: string | null }>; unreadCount: number };
    if (!state.read) return r as T;
    const items = r.items.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() }));
    return { items, unreadCount: 0 } as T;
  }

  if (method === 'DOWNLOAD') {
    const q = new URL(path, 'http://demo').searchParams;
    const start = q.get('periodStart') ?? '';
    const end = start ? new Date(Date.parse(`${start}T12:00:00Z`) + (Number(q.get('weeks') ?? 2) * 7 - 1) * 86_400_000).toISOString().slice(0, 10) : '';
    const csv = SAMPLE_CSV.replaceAll('{{start}}', start).replaceAll('{{end}}', end);
    return { ok: true, blob: new Blob([csv], { type: 'text/csv' }), headers: new Headers() } as T;
  }

  // The schedule builder's batch check is a POST that only reads: replay the recorded answer.
  if (path === '/api/schedule/planner/eligibility' && method === 'POST') return (data.get(path) ?? { users: [], reasons: [], shifts: {}, days: {}, evaluations: 0, ms: 0 }) as T;
  // HR's conversation lookup (a POST with a reason): the recorded person's list, only for that person.
  const lookup = /^\/api\/messages-admin\/people\/([^/]+)\/conversations$/.exec(path);
  if (lookup && method === 'POST') {
    const name = ((data.get('/api/messages/people') as { people?: Array<{ id: string; name: string }> } | undefined)?.people ?? []).find((p) => p.id === lookup[1])?.name;
    const list = (data.get(path) as Array<{ members: Array<string | null> }> | undefined) ?? [];
    return (name ? list.filter((c) => c.members.includes(name)) : []) as T;
  }
  const session = loadSession();
  if (method !== 'GET') {
    const kept = sessionWrite(session, path, method, (init.body ?? {}) as Record<string, unknown>, { me: data.get('/api/me') as { id: string }, templates: data.get('/api/schedule/templates') as TemplatesView | undefined });
    if (kept) {
      saveSession(kept.state);
      return kept.response as T;
    }
  }
  const planned = plannerApi(data, path, method, (init.body ?? {}) as Record<string, unknown>);
  if (planned !== undefined) return planned as T;

  if (method === 'GET') {
    const body = data.get(path);
    if (body === undefined) throw new ApiError(404, 'NOT_IN_DEMO', 'This feature is not available in the demo.');
    return sessionRead(session, path, body) as T;
  }

  // Changes look like they worked, but nothing is kept (the banner says so).
  return { id: 'demo', ok: true, outcome: 'ASSIGNED', outOfRange: false, reasons: [], locationStatus: 'ON_SITE' } as T;
}

/** The board the planner last showed (writes don't say which department they're for). */
let planBase: Board | null = null;
function baseBoard(data: Fixtures): Board | null {
  if (planBase) return planBase;
  const options = data.get('/api/schedule/fill/options') as { defaultDepartmentId?: string | null; departments?: Array<{ id: string }> } | undefined;
  const dep = options?.defaultDepartmentId ?? options?.departments?.[0]?.id;
  return dep ? ((data.get(`/api/schedule/planner?departmentId=${dep}`) as Board | undefined) ?? null) : null;
}

/**
 * The schedule builder (and Fill the schedule) on the recorded board, with this tab's changes
 * kept in session storage. Returns undefined for anything it doesn't handle.
 */
function plannerApi(data: Fixtures, path: string, method: string, body: Record<string, unknown>): unknown {
  const url = new URL(path, 'http://demo');
  const p = url.pathname;
  if (method === 'GET' && p === '/api/schedule/planner') {
    const q = url.searchParams;
    // One board recorded per department, a few weeks long; the facility filter is applied here.
    const base = data.get(`/api/schedule/planner?departmentId=${q.get('departmentId')}`) as Board | undefined;
    if (!base?.shifts) return undefined;
    planBase = base;
    return plan.boardFor(base, plan.loadPlan(), q.get('from') ?? base.range.from, q.get('to') ?? base.range.to, q.get('facilityIds')?.split(',').filter(Boolean));
  }
  if (method === 'GET') return undefined;
  if (p === '/api/schedule/fill/run') {
    const recorded = data.get(`/api/schedule/fill/run?week=${Number(body.weekIndex ?? 0)}`) as FillWeek | undefined;
    const base = baseBoard(data);
    if (recorded && base) return plan.fillWeek(base, plan.loadPlan(), recorded);
    const start = String(body.weekStart ?? '');
    return { week: { start, index: Number(body.weekIndex ?? 0), tentative: false, beyondWindowFrom: start }, settings: { useSeniority: false, toggles: body.toggles, planAheadWeeks: 2 }, summary: { slots: 0, filled: 0, overtimeHours: 0, overtimeCost: 0, hours: { stdev: 0 }, ms: 0 }, proposals: [], unfilled: [], coverageGaps: [], slots: [], people: {}, carry: [] };
  }
  if (p === '/api/forecast/preview-shifts') return data.get(`/api/forecast/preview-shifts?facilityId=${String(body.facilityId)}&positionId=${String(body.positionId)}`) ?? { shifts: [] };
  if (p === '/api/schedule/rotations/generate') return { created: 0, assigned: 0, open: 0, items: [] };
  if (p === '/api/shifts/publish/check') return plan.publishCheck();

  const base = baseBoard(data);
  if (!base) return undefined;
  const state = plan.loadPlan();
  const keep = <R extends { plan: plan.PlanState }>(r: R) => {
    plan.savePlan(r.plan);
    const { plan: _p, ...rest } = r;
    return rest;
  };
  try {
    let m: RegExpExecArray | null;
    if ((m = /^\/api\/shifts\/([^/]+)\/assign$/.exec(p))) {
      plan.savePlan(plan.assign(base, state, m[1]!, (body.userId as string | null) ?? null));
      return { ok: true, flags: [] };
    }
    if ((m = /^\/api\/schedule\/planner\/shifts\/([^/]+)\/move$/.exec(p))) return keep(plan.move(base, state, m[1]!, body as plan.MoveBody));
    if ((m = /^\/api\/schedule\/planner\/shifts\/([^/]+)\/assign-many$/.exec(p))) return keep(plan.assignMany(base, state, m[1]!, (body.userIds as string[]) ?? []));
    if (p === '/api/schedule/planner/shifts') return keep(plan.create(base, state, body as unknown as plan.CreateBody));
    if (p === '/api/schedule/planner/cancel') {
      const ids = (body.shiftIds as string[]) ?? [];
      plan.savePlan(plan.cancel(base, state, ids));
      return { cancelled: ids.length, kept: [] };
    }
    if ((m = /^\/api\/shifts\/([^/]+)\/cancel$/.exec(p)) && plan.shiftsOf(base, state).some((s) => s.id === m![1])) {
      plan.savePlan(plan.cancel(base, state, [m[1]!]));
      return { ok: true };
    }
    if (p === '/api/schedule/planner/copy') return keep(plan.copyRange(base, state, body as { from: string; to: string; days: number }));
    if (p === '/api/shifts/publish') return keep(plan.publish(base, state, body as { facilityId: string; from: string; to: string; shiftIds?: string[] }));
    if (p === '/api/schedule/fill/accept') return keep(plan.fillAccept(base, state, (body.items as Parameters<typeof plan.fillAccept>[2]) ?? []));
    if (p === '/api/schedule/fill/undo') return keep(plan.fillUndo(base, state, (body.undoIds as string[]) ?? []));
  } catch (e) {
    // A shift the planner never showed (another screen's): the plain "looks saved" answer.
    if (e instanceof ApiError && e.code === 'NOT_FOUND') return undefined;
    throw e;
  }
  return undefined;
}

/**
 * A screen asked with options nobody recorded (Trust's Overview with another framework scope, say):
 * answer with the recording of the same address that shares the most of its options.
 */
export function nearest(data: Fixtures, path: string): unknown {
  const u = new URL(path, 'http://demo');
  const want = [...u.searchParams.entries()].map(([k, v]) => `${k}=${v}`);
  let best: { key: string; score: number } | null = null;
  for (const key of data.keys()) {
    const k = new URL(key, 'http://demo');
    if (k.pathname !== u.pathname) continue;
    const score = [...k.searchParams.entries()].filter(([a, b]) => want.includes(`${a}=${b}`)).length;
    if (!best || score > best.score) best = { key, score };
  }
  return best ? data.get(best.key) : undefined;
}

/** What a Dev console download saves in the demo: a short note in both languages, no data. */
export function demoPlatformFile(name: string): Blob {
  return new Blob([`${name}\n\nFlexcityHeadquarters demo: this file would come from the Dev console. The demo has sample data only, so there is nothing to download.\n\nDémonstration de FlexcityHeadquarters : ce fichier viendrait de la console Dev. La démonstration n’a que des données fictives, donc il n’y a rien à télécharger.\n`], { type: 'text/plain' });
}

/** Dev console in the static demo: recorded responses; changes look saved but aren't kept. */
/** Menus-and-access switches flipped in this demo session (never saved). */
const demoAccess = new Map<string, unknown>();

export async function demoPlatformApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  await delay();
  const method = init.method ?? 'GET';
  const signedIn = () => {
    try {
      return sessionStorage.getItem(PLATFORM_KEY) === '1';
    } catch {
      return false;
    }
  };
  const setSignedIn = (on: boolean) => {
    try {
      if (on) sessionStorage.setItem(PLATFORM_KEY, '1');
      else sessionStorage.removeItem(PLATFORM_KEY);
    } catch {
      /* fine */
    }
  };
  if (path === '/auth/login' && method === 'POST') {
    const { email, password } = (init.body ?? {}) as { email?: string; password?: string };
    if (String(email).toLowerCase() !== 'dev@flexcity.dev' || password !== DEMO_PASSWORD) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    setSignedIn(true);
    return { admin: { id: 'demo-dev', email: 'dev@flexcity.dev', name: 'FH Dev' } } as T;
  }
  if (path === '/auth/logout') {
    setSignedIn(false);
    return undefined as T;
  }
  if (!signedIn()) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to the Dev console');
  const data = await fixtures('platform');
  const notes = demoConsoleNotes(path, method);
  if (notes !== undefined) return notes as T;

  const preview = /^\/tenants\/([^/]+)\/import(\/preview)?$/.exec(path);
  if (preview && method === 'POST') {
    const city = data.get(`/tenants/${preview[1]}`) as { positions: Array<{ id: string; name: string; nameFr: string | null }> };
    const { previewImport } = await import('../../../api/src/services/platform/staffImport');
    const result = previewImport(String((init.body as { csv?: string }).csv ?? ''), { existingEmails: new Set(), positions: city.positions, today: new Date().toISOString().slice(0, 10) });
    if (preview[2]) return result as T;
    return { created: result.summary.create, exists: 0, errors: result.summary.error, invited: 0 } as T;
  }
  // Menus and access: flip switches in the browser so the demo console feels real (nothing is saved).
  const access = /^\/tenants\/([^/]+)\/access\/(menu|permission|reset|mfa)$/.exec(path);
  if (access) {
    const key = `/tenants/${access[1]}/access`;
    const current = (demoAccess.get(key) ?? data.get(key)) as { roles: Array<{ role: string; mfa?: boolean; customized: boolean; permissions: string[]; defaults: string[]; menu: Array<{ href: string; shown: boolean }> }> } | undefined;
    if (!current) throw new ApiError(404, 'NOT_IN_DEMO', 'This feature is not available in the demo.');
    const b = (init.body ?? {}) as { role: string; href?: string; shown?: boolean; permission?: string; on?: boolean; required?: boolean };
    const next = structuredClone(current);
    const r = next.roles.find((x) => x.role === b.role);
    if (r && access[2] === 'mfa') r.mfa = !!b.required;
    else if (r) {
      if (access[2] === 'menu') r.menu = r.menu.map((m) => (m.href === b.href ? { ...m, shown: !!b.shown } : m));
      if (access[2] === 'permission') r.permissions = b.on ? [...new Set([...r.permissions, b.permission!])] : r.permissions.filter((p) => p !== b.permission);
      r.customized = true;
    }
    if (access[2] === 'reset') {
      // Back to the recorded city for that role.
      const recorded = data.get(key) as typeof current;
      const i = next.roles.findIndex((x) => x.role === b.role);
      const orig = recorded.roles.find((x) => x.role === b.role);
      if (i >= 0 && orig) next.roles[i] = structuredClone(orig);
    }
    demoAccess.set(key, next);
    return next as T;
  }
  // A new organization opens the recorded demo city (nothing is created).
  if (path === '/tenants' && method === 'POST') return { id: ((data.get('/tenants') as Array<{ id: string }>)[0] ?? { id: 'demo' }).id } as T;
  if (method === 'GET') {
    const body = demoAccess.get(path) ?? data.get(path) ?? nearest(data, path);
    if (body === undefined) throw new ApiError(404, 'NOT_IN_DEMO', 'This feature is not available in the demo.');
    // Open the demo's own sign-in page instead of a recorded local address.
    const city = body as { organization?: { signInUrl?: string } };
    if (city.organization?.signInUrl) city.organization.signInUrl = `${window.location.origin}${window.location.pathname.split('/platform')[0]}/login/`;
    return body as T;
  }
  return { id: 'demo', ok: true } as T;
}
