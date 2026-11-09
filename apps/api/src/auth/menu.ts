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
  { href: '/alone', key: 'loneWork', group: 'mine', permissions: ['lonework.self'] },
  { href: '/patrol', key: 'patrol', group: 'mine', permissions: ['winter.patrol'] },
  { href: '/headcount', key: 'headcount', group: 'deck', permissions: ['ops.headcount.record'] },
  { href: '/deck', key: 'deck', group: 'deck', permissions: ['deck.rotate'] },
  { href: '/status', key: 'status', group: 'deck', permissions: ['ops.status.read'] },
  { href: '/ops', key: 'ops', group: 'deck', permissions: ['ops.chemical.record'] },
  { href: '/incidents', key: 'incidents', group: 'deck', permissions: ['incidents.create'] },
  { href: '/members', key: 'members', group: 'deck', permissions: ['members.manage'] },
  { href: '/manage/programs', key: 'programs', group: 'manage', permissions: ['lessons.plan'] },
  { href: '/manage/schedule', key: 'manageSchedule', group: 'manage', permissions: ['schedule.write'] },
  { href: '/manage/forecast', key: 'forecast', group: 'manage', permissions: ['schedule.write'] },
  { href: '/manage/approvals', key: 'approvals', group: 'manage', permissions: ['timeclock.review'] },
  { href: '/manage/staff', key: 'staff', group: 'manage', permissions: ['users.read'] },
  { href: '/manage/overtime', key: 'overtime', group: 'manage', permissions: ['overtime.manage'] },
  { href: '/manage/onboarding', key: 'onboarding', group: 'manage', permissions: ['onboarding.hr', 'onboarding.lead'] },
  { href: '/manage/care', key: 'care', group: 'manage', permissions: ['care.manage'] },
  { href: '/manage/lone-work', key: 'loneWorkMonitor', group: 'manage', permissions: ['lonework.monitor'] },
  { href: '/manage/call-outs', key: 'callOuts', group: 'manage', permissions: ['winter.callout'] },
  { href: '/manage/winter', key: 'winter', group: 'manage', permissions: ['winter.manage', 'winter.records'] },
  { href: '/manage/people', key: 'people', group: 'manage', permissions: ['reliability.read'] },
  { href: '/manage/compliance', key: 'compliance', group: 'manage', permissions: ['compliance.report'] },
  { href: '/manage/benchmarks', key: 'benchmarks', group: 'manage', permissions: ['tenant.configure', 'reliability.read'] },
  { href: '/manage/certifications', key: 'certifications', group: 'manage', permissions: ['certs.verify'] },
  { href: '/manage/jobs', key: 'jobs', group: 'manage', permissions: ['jobs.manage'] },
  { href: '/manage/payroll', key: 'payroll', group: 'manage', permissions: ['payroll.export'] },
  { href: '/manage/fees', key: 'fees', group: 'manage', permissions: ['fees.manage'] },
  { href: '/manage/roles', key: 'roles', group: 'manage', permissions: ['roles.manage'] },
  { href: '/manage/billing', key: 'billing', group: 'manage', permissions: ['billing.manage'] },
  { href: '/manage/settings', key: 'settings', group: 'manage', permissions: ['tenant.configure', 'ops.configure'] },
  { href: '/union', key: 'union', group: 'union', permissions: ['union.hub'] },
];
export const MENU_HREFS = new Set(MENU.map((m) => m.href));
