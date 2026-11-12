/**
 * "A new version is ready": how an open tab learns that a newer build is deployed, and when it
 * may refresh without getting in anyone's way (docs/RELEASES.md).
 *
 * Noticing, without tight polling:
 * - every API answer carries X-FH-Version (the API's release). When it differs from this
 *   build's release, the tab asks the web tier which build it serves (/version.json): during a
 *   rolling deployment the API can be new before the web tasks are;
 * - when the tab comes back to the foreground (at most every few minutes), after the live
 *   stream reconnects (a deployment drops it), and every 30 minutes for screens left open on a
 *   wall (status boards);
 * - the API answering 426 CLIENT_OUTDATED (this build is older than the API's MIN_WEB_VERSION).
 *
 * Never interrupting: the prompt waits, and nothing reloads, while a punch is being sent, a
 * dialog is open, a form has unsaved changes, punches or attendance wait on this phone, or the
 * kiosk is mid-entry (setBusy). Offline punches and attendance are kept in this phone's storage,
 * so a reload never loses them: the new build sends them.
 */
import { DEMO } from './demo';

export const WEB_VERSION = process.env.NEXT_PUBLIC_FH_VERSION || 'dev';
/** Sent with every API request, so the API can refuse builds older than its minimum. */
export const CLIENT_HEADERS: Record<string, string> = { 'x-fh-client': `web/${WEB_VERSION}` };

/** "202611121530.abc1234" → "abc1234" (the API's X-FH-Version is the bare release). */
export function releaseOf(version: string): string {
  const m = /^\d{4,12}\.(.+)$/.exec(version);
  return m ? m[1]! : version;
}

export interface UpdateState {
  /** A newer build's version id, once one is being served. */
  available: string | null;
  /** The API refuses this build: refresh as soon as it's safe. */
  outdated: boolean;
}

let state: UpdateState = { available: null, outdated: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
export const getUpdateState = (): UpdateState => state;
export function subscribeUpdate(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
function set(next: Partial<UpdateState>) {
  const merged = { ...state, ...next };
  if (merged.available === state.available && merged.outdated === state.outdated) return;
  state = merged;
  emit();
}

// ---- Noticing a newer build -------------------------------------------------------------------

const MIN_GAP_MS = 60_000;
const SAME_MISMATCH_GAP_MS = 10 * 60_000;
let lastCheck = 0;
let checking: Promise<void> | null = null;
let mismatchSeen: { release: string; at: number } | null = null;

type Fetcher = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
let fetcher: Fetcher = (url) => fetch(url, { cache: 'no-store', credentials: 'same-origin' });
/** Tests replace the network. */
export function setVersionFetcher(fn: Fetcher | null) {
  fetcher = fn ?? ((url) => fetch(url, { cache: 'no-store', credentials: 'same-origin' }));
}

/** Asks the web tier which build it serves. At most once a minute unless `force`. */
export function checkForUpdate(opts: { force?: boolean; now?: number } = {}): Promise<void> {
  if (DEMO) return Promise.resolve();
  const now = opts.now ?? Date.now();
  if (checking) return checking;
  if (!opts.force && now - lastCheck < MIN_GAP_MS) return Promise.resolve();
  lastCheck = now;
  checking = (async () => {
    try {
      const r = await fetcher('/version.json');
      if (!r.ok) return;
      const v = ((await r.json()) as { version?: unknown }).version;
      if (typeof v === 'string' && v && v !== WEB_VERSION) {
        set({ available: v });
        // Let the service worker pick up its own new copy too (it activates at once).
        void navigator.serviceWorker?.getRegistration?.().then((reg) => reg?.update()).catch(() => undefined);
      }
    } catch {
      /* offline or the web tier is restarting: the next trigger tries again */
    } finally {
      checking = null;
    }
  })();
  return checking;
}

/** The API's X-FH-Version on an answer: a different release is worth one look at the web tier. */
export function noteServerVersion(release: string | null | undefined, now = Date.now()) {
  if (DEMO || !release || release === releaseOf(WEB_VERSION) || state.available) return;
  // The same mismatch again (the API rolled first, or runs a different tag): look again only now and then.
  if (mismatchSeen && mismatchSeen.release === release && now - mismatchSeen.at < SAME_MISMATCH_GAP_MS) return;
  mismatchSeen = { release, at: now };
  void checkForUpdate({ now });
}

const OUTDATED_RELOAD_KEY = 'fh-outdated-reload';
/**
 * The API said CLIENT_OUTDATED. Reload at once when nothing is in progress, unless this tab
 * already reloaded for it in the last five minutes (the web tier may still be rolling out:
 * no reload loop, the prompt stays instead).
 */
export function markOutdated(now = Date.now()) {
  if (DEMO) return;
  set({ outdated: true });
  let last = lastOutdatedReload;
  try {
    last = Math.max(last, Number(sessionStorage.getItem(OUTDATED_RELOAD_KEY) ?? -Infinity));
  } catch {
    /* storage blocked: this tab's memory still guards */
  }
  if (now - last < 5 * 60_000 || !safeToRefresh()) return;
  reloadForUpdate(now, true);
}

let reloader: () => void = () => window.location.reload();
/** Tests replace the reload. */
export function setReloader(fn: (() => void) | null) {
  reloader = fn ?? (() => window.location.reload());
}
let lastOutdatedReload = -Infinity;
export function reloadForUpdate(now = Date.now(), outdated = state.outdated) {
  if (outdated) {
    lastOutdatedReload = now;
    try {
      sessionStorage.setItem(OUTDATED_RELOAD_KEY, String(now));
    } catch {
      /* storage blocked */
    }
  }
  reloader();
}

// ---- Not getting in the way ----------------------------------------------------------------

const busy = new Set<string>();
/** Something in progress that a reload would interrupt (a punch being sent, the kiosk mid-entry). */
export function setBusy(key: string, on: boolean) {
  const had = busy.has(key);
  if (on) busy.add(key);
  else busy.delete(key);
  if (had !== on) emit();
}

let dirty = false;
let lastInput = 0;
export function markDirty(now = Date.now()) {
  lastInput = now;
  if (!dirty) {
    dirty = true;
    emit();
  }
}
export function markClean() {
  if (dirty) {
    dirty = false;
    emit();
  }
}
export const isDirty = () => dirty;

/**
 * Unsaved typing anywhere counts as a dirty form: text fields anywhere (but the header's search),
 * and choices inside a <form>. Saving (a form's submit, then a quiet second and a half) or going to
 * another screen makes it clean again. `data-fh-nodirty` opts an area out (filters, search boxes).
 */
export function installDirtyTracking(doc: Document = document): () => void {
  const onInput = (e: Event) => {
    const el = e.target;
    if (!(el instanceof HTMLElement)) return;
    if (el.closest('header, [role="search"], [data-fh-nodirty]')) return;
    const text = el instanceof HTMLTextAreaElement || el.isContentEditable || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'search', 'range', 'button', 'submit', 'file'].includes(el.type));
    const choice = (el instanceof HTMLInputElement && ['checkbox', 'radio', 'range', 'file'].includes(el.type)) || el instanceof HTMLSelectElement;
    if (text || (choice && el.closest('form'))) markDirty();
  };
  const onSubmit = () => {
    const at = Date.now();
    setTimeout(() => {
      if (lastInput <= at) markClean();
    }, 1500);
  };
  doc.addEventListener('input', onInput, true);
  doc.addEventListener('change', onInput, true);
  doc.addEventListener('submit', onSubmit, true);
  return () => {
    doc.removeEventListener('input', onInput, true);
    doc.removeEventListener('change', onInput, true);
    doc.removeEventListener('submit', onSubmit, true);
  };
}

/** Punches or class attendance saved on this phone and not sent yet (lib/offlinePunches.ts, lib/offlineAttendance.ts). */
export function hasPendingQueue(storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage): boolean {
  if (!storage) return false;
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k) continue;
      if (k.startsWith('fh-punch-queue:')) {
        const list = JSON.parse(storage.getItem(k) ?? '[]') as Array<{ state?: string }>;
        if (list.some((p) => p.state === 'waiting')) return true;
      }
      if (k === 'fh-attendance-queue') {
        const q = JSON.parse(storage.getItem(k) ?? '[]') as unknown;
        if (Array.isArray(q) ? q.length > 0 : q && typeof q === 'object' && Object.keys(q).length > 0) return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

export interface Blockers { busy: string[]; dirty: boolean; dialog: boolean; queue: boolean }
export function blockers(doc: Document | null = typeof document === 'undefined' ? null : document): Blockers {
  return { busy: [...busy], dirty, dialog: !!doc?.querySelector('dialog[open]'), queue: hasPendingQueue() };
}
/** Nothing a refresh would interrupt or lose. */
export function safeToRefresh(doc?: Document | null): boolean {
  const b = blockers(doc);
  return b.busy.length === 0 && !b.dirty && !b.dialog && !b.queue;
}

/** Idle long enough for a refresh nobody notices: hidden for 3 minutes, or untouched for 15. */
export const HIDDEN_RELOAD_MS = 3 * 60_000;
export const IDLE_RELOAD_MS = 15 * 60_000;
export function idleEnough(opts: { now: number; hiddenSince: number | null; lastActivity: number }): boolean {
  if (opts.hiddenSince !== null && opts.now - opts.hiddenSince >= HIDDEN_RELOAD_MS) return true;
  return opts.now - opts.lastActivity >= IDLE_RELOAD_MS;
}

/** For tests: back to a fresh tab. */
export function resetAppUpdate() {
  state = { available: null, outdated: false };
  busy.clear();
  dirty = false;
  lastInput = 0;
  lastCheck = 0;
  checking = null;
  mismatchSeen = null;
  lastOutdatedReload = -Infinity;
}
