import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetLimits } from '../../src/auth/rateLimit.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { app as appDb, owner, seedOpenOffer, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'paypeek';
let t: Awaited<ReturnType<typeof seedTenant>>;
let guard: string;
const get = (p: string) => request(server).get(p).auth(guard, { type: 'bearer' }).set('x-tenant-subdomain', SUB);

beforeAll(async () => {
  resetLimits();
  t = await seedTenant(SUB, 1);
  guard = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'] });
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('pay preview on open shifts', () => {
  it('says when there is no pay rate yet', async () => {
    const { offer } = await seedOpenOffer(t, 5, 4);
    expect((await get(`/api/offers/${offer.id}/pay-preview`)).body).toEqual({ available: false });
  });

  it('a 4-hour shift at $20 adds $80; a 10-hour shift adds daily overtime (BC: over 8 h at 1.5x)', async () => {
    await owner.payRate.create({ data: { tenantId: t.tenant.id, userId: t.users[0]!.id, positionId: t.position.id, hourlyRate: '20.00', effectiveFrom: new Date('2020-01-01') } });
    const short = await seedOpenOffer(t, 8, 4);
    expect((await get(`/api/offers/${short.offer.id}/pay-preview`)).body).toMatchObject({ available: true, hours: '4.00', rate: '20.00', gross: '80.00', overtimeHours: '0.00' });
    const long = await seedOpenOffer(t, 9, 10);
    const r = (await get(`/api/offers/${long.offer.id}/pay-preview`)).body;
    expect(r.overtimeHours).toBe('2.00');
    expect(r.gross).toBe('220.00');
  });
});
