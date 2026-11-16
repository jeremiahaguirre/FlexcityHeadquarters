import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { databaseAllow, databaseConsume, HIT_RETENTION_MS, purgeRateLimitHits } from '../../src/auth/rateLimit.js';
import { db } from '../../src/lib/db.js';
import { owner } from './fixtures.js';

afterAll(async () => {
  await db().$disconnect();
  await owner.$disconnect();
});

describe('shared rate limiter', () => {
  it('holds the limit across concurrent requests, as if from several servers', async () => {
    const key = `test:${randomBytes(4).toString('hex')}`;
    const results = await Promise.all(Array.from({ length: 12 }, () => databaseAllow(key, 5, 60_000)));
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(await owner.rateLimitHit.count({ where: { key } })).toBe(5);
  });

  it('frees up once the window has passed', async () => {
    const key = `test:${randomBytes(4).toString('hex')}`;
    const past = new Date(Date.now() - 120_000);
    for (let i = 0; i < 3; i++) await databaseAllow(key, 3, 60_000, past);
    expect(await databaseAllow(key, 3, 60_000, past)).toBe(false);
    expect(await databaseAllow(key, 3, 60_000)).toBe(true);
  });
});

describe('rate-limit hit purge (ARCHITECTURE-REVIEW A25)', () => {
  it('deletes hits older than a day in batches and keeps recent ones', async () => {
    const tag = `purge:${randomBytes(4).toString('hex')}`;
    const now = new Date();
    const old = new Date(now.getTime() - HIT_RETENTION_MS - 60_000);
    await owner.rateLimitHit.createMany({ data: [...Array.from({ length: 7 }, () => ({ key: `${tag}:old`, at: old })), { key: `${tag}:new`, at: new Date(now.getTime() - 60_000) }] });
    // Batches of 3: 3 + 3 + 1 (plus any other expired hits left by earlier tests).
    const deleted = await purgeRateLimitHits(now, 3);
    expect(deleted).toBeGreaterThanOrEqual(7);
    expect(await owner.rateLimitHit.count({ where: { key: `${tag}:old` } })).toBe(0);
    expect(await owner.rateLimitHit.count({ where: { key: `${tag}:new` } })).toBe(1);
    expect(await owner.rateLimitHit.count({ where: { at: { lt: new Date(now.getTime() - HIT_RETENTION_MS) } } })).toBe(0);
  });

  it('has an index on "at" for the purge', async () => {
    const idx = await owner.$queryRaw<Array<{ indexdef: string }>>`SELECT indexdef FROM pg_indexes WHERE tablename = 'RateLimitHit'`;
    expect(idx.map((i) => i.indexdef)).toContainEqual(expect.stringMatching(/USING btree \("?at"?\)$/));
  });

  it('requests no longer delete old hits themselves', async () => {
    const tag = `inline:${randomBytes(4).toString('hex')}`;
    const old = new Date(Date.now() - HIT_RETENTION_MS - 60_000);
    await owner.rateLimitHit.createMany({ data: Array.from({ length: 3 }, () => ({ key: `${tag}:old`, at: old })) });
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      expect(await databaseAllow(`${tag}:a`, 5, 60_000)).toBe(true);
      expect((await databaseConsume(`${tag}:b`, 5, 60_000)).allowed).toBe(true);
    } finally {
      random.mockRestore();
    }
    expect(await owner.rateLimitHit.count({ where: { key: `${tag}:old` } })).toBe(3);
  });
});
