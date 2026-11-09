import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { computeBenchmarks } from '../../src/services/platform/benchmarks.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const cities: Array<Awaited<ReturnType<typeof seedTenant>>> = [];
const hrTokens: string[] = [];
const get = (i: number, p: string) => request(server).get(p).auth(hrTokens[i]!, { type: 'bearer' }).set('x-tenant-subdomain', `bench${i}`);
const put = (i: number, p: string, b: object) => request(server).put(p).auth(hrTokens[i]!, { type: 'bearer' }).set('x-tenant-subdomain', `bench${i}`).send(b);

beforeAll(async () => {
  resetLimits();
  await owner.benchmarkSnapshot.deleteMany({});
  for (let i = 0; i < 6; i++) {
    const t = await seedTenant(`bench${i}`, 1);
    cities.push(t);
    const h = await owner.user.create({ data: { tenantId: t.tenant.id, roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', firstName: 'H', lastName: String(i), email: `hr@bench${i}.test` } });
    hrTokens.push(await signAccessToken({ sub: h.id, tid: t.tenant.id, roles: ['HR_ADMIN'] }));
    // i no-shows out of 10 shifts in the last 90 days → 0%, 10%, … 50%
    for (let s = 0; s < 10; s++) {
      const end = new Date(Date.now() - (s + 2) * 86_400_000);
      await owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: t.position.id, userId: t.users[0]!.id, status: 'PUBLISHED', startsAt: new Date(end.getTime() - 4 * 3_600_000), endsAt: end } });
    }
    for (let n = 0; n < i; n++) await owner.reliabilityEvent.create({ data: { tenantId: t.tenant.id, userId: t.users[0]!.id, type: 'NO_SHOW', occurredAt: new Date(Date.now() - (n + 2) * 86_400_000) } });
  }
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('benchmarks across cities', () => {
  it('a city sees its own measures; no peers until it shares', async () => {
    const r = await get(3, '/api/benchmarks');
    expect(r.body.mine.noShowRate).toBe(30);
    expect(r.body.peers).toBeNull();
  });

  it('with only four cities sharing, nothing is published', async () => {
    for (const i of [0, 1, 2, 3]) await put(i, '/api/benchmarks/opt-in', { on: true });
    expect(await computeBenchmarks(appDb)).toBe(0);
    expect((await get(0, '/api/benchmarks')).body.peers).toEqual({});
  });

  it('with five cities, quartiles are published, and only quartiles are stored', async () => {
    await put(4, '/api/benchmarks/opt-in', { on: true });
    expect(await computeBenchmarks(appDb)).toBeGreaterThan(0);
    const peers = (await get(4, '/api/benchmarks')).body.peers;
    expect(peers.noShowRate).toEqual({ p25: 10, p50: 20, p75: 30, cities: 5 });
    const row = await owner.benchmarkSnapshot.findFirstOrThrow({ where: { metric: 'noShowRate' } });
    expect(Object.keys(row).sort()).toEqual(['cities', 'computedOn', 'id', 'metric', 'p25', 'p50', 'p75']);
    // A city that doesn't share still sees no peers.
    expect((await get(5, '/api/benchmarks')).body.peers).toBeNull();
  });
});
