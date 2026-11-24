/**
 * Recorded answers whose times only make sense relative to "now". The recordings move by whole
 * days (demoFixtures.ts), which keeps a schedule on the right dates but leaves a punch that is still
 * open, or a lone-worker session that is still running, a day or more old ("27:20 worked"). These
 * answers are moved to the current time: the open punch started a few hours ago, and each running
 * lone-work session started earlier today and is checking in on its interval.
 */
import { deviceLocalIso } from './offlinePunches';

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** The open punch began this long before now (and its shift on the quarter hour before that). */
export const OPEN_PUNCH_MINUTES = 3 * 60 + 12;

interface OpenPunch { clockIn: string; localClockIn: string; localClockOut?: string | null; shift?: { startsAt?: string; endsAt?: string } | null }
interface LoneWork { status: string; endedAt: string | null; intervalMinutes: number; startedAt: string; lastCheckInAt: string | null; nextDueAt: string | null; overdueAt: string | null }

function livePunch<T extends OpenPunch>(p: T, now: number): T {
  const clockIn = now - OPEN_PUNCH_MINUTES * MIN;
  const shiftStart = Math.ceil(clockIn / (15 * MIN)) * 15 * MIN;
  const out: T = { ...p, clockIn: iso(clockIn), localClockIn: deviceLocalIso(iso(clockIn)) };
  if (p.shift?.startsAt && p.shift.endsAt) {
    const length = Date.parse(p.shift.endsAt) - Date.parse(p.shift.startsAt);
    out.shift = { ...p.shift, startsAt: iso(shiftStart), endsAt: iso(shiftStart + length) };
  }
  return out;
}

function liveSession<T extends LoneWork>(s: T, now: number): T {
  if (s.endedAt) return s;
  const every = s.intervalMinutes * MIN;
  if (s.status === 'OVERDUE') {
    // Missed the last check-in by 25 minutes.
    const last = now - every - 25 * MIN;
    return { ...s, startedAt: iso(last - every), lastCheckInAt: iso(last), nextDueAt: iso(last + every), overdueAt: iso(last + every + 5 * MIN) };
  }
  // Checked in 20 minutes ago.
  const last = now - 20 * MIN;
  return { ...s, startedAt: iso(last - every), lastCheckInAt: iso(last), nextDueAt: iso(last + every), overdueAt: null };
}

/** The recorded answer for `path`, with "still running" times moved to now. Other answers are unchanged. */
export function liveTimes<T>(path: string, body: T, now = Date.now()): T {
  const route = path.split('?')[0];
  if (route === '/api/me/punch/open') return (body ? livePunch(body as unknown as OpenPunch, now) : body) as T;
  if (route === '/api/me/punches' && Array.isArray(body)) {
    return body.map((p: OpenPunch) => (p.localClockOut === null ? livePunch(p, now) : p)) as T;
  }
  if (route === '/api/me/lone-work') return (body ? liveSession(body as unknown as LoneWork, now) : body) as T;
  if (route === '/api/lone-work' && Array.isArray(body)) return body.map((s: LoneWork) => liveSession(s, now)) as T;
  return body;
}
