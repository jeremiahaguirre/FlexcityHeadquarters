import { Router } from 'express';
import { z } from 'zod';
import { authOf } from '../auth/middleware.js';
import { withTenant } from '../lib/db.js';
import { onUserSignal } from '../services/notifications/liveHub.js';
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
    if (s.tenantId === a.tenantId) res.write(`event: notification\ndata: ${JSON.stringify({ id: s.id })}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(`: keep-alive\n\n`), 25_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    off();
  });
});
