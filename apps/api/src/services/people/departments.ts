/**
 * Departments (Aquatics, Water Works, Parks…). The built-in aquatic roles reach
 * only the positions in aquatic departments; a city with no departments yet
 * keeps the old behaviour, where those roles reach the whole organization.
 */
import { withTenant } from '../../lib/db.js';

const cache = new Map<string, { at: number; aquatic: string[] | null }>();
const TTL_MS = 30_000;

/** Positions in aquatic departments, or null when the city has no departments yet. */
export async function aquaticPositions(tenantId: string): Promise<string[] | null> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.aquatic;
  const aquatic = await withTenant(tenantId, async (tx) => {
    if (!(await tx.department.count())) return null;
    return (await tx.position.findMany({ where: { department: { aquatic: true } }, select: { id: true } })).map((p) => p.id);
  });
  cache.set(tenantId, { at: Date.now(), aquatic });
  return aquatic;
}

export function forgetDepartments(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}
