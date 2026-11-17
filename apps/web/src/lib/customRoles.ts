export interface CustomRole {
  id: string;
  name: string;
  nameFr: string | null;
  description?: string | null;
  permissions?: string[];
  scopePositionIds?: string[];
  scopeFacilityIds?: string[];
  scopeDepartmentIds?: string[];
  members?: number;
  /** City side: whether this person may change the role or give it to someone. */
  canManage?: boolean;
}
export type RoleCatalog = Record<string, string[]>;
export interface RoleInput { name: string; nameFr: string | null; description: string | null; permissions: string[]; scopePositionIds: string[]; scopeFacilityIds: string[]; scopeDepartmentIds: string[] }

export const roleName = (r: { name: string; nameFr: string | null }, lng: string) => (lng === 'fr-CA' && r.nameFr ? r.nameFr : r.name);

/** Starting points: a template ticks the catalogue groups a kind of role usually needs. */
export const ROLE_TEMPLATES: Record<'worker' | 'lead' | 'supervisor' | 'manager', string[]> = {
  worker: ['everyday', 'shiftBoard'],
  lead: ['everyday', 'shiftBoard', 'lead'],
  supervisor: ['everyday', 'shiftBoard', 'safety', 'lead'],
  manager: ['everyday', 'lead', 'manager'],
};

/** The ticked capabilities that need `p` (managing roles needs the staff list): while any is ticked, `p` stays. */
export const neededBy = (checked: ReadonlySet<string>, p: string, needs: Readonly<Record<string, string[]>>): string[] => [...checked].filter((q) => needs[q]?.includes(p));

/** Ticks or unticks a capability in the role editor: ticking brings what it needs; something another ticked one needs can't be unticked. */
export function toggleCapability(checked: ReadonlySet<string>, p: string, needs: Readonly<Record<string, string[]>>, can: (p: string) => boolean): Set<string> {
  const next = new Set(checked);
  if (next.has(p)) {
    if (!neededBy(checked, p, needs).length) next.delete(p);
  } else for (const q of [p, ...(needs[p] ?? [])]) if (can(q)) next.add(q);
  return next;
}
