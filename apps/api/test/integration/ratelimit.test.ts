import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { databaseAllow } from '../../src/auth/rateLimit.js';
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
