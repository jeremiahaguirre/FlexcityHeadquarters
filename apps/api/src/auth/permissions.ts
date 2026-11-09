import type { AccessRole } from '@prisma/client';

/**
 * Permission matrix. Routes check permissions, never role names, so the matrix
 * can change without touching route code.
 */
export const PERMISSIONS = [
  'users.read',
  'users.write', // hire dates, pay rates, VSC, terminations
  'users.privacy', // erasure requests
  'certs.verify',
  'schedule.read',
  'schedule.write',
  'schedule.assist', // run the scheduling assistant, configure weights
  'shiftboard.claim',
  'shiftboard.post',
  'shiftboard.approve', // approve overtime / override claims
  'shiftboard.assign_emergency',
  'availability.self',
  'timeoff.self',
  'timeoff.approve',
  'timeclock.punch',
  'timeclock.review',
  'payroll.export',
  'ops.chemical.record',
  'ops.chemical.signoff',
  'ops.pool.close', // confirm / dismiss closure recommendations, reopen
  'ops.status.read', // live pool status board
  'ops.page_head_guard',
  'incidents.create',
  'incidents.read',
  'discipline.read',
  'discipline.write',
  'audit.read',
  'reliability.read',
  'union.hub', // only meaningful through the Union Hub service
  'seniority.read',
  'tenant.configure',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const STAFF_BASE: Permission[] = [
  'schedule.read',
  'shiftboard.claim',
  'shiftboard.post',
  'availability.self',
  'timeoff.self',
  'timeclock.punch',
  'ops.chemical.record',
  'incidents.create',
];

export const ROLE_PERMISSIONS: Record<AccessRole, Permission[]> = {
  HR_ADMIN: [
    'users.read',
    'users.write',
    'users.privacy',
    'certs.verify',
    'schedule.read',
    'timeclock.review',
    'payroll.export',
    'incidents.read',
    'discipline.read',
    'discipline.write',
    'audit.read',
    'reliability.read',
    'seniority.read',
    'tenant.configure',
    'ops.status.read',
  ],
  AQUATIC_SUPERVISOR: [
    ...STAFF_BASE,
    'users.read',
    'certs.verify',
    'schedule.write',
    'schedule.assist',
    'shiftboard.approve',
    'shiftboard.assign_emergency',
    'timeoff.approve',
    'timeclock.review',
    'payroll.export',
    'ops.chemical.signoff',
    'ops.pool.close',
    'ops.status.read',
    'incidents.read',
    'discipline.read',
    'discipline.write',
    'reliability.read',
    'seniority.read',
  ],
  HEAD_LIFEGUARD: [
    ...STAFF_BASE,
    'schedule.write',
    'shiftboard.assign_emergency',
    'ops.chemical.signoff',
    'ops.pool.close',
    'ops.status.read',
  ],
  STAFF: STAFF_BASE,
  FRONT_DESK: ['schedule.read', 'ops.status.read', 'ops.page_head_guard', 'timeclock.punch'],
  UNION_STEWARD: ['union.hub', 'seniority.read', 'schedule.read'],
};

export function permissionsFor(roles: readonly AccessRole[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r]) out.add(p);
  return out;
}
