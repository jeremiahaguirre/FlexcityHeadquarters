import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { icsFor } from '../../src/routes/calendar.js';
import { app as appDb, owner, seedTenant } from './fixtures.js';

const server = createApp();
const SUB = 'ics';
let t: Awaited<ReturnType<typeof seedTenant>>;
let tok = '';
const as = () => ({
  get: (p: string) => request(server).get(p).set('x-tenant-subdomain', SUB).auth(tok, { type: 'bearer' }),
  post: (p: string) => request(server).post(p).set('x-tenant-subdomain', SUB).auth(tok, { type: 'bearer' }).send({}),
  del: (p: string) => request(server).delete(p).set('x-tenant-subdomain', SUB).auth(tok, { type: 'bearer' }),
});
const path = (url: string) => new URL(url).pathname;

beforeAll(async () => {
  t = await seedTenant(SUB, 2);
  tok = await signAccessToken({ sub: t.users[0]!.id, tid: t.tenant.id, roles: ['STAFF'], aat: Math.floor(Date.now() / 1000) });
  const start = new Date(Date.now() + 2 * 86_400_000);
  for (const [userId, status] of [[t.users[0]!.id, 'PUBLISHED'], [t.users[0]!.id, 'DRAFT'], [t.users[1]!.id, 'PUBLISHED']] as const) {
    await owner.shift.create({ data: { tenantId: t.tenant.id, facilityId: t.facility.id, positionId: t.position.id, userId, startsAt: start, endsAt: new Date(start.getTime() + 4 * 3_600_000), status } });
  }
});
afterAll(async () => {
  await appDb.$disconnect();
  await owner.$disconnect();
});

describe('calendar feed', () => {
  it('writes valid iCalendar, escaped and folded', () => {
    const ics = icsFor('My shifts', [{ id: 's1', startsAt: new Date('2026-12-01T16:00:00Z'), endsAt: new Date('2026-12-01T20:00:00Z'), position: 'Lifeguard, senior', facility: 'Parkinson Recreation Centre; main pool, with a very long name that goes past seventy five octets', status: 'PUBLISHED' }]);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART:20261201T160000Z');
    expect(ics).toContain('SUMMARY:Lifeguard\\, senior · Parkinson');
    expect(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
  });

  it('gives a private link once; the feed holds only my published shifts, no other names', async () => {
    expect((await as().get('/api/me/calendar')).body.active).toBe(false);
    const r = await as().post('/api/me/calendar');
    expect(r.status).toBe(201);
    const feed = await request(server).get(path(r.body.url));
    expect(feed.status).toBe(200);
    expect(feed.headers['content-type']).toContain('text/calendar');
    expect(feed.text.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(feed.text).not.toContain('Guard1');
    expect((await as().get('/api/me/calendar')).body.active).toBe(true);

    // A new link stops the old one; turning it off stops both.
    const again = await as().post('/api/me/calendar');
    expect((await request(server).get(path(r.body.url))).status).toBe(404);
    expect((await request(server).get(path(again.body.url))).status).toBe(200);
    await as().del('/api/me/calendar');
    expect((await request(server).get(path(again.body.url))).status).toBe(404);
  });

  it('a made-up link or another organization’s id finds nothing', async () => {
    expect((await request(server).get(`/api/calendar/${t.tenant.id}/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.ics`)).status).toBe(404);
    expect((await request(server).get('/api/calendar/not-a-uuid/x.ics')).status).toBe(404);
  });
});
