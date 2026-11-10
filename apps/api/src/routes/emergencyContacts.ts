/**
 * Emergency contacts: who to call for someone in an emergency. People keep their
 * own; HR can keep them for anyone; a working-alone monitor sees them only once
 * that person's session has escalated or they asked for help. Every read of
 * someone else's contacts is audited.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireFeature, requirePermission } from '../auth/middleware.js';
import type { Tx } from '../lib/db.js';
import { audit, withTenant } from '../lib/db.js';
import { conflict, notFound } from '../lib/errors.js';
import { assertUserInScope } from '../services/people/scope.js';
import { h } from './context.js';

export const emergencyContactsRouter = Router();
const uuid = z.string().uuid();
export const MAX_CONTACTS = 3;

const phone = z.string().trim().regex(/^\+?[\d\s().-]{10,20}$/, 'Use a phone number with its area code.').refine((p) => p.replace(/\D/g, '').length >= 10, 'Use a phone number with its area code.');
export const contactsBody = z
  .array(z.object({ name: z.string().trim().min(2).max(80), relationship: z.string().trim().max(40).nullable().optional(), phone, altPhone: phone.nullable().optional() }))
  .max(MAX_CONTACTS);

const view = (c: { id: string; name: string; relationship: string | null; phone: string; altPhone: string | null; priority: number }) => ({ id: c.id, name: c.name, relationship: c.relationship, phone: c.phone, altPhone: c.altPhone, priority: c.priority });

export async function contactsOf(tx: Tx, userId: string) {
  return (await tx.emergencyContact.findMany({ where: { userId }, orderBy: { priority: 'asc' } })).map(view);
}

/** Replaces the whole list, in the order given (first = call first). */
async function replaceContacts(tx: Tx, tenantId: string, userId: string, list: z.infer<typeof contactsBody>) {
  await tx.emergencyContact.deleteMany({ where: { userId } });
  if (list.length) await tx.emergencyContact.createMany({ data: list.map((c, i) => ({ tenantId, userId, name: c.name, relationship: c.relationship ?? null, phone: c.phone, altPhone: c.altPhone ?? null, priority: i + 1 })) });
  return contactsOf(tx, userId);
}

emergencyContactsRouter.get(
  '/me/emergency-contacts',
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await withTenant(a.tenantId, (tx) => contactsOf(tx, a.userId)));
  }),
);

emergencyContactsRouter.put(
  '/me/emergency-contacts',
  h(async (req, res) => {
    const a = authOf(req);
    const list = contactsBody.parse(req.body);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const out = await replaceContacts(tx, a.tenantId, a.userId, list);
        await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'emergency_contacts.update', entity: 'User', entityId: a.userId, after: { count: list.length } });
        return out;
      }),
    );
  }),
);

/** HR: someone's contacts, e.g. after a workplace injury. */
emergencyContactsRouter.get(
  '/users/:id/emergency-contacts',
  requirePermission('users.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.id);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        if (!(await tx.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw notFound('Person');
        await assertUserInScope(tx, a, userId);
        await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'emergency_contacts.read', entity: 'User', entityId: userId });
        return contactsOf(tx, userId);
      }),
    );
  }),
);

emergencyContactsRouter.put(
  '/users/:id/emergency-contacts',
  requirePermission('users.write'),
  h(async (req, res) => {
    const a = authOf(req);
    const userId = uuid.parse(req.params.id);
    const list = contactsBody.parse(req.body);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        if (!(await tx.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw notFound('Person');
        await assertUserInScope(tx, a, userId);
        const out = await replaceContacts(tx, a.tenantId, userId, list);
        await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'emergency_contacts.update', entity: 'User', entityId: userId, after: { count: list.length } });
        return out;
      }),
    );
  }),
);

/** A monitor, once a working-alone session has escalated or the person asked for help. */
emergencyContactsRouter.get(
  '/lone-work/:id/emergency-contacts',
  requireFeature('loneWork'),
  requirePermission('lonework.monitor'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const s = await tx.loneWorkSession.findUnique({ where: { id }, select: { userId: true, status: true } });
        if (!s) throw notFound('Working-alone session');
        await assertUserInScope(tx, a, s.userId);
        if (s.status !== 'ESCALATED' && s.status !== 'HELP') throw conflict('NOT_ESCALATED', 'Emergency contacts open once a session has escalated or the person asked for help.');
        await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'emergency_contacts.read', entity: 'LoneWorkSession', entityId: id, after: { userId: s.userId, status: s.status } });
        return contactsOf(tx, s.userId);
      }),
    );
  }),
);
