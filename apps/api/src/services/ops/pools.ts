/**
 * Pools in an aquatic centre: their details (capacity, depth, volume) and
 * deck headcounts. Water chemistry lives in poolOps.ts and is reported apart.
 */
import { z } from 'zod';
import type { Tx } from '../../lib/db.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { localIso } from '../../lib/time.js';
import { notify, usersWithRoles } from '../notifications/notifier.js';
import { lifeguardsRequired } from './chemistry.js';

export const poolKinds = z.enum(['POOL', 'LEISURE_POOL', 'HOT_TUB', 'WADING_POOL', 'WAVE_POOL', 'SPLASH_PAD']);
const metres = z.string().regex(/^\d{1,2}(\.\d{1,2})?$/).nullable();

export const poolDetailsBody = z.object({
  facilityId: z.string().uuid(),
  name: z.string().trim().min(2).max(60),
  kind: poolKinds,
  maxCapacity: z.number().int().min(1).max(10_000).nullable(),
  bathersPerLifeguard: z.number().int().min(1).max(500).nullable(),
  depthMinM: metres,
  depthMaxM: metres,
  volumeLitres: z.number().int().min(100).max(50_000_000).nullable(),
  notes: z.string().trim().max(500).nullable(),
  archived: z.boolean().optional(),
});
export type PoolDetails = z.infer<typeof poolDetailsBody>;

function check(b: Partial<PoolDetails>) {
  if (b.depthMinM && b.depthMaxM && Number(b.depthMinM) > Number(b.depthMaxM)) throw badRequest('The shallow end must not be deeper than the deep end.');
}

export async function createPool(tx: Tx, tenantId: string, b: PoolDetails) {
  check(b);
  if (!(await tx.facility.findUnique({ where: { id: b.facilityId } }))) throw notFound('Facility');
  const { archived: _a, ...data } = b;
  return tx.poolBody.create({ data: { ...data, tenantId } });
}

export async function updatePool(tx: Tx, id: string, b: Partial<PoolDetails>) {
  const before = await tx.poolBody.findUnique({ where: { id } });
  if (!before) throw notFound('Pool');
  // Compare against what's saved for whichever end isn't being changed.
  check({ depthMinM: b.depthMinM !== undefined ? b.depthMinM : (before.depthMinM?.toString() ?? null), depthMaxM: b.depthMaxM !== undefined ? b.depthMaxM : (before.depthMaxM?.toString() ?? null) });
  if (b.facilityId && !(await tx.facility.findUnique({ where: { id: b.facilityId } }))) throw notFound('Facility');
  const { archived, ...data } = b;
  return tx.poolBody.update({ where: { id }, data: { ...data, ...(archived === undefined ? {} : { archivedAt: archived ? (before.archivedAt ?? new Date()) : null }) } });
}

export const poolDetailsView = (p: {
  maxCapacity: number | null;
  depthMinM: { toString(): string } | null;
  depthMaxM: { toString(): string } | null;
  volumeLitres: number | null;
  notes: string | null;
  archivedAt: Date | null;
}) => ({
  maxCapacity: p.maxCapacity,
  depthMinM: p.depthMinM?.toString() ?? null,
  depthMaxM: p.depthMaxM?.toString() ?? null,
  volumeLitres: p.volumeLitres,
  notes: p.notes,
  archived: p.archivedAt !== null,
});

/** Records a deck count; above capacity, head guards and supervisors are alerted. */
export async function recordHeadcount(tx: Tx, tenantId: string, userId: string, poolBodyId: string, count: number) {
  const pool = await tx.poolBody.findUnique({ where: { id: poolBodyId } });
  if (!pool || pool.archivedAt) throw notFound('Pool');
  const overCapacity = pool.maxCapacity !== null && count > pool.maxCapacity;
  const hc = await tx.headCount.create({ data: { tenantId, poolBodyId, count, overCapacity, recordedById: userId } });
  if (overCapacity) {
    const leads = await usersWithRoles(tx, ['HEAD_LIFEGUARD', 'AQUATIC_SUPERVISOR'], [userId]);
    await notify(tx, tenantId, leads.map((id) => ({ userId: id, type: 'over_capacity', params: { pool: pool.name, count, max: pool.maxCapacity }, link: '/headcount' })));
  }
  return { id: hc.id, overCapacity, maxCapacity: pool.maxCapacity, lifeguardsRequired: lifeguardsRequired(count, pool.bathersPerLifeguard) };
}

/** Every open pool with its capacity and latest count: what the clicker screen needs. */
export async function headcountBoard(tx: Tx) {
  const pools = await tx.poolBody.findMany({
    where: { archivedAt: null },
    include: { facility: { select: { id: true, name: true, timezone: true } }, headcounts: { orderBy: { recordedAt: 'desc' }, take: 1 } },
    orderBy: [{ facility: { name: 'asc' } }, { name: 'asc' }],
  });
  const ids = pools.flatMap((p) => p.headcounts.map((h) => h.recordedById));
  const people = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } });
  return pools.map((p) => {
    const last = p.headcounts[0];
    const who = last ? people.find((u) => u.id === last.recordedById) : undefined;
    return {
      id: p.id,
      name: p.name,
      kind: p.kind,
      status: p.status,
      facility: { id: p.facility.id, name: p.facility.name },
      maxCapacity: p.maxCapacity,
      bathersPerLifeguard: p.bathersPerLifeguard,
      last: last
        ? { count: last.count, overCapacity: last.overCapacity, localRecordedAt: localIso(last.recordedAt, p.facility.timezone), by: who ? `${who.firstName} ${who.lastName}` : null, lifeguardsRequired: lifeguardsRequired(last.count, p.bathersPerLifeguard) }
        : null,
    };
  });
}

/** The headcount report: every count in a period, newest first. */
export async function headcountReport(tx: Tx, from: Date, to: Date, poolBodyId?: string) {
  const rows = await tx.headCount.findMany({
    where: { recordedAt: { gte: from, lt: to }, ...(poolBodyId ? { poolBodyId } : {}) },
    include: { poolBody: { select: { id: true, name: true, maxCapacity: true, bathersPerLifeguard: true, facility: { select: { name: true, timezone: true } } } } },
    orderBy: { recordedAt: 'desc' },
    take: 2000,
  });
  const people = await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.recordedById))] } }, select: { id: true, firstName: true, lastName: true } });
  return rows.map((r) => {
    const who = people.find((u) => u.id === r.recordedById);
    return {
      id: r.id,
      pool: { id: r.poolBody.id, name: r.poolBody.name, facility: r.poolBody.facility.name, maxCapacity: r.poolBody.maxCapacity },
      count: r.count,
      overCapacity: r.overCapacity,
      lifeguardsRequired: lifeguardsRequired(r.count, r.poolBody.bathersPerLifeguard),
      localRecordedAt: localIso(r.recordedAt, r.poolBody.facility.timezone),
      by: who ? `${who.firstName} ${who.lastName}` : null,
    };
  });
}
