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
  'reliability.write', // record missed shifts / in-service, excuse events, write conduct notes
  'union.hub', // only meaningful through the Union Hub service
  'seniority.read',
  'tenant.configure',
  'positions.manage', // define positions and their required certifications
  'users.scheduling', // shadow tier, weekly hour targets/caps, position approvals
  'ops.configure', // pools and their permit thresholds
  'jobs.manage', // public job postings
  'shifts.self', // works shifts: Today and My schedule
  'lessons.teach', // teaches swim lessons: class lists and attendance
  'ops.headcount.record', // bather counts on deck (the clicker)
  'deck.rotate', // run the lifeguard rotation (chair plan)
  'compliance.report', // rebuild who/what/where at any past minute
  'onboarding.hr', // HR onboarding items: checks, forms, training; waive items
  'onboarding.lead', // supervisor onboarding items: orientation, equipment, shadow shifts
  'onboarding.configure', // the catalogue and which positions need which items
  'overtime.manage', // overtime equalization: standings, call-outs, policy
  'care.manage', // follow up after critical incidents
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const STAFF_BASE: Permission[] = [
  'schedule.read',
  'shifts.self',
  'lessons.teach',
  'shiftboard.claim',
  'shiftboard.post',
  'availability.self',
  'timeoff.self',
  'timeclock.punch',
  'ops.chemical.record',
  'ops.headcount.record',
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
    'reliability.write',
    'compliance.report',
    'onboarding.hr',
    'onboarding.configure',
    'overtime.manage',
    'care.manage',
    'seniority.read',
    'tenant.configure',
    'positions.manage',
    'jobs.manage',
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
    'reliability.write',
    'seniority.read',
    'positions.manage',
    'users.scheduling',
    'ops.configure',
    'jobs.manage',
    'deck.rotate',
    'compliance.report',
    'onboarding.lead',
    'onboarding.configure',
    'overtime.manage',
    'care.manage',
  ],
  HEAD_LIFEGUARD: [
    ...STAFF_BASE,
    'deck.rotate',
    'schedule.write',
    'shiftboard.assign_emergency',
    'ops.chemical.signoff',
    'ops.pool.close',
    'ops.status.read',
  ],
  STAFF: STAFF_BASE,
  FRONT_DESK: ['schedule.read', 'shifts.self', 'ops.status.read', 'ops.page_head_guard', 'timeclock.punch'],
  UNION_STEWARD: ['union.hub', 'seniority.read', 'schedule.read'],
  // Water works, maintenance, parks…: their own shifts and time, nothing aquatic.
  EMPLOYEE: ['schedule.read', 'shifts.self', 'timeclock.punch', 'timeoff.self', 'availability.self'],
};

export function permissionsFor(roles: readonly AccessRole[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r]) out.add(p);
  return out;
}
