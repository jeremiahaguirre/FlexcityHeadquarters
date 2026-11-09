import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { hashPassword, signAccessToken } from '../../src/auth/tokens.js';
import { withTenant } from '../../src/lib/db.js';
import { onUserSignal, startLiveHub, stopLiveHub } from '../../src/services/notifications/liveHub.js';
import { ConsoleMailer, deliverOutbox } from '../../src/services/notifications/mailer.js';
import { handleEvent } from '../../src/services/notifications/notifier.js';
import { claimOffer } from '../../src/services/shiftboard/offers.js';
import { app, owner, seedOpenOffer, seedTenant } from './fixtures.js';

let t: Awaited<ReturnType<typeof seedTenant>>;
let supId: string;

beforeAll(async () => {
  t = await seedTenant('zeta', 2);
  const sup = await owner.user.create({
    data: {
      tenantId: t.tenant.id,
      roles: ['AQUATIC_SUPERVISOR'],
      employmentStatus: 'FULL_TIME',
      firstName: 'Sup',
      lastName: 'Z',
      email: 'sup@zeta.test',
      locale: 'fr-CA',
      passwordHash: await hashPassword('pw-pw-pw-pw'),
    },
  });
  supId = sup.id;
  await startLiveHub(process.env.APP_DATABASE_URL!);
});
afterAll(async () => {
  await stopLiveHub();
  await app.$disconnect();
  await owner.$disconnect();
});

describe('notifications', () => {
  it('notifies supervisors (in-app, live, email) when a claim needs overtime approval', async () => {
    const guard = t.users[0]!;
    const { offer } = await seedOpenOffer(t, 6, 10);
    const res = await withTenant(t.tenant.id, (tx) => claimOffer(tx, { userId: guard.id, tenantId: t.tenant.id, canPostOpenShifts: false }, offer.id), {
      prisma: app,
    });
    expect(res.outcome).toBe('PENDING_APPROVAL');

    const live = new Promise<string>((resolve) => {
      const off = onUserSignal(supId, (s) => {
        off();
        resolve(s.id);
      });
    });
    const created = await handleEvent(res.events[0]!, app);
    expect(created).toBe(2); // supervisor + claimant

    const liveId = await Promise.race([live, new Promise<string>((_, rej) => setTimeout(() => rej(new Error('no live signal')), 3000))]);
    const supNote = await owner.notification.findUniqueOrThrow({ where: { id: liveId } });
    expect(supNote).toMatchObject({ userId: supId, type: 'claim_needs_approval', link: '/manage/approvals' });
    expect(supNote.params).toMatchObject({ overtimeHours: '2.00' });

    const claimantNote = await owner.notification.findFirst({ where: { userId: guard.id, type: 'claim_pending' } });
    expect(claimantNote).not.toBeNull();

    const mail = await owner.emailOutbox.findFirstOrThrow({ where: { toEmail: 'sup@zeta.test' } });
    expect(mail).toMatchObject({ template: 'claim_needs_approval', locale: 'fr-CA', sentAt: null });
  });

  it('delivers queued email in the recipient’s language', async () => {
    const mailer = new ConsoleMailer(true);
    const r = await deliverOutbox(owner, mailer);
    expect(r.failed).toBe(0);
    const sent = mailer.sent.find((m) => m.to === 'sup@zeta.test');
    expect(sent?.subject).toBe('Une demande de quart attend votre approbation');
    expect(await owner.emailOutbox.count({ where: { toEmail: 'sup@zeta.test', sentAt: null } })).toBe(0);
  });

  it('lists and marks notifications read over HTTP, scoped to the signed-in user', async () => {
    const server = createApp();
    const token = await signAccessToken({ sub: supId, tid: t.tenant.id, roles: ['AQUATIC_SUPERVISOR'] });
    const list = await request(server).get('/api/notifications').set('x-tenant-subdomain', 'zeta').auth(token, { type: 'bearer' });
    expect(list.status).toBe(200);
    expect(list.body.unreadCount).toBe(1);
    expect(list.body.items.every((n: { userId: string }) => n.userId === supId)).toBe(true);

    const read = await request(server).post('/api/notifications/read').set('x-tenant-subdomain', 'zeta').auth(token, { type: 'bearer' }).send({ all: true });
    expect(read.body.updated).toBe(1);
    const after = await request(server).get('/api/notifications?unread=1').set('x-tenant-subdomain', 'zeta').auth(token, { type: 'bearer' });
    expect(after.body.items).toHaveLength(0);
  });
});
