export interface CustomRole {
  id: string;
  name: string;
  nameFr: string | null;
  description?: string | null;
  permissions?: string[];
  scopePositionIds?: string[];
  scopeFacilityIds?: string[];
  members?: number;
  /** City side: whether this person may change the role or give it to someone. */
  canManage?: boolean;
}
export type RoleCatalog = Record<string, string[]>;
export interface RoleInput { name: string; nameFr: string | null; description: string | null; permissions: string[]; scopePositionIds: string[]; scopeFacilityIds: string[] }

export const roleName = (r: { name: string; nameFr: string | null }, lng: string) => (lng === 'fr-CA' && r.nameFr ? r.nameFr : r.name);

/** Starting points: a template ticks the catalogue groups a kind of role usually needs. */
export const ROLE_TEMPLATES: Record<'worker' | 'lead' | 'supervisor' | 'manager', string[]> = {
  worker: ['everyday', 'shiftBoard'],
  lead: ['everyday', 'shiftBoard', 'lead'],
  supervisor: ['everyday', 'shiftBoard', 'safety', 'lead'],
  manager: ['everyday', 'lead', 'manager'],
};
