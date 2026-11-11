import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
vi.mock('./api', () => ({ api: vi.fn() }));

const { ApiError } = await import('./apiError');
const q = await import('./offlinePunches');

const A = 'user-a';
const B = 'user-b';
const inBody = { facilityId: 'f1', positionId: 'p1', location: null };
const tap = (kind: 'in' | 'out', at: string, user = A) => q.enqueuePunch(user, { clientId: q.newPunchId(), kind, occurredAt: at, ...(kind === 'in' ? { body: inBody, place: 'Arena' } : {}) });

describe('offline punch queue', () => {
  beforeEach(() => store.clear());

  it('keeps each person’s punches apart on a shared phone', async () => {
    tap('in', '2026-11-11T16:00:00.000Z', A);
    tap('in', '2026-11-11T17:00:00.000Z', B);
    expect(q.queuedPunches(A)).toHaveLength(1);
    expect(q.queuedPunches(B)).toHaveLength(1);
    const send = vi.fn().mockResolvedValue({});
    await q.syncPunches(A, { send });
    // Only A's punch went out; B's still waits for B.
    expect(send).toHaveBeenCalledTimes(1);
    expect(q.queuedPunches(A)).toHaveLength(0);
    expect(q.queuedPunches(B)).toHaveLength(1);
    q.clearPunches(B);
    expect(q.queuedPunches(B)).toHaveLength(0);
  });

  it('sends in order with the tap’s id, time and the phone’s clock', async () => {
    const a = tap('in', '2026-11-11T16:00:00.000Z');
    const b = tap('out', '2026-11-11T20:00:00.000Z');
    const send = vi.fn().mockResolvedValue({});
    const r = await q.syncPunches(A, { send, now: () => Date.parse('2026-11-11T21:00:00.000Z') });
    expect(r).toEqual({ sent: 2, rejected: 0, waiting: 0 });
    expect(send.mock.calls.map((c) => c[0])).toEqual(['/api/timeclock/in', '/api/timeclock/out']);
    expect(send.mock.calls[0]![1]).toEqual({ ...inBody, clientId: a.clientId, occurredAt: a.occurredAt, sentAt: '2026-11-11T21:00:00.000Z', offline: true });
    expect(send.mock.calls[1]![1]).toMatchObject({ clientId: b.clientId });
  });

  it('keeps everything when offline and waits longer after each failed try', async () => {
    tap('in', '2026-11-11T16:00:00.000Z');
    tap('out', '2026-11-11T20:00:00.000Z');
    let now = 1_000_000;
    const send = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await q.syncPunches(A, { send, now: () => now })).toEqual({ sent: 0, rejected: 0, waiting: 2 });
    // Stops at the first one: the clock-out never goes before its clock-in.
    expect(send).toHaveBeenCalledTimes(1);
    expect(q.nextRetryAt(A)).toBe(now + 5_000);
    // Too soon: nothing is tried.
    await q.syncPunches(A, { send, now: () => now + 1_000 });
    expect(send).toHaveBeenCalledTimes(1);
    now += 6_000;
    await q.syncPunches(A, { send, now: () => now });
    expect(q.nextRetryAt(A)).toBe(now + 10_000);
    // The connection came back: forced, and it all goes.
    send.mockResolvedValue({});
    expect(await q.syncPunches(A, { send, force: true, now: () => now })).toEqual({ sent: 2, rejected: 0, waiting: 0 });
    expect(q.backoffMs(20)).toBe(5 * 60_000);
  });

  it('a punch the server refuses stays with its reason until dismissed; the rest still go', async () => {
    const a = tap('in', '2026-11-08T16:00:00.000Z');
    tap('out', '2026-11-11T20:00:00.000Z');
    const send = vi.fn().mockRejectedValueOnce(new ApiError(422, 'PUNCH_TOO_OLD', 'Too old')).mockResolvedValueOnce({});
    expect(await q.syncPunches(A, { send })).toEqual({ sent: 1, rejected: 1, waiting: 0 });
    expect(q.queuedPunches(A)).toEqual([expect.objectContaining({ clientId: a.clientId, state: 'rejected', error: { code: 'PUNCH_TOO_OLD', message: 'Too old' } })]);
    // A refused punch isn't retried.
    await q.syncPunches(A, { send, force: true });
    expect(send).toHaveBeenCalledTimes(2);
    q.dismissPunch(A, a.clientId);
    expect(q.queuedPunches(A)).toEqual([]);
  });

  it('server trouble and an expired sign-in are retried; refusals are not', () => {
    expect(q.isTransient(new TypeError('Failed to fetch'))).toBe(true);
    expect(q.isTransient(new ApiError(503, 'ERROR', 'down'))).toBe(true);
    expect(q.isTransient(new ApiError(401, 'UNAUTHORIZED', 'x'))).toBe(true);
    expect(q.isTransient(new ApiError(409, 'NOT_CLOCKED_IN', 'x'))).toBe(false);
  });

  it('shows the person on the clock from their waiting punches', () => {
    const server = { id: 'srv' };
    expect(q.effectiveOpen(server, []).open).toBe(server);
    const a = tap('in', '2026-11-11T16:00:00.000Z');
    expect(q.effectiveOpen(null, q.queuedPunches(A))).toMatchObject({ open: { clientId: a.clientId }, pending: { clientId: a.clientId } });
    const b = tap('out', '2026-11-11T20:00:00.000Z');
    expect(q.effectiveOpen(null, q.queuedPunches(A))).toMatchObject({ open: null, pending: { clientId: b.clientId } });
  });

  it('never keeps the same tap twice', () => {
    const a = tap('in', '2026-11-11T16:00:00.000Z');
    q.enqueuePunch(A, { clientId: a.clientId, kind: 'in', occurredAt: a.occurredAt, body: inBody });
    expect(q.queuedPunches(A)).toHaveLength(1);
  });
});
