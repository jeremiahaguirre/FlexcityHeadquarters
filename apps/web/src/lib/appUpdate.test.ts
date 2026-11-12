import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as u from './appUpdate';

const memory = (entries: Record<string, string>): Storage => {
  const m = new Map(Object.entries(entries));
  return { get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() };
};

describe('new version ready', () => {
  let served = 'dev';
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ version: served }) }));
  const reload = vi.fn();
  beforeEach(() => {
    u.resetAppUpdate();
    served = 'dev';
    fetcher.mockClear();
    reload.mockClear();
    u.setVersionFetcher(fetcher);
    u.setReloader(reload);
  });

  it('a version id is build time plus release; the API names the bare release', () => {
    expect(u.releaseOf('202611121530.abc1234')).toBe('abc1234');
    expect(u.releaseOf('dev')).toBe('dev');
    expect(u.CLIENT_HEADERS['x-fh-client']).toBe(`web/${u.WEB_VERSION}`);
  });

  it('the same release from the API needs no look; a different one asks the web tier once', async () => {
    u.noteServerVersion('dev');
    expect(fetcher).not.toHaveBeenCalled();
    served = '202611121530.new';
    u.noteServerVersion('new', 1_000_000);
    await vi.waitFor(() => expect(u.getUpdateState().available).toBe('202611121530.new'));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('the API rolled first: the web tier still serves this build, so nothing shows, and the same mismatch is not re-checked for 10 minutes', async () => {
    u.noteServerVersion('new', 1_000_000);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(u.getUpdateState().available).toBeNull();
    u.noteServerVersion('new', 1_000_000 + 5 * 60_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    u.noteServerVersion('new', 1_000_000 + 11 * 60_000);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });

  it('checks at most once a minute unless forced', async () => {
    await u.checkForUpdate({ now: 10_000_000 });
    await u.checkForUpdate({ now: 10_030_000 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await u.checkForUpdate({ now: 10_030_000, force: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('a failed look is quiet', async () => {
    u.setVersionFetcher(async () => {
      throw new Error('offline');
    });
    await u.checkForUpdate({ force: true });
    expect(u.getUpdateState().available).toBeNull();
  });

  it('nothing refreshes while something is in progress', () => {
    expect(u.safeToRefresh(null)).toBe(true);
    u.setBusy('punch', true);
    expect(u.safeToRefresh(null)).toBe(false);
    u.setBusy('punch', false);
    u.markDirty();
    expect(u.safeToRefresh(null)).toBe(false);
    u.markClean();
    expect(u.safeToRefresh(null)).toBe(true);
    const doc = { querySelector: (s: string) => (s === 'dialog[open]' ? {} : null) } as unknown as Document;
    expect(u.safeToRefresh(doc)).toBe(false);
  });

  it('waiting offline punches or attendance hold the refresh; refused ones do not', () => {
    expect(u.hasPendingQueue(memory({ 'fh-punch-queue:a': JSON.stringify([{ state: 'rejected' }]) }))).toBe(false);
    expect(u.hasPendingQueue(memory({ 'fh-punch-queue:a': JSON.stringify([{ state: 'waiting' }]) }))).toBe(true);
    expect(u.hasPendingQueue(memory({ 'fh-attendance-queue': JSON.stringify([{ clientId: 'x' }]) }))).toBe(true);
    expect(u.hasPendingQueue(memory({ 'fh-attendance-queue': '[]', other: 'x' }))).toBe(false);
    expect(u.hasPendingQueue(memory({ 'fh-punch-queue:a': 'not json' }))).toBe(false);
  });

  it('refreshes by itself only after being hidden 3 minutes or untouched 15', () => {
    const now = 100 * 60_000;
    expect(u.idleEnough({ now, hiddenSince: now - 60_000, lastActivity: now - 60_000 })).toBe(false);
    expect(u.idleEnough({ now, hiddenSince: now - 3 * 60_000, lastActivity: now })).toBe(true);
    expect(u.idleEnough({ now, hiddenSince: null, lastActivity: now - 15 * 60_000 })).toBe(true);
  });

  it('too old for the API: refreshes when safe, but never twice within five minutes (no reload loop)', () => {
    u.setBusy('punch', true);
    u.markOutdated(1_000);
    expect(u.getUpdateState().outdated).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    u.setBusy('punch', false);
    u.markOutdated(2_000);
    expect(reload).toHaveBeenCalledTimes(1);
    u.markOutdated(60_000);
    expect(reload).toHaveBeenCalledTimes(1);
    u.markOutdated(2_000 + 5 * 60_000);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
