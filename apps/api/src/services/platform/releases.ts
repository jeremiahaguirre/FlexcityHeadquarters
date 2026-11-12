/**
 * Staged rollouts by organization (docs/RELEASES.md).
 *
 * - Release rings (Pilot, Early, General…) group organizations; an organization is in at most one.
 * - A release bundles feature switches (services/platform/features.ts) to set. It goes out ring by
 *   ring: a stage for a ring, now or at a set time. A ring's stage can be scheduled only once every
 *   earlier ring has one, and not before theirs.
 * - The organization's own choice wins: a switch the Dev console (or the organization itself) set on
 *   purpose (Tenant.featureChoices) is never changed by a release. The preview shows these
 *   conflicts before scheduling, and they are checked again when the stage applies.
 * - HR admins hear about it in advance (in-app and email, EN/FR): `noticeDays` before, or at once
 *   when the stage is sooner. The worker sends notices and applies due stages every minute;
 *   both steps claim their row first, so running twice never repeats them.
 * - Undoing a stage puts back each switch it changed, unless someone changed that switch since.
 * Every step is in the Dev console's log and in each organization's own audit trail.
 */
import type { Prisma, PrismaClient, ReleaseChange } from '../../generated/prisma/client.js';
import { z } from 'zod';
import { type Tx, db, withTenant } from '../../lib/db.js';
import { HttpError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { notify, usersWithRoles } from '../notifications/notifier.js';
import { FEATURE_KEYS, type FeatureKey, forgetFeatures, resolveFeatures } from './features.js';
import { setRingResolver } from './releaseNotes.js';

const DAY = 86_400_000;
type Switches = Partial<Record<FeatureKey, boolean>>;

export const releaseBody = z.object({
  name: z.string().trim().min(2).max(120),
  summaryEn: z.string().trim().min(2).max(1000),
  summaryFr: z.string().trim().min(2).max(1000),
  features: z
    .partialRecord(z.enum(FEATURE_KEYS as [FeatureKey, ...FeatureKey[]]), z.boolean())
    .refine((f) => Object.keys(f).length > 0, 'Choose at least one feature'),
});
export const stageBody = z.object({
  ringId: z.string().uuid(),
  scheduledAt: z.coerce.date(),
  noticeDays: z.number().int().min(0).max(60).default(7),
});

// ---- Rings -------------------------------------------------------------------------------------

export async function listRings(prisma: PrismaClient = db()) {
  const rings = await prisma.releaseRing.findMany({ orderBy: { position: 'asc' }, include: { members: { select: { tenantId: true } } } });
  return rings.map((r) => ({ id: r.id, name: r.name, position: r.position, tenantIds: r.members.map((m) => m.tenantId) }));
}

export async function ringTenantIds(prisma: PrismaClient, ringIds: string[]): Promise<string[]> {
  return (await prisma.releaseRingMember.findMany({ where: { ringId: { in: ringIds } }, select: { tenantId: true } })).map((m) => m.tenantId);
}
// What's new notes for a ring reach its organizations.
setRingResolver(ringTenantIds);

/** Puts these organizations in the ring (moving them out of any other) and takes the rest out of it. */
export async function setRingMembers(prisma: PrismaClient, ringId: string, tenantIds: string[]) {
  await prisma.$transaction(async (tx) => {
    await tx.releaseRingMember.deleteMany({ where: { OR: [{ ringId, tenantId: { notIn: tenantIds } }, { tenantId: { in: tenantIds }, ringId: { not: ringId } }] } });
    await tx.releaseRingMember.createMany({ data: tenantIds.map((tenantId) => ({ tenantId, ringId })), skipDuplicates: true });
  });
}

// ---- Preview: what a stage would do, organization by organization -----------------------------

export interface OrgPreview {
  tenantId: string;
  name: string;
  /** Switches that will change. */
  changes: Array<{ key: FeatureKey; from: boolean; to: boolean }>;
  /** Chosen on purpose for this organization: the release leaves them as they are. */
  conflicts: Array<{ key: FeatureKey; value: boolean }>;
  /** Already as the release wants. */
  unchanged: FeatureKey[];
}

export function planFor(features: Switches, stored: unknown, choices: string[]): Omit<OrgPreview, 'tenantId' | 'name'> {
  const now = resolveFeatures(stored);
  const out: Omit<OrgPreview, 'tenantId' | 'name'> = { changes: [], conflicts: [], unchanged: [] };
  for (const [k, to] of Object.entries(features) as Array<[FeatureKey, boolean]>) {
    if (choices.includes(k) && now[k] !== to) out.conflicts.push({ key: k, value: now[k] });
    else if (now[k] === to) out.unchanged.push(k);
    else out.changes.push({ key: k, from: now[k], to });
  }
  return out;
}

export async function previewStage(prisma: PrismaClient, releaseId: string, ringId: string): Promise<OrgPreview[]> {
  const release = await prisma.release.findUnique({ where: { id: releaseId } });
  if (!release) throw notFound('Release');
  const ids = await ringTenantIds(prisma, [ringId]);
  const out: OrgPreview[] = [];
  for (const id of ids) {
    const t = await withTenant(id, (tx) => tx.tenant.findUnique({ where: { id }, select: { name: true, features: true, featureChoices: true } }), { prisma });
    if (t) out.push({ tenantId: id, name: t.name, ...planFor(release.features as Switches, t.features, t.featureChoices) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---- Scheduling --------------------------------------------------------------------------------

const LIVE = ['SCHEDULED', 'APPLIED'];

/** A stage for a ring: every earlier ring already has one, no earlier than theirs. Creates each organization's part. */
export async function scheduleStage(prisma: PrismaClient, releaseId: string, input: z.infer<typeof stageBody>, adminId: string) {
  const release = await prisma.release.findUnique({ where: { id: releaseId }, include: { stages: true } });
  if (!release) throw notFound('Release');
  const ring = await prisma.releaseRing.findUnique({ where: { id: input.ringId } });
  if (!ring) throw notFound('Ring');
  if (release.stages.some((s) => s.ringId === ring.id && LIVE.includes(s.status))) throw conflict('STAGE_EXISTS', 'This release is already scheduled for that ring.');
  const earlier = await prisma.releaseRing.findMany({ where: { position: { lt: ring.position } } });
  for (const r of earlier) {
    const s = release.stages.find((x) => x.ringId === r.id && LIVE.includes(x.status));
    if (!s) throw conflict('RING_ORDER', `Schedule ${r.name} first: rings go in order.`, { ring: r.name });
    if (input.scheduledAt < s.scheduledAt) throw conflict('RING_ORDER', `Not before ${r.name}.`, { ring: r.name, after: s.scheduledAt });
  }
  const members = await ringTenantIds(prisma, [ring.id]);
  if (!members.length) throw badRequest('This ring has no organizations yet.');
  const stage = await prisma.$transaction(async (tx) => {
    // A cancelled or undone stage for this ring makes way for the new one.
    await tx.releaseStage.deleteMany({ where: { releaseId, ringId: ring.id, status: { notIn: LIVE } } });
    const st = await tx.releaseStage.create({ data: { releaseId, ringId: ring.id, scheduledAt: input.scheduledAt, noticeDays: input.noticeDays, createdById: adminId } });
    for (const tenantId of members) {
      await tx.releaseChange.create({
        data: { tenantId, stageId: st.id, releaseId, titleEn: release.name, titleFr: release.name, summaryEn: release.summaryEn, summaryFr: release.summaryFr, features: release.features as Prisma.InputJsonValue, scheduledAt: input.scheduledAt },
      });
    }
    await tx.platformAudit.create({ data: { adminId, tenantId: null, action: 'release.schedule', detail: { releaseId, release: release.name, ring: ring.name, scheduledAt: input.scheduledAt.toISOString(), noticeDays: input.noticeDays, organizations: members.length } } });
    return st;
  });
  return stage;
}

// ---- Advance notice ----------------------------------------------------------------------------

async function orgTimezone(tx: Tx): Promise<string> {
  return (await tx.facility.findFirst({ orderBy: { createdAt: 'asc' }, select: { timezone: true } }))?.timezone ?? 'America/Toronto';
}
export function noticeParams(c: Pick<ReleaseChange, 'id' | 'titleEn' | 'titleFr' | 'summaryEn' | 'summaryFr' | 'scheduledAt'>, timeZone: string) {
  const when = (locale: string) => new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'long', timeStyle: 'short' }).format(c.scheduledAt);
  return { changeId: c.id, titleEn: c.titleEn, titleFr: c.titleFr, summaryEn: c.summaryEn, summaryFr: c.summaryFr, whenEn: when('en-CA'), whenFr: when('fr-CA'), at: c.scheduledAt.toISOString() };
}

/** HR admins of each organization whose change is within its notice period, once. */
export async function sendReleaseNotices(prisma: PrismaClient = db(), now = new Date()): Promise<number> {
  const due = await prisma.releaseChange.findMany({ where: { status: 'PLANNED', noticeSentAt: null }, include: { stage: { select: { noticeDays: true } } } });
  let sent = 0;
  for (const c of due) {
    if (c.scheduledAt.getTime() - c.stage.noticeDays * DAY > now.getTime()) continue;
    sent += await withTenant(
      c.tenantId,
      async (tx) => {
        // Claimed first: a second worker (or a retry) finds nothing to send.
        const claimed = await tx.releaseChange.updateMany({ where: { id: c.id, noticeSentAt: null, status: 'PLANNED' }, data: { noticeSentAt: now } });
        if (!claimed.count) return 0;
        const params = noticeParams(c, await orgTimezone(tx));
        const hr = await usersWithRoles(tx, ['HR_ADMIN']);
        await notify(tx, c.tenantId, hr.map((userId) => ({ userId, type: 'release_scheduled', params, link: '/whats-new', email: 'release_scheduled' })));
        return 1;
      },
      { prisma },
    );
  }
  return sent;
}

// ---- Applying and undoing ----------------------------------------------------------------------

async function record(tx: Tx, adminId: string, tenantId: string, action: string, detail: unknown) {
  const json = JSON.parse(JSON.stringify(detail)) as Prisma.InputJsonValue;
  await tx.platformAudit.create({ data: { adminId, tenantId, action, detail: json } });
  await tx.auditLog.create({ data: { tenantId, actorId: null, action: `platform.${action}`, entity: 'Tenant', entityId: tenantId, after: json } });
}

/** One organization's part: claim it, skip its own choices, remember what it had, set the rest. */
export async function applyChange(prisma: PrismaClient, changeId: string, tenantId: string, adminId: string, now = new Date()): Promise<boolean> {
  const done = await withTenant(
    tenantId,
    async (tx) => {
      const claimed = await tx.releaseChange.updateMany({ where: { id: changeId, status: 'PLANNED' }, data: { status: 'APPLIED', appliedAt: now } });
      if (!claimed.count) return false;
      const c = await tx.releaseChange.findUniqueOrThrow({ where: { id: changeId } });
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { features: true, featureChoices: true } });
      const stored = (t.features && typeof t.features === 'object' ? t.features : {}) as Record<string, boolean>;
      const want = c.features as Switches;
      const skipped: string[] = [];
      const previous: Record<string, boolean | null> = {};
      const next = { ...stored };
      for (const [k, v] of Object.entries(want)) {
        if (t.featureChoices.includes(k)) {
          skipped.push(k);
          continue;
        }
        previous[k] = typeof stored[k] === 'boolean' ? stored[k]! : null;
        next[k] = v as boolean;
      }
      await tx.tenant.update({ where: { id: tenantId }, data: { features: next } });
      await tx.releaseChange.update({ where: { id: changeId }, data: { skipped, previous } });
      await record(tx, adminId, tenantId, 'release.apply', { releaseId: c.releaseId, release: c.titleEn, set: Object.fromEntries(Object.entries(want).filter(([k]) => !skipped.includes(k))), keptOwnChoice: skipped });
      return true;
    },
    { prisma },
  );
  if (done) forgetFeatures(tenantId);
  return done;
}

async function settleStage(prisma: PrismaClient, stageId: string, now = new Date()) {
  const left = await prisma.releaseChange.count({ where: { stageId, status: 'PLANNED' } });
  if (!left) await prisma.releaseStage.updateMany({ where: { id: stageId, status: 'SCHEDULED' }, data: { status: 'APPLIED', appliedAt: now } });
}

export async function applyStage(prisma: PrismaClient, stageId: string, now = new Date()): Promise<number> {
  const stage = await prisma.releaseStage.findUnique({ where: { id: stageId }, include: { changes: { where: { status: 'PLANNED' }, select: { id: true, tenantId: true } } } });
  if (!stage || stage.status !== 'SCHEDULED') return 0;
  let n = 0;
  for (const c of stage.changes) if (await applyChange(prisma, c.id, c.tenantId, stage.createdById, now)) n++;
  await settleStage(prisma, stageId, now);
  return n;
}

/** Worker: notices first, then every stage whose time has come. */
export async function releaseTick(prisma: PrismaClient = db(), now = new Date()): Promise<{ notices: number; applied: number }> {
  const notices = await sendReleaseNotices(prisma, now);
  let applied = 0;
  for (const s of await prisma.releaseStage.findMany({ where: { status: 'SCHEDULED', scheduledAt: { lte: now } }, select: { id: true } })) applied += await applyStage(prisma, s.id, now);
  return { notices, applied };
}

/**
 * Undo a stage: each switch it set goes back to what it was, unless it was changed since (then it
 * stays, and is reported). Organizations not reached yet are simply cancelled.
 */
export async function rollbackStage(prisma: PrismaClient, stageId: string, adminId: string, now = new Date()) {
  const stage = await prisma.releaseStage.findUnique({ where: { id: stageId }, include: { changes: true } });
  if (!stage) throw notFound('Stage');
  if (!LIVE.includes(stage.status)) throw conflict('STAGE_CLOSED', 'This stage was already undone or cancelled.');
  const kept: Array<{ tenantId: string; keys: string[] }> = [];
  let restored = 0;
  for (const c of stage.changes) {
    if (c.status === 'PLANNED') {
      await withTenant(c.tenantId, (tx) => tx.releaseChange.updateMany({ where: { id: c.id, status: 'PLANNED' }, data: { status: 'CANCELLED' } }), { prisma });
      continue;
    }
    if (c.status !== 'APPLIED') continue;
    const r = await withTenant(
      c.tenantId,
      async (tx) => {
        const claimed = await tx.releaseChange.updateMany({ where: { id: c.id, status: 'APPLIED' }, data: { status: 'ROLLED_BACK', rolledBackAt: now } });
        if (!claimed.count) return null;
        const t = await tx.tenant.findUniqueOrThrow({ where: { id: c.tenantId }, select: { features: true, featureChoices: true } });
        const stored = { ...((t.features && typeof t.features === 'object' ? t.features : {}) as Record<string, boolean>) };
        const set = c.features as Switches;
        const prev = (c.previous ?? {}) as Record<string, boolean | null>;
        const left: string[] = [];
        for (const k of Object.keys(prev)) {
          // Changed since (by the console, the organization or another release): leave it.
          if (stored[k] !== set[k as FeatureKey] || t.featureChoices.includes(k)) {
            left.push(k);
            continue;
          }
          if (prev[k] === null) delete stored[k];
          else stored[k] = prev[k]!;
        }
        await tx.tenant.update({ where: { id: c.tenantId }, data: { features: stored } });
        await record(tx, adminId, c.tenantId, 'release.rollback', { releaseId: c.releaseId, release: c.titleEn, restored: Object.keys(prev).filter((k) => !left.includes(k)), leftAsChanged: left });
        return left;
      },
      { prisma },
    );
    if (r === null) continue;
    restored++;
    forgetFeatures(c.tenantId);
    if (r.length) kept.push({ tenantId: c.tenantId, keys: r });
  }
  await prisma.releaseStage.update({ where: { id: stageId }, data: stage.status === 'APPLIED' ? { status: 'ROLLED_BACK', rolledBackAt: now } : { status: 'CANCELLED', rolledBackAt: now } });
  await prisma.platformAudit.create({ data: { adminId, tenantId: null, action: stage.status === 'APPLIED' ? 'release.rollback' : 'release.cancel', detail: { stageId, releaseId: stage.releaseId, restored, kept } } });
  return { restored, kept };
}

/** A whole release, last ring first. */
export async function rollbackRelease(prisma: PrismaClient, releaseId: string, adminId: string) {
  const stages = await prisma.releaseStage.findMany({ where: { releaseId, status: { in: LIVE } } });
  const rings = new Map((await prisma.releaseRing.findMany()).map((r) => [r.id, r.position]));
  stages.sort((a, b) => (rings.get(b.ringId) ?? 0) - (rings.get(a.ringId) ?? 0));
  if (!stages.length) throw new HttpError(409, 'NOTHING_TO_UNDO', 'Nothing of this release is scheduled or applied.');
  const out = [];
  for (const s of stages) out.push(await rollbackStage(prisma, s.id, adminId));
  return { stages: out.length, restored: out.reduce((n, r) => n + r.restored, 0), kept: out.flatMap((r) => r.kept) };
}

// ---- What an organization sees -----------------------------------------------------------------

/** Coming and recent release changes for this organization (its HR admins' Updates list). */
export async function changesFor(tx: Tx, now = new Date()) {
  const rows = await tx.releaseChange.findMany({
    where: { OR: [{ status: 'PLANNED' }, { status: { in: ['APPLIED', 'ROLLED_BACK'] }, scheduledAt: { gte: new Date(now.getTime() - 30 * DAY) } }] },
    orderBy: { scheduledAt: 'asc' },
    take: 50,
  });
  const choices = (await tx.tenant.findFirst({ select: { featureChoices: true } }))?.featureChoices ?? [];
  return rows.map((c) => {
    const f = c.features as Record<string, boolean>;
    const kept = c.status === 'PLANNED' ? Object.keys(f).filter((k) => choices.includes(k)) : c.skipped;
    return { id: c.id, title: { en: c.titleEn, fr: c.titleFr }, summary: { en: c.summaryEn, fr: c.summaryFr }, scheduledAt: c.scheduledAt.toISOString(), status: c.status, features: Object.fromEntries(Object.entries(f).filter(([k]) => !kept.includes(k))), keptOwnChoice: kept };
  });
}
