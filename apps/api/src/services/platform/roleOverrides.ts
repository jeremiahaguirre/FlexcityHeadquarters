/**
 * Per-city customization of each access level, set from the Dev console:
 * permissions added or removed, and menu items hidden. Applied on every
 * request (requireAuth), so a switch changes what the API allows, not just
 * what the menu shows.
 */
import type { AccessRole } from '../../generated/prisma/client.js';
import { MENU, MENU_HREFS } from '../../auth/menu.js';
import { PERMISSIONS, type Permission, ROLE_PERMISSIONS } from '../../auth/permissions.js';

export interface RoleOverride { grant: Permission[]; revoke: Permission[]; hideMenu: string[] }
export type RoleOverrides = Partial<Record<AccessRole, RoleOverride>>;

const ROLES = Object.keys(ROLE_PERMISSIONS) as AccessRole[];
const KNOWN = new Set<string>(PERMISSIONS);

/** Stored JSON → clean overrides (unknown roles, permissions and menu items dropped). */
export function parseOverrides(stored: unknown): RoleOverrides {
  const s = stored && typeof stored === 'object' ? (stored as Record<string, Partial<Record<keyof RoleOverride, unknown>>>) : {};
  const out: RoleOverrides = {};
  for (const r of ROLES) {
    const o = s[r];
    if (!o) continue;
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    out[r] = {
      grant: list(o.grant).filter((p) => KNOWN.has(p)) as Permission[],
      revoke: list(o.revoke).filter((p) => KNOWN.has(p)) as Permission[],
      hideMenu: list(o.hideMenu).filter((h) => MENU_HREFS.has(h)),
    };
  }
  return out;
}

/** One role's permissions after its overrides. */
export function rolePermissions(role: AccessRole, overrides: RoleOverrides): Set<Permission> {
  const o = overrides[role];
  const out = new Set<Permission>(ROLE_PERMISSIONS[role]);
  for (const p of o?.grant ?? []) out.add(p);
  for (const p of o?.revoke ?? []) out.delete(p);
  return out;
}

/** A person's permissions: the union over their roles, each after its own overrides. */
export function permissionsWithOverrides(roles: readonly AccessRole[], overrides: RoleOverrides): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) for (const p of rolePermissions(r, overrides)) out.add(p);
  return out;
}

/** Menu items hidden for this person: hidden for every one of their roles. */
export function hiddenMenuFor(roles: readonly AccessRole[], overrides: RoleOverrides): string[] {
  if (!roles.length) return [];
  return MENU.map((m) => m.href).filter((h) => roles.every((r) => overrides[r]?.hideMenu.includes(h)));
}

const blank = (): RoleOverride => ({ grant: [], revoke: [], hideMenu: [] });

/** Turn one permission on or off for a role, relative to its defaults. */
export function setPermission(overrides: RoleOverrides, role: AccessRole, permission: Permission, on: boolean): RoleOverrides {
  const o = { ...blank(), ...overrides[role] };
  const isDefault = ROLE_PERMISSIONS[role].includes(permission);
  o.grant = o.grant.filter((p) => p !== permission);
  o.revoke = o.revoke.filter((p) => p !== permission);
  if (on && !isDefault) o.grant.push(permission);
  if (!on && isDefault) o.revoke.push(permission);
  return { ...overrides, [role]: o };
}

/**
 * Show or hide a menu item for a role. Hiding also removes the permissions
 * only that screen uses (so the API refuses it too); showing gives back
 * access to the screen's first permission if the role has none of them.
 */
export function setMenu(overrides: RoleOverrides, role: AccessRole, href: string, shown: boolean): RoleOverrides {
  const item = MENU.find((m) => m.href === href);
  if (!item) return overrides;
  let next: RoleOverrides = { ...overrides, [role]: { ...blank(), ...overrides[role] } };
  const o = next[role]!;
  o.hideMenu = o.hideMenu.filter((h) => h !== href);
  if (shown) {
    const have = rolePermissions(role, next);
    if (!item.permissions.some((p) => have.has(p))) next = setPermission(next, role, item.permissions[0]!, true);
    return next;
  }
  o.hideMenu.push(href);
  const have = rolePermissions(role, next);
  const stillNeeded = new Set(
    MENU.filter((m) => m.href !== href && !o.hideMenu.includes(m.href) && m.permissions.some((p) => have.has(p))).flatMap((m) => m.permissions),
  );
  for (const p of item.permissions) if (have.has(p) && !stillNeeded.has(p)) next = setPermission(next, role, p, false);
  return next;
}
