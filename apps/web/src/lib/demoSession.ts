/**
 * The static demo's memory for a few everyday actions, so they can be tried end to end: a message
 * you send stays in its conversation, an answered survey shows as answered, saved shift preferences
 * and a saved bid ranking come back as saved, and a weekly template's preview counts its shifts.
 * Kept in this tab's session storage (cleared on sign-in and sign-out); nothing leaves the browser.
 * The real rules (who may message whom, anonymity, award order, holidays) are the API's.
 */
import type { MyRound } from './bidding';
import type { ChatMessage, ConversationDetail, ConversationSummary } from './messages';
import type { ApplyResult, PreferenceWindow, ShiftTemplate, TemplatesView } from './shiftTemplates';
import type { MySurvey } from './surveys';

const KEY = 'flexcity-demo-session';

export interface SessionState {
  /** Messages sent in this visit, per conversation. */
  sent: Record<string, ChatMessage[]>;
  /** Surveys answered in this visit. */
  answered: string[];
  preferences: { preferences: PreferenceWindow[]; maxWeeklyHours: number | null; maxDaysPerWeek: number | null; updatedAt: string } | null;
  /** Bid rankings saved in this visit, per round. */
  bids: Record<string, string[]>;
}

export const emptySession = (): SessionState => ({ sent: {}, answered: [], preferences: null, bids: {} });

export function loadSession(): SessionState {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return { ...emptySession(), ...(JSON.parse(raw) as Partial<SessionState>) };
  } catch {
    /* storage unavailable */
  }
  return emptySession();
}

export function saveSession(s: SessionState | null) {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* the demo still works for this page view */
  }
}

export interface Me { id: string; firstName?: string; lastName?: string }

/**
 * A write this module keeps: the new state and the answer to give. Undefined when it isn't one of
 * them (the demo's usual "looks saved" answer applies).
 */
export function sessionWrite(s: SessionState, path: string, method: string, body: Record<string, unknown>, ctx: { me: Me; now?: Date; templates?: TemplatesView }): { state: SessionState; response: unknown } | undefined {
  const now = (ctx.now ?? new Date()).toISOString();
  let m: RegExpExecArray | null;
  if (method === 'POST' && (m = /^\/api\/messages\/conversations\/([^/]+)\/messages$/.exec(path))) {
    const text = String(body.text ?? '').trim();
    if (!text) return undefined;
    const list = s.sent[m[1]!] ?? [];
    const msg: ChatMessage = { id: `demo-msg-${list.length + 1}`, authorId: ctx.me.id, author: [ctx.me.firstName, ctx.me.lastName].filter(Boolean).join(' ') || null, mine: true, text, removed: false, createdAt: now, editedAt: null, attachment: null, canEdit: false };
    return { state: { ...s, sent: { ...s.sent, [m[1]!]: [...list, msg] } }, response: msg };
  }
  if (method === 'POST' && (m = /^\/api\/me\/surveys\/([^/]+)\/answers$/.exec(path))) {
    return { state: { ...s, answered: [...new Set([...s.answered, m[1]!])] }, response: { ok: true } };
  }
  if (method === 'PUT' && path === '/api/me/preferences') {
    const preferences = ((body.preferences as PreferenceWindow[] | undefined) ?? []).map((w, i) => ({ ...w, id: `demo-pref-${i + 1}` }));
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return { state: { ...s, preferences: { preferences, maxWeeklyHours: num(body.maxWeeklyHours), maxDaysPerWeek: num(body.maxDaysPerWeek), updatedAt: now } }, response: { ok: true } };
  }
  if (method === 'PUT' && (m = /^\/api\/me\/bids\/([^/]+)\/choices$/.exec(path))) {
    const ids = ((body.itemIds as unknown[] | undefined) ?? []).map(String);
    return { state: { ...s, bids: { ...s.bids, [m[1]!]: ids } }, response: { ok: true, choices: ids.length } };
  }
  if (method === 'POST' && (m = /^\/api\/schedule\/templates\/([^/]+)\/apply$/.exec(path))) {
    const t = ctx.templates?.templates.find((x) => x.id === m![1]);
    if (!t) return undefined;
    const r = templatePreview(t, String(body.from ?? ''), String(body.to ?? ''));
    return { state: s, response: body.dryRun ? r : { ...r, applicationId: r.created ? 'demo-application' : null } };
  }
  return undefined;
}

/** A recorded GET answer with this visit's changes on top. Returns the body unchanged otherwise. */
export function sessionRead(s: SessionState, path: string, body: unknown): unknown {
  if (body === undefined || body === null) return body;
  const m = /^\/api\/messages\/conversations\/([^/?]+)$/.exec(path);
  if (m && s.sent[m[1]!]?.length) {
    const c = body as ConversationDetail;
    return { ...c, messages: [...c.messages, ...s.sent[m[1]!]!] };
  }
  if (path === '/api/messages/conversations') {
    return (body as ConversationSummary[]).map((c) => {
      const last = s.sent[c.id]?.at(-1);
      return last ? { ...c, lastMessageAt: last.createdAt } : c;
    });
  }
  if (path === '/api/me/surveys' && s.answered.length) return (body as MySurvey[]).map((x) => (s.answered.includes(x.id) ? { ...x, responded: true } : x));
  if (path === '/api/me/preferences' && s.preferences) return { ...(body as object), ...s.preferences };
  if (path === '/api/me/bids' && Object.keys(s.bids).length) return (body as MyRound[]).map((r) => (s.bids[r.id] ? { ...r, myChoices: s.bids[r.id] } : r));
  return body;
}

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const dow = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
const clock = (d: string, minute: number) => `${addDays(d, Math.floor(minute / 1440))}T${String(Math.floor((minute % 1440) / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`;

/**
 * What applying a template to [from, to) would make: each line on each of its weekdays, as many
 * shifts as its headcount, inside the template's own dates. The demo doesn't know holidays,
 * opening hours or shifts already made from it, so nothing is skipped or flagged.
 */
export function templatePreview(t: Pick<ShiftTemplate, 'slots' | 'validFrom' | 'validTo'>, from: string, to: string): ApplyResult {
  const days = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY);
  const f = t.validFrom && t.validFrom > from ? t.validFrom : from;
  const end = t.validTo && addDays(t.validTo, 1) < to ? addDays(t.validTo, 1) : to;
  const items: ApplyResult['items'] = [];
  for (let d = f; d < end; d = addDays(d, 1)) {
    for (const [i, s] of t.slots.entries()) {
      if (s.daysOfWeek.includes(dow(d))) items.push({ slotId: s.id ?? `slot-${i}`, date: d, startsAt: clock(d, s.startMinute), endsAt: clock(d, s.endMinute), status: 'create', count: s.headcount, code: null });
    }
  }
  const inside = f < end ? Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${f}T12:00:00Z`)) / DAY) : 0;
  return { applicationId: null, created: items.reduce((n, x) => n + x.count, 0), existing: 0, skipped: 0, flagged: 0, outsideDates: Math.max(0, days - inside), items };
}
