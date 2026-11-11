/**
 * Who may message whom, and when a conversation is read-only. Pure rules here; loading people is
 * at the bottom.
 *
 * Reach follows the organization's structure, never across organizations (row-level security):
 *  - HR reaches anyone, and anyone can reach HR.
 *  - A lead reaches the people they lead and those people reach them: someone who reports to them,
 *    someone in a department they manage, or (supervisor and head-guard roles) someone in their department.
 *  - Staff reach colleagues in their own department(s) while the organization allows staff-to-staff
 *    direct messages (on by default). With no departments set up, the organization is one department.
 *
 * Safeguarding, the "rule of two" (checked when a conversation is made and on every message sent,
 * because birth dates change and people have birthdays):
 *  - A minor never has a one-to-one conversation with an adult, whatever the adult's role.
 *    Minor-to-minor one-to-one is allowed unless the organization turns it off.
 *  - Minor = younger than the age of majority (services/legal/ages.ts: 19 in BC, NB, NL, NS, NT,
 *    NU and YT, 18 elsewhere). An organization with facilities in several provinces uses the
 *    highest of them, so nobody is treated as an adult too early. No birth date on file = treated
 *    as possibly a minor: the app has no other proof of age to rely on.
 *  - A group that includes a minor (or someone whose age isn't known) needs at least two adults in
 *    it, or it is read-only until it has them again.
 * The reason given to other people is only "safeguarding": never an age or a birth date.
 */
import type { Tx } from '../../lib/db.js';
import { ageOfMajority, yearsOld } from '../legal/ages.js';

export interface MessagingSettings {
  /** Staff may start one-to-one conversations with colleagues in their department. */
  staffDirect: boolean;
  /** Two minors may message each other one to one. */
  minorDirect: boolean;
  /** Push notifications carry the first words of the message (off: "New message from X" only). */
  pushPreview: boolean;
  /** A shift's conversation turns read-only this many hours after the shift ends. */
  shiftArchiveHours: number;
}
export const MESSAGING_DEFAULTS: MessagingSettings = { staffDirect: true, minorDirect: true, pushPreview: false, shiftArchiveHours: 12 };
export const SHIFT_ARCHIVE_LIMITS = [1, 168] as const;
/** Longest message, in characters. */
export const MAX_TEXT = 2000;
/** The author may change a message for this long after sending it. */
export const EDIT_WINDOW_MS = 15 * 60_000;
/** Characters of a message a push may show, when the organization allows previews. */
export const PREVIEW_CHARS = 60;
/** How long an investigation opening lasts. */
export const INVESTIGATION_DAYS = 14;

export function readMessagingSettings(raw: unknown): MessagingSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const bool = (k: keyof MessagingSettings) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : (MESSAGING_DEFAULTS[k] as boolean));
  const h = Number(r.shiftArchiveHours);
  return {
    staffDirect: bool('staffDirect'),
    minorDirect: bool('minorDirect'),
    pushPreview: bool('pushPreview'),
    shiftArchiveHours: Number.isInteger(h) && h >= SHIFT_ARCHIVE_LIMITS[0] && h <= SHIFT_ARCHIVE_LIMITS[1] ? h : MESSAGING_DEFAULTS.shiftArchiveHours,
  };
}

export type AgeClass = 'adult' | 'minor' | 'unknown';

/** Adult, minor or unknown on a day (YYYY-MM-DD), from a birth date. */
export function ageClass(dateOfBirth: Date | null | undefined, majority: number, today: string): AgeClass {
  if (!dateOfBirth) return 'unknown';
  return yearsOld(dateOfBirth.toISOString().slice(0, 10), today) >= majority ? 'adult' : 'minor';
}

/** The age of majority the organization goes by: the highest of its facilities' provinces (19 when it has none). */
export function majorityFor(provinces: Array<string | null>): number {
  return provinces.length ? Math.max(...provinces.map((p) => ageOfMajority(p))) : 19;
}

/** One to one between two people of these ages: allowed by the rule of two? */
export function directSafe(a: AgeClass, b: AgeClass, s: Pick<MessagingSettings, 'minorDirect'>): boolean {
  if (a === 'adult' && b === 'adult') return true;
  if (a === 'minor' && b === 'minor') return s.minorDirect;
  return false; // adult and minor, or anyone whose age isn't known
}

/** A group with these members: fine, or (with a minor or an unknown age in it) at least two adults. */
export function groupSafe(ages: AgeClass[]): boolean {
  if (ages.every((x) => x === 'adult')) return true;
  return ages.filter((x) => x === 'adult').length >= 2;
}

export interface Person {
  id: string;
  name: string;
  roles: string[];
  /** Departments of the positions they hold. */
  departmentIds: string[];
  /** Departments they were chosen to manage. */
  managesDepartmentIds: string[];
  reportsToId: string | null;
  age: AgeClass;
  active: boolean;
}

const SUPERVISOR_ROLES = new Set(['AQUATIC_SUPERVISOR', 'HEAD_LIFEGUARD']);
export const isHr = (p: Pick<Person, 'roles'>) => p.roles.includes('HR_ADMIN');
const meets = (a: string[], b: string[]) => a.some((x) => b.includes(x));

/** Does the organization's structure let `me` and `other` talk? (Safeguarding is separate.) */
export function canReach(me: Person, other: Person, ctx: { hasDepartments: boolean }, s: Pick<MessagingSettings, 'staffDirect'>): boolean {
  if (me.id === other.id || !other.active || !me.active) return false;
  if (isHr(me) || isHr(other)) return true;
  const sameDept = !ctx.hasDepartments || meets(me.departmentIds, other.departmentIds);
  const leads = (x: Person, y: Person) => y.reportsToId === x.id || meets(x.managesDepartmentIds, y.departmentIds) || (x.roles.some((r) => SUPERVISOR_ROLES.has(r)) && sameDept);
  if (leads(me, other) || leads(other, me)) return true;
  return sameDept && s.staffDirect;
}

/** May `me` put `other` in a group or a shift/department conversation they create? Leads and HR only, within reach. */
export function canAddToGroup(me: Person, other: Person, ctx: { hasDepartments: boolean }): boolean {
  return canReach(me, other, ctx, { staffDirect: true });
}

// ------------------------------------------------------------------ Loading

export interface Context {
  settings: MessagingSettings;
  hasDepartments: boolean;
  majority: number;
  today: string;
}

export async function loadContext(tx: Tx, now = new Date()): Promise<Context> {
  const [t, depts, facilities] = await Promise.all([
    tx.tenant.findFirst({ select: { messagingSettings: true } }),
    tx.department.count(),
    tx.facility.findMany({ select: { province: true }, distinct: ['province'] }),
  ]);
  return { settings: readMessagingSettings(t?.messagingSettings), hasDepartments: depts > 0, majority: majorityFor(facilities.map((f) => f.province)), today: now.toISOString().slice(0, 10) };
}

/** People with what the rules need. `ids` limits it; without, everyone active. */
export async function loadPeople(tx: Tx, ctx: Context, ids?: string[]): Promise<Map<string, Person>> {
  const users = await tx.user.findMany({
    where: ids ? { id: { in: ids } } : { status: 'ACTIVE', anonymizedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      roles: true,
      status: true,
      anonymizedAt: true,
      processingRestrictedAt: true,
      dateOfBirth: true,
      reportsToId: true,
      positions: { select: { position: { select: { departmentId: true } } } },
      managesDepartments: { select: { departmentId: true } },
    },
  });
  return new Map(
    users.map((u) => [
      u.id,
      {
        id: u.id,
        name: `${u.preferredName || u.firstName} ${u.lastName}`,
        roles: u.roles,
        departmentIds: [...new Set(u.positions.map((p) => p.position.departmentId).filter((d): d is string => !!d))],
        managesDepartmentIds: u.managesDepartments.map((m) => m.departmentId),
        reportsToId: u.reportsToId,
        age: ageClass(u.dateOfBirth, ctx.majority, ctx.today),
        active: u.status === 'ACTIVE' && !u.anonymizedAt && !u.processingRestrictedAt,
      },
    ]),
  );
}
