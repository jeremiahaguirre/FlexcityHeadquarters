/**
 * In-browser stand-in for the API, used only by the static demo build.
 * Responses have the same shapes and error codes as the real API so the UI
 * code paths are identical. The rules here are a simplified illustration —
 * real eligibility and overtime decisions are made server-side by the API.
 */
import { ApiError } from './apiError';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from './demo';

const FACILITY = { name: 'Lakeview Aquatic Centre', timezone: 'America/Vancouver' };
const OFFSET = '-07:00';
const STORE_KEY = 'flexcity-demo-v1';

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

const POOLS = [
  { id: 'p1', name: 'Main Tank', kind: 'POOL', status: 'OPEN', facility: { id: 'f1', name: FACILITY.name } },
  { id: 'p2', name: 'Leisure Pool', kind: 'LEISURE_POOL', status: 'OPEN', facility: { id: 'f1', name: FACILITY.name } },
  { id: 'p3', name: 'Hot Tub', kind: 'HOT_TUB', status: 'CLOSURE_RECOMMENDED', facility: { id: 'f1', name: FACILITY.name } },
];

const STAFF_PERMS = ['schedule.read', 'shiftboard.claim', 'shiftboard.post', 'availability.self', 'timeoff.self', 'timeclock.punch', 'ops.chemical.record', 'incidents.create'];
const PEOPLE: Record<string, { firstName: string; lastName: string; roles: string[]; permissions: string[] }> = {
  'guard@demo.flexcity': { firstName: 'Jordan', lastName: 'Singh', roles: ['STAFF'], permissions: STAFF_PERMS },
  'supervisor@demo.flexcity': {
    firstName: 'Sam',
    lastName: 'Okafor',
    roles: ['AQUATIC_SUPERVISOR'],
    permissions: [...STAFF_PERMS, 'users.read', 'certs.verify', 'schedule.write', 'schedule.assist', 'shiftboard.approve', 'shiftboard.assign_emergency', 'timeoff.approve', 'timeclock.review', 'payroll.export', 'ops.chemical.signoff', 'ops.pool.close', 'ops.status.read', 'incidents.read', 'positions.manage', 'users.scheduling'],
  },
  'frontdesk@demo.flexcity': { firstName: 'Casey', lastName: 'Martin', roles: ['FRONT_DESK'], permissions: ['schedule.read', 'ops.status.read', 'ops.page_head_guard', 'timeclock.punch'] },
};

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const NOTES = [
  { id: 'n1', type: 'shift_available', params: {}, link: '/board', readAt: null, createdAt: minutesAgo(12) },
  { id: 'n2', type: 'schedule_published', params: { count: 4 }, link: '/board', readAt: null, createdAt: minutesAgo(95) },
  { id: 'n3', type: 'cert_verified', params: { name: 'National Lifeguard' }, link: null, readAt: minutesAgo(60), createdAt: minutesAgo(60 * 26) },
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

const delay = () => new Promise((r) => setTimeout(r, 250));

export async function demoApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  await delay();
  const state = load();
  const method = init.method ?? 'GET';

  if (path === '/api/auth/login' && method === 'POST') {
    const { email, password } = (init.body ?? {}) as { email?: string; password?: string };
    if (!DEMO_ACCOUNTS.includes(String(email).toLowerCase() as (typeof DEMO_ACCOUNTS)[number]) || password !== DEMO_PASSWORD) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    const who = PEOPLE[String(email).toLowerCase()]!;
    save({ ...state, signedIn: true, account: String(email).toLowerCase() });
    return { accessToken: 'demo', user: { id: 'demo-user', firstName: who.firstName, roles: who.roles, locale: 'en-CA' } } as T;
  }
  if (path === '/api/auth/logout') {
    save({ signedIn: false, claimed: [], pending: [] });
    return undefined as T;
  }

  if (!state.signedIn) throw new ApiError(401, 'UNAUTHENTICATED', 'Not signed in');

  if (path === '/api/me') {
    const email = state.account ?? 'guard@demo.flexcity';
    const who = PEOPLE[email] ?? PEOPLE['guard@demo.flexcity']!;
    return {
      id: 'demo-user',
      ...who,
      email,
      phone: null,
      locale: 'en-CA',
      employmentStatus: 'PART_TIME',
      positions: [{ id: 'p1', ...LIFEGUARD }],
      certifications: [],
    } as T;
  }

  if (path.startsWith('/api/notifications/read')) {
    save({ ...state, read: true });
    return { updated: 2 } as T;
  }
  if (path.startsWith('/api/notifications')) {
    const items = NOTES.map((n) => (state.read ? { ...n, readAt: n.readAt ?? minutesAgo(1) } : n));
    return { items, unreadCount: items.filter((n) => !n.readAt).length } as T;
  }

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

  if (path === '/api/ops/status') return POOLS as T;

  throw new ApiError(404, 'NOT_IN_DEMO', 'This feature is not available in the demo.');
}
