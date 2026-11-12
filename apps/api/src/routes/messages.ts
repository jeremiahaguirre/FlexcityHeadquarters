/**
 * Team messaging routes (services/messaging): conversations, messages, read receipts, muting,
 * reports to HR, investigations and the organization's messaging settings.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import { audit, withTenant } from '../lib/db.js';
import { sendFile } from '../lib/files.js';
import { MAX_TEXT, MESSAGING_DEFAULTS, SHIFT_ARCHIVE_LIMITS, readMessagingSettings } from '../services/messaging/policy.js';
import {
  MAX_FILE_BYTES,
  addMembers,
  closeReport,
  conversationsOf,
  createGroup,
  directory,
  editMessage,
  listConversations,
  listReports,
  markRead,
  openDepartment,
  openDirect,
  openForInvestigation,
  openShift,
  readAttachment,
  readConversation,
  removeMember,
  removeMessage,
  reportMessage,
  sendMessage,
  setMuted,
  unreadTotal,
  inMessaging,
} from '../services/messaging/conversations.js';
import { h } from './context.js';

export const messagesRouter = Router();
messagesRouter.use('/messages', requireFeature('messaging'));
const uuid = z.string().uuid();
const use = requirePermission('messages.use');
const investigate = requirePermission('messages.investigate');

messagesRouter.get(
  '/messages/unread',
  use,
  h(async (req, res) => {
    const a = authOf(req);
    res.json({ total: await inMessaging(a, (tx) => unreadTotal(tx, a.userId)) });
  }),
);

messagesRouter.get(
  '/messages/people',
  use,
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await inMessaging(a, (tx) => directory(tx, a)));
  }),
);

messagesRouter.get(
  '/messages/conversations',
  use,
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await inMessaging(a, (tx) => listConversations(tx, a)));
  }),
);

messagesRouter.post(
  '/messages/direct',
  use,
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ userId: uuid }).parse(req.body);
    const c = await inMessaging(a, (tx) => openDirect(tx, a, b.userId));
    res.status(201).json({ id: c.id });
  }),
);

messagesRouter.post(
  '/messages/groups',
  use,
  requirePermission('messages.groups'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ title: z.string().trim().min(2).max(80), memberIds: z.array(uuid).min(1).max(500) }).parse(req.body);
    const c = await inMessaging(a, (tx) => createGroup(tx, a, b.title, b.memberIds));
    res.status(201).json({ id: c.id });
  }),
);

messagesRouter.post(
  '/messages/shift',
  use,
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ shiftId: uuid }).parse(req.body);
    const c = await inMessaging(a, (tx) => openShift(tx, a, b.shiftId));
    res.status(201).json({ id: c.id });
  }),
);

messagesRouter.post(
  '/messages/department',
  use,
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ departmentId: uuid }).parse(req.body);
    const c = await inMessaging(a, (tx) => openDepartment(tx, a, b.departmentId));
    res.status(201).json({ id: c.id });
  }),
);

/** Members read; HR reads only after opening it for an investigation (requires messages.investigate, checked inside). */
messagesRouter.get(
  '/messages/conversations/:id',
  h(async (req, res) => {
    const a = authOf(req);
    if (!a.permissions.has('messages.use') && !a.permissions.has('messages.investigate')) return void res.status(403).json({ code: 'FORBIDDEN', message: 'Forbidden' });
    const id = uuid.parse(req.params.id);
    const q = z.object({ before: z.coerce.date().optional() }).parse(req.query);
    res.json(await inMessaging(a, (tx) => readConversation(tx, a, id, q.before)));
  }),
);

const attachment = z.object({ fileName: z.string().trim().min(1).max(160), data: z.string().regex(/^data:[\w.+/-]+;base64,/).max(Math.ceil((MAX_FILE_BYTES * 4) / 3) + 200) });

messagesRouter.post(
  '/messages/conversations/:id/messages',
  use,
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const b = z.object({ text: z.string().max(MAX_TEXT + 200).default(''), attachment: attachment.optional() }).parse(req.body);
    res.status(201).json(await inMessaging(a, (tx) => sendMessage(tx, a, id, b.text, b.attachment)));
  }),
);

messagesRouter.post(
  '/messages/conversations/:id/read',
  use,
  h(async (req, res) => {
    const a = authOf(req);
    await inMessaging(a, (tx) => markRead(tx, a, uuid.parse(req.params.id)));
    res.json({ ok: true });
  }),
);

messagesRouter.post(
  '/messages/conversations/:id/mute',
  use,
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ muted: z.boolean() }).parse(req.body);
    await inMessaging(a, (tx) => setMuted(tx, a, uuid.parse(req.params.id), b.muted));
    res.json({ ok: true });
  }),
);

messagesRouter.post(
  '/messages/conversations/:id/members',
  use,
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ userIds: z.array(uuid).min(1).max(200) }).parse(req.body);
    await inMessaging(a, (tx) => addMembers(tx, a, uuid.parse(req.params.id), b.userIds));
    res.json({ ok: true });
  }),
);

messagesRouter.delete(
  '/messages/conversations/:id/members/:userId',
  use,
  h(async (req, res) => {
    const a = authOf(req);
    const userId = req.params.userId === 'me' ? a.userId : uuid.parse(req.params.userId);
    await inMessaging(a, (tx) => removeMember(tx, a, uuid.parse(req.params.id), userId));
    res.json({ ok: true });
  }),
);

messagesRouter.patch(
  '/messages/:id',
  use,
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ text: z.string().max(MAX_TEXT + 200) }).parse(req.body);
    await inMessaging(a, (tx) => editMessage(tx, a, uuid.parse(req.params.id), b.text));
    res.json({ ok: true });
  }),
);

messagesRouter.delete(
  '/messages/:id',
  use,
  h(async (req, res) => {
    const a = authOf(req);
    await inMessaging(a, (tx) => removeMessage(tx, a, uuid.parse(req.params.id)));
    res.json({ ok: true });
  }),
);

messagesRouter.get(
  '/messages/:id/file',
  h(async (req, res) => {
    const a = authOf(req);
    if (!a.permissions.has('messages.use') && !a.permissions.has('messages.investigate')) return void res.status(403).json({ code: 'FORBIDDEN', message: 'Forbidden' });
    const f = await inMessaging(a, (tx) => readAttachment(tx, a, uuid.parse(req.params.id)));
    sendFile(res, f.bytes, { type: f.type, name: f.name });
  }),
);

messagesRouter.post(
  '/messages/:id/report',
  use,
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ reason: z.string().trim().min(5).max(1000) }).parse(req.body);
    const r = await inMessaging(a, (tx) => reportMessage(tx, a, uuid.parse(req.params.id), b.reason));
    res.status(201).json({ id: r.id });
  }),
);

// ------------------------------------------------------------------ HR: reports and investigations
messagesRouter.get(
  '/messages-admin/reports',
  requireFeature('messaging'),
  investigate,
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await inMessaging(a, (tx) => listReports(tx, a)));
  }),
);

messagesRouter.post(
  '/messages-admin/reports/:id/close',
  requireFeature('messaging'),
  investigate,
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ note: z.string().trim().min(3).max(1000) }).parse(req.body);
    await inMessaging(a, (tx) => closeReport(tx, a, uuid.parse(req.params.id), b.note));
    res.json({ ok: true });
  }),
);

messagesRouter.post(
  '/messages-admin/conversations/:id/investigate',
  requireFeature('messaging'),
  investigate,
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ reason: z.string().trim().min(10).max(1000), reportId: uuid.optional() }).parse(req.body);
    const g = await inMessaging(a, (tx) => openForInvestigation(tx, a, uuid.parse(req.params.id), b.reason, b.reportId));
    res.status(201).json({ expiresAt: g.expiresAt });
  }),
);

/** Looking up someone's conversations needs a reason, like opening one; it's recorded with the lookup. */
messagesRouter.post(
  '/messages-admin/people/:id/conversations',
  requireFeature('messaging'),
  investigate,
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ reason: z.string().trim().min(10).max(1000) }).parse(req.body);
    res.json(await inMessaging(a, (tx) => conversationsOf(tx, a, uuid.parse(req.params.id), b.reason)));
  }),
);

// ------------------------------------------------------------------ Settings
messagesRouter.get(
  '/messages-admin/settings',
  requireFeature('messaging'),
  requirePermission('tenant.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    const t = await inMessaging(a, (tx) => tx.tenant.findFirstOrThrow({ select: { messagingSettings: true } }));
    res.json({ ...readMessagingSettings(t.messagingSettings), defaults: MESSAGING_DEFAULTS, shiftArchiveLimits: SHIFT_ARCHIVE_LIMITS });
  }),
);

messagesRouter.put(
  '/messages-admin/settings',
  requireFeature('messaging'),
  requirePermission('tenant.configure'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = z.object({ staffDirect: z.boolean(), minorDirect: z.boolean(), pushPreview: z.boolean(), shiftArchiveHours: z.number().int().min(SHIFT_ARCHIVE_LIMITS[0]).max(SHIFT_ARCHIVE_LIMITS[1]) }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const before = await tx.tenant.findFirstOrThrow({ select: { messagingSettings: true } });
      await tx.tenant.update({ where: { id: a.tenantId }, data: { messagingSettings: b } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'settings.messaging', entity: 'Tenant', entityId: a.tenantId, before: readMessagingSettings(before.messagingSettings), after: b });
    });
    res.json(b);
  }),
);
