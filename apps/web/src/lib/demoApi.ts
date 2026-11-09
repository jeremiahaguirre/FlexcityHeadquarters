/**
 * In-browser stand-in for the API, used only by the static demo build.
 * GET requests replay responses recorded from a real local stack
 * (demoFixtures.ts); changes are accepted but not kept. The shift board is
 * simulated so claiming, overtime approval and refusal reasons can be tried.
 * Real eligibility and overtime decisions are made server-side by the API.
 */
import { ApiError } from './apiError';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, type DemoAccount } from './demo';
import { type DemoRole, type Fixtures, loadFixtures } from './demoFixtures';

const FACILITY = { name: 'Lakeview Aquatic Centre', timezone: 'America/Vancouver' };
const OFFSET = '-07:00';
const STORE_KEY = 'flexcity-demo-v2';

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
const fixtures = (role: DemoRole | 'public') => {
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

  if (path === '/api/public/jobs') return (await fixtures('public')).get(path) as T;

  if (path === '/api/auth/login' && method === 'POST') {
    const { email, password } = (init.body ?? {}) as { email?: string; password?: string };
    const account = String(email).toLowerCase() as DemoAccount;
    if (!DEMO_ACCOUNTS.includes(account) || password !== DEMO_PASSWORD) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    const me = (await fixtures(roleOf(account))).get('/api/me') as { id: string; firstName: string; roles: string[] };
    save({ signedIn: true, account, claimed: [], pending: [] });
    return { accessToken: 'demo', user: { id: me.id, firstName: me.firstName, roles: me.roles, locale: 'en-CA' } } as T;
  }
  if (path === '/api/auth/logout') {
    save({ signedIn: false, claimed: [], pending: [] });
    return undefined as T;
  }
  if (path.startsWith('/api/auth/')) throw new ApiError(404, 'NOT_IN_DEMO', 'This feature is not available in the demo.');

  if (!state.signedIn || !state.account) throw new ApiError(401, 'UNAUTHENTICATED', 'Not signed in');
  const data = await fixtures(roleOf(state.account));

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

  if (method === 'GET') {
    const body = data.get(path);
    if (body === undefined) throw new ApiError(404, 'NOT_IN_DEMO', 'This feature is not available in the demo.');
    return body as T;
  }

  // Changes look like they worked, but nothing is kept (the banner says so).
  return { id: 'demo', ok: true, outcome: 'ASSIGNED', outOfRange: false, reasons: [], locationStatus: 'ON_SITE' } as T;
}

/** Dev console in the static demo (filled from recorded responses in demoFixtures). */
export async function demoPlatformApi<T>(_path: string, _init: { method?: string; body?: unknown } = {}): Promise<T> {
  await delay();
  throw new ApiError(404, 'NOT_IN_DEMO', 'This feature is not available in the demo.');
}
