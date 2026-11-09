export interface CustomRole { id: string; name: string; nameFr: string | null; description?: string | null; permissions?: string[]; members?: number }
export type RoleCatalog = Record<string, string[]>;
export interface RoleInput { name: string; nameFr: string | null; description: string | null; permissions: string[] }

export const roleName = (r: { name: string; nameFr: string | null }, lng: string) => (lng === 'fr-CA' && r.nameFr ? r.nameFr : r.name);
