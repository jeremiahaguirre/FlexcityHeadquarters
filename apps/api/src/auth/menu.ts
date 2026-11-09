/**
 * The app's menu, as the API knows it: each screen and the permission(s) that
 * show it (any one is enough). The web menu (apps/web/src/lib/nav.ts) must
 * match; a web test checks they stay in step.
 */
import type { Permission } from './permissions.js';

export interface MenuItem { href: string; key: string; group: 'mine' | 'deck' | 'manage' | 'union'; permissions: Permission[] }

export const MENU: MenuItem[] = [
  { href: '/today', key: 'today', group: 'mine', permissions: ['shifts.self'] },
  { href: '/schedule', key: 'schedule', group: 'mine', permissions: ['shifts.self'] },
  { href: '/board', key: 'board', group: 'mine', permissions: ['shiftboard.claim'] },
  { href: '/timeclock', key: 'timeclock', group: 'mine', permissions: ['timeclock.punch'] },
  { href: '/time-off', key: 'timeOff', group: 'mine', permissions: ['timeoff.self'] },
  { href: '/availability', key: 'availability', group: 'mine', permissions: ['availability.self'] },
  { href: '/lessons', key: 'lessons', group: 'mine', permissions: ['lessons.teach'] },
  { href: '/headcount', key: 'headcount', group: 'deck', permissions: ['ops.headcount.record'] },
  { href: '/deck', key: 'deck', group: 'deck', permissions: ['deck.rotate'] },
  { href: '/status', key: 'status', group: 'deck', permissions: ['ops.status.read'] },
  { href: '/ops', key: 'ops', group: 'deck', permissions: ['ops.chemical.record'] },
  { href: '/incidents', key: 'incidents', group: 'deck', permissions: ['incidents.create'] },
  { href: '/manage/schedule', key: 'manageSchedule', group: 'manage', permissions: ['schedule.write'] },
  { href: '/manage/approvals', key: 'approvals', group: 'manage', permissions: ['timeclock.review'] },
  { href: '/manage/staff', key: 'staff', group: 'manage', permissions: ['users.read'] },
  { href: '/manage/onboarding', key: 'onboarding', group: 'manage', permissions: ['onboarding.hr', 'onboarding.lead'] },
  { href: '/manage/people', key: 'people', group: 'manage', permissions: ['reliability.read'] },
  { href: '/manage/compliance', key: 'compliance', group: 'manage', permissions: ['compliance.report'] },
  { href: '/manage/certifications', key: 'certifications', group: 'manage', permissions: ['certs.verify'] },
  { href: '/manage/jobs', key: 'jobs', group: 'manage', permissions: ['jobs.manage'] },
  { href: '/manage/payroll', key: 'payroll', group: 'manage', permissions: ['payroll.export'] },
  { href: '/manage/settings', key: 'settings', group: 'manage', permissions: ['tenant.configure', 'ops.configure'] },
  { href: '/union', key: 'union', group: 'union', permissions: ['union.hub'] },
];
export const MENU_HREFS = new Set(MENU.map((m) => m.href));
