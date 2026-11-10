/**
 * Departments (Aquatics, Water Works, Parks…) and who manages them. HR picks each
 * department's managers; a manager reaches the positions in the departments they
 * run. A city with no departments yet keeps the old behaviour.
 */
import { withTenant } from '../../lib/db.js';

export interface ManagedScope {
  /** False until the city sets up its first department. */
  hasDepartments: boolean;
  /** Positions in the departments this person was chosen to manage. */
  positionIds: string[];
  /** Whether one of those departments is aquatics (its managers also see pool staff without a position). */
  aquatic: boolean;
}

const cache = new Map<string, { at: number; v: ManagedScope }>();
const TTL_MS = 30_000;

export async function managedScope(tenantId: string, userId: string): Promise<ManagedScope> {
  const key = `${tenantId}:${userId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v;
  const v = await withTenant(tenantId, async (tx) => {
    if (!(await tx.department.count())) return { hasDepartments: false, positionIds: [], aquatic: false };
    const managed = await tx.departmentManager.findMany({ where: { userId }, include: { department: { select: { aquatic: true, positions: { select: { id: true } } } } } });
    return {
      hasDepartments: true,
      positionIds: [...new Set(managed.flatMap((m) => m.department.positions.map((p) => p.id)))],
      aquatic: managed.some((m) => m.department.aquatic),
    };
  });
  cache.set(key, { at: Date.now(), v });
  return v;
}

export function forgetDepartments(tenantId?: string): void {
  if (!tenantId) return cache.clear();
  for (const k of cache.keys()) if (k.startsWith(`${tenantId}:`)) cache.delete(k);
}
