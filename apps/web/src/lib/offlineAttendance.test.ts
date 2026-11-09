import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
const post = vi.fn();
vi.mock('./api', () => ({ api: (...a: unknown[]) => post(...a) }));

const { enqueue, queued, syncQueue } = await import('./offlineAttendance');

describe('offline attendance queue', () => {
  beforeEach(() => {
    store.clear();
    post.mockReset();
  });

  it('keeps only the newest tap per swimmer and session', () => {
    enqueue({ enrollmentId: 'e1', sessionDate: '2026-11-03', status: 'ABSENT' });
    enqueue({ enrollmentId: 'e1', sessionDate: '2026-11-03', status: 'PRESENT' });
    enqueue({ enrollmentId: 'e2', sessionDate: '2026-11-03', status: 'PRESENT' });
    expect(queued().map((q) => [q.enrollmentId, q.status])).toEqual([
      ['e1', 'PRESENT'],
      ['e2', 'PRESENT'],
    ]);
  });

  it('removes marks the server acknowledged and keeps everything when offline', async () => {
    const a = enqueue({ enrollmentId: 'e1', sessionDate: '2026-11-03', status: 'PRESENT' });
    post.mockRejectedValueOnce(new Error('offline'));
    expect(await syncQueue()).toBe(1);
    post.mockResolvedValueOnce({ results: [{ clientId: a.clientId, outcome: 'saved' }] });
    expect(await syncQueue()).toBe(0);
  });
});
