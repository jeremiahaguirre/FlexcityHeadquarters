'use client';

import { api } from './api';
import { ApiError } from './apiError';

/**
 * Punches that survive no signal (arenas, works yards, outdoor sites).
 * - Every tap gets its own id and the time it happened, and is sent with them. The server
 *   recognises a re-sent id, so retrying is always safe (never a double punch).
 * - Without a connection the tap is kept on this phone, per person: someone else signing in on
 *   the same phone never sends (or sees) another person's punches.
 * - Waiting punches go out in order when the connection returns, with growing pauses between
 *   failed tries. A punch the server refuses stays visible with its reason until the person
 *   dismisses it.
 */
export type PunchKind = 'in' | 'out';
export interface PunchInBody {
  facilityId: string;
  shiftId?: string;
  positionId?: string;
  location: { lat: number; lon: number; accuracyM: number | null } | null;
}
export interface QueuedPunch {
  clientId: string;
  kind: PunchKind;
  /** When the tap happened, by this phone's clock (ISO). */
  occurredAt: string;
  body?: PunchInBody;
  /** Facility name, to show the punch while it waits. */
  place?: string;
  state: 'waiting' | 'rejected';
  attempts: number;
  /** Epoch ms before which an automatic retry waits (backoff). */
  retryAt: number;
  error?: { code: string; message: string };
}

export const QUEUE_EVENT = 'fh:punch-queue';
const key = (userId: string) => `fh-punch-queue:${userId}`;

function read(userId: string): QueuedPunch[] {
  try {
    const raw = localStorage.getItem(key(userId));
    return raw ? (JSON.parse(raw) as QueuedPunch[]) : [];
  } catch {
    return [];
  }
}
function write(userId: string, list: QueuedPunch[]) {
  try {
    if (list.length) localStorage.setItem(key(userId), JSON.stringify(list));
    else localStorage.removeItem(key(userId));
  } catch {
    /* storage blocked: nothing more we can do on this phone */
  }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event(QUEUE_EVENT));
}

export const queuedPunches = (userId: string): QueuedPunch[] => read(userId);
export const waitingCount = (userId: string): number => read(userId).filter((p) => p.state === 'waiting').length;

export function newPunchId(): string {
  return crypto.randomUUID();
}

export function enqueuePunch(userId: string, p: { clientId: string; kind: PunchKind; occurredAt: string; body?: PunchInBody; place?: string }): QueuedPunch {
  const item: QueuedPunch = { ...p, state: 'waiting', attempts: 0, retryAt: 0 };
  // The same tap (same id) is never kept twice.
  write(userId, [...read(userId).filter((q) => q.clientId !== p.clientId), item]);
  return item;
}

/** The person has read why a punch wasn't accepted. */
export function dismissPunch(userId: string, clientId: string) {
  write(userId, read(userId).filter((q) => q.clientId !== clientId));
}

/** On sign-out (after the warning), this person's unsent punches leave the phone. */
export function clearPunches(userId: string) {
  write(userId, []);
}

/** No connection, or the server couldn't answer: worth trying again later. */
export function isTransient(e: unknown): boolean {
  if (!(e instanceof ApiError)) return true;
  return e.status >= 500 || e.status === 401 || e.status === 408 || e.status === 429;
}

/** 5 s, 10 s, 20 s … up to 5 minutes. */
export function backoffMs(attempts: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, attempts - 1), 5 * 60_000);
}

type Send = (path: string, body: unknown) => Promise<unknown>;
const defaultSend: Send = (path, body) => api(path, { method: 'POST', body });

export function payload(p: QueuedPunch, now = new Date()) {
  return { ...(p.body ?? {}), clientId: p.clientId, occurredAt: p.occurredAt, sentAt: now.toISOString(), offline: true };
}

let running: Promise<SyncResult> | null = null;
export interface SyncResult {
  sent: number;
  rejected: number;
  waiting: number;
}

/**
 * Send this person's waiting punches, oldest first. Stops at the first one that can't get
 * through (order matters: a clock-out can't go before its clock-in). `force` ignores the backoff
 * (the connection just came back, or the person tapped "Try now").
 */
export function syncPunches(userId: string, opts: { force?: boolean; send?: Send; now?: () => number } = {}): Promise<SyncResult> {
  running ??= (async () => {
    const send = opts.send ?? defaultSend;
    const now = opts.now ?? Date.now;
    let sent = 0;
    let rejected = 0;
    for (const p of read(userId)) {
      if (p.state !== 'waiting') continue;
      if (!opts.force && p.retryAt > now()) break;
      try {
        await send(p.kind === 'in' ? '/api/timeclock/in' : '/api/timeclock/out', payload(p, new Date(now())));
        write(userId, read(userId).filter((q) => q.clientId !== p.clientId));
        sent++;
      } catch (e) {
        if (isTransient(e)) {
          const attempts = p.attempts + 1;
          write(userId, read(userId).map((q) => (q.clientId === p.clientId ? { ...q, attempts, retryAt: now() + backoffMs(attempts) } : q)));
          break;
        }
        const err = e as ApiError;
        write(userId, read(userId).map((q) => (q.clientId === p.clientId ? { ...q, state: 'rejected' as const, error: { code: err.code, message: err.message } } : q)));
        rejected++;
      }
    }
    return { sent, rejected, waiting: waitingCount(userId) };
  })().finally(() => {
    running = null;
  });
  return running;
}

/** When the next automatic try is due (epoch ms), or null when nothing is waiting. */
export function nextRetryAt(userId: string): number | null {
  const first = read(userId).find((p) => p.state === 'waiting');
  return first ? first.retryAt : null;
}

/**
 * Whether the person is on the clock once their waiting punches count: the server's answer,
 * then each waiting tap in order. Refused punches don't count.
 */
export function effectiveOpen<T>(server: T | null, queue: QueuedPunch[]): { open: T | QueuedPunch | null; pending: QueuedPunch | null } {
  let open: T | QueuedPunch | null = server;
  let pending: QueuedPunch | null = null;
  for (const p of queue) {
    if (p.state !== 'waiting') continue;
    open = p.kind === 'in' ? p : null;
    pending = p;
  }
  return { open, pending };
}

/** "2026-11-11T09:02:00" on this phone's clock, the shape the app formats times from. */
export function deviceLocalIso(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
