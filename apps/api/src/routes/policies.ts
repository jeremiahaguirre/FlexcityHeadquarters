/**
 * Policies staff read and sign: a pool safety plan, the code of conduct, the
 * respectful-workplace policy. Signing records the typed name and a fingerprint
 * of the exact text; a revision is a new version everyone signs again.
 */
import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { authOf, requirePermission } from '../auth/middleware.js';
import type { Tx } from '../lib/db.js';
import { audit, withTenant } from '../lib/db.js';
import { conflict, notFound } from '../lib/errors.js';
import { notify } from '../services/notifications/notifier.js';
import { h } from './context.js';

export const policiesRouter = Router();
const uuid = z.string().uuid();
const fingerprint = (title: string, body: string) => createHash('sha256').update(`${title}\n\n${body}`).digest('hex');
const draft = z.object({ title: z.string().trim().min(3).max(140), body: z.string().trim().min(20).max(60_000), positionIds: z.array(uuid).max(100).default([]), dueDays: z.number().int().min(1).max(365).nullable().optional() });

/** Active people a policy is for. */
async function audience(tx: Tx, positionIds: string[]) {
  return tx.user.findMany({ where: { status: 'ACTIVE', anonymizedAt: null, ...(positionIds.length ? { positions: { some: { positionId: { in: positionIds } } } } : { roles: { isEmpty: false } }) }, select: { id: true, firstName: true, lastName: true, createdAt: true } });
}
const dueOn = (p: { publishedAt: Date; dueDays: number | null }, started?: Date) => (p.dueDays ? new Date(Math.max(p.publishedAt.getTime(), started?.getTime() ?? 0) + p.dueDays * 86_400_000) : null);

/** Mine: to sign, and signed. */
policiesRouter.get(
  '/me/policies',
  h(async (req, res) => {
    const a = authOf(req);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const me = await tx.user.findUniqueOrThrow({ where: { id: a.userId }, select: { createdAt: true, positions: { select: { positionId: true } } } });
        const mine = new Set(me.positions.map((p) => p.positionId));
        const policies = await tx.policy.findMany({ where: { retiredAt: null }, orderBy: { publishedAt: 'desc' } });
        const forMe = policies.filter((p) => !p.positionIds.length || p.positionIds.some((x) => mine.has(x)));
        const acks = await tx.policyAck.findMany({ where: { userId: a.userId }, include: { policy: { select: { id: true, title: true, version: true } } }, orderBy: { signedAt: 'desc' } });
        const signed = new Set(acks.map((x) => x.policyId));
        return {
          toSign: forMe.filter((p) => !signed.has(p.id)).map((p) => ({ id: p.id, title: p.title, body: p.body, version: p.version, publishedAt: p.publishedAt, dueOn: dueOn(p, me.createdAt) })),
          signed: acks.map((x) => ({ policyId: x.policyId, title: x.policy.title, version: x.policy.version, signedAt: x.signedAt, signedName: x.signedName })),
        };
      }),
    );
  }),
);

policiesRouter.post(
  '/me/policies/:id/sign',
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const { signedName } = z.object({ signedName: z.string().trim().min(2).max(120) }).parse(req.body);
    await withTenant(a.tenantId, async (tx) => {
      const p = await tx.policy.findUnique({ where: { id } });
      if (!p || p.retiredAt) throw notFound('Policy');
      if (await tx.policyAck.findUnique({ where: { policyId_userId: { policyId: id, userId: a.userId } } })) throw conflict('ALREADY_SIGNED', 'You’ve already signed this policy.');
      // Re-check the fingerprint: what's signed is exactly what's stored.
      if (fingerprint(p.title, p.body) !== p.textSha256) throw conflict('POLICY_CHANGED', 'This policy’s text doesn’t match what was published.');
      await tx.policyAck.create({ data: { tenantId: a.tenantId, policyId: id, userId: a.userId, signedName, textSha256: p.textSha256 } });
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'policy.sign', entity: 'Policy', entityId: id, after: { version: p.version, textSha256: p.textSha256 } });
    });
    res.status(201).json({ ok: true });
  }),
);

/** HR: every live policy with how many have signed. */
policiesRouter.get(
  '/policies',
  requirePermission('policies.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const policies = await tx.policy.findMany({ where: { retiredAt: null }, orderBy: { publishedAt: 'desc' }, include: { _count: { select: { acks: true } } } });
        const out = [];
        for (const p of policies) {
          const people = await audience(tx, p.positionIds);
          out.push({ id: p.id, title: p.title, body: p.body, version: p.version, positionIds: p.positionIds, dueDays: p.dueDays, publishedAt: p.publishedAt, signed: p._count.acks, of: people.length, textSha256: p.textSha256 });
        }
        return out;
      }),
    );
  }),
);

async function publish(tx: Tx, tenantId: string, actorId: string, b: z.infer<typeof draft>, replaces?: { id: string; version: number }) {
  const p = await tx.policy.create({ data: { tenantId, title: b.title, body: b.body, textSha256: fingerprint(b.title, b.body), version: (replaces?.version ?? 0) + 1, replacesId: replaces?.id ?? null, positionIds: b.positionIds, dueDays: b.dueDays ?? null, createdById: actorId } });
  if (replaces) await tx.policy.update({ where: { id: replaces.id }, data: { retiredAt: new Date() } });
  await audit(tx, { tenantId, actorId, action: replaces ? 'policy.revise' : 'policy.publish', entity: 'Policy', entityId: p.id, after: { title: b.title, version: p.version, textSha256: p.textSha256, positions: b.positionIds.length } });
  const people = await audience(tx, b.positionIds);
  await notify(tx, tenantId, people.filter((u) => u.id !== actorId).map((u) => ({ userId: u.id, type: 'policy_to_sign', params: { title: b.title }, link: '/profile#policies' })));
  return p;
}

policiesRouter.post(
  '/policies',
  requirePermission('policies.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const b = draft.parse(req.body);
    const p = await withTenant(a.tenantId, (tx) => publish(tx, a.tenantId, a.userId, b));
    res.status(201).json({ id: p.id, version: p.version });
  }),
);

/** A new version: everyone it's for signs again. */
policiesRouter.post(
  '/policies/:id/revise',
  requirePermission('policies.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    const b = draft.parse(req.body);
    const p = await withTenant(a.tenantId, async (tx) => {
      const old = await tx.policy.findUnique({ where: { id } });
      if (!old || old.retiredAt) throw notFound('Policy');
      return publish(tx, a.tenantId, a.userId, b, { id: old.id, version: old.version });
    });
    res.status(201).json({ id: p.id, version: p.version });
  }),
);

policiesRouter.post(
  '/policies/:id/retire',
  requirePermission('policies.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    await withTenant(a.tenantId, async (tx) => {
      const done = await tx.policy.updateMany({ where: { id, retiredAt: null }, data: { retiredAt: new Date() } });
      if (!done.count) throw notFound('Policy');
      await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'policy.retire', entity: 'Policy', entityId: id });
    });
    res.json({ ok: true });
  }),
);

/** Who has signed this version, and who hasn't yet. */
policiesRouter.get(
  '/policies/:id/status',
  requirePermission('policies.manage'),
  h(async (req, res) => {
    const a = authOf(req);
    const id = uuid.parse(req.params.id);
    res.json(
      await withTenant(a.tenantId, async (tx) => {
        const p = await tx.policy.findUnique({ where: { id }, include: { acks: true } });
        if (!p) throw notFound('Policy');
        const people = await audience(tx, p.positionIds);
        const acked = new Map(p.acks.map((x) => [x.userId, x]));
        const now = Date.now();
        return {
          signed: people.filter((u) => acked.has(u.id)).map((u) => ({ userId: u.id, name: `${u.firstName} ${u.lastName}`, signedAt: acked.get(u.id)!.signedAt })),
          waiting: people.filter((u) => !acked.has(u.id)).map((u) => {
            const due = dueOn(p, u.createdAt);
            return { userId: u.id, name: `${u.firstName} ${u.lastName}`, dueOn: due, overdue: !!due && due.getTime() < now };
          }),
        };
      }),
    );
  }),
);
