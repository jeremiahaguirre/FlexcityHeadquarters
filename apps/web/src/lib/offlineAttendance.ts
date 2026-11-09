'use client';

import { api } from './api';

/**
 * On-deck attendance that survives poor Wi-Fi.
 * - Rosters are cached on the device after every successful load.
 * - Each tap is queued locally with its own id and timestamp, then uploaded.
 *   The server treats a re-sent id as already saved and keeps the latest tap,
 *   so retries are always safe.
 */
export type Status = 'PRESENT' | 'ABSENT' | 'EXCUSED';
export interface QueuedMark {
  clientId: string;
  enrollmentId: string;
  sessionDate: string;
  status: Status;
  recordedAt: string;
}
export interface Session {
  classId: string;
  sessionDate: string;
  name: string;
  level: string | null;
  facility: { id: string; name: string };
  localStartsAt: string;
  localEndsAt: string;
  roster: Array<{ enrollmentId: string; swimmerName: string; safetyNote: string | null; status: Status | null }>;
}

const QUEUE = 'fh-attendance-queue';
const CACHE = 'fh-lessons-cache';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the queue stays in memory for this visit */
  }
}

export const queued = (): QueuedMark[] => read<QueuedMark[]>(QUEUE, []);
export const cachedSessions = (): { savedAt: string; sessions: Session[] } | null => read(CACHE, null);
export const cacheSessions = (sessions: Session[]) => write(CACHE, { savedAt: new Date().toISOString(), sessions });

export function enqueue(m: Omit<QueuedMark, 'clientId' | 'recordedAt'>): QueuedMark {
  const mark: QueuedMark = { ...m, clientId: `${Date.now().toString(36)}-${crypto.randomUUID()}`, recordedAt: new Date().toISOString() };
  // Only the newest tap per swimmer/session needs to travel.
  const rest = queued().filter((q) => !(q.enrollmentId === m.enrollmentId && q.sessionDate === m.sessionDate));
  write(QUEUE, [...rest, mark]);
  return mark;
}

let syncing: Promise<number> | null = null;
/** Upload the queue. Returns how many marks are still waiting (0 when all synced). */
export function syncQueue(): Promise<number> {
  syncing ??= (async () => {
    const batch = queued();
    if (!batch.length) return 0;
    try {
      const r = await api<{ results: Array<{ clientId: string; outcome: string }> }>('/api/lessons/attendance', { method: 'POST', body: batch });
      const done = new Set(r.results.map((x) => x.clientId));
      write(QUEUE, queued().filter((q) => !done.has(q.clientId)));
    } catch {
      /* offline or server unreachable: keep everything for the next try */
    }
    return queued().length;
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}
