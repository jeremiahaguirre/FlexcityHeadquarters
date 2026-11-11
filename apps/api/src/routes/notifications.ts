import { Router } from 'express';
import { z } from 'zod';
import { authOf } from '../auth/middleware.js';
import { withTenant } from '../lib/db.js';
import { onUserSignal } from '../services/notifications/liveHub.js';
import { config } from '../config.js';
import { pushEnabled } from '../services/notifications/push.js';
import { h } from './context.js';

export const notificationsRouter = Router();

notificationsRouter.get(
  '/notifications',
  h(async (req, res) => {
    const a = authOf(req);
    const q = z.object({ unread: z.enum(['1', '0']).optional(), before: z.coerce.date().optional() }).parse(req.query);
    const out = await withTenant(a.tenantId, async (tx) => {
      const items = await tx.notification.findMany({
        where: { userId: a.userId, ...(q.unread === '1' ? { readAt: null } : {}), ...(q.before ? { createdAt: { lt: q.before } } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      const unreadCount = await tx.notification.count({ where: { userId: a.userId, readAt: null } });
      return { items, unreadCount };
    });
    res.json(out);
  }),
);

notificationsRouter.post(
  '/notifications/read',
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.union([z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }), z.object({ all: z.literal(true) })]).parse(req.body);
    const count = await withTenant(a.tenantId, async (tx) => {
      const r = await tx.notification.updateMany({
        where: { userId: a.userId, readAt: null, ...('ids' in body ? { id: { in: body.ids } } : {}) },
        data: { readAt: new Date() },
      });
      return r.count;
    });
    res.json({ updated: count });
  }),
);

/**
 * Server-Sent Events. The browser reads this with fetch() (so it can send the
 * Bearer token) and refetches /notifications when a signal arrives.
 */
notificationsRouter.get('/notifications/stream', (req, res) => {
  const a = authOf(req);
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`event: ready\ndata: {}\n\n`);
  const off = onUserSignal(a.userId, (s) => {
    // Only ids travel between processes; the browser refetches /notifications under its own tenant.
    if (s.resync) res.write(`event: notification\ndata: {}\n\n`);
    else if (s.tenantId === a.tenantId) res.write(`event: notification\ndata: ${JSON.stringify({ id: s.id })}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(`: keep-alive\n\n`), 25_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    off();
  });
});

/**
 * Push to this device. The endpoint is where FH's server will send the encrypted message, so
 * only the browser push services are accepted (Google, Mozilla, Apple, Microsoft), never an
 * address someone typed: otherwise this would let anyone make the server call any URL.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/];
export const pushEndpoint = z
  .string()
  .url()
  .max(1000)
  .refine((u) => {
    const x = new URL(u);
    return x.protocol === 'https:' && !x.port && PUSH_HOSTS.some((r) => r.test(x.hostname));
  }, 'Not a browser push service');

notificationsRouter.get(
  '/push/key',
  h(async (_req, res) => {
    res.json({ publicKey: pushEnabled() ? config().VAPID_PUBLIC_KEY : null });
  }),
);

notificationsRouter.get(
  '/me/push',
  h(async (req, res) => {
    const a = authOf(req);
    const devices = await withTenant(a.tenantId, (tx) => tx.pushSubscription.findMany({ where: { userId: a.userId }, select: { id: true, endpoint: true, device: true, createdAt: true, lastSentAt: true }, orderBy: { createdAt: 'desc' } }));
    res.json(devices);
  }),
);

notificationsRouter.post(
  '/me/push',
  h(async (req, res) => {
    const a = authOf(req);
    const b64 = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/);
    const body = z.object({ endpoint: pushEndpoint, keys: z.object({ p256dh: b64.min(80).max(120), auth: b64.min(16).max(32) }), device: z.string().trim().max(80).nullable().optional() }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      // One person per endpoint: a shared tablet signed in by someone else takes it over.
      await tx.pushSubscription.deleteMany({ where: { endpoint: body.endpoint } });
      // A person keeps at most 10 devices; the oldest go first.
      const old = await tx.pushSubscription.findMany({ where: { userId: a.userId }, orderBy: { createdAt: 'desc' }, skip: 9, select: { id: true } });
      if (old.length) await tx.pushSubscription.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
      await tx.pushSubscription.create({ data: { tenantId: a.tenantId, userId: a.userId, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, device: body.device ?? null } });
    });
    res.status(201).json({ ok: true });
  }),
);

notificationsRouter.delete(
  '/me/push',
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ endpoint: z.string().max(1000).optional(), all: z.literal(true).optional() }).parse(req.body ?? {});
    const n = await withTenant(a.tenantId, (tx) => tx.pushSubscription.deleteMany({ where: { userId: a.userId, ...(body.all ? {} : { endpoint: body.endpoint ?? '' }) } }));
    res.json({ removed: n.count });
  }),
);
