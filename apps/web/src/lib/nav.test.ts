import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS } from '../../../api/src/auth/permissions';
import { homePath, phoneTabs, visibleNav } from './nav';

/** Each sign-in sees only the screens its job needs (permissions come from the API's matrix). */
function menu(...roles: Array<keyof typeof ROLE_PERMISSIONS>) {
  const perms = new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r]));
  const can = (p: string) => perms.has(p as never);
  return { items: visibleNav(can).map((n) => n.href), home: homePath(can) };
}

describe('menus per role', () => {
  it('union steward: only the Union hub, which is also their home page', () => {
    expect(menu('UNION_STEWARD')).toEqual({ items: ['/union'], home: '/union' });
  });

  it('lifeguard / instructor: their own work and the pool deck tasks', () => {
    expect(menu('STAFF')).toEqual({
      items: ['/today', '/schedule', '/board', '/timeclock', '/time-off', '/availability', '/lessons', '/headcount', '/ops', '/incidents'],
      home: '/today',
    });
  });

  it('front desk: shifts, clock and the live pool board, nothing else', () => {
    expect(menu('FRONT_DESK').items).toEqual(['/today', '/schedule', '/timeclock', '/status']);
  });

  it('HR administrator: people, pay and settings, no personal shift screens or pool deck', () => {
    expect(menu('HR_ADMIN')).toEqual({
      items: ['/manage/approvals', '/manage/staff', '/manage/people', '/manage/certifications', '/manage/jobs', '/manage/payroll', '/manage/settings'],
      home: '/manage/approvals',
    });
  });

  it('general employee (water works, maintenance…): their own work, no pool screens at all', () => {
    expect(menu('EMPLOYEE')).toEqual({ items: ['/today', '/schedule', '/timeclock', '/time-off', '/availability'], home: '/today' });
  });

  it('people review is for HR and supervisors only', () => {
    expect(menu('AQUATIC_SUPERVISOR').items).toContain('/manage/people');
    for (const r of ['STAFF', 'HEAD_LIFEGUARD', 'FRONT_DESK', 'UNION_STEWARD', 'EMPLOYEE'] as const) expect(menu(r).items).not.toContain('/manage/people');
  });

  it('a steward who is also a lifeguard gets both', () => {
    expect(menu('UNION_STEWARD', 'STAFF').items).toContain('/board');
  });

  it('phones get useful tabs for every role', () => {
    const tabsFor = (role: keyof typeof ROLE_PERMISSIONS) => {
      const perms = new Set(ROLE_PERMISSIONS[role]);
      return phoneTabs(visibleNav((p) => perms.has(p as never))).tabs.map((n) => n.href);
    };
    expect(tabsFor('STAFF')).toEqual(['/today', '/schedule', '/headcount', '/board']);
    expect(tabsFor('HR_ADMIN')).toEqual(['/manage/approvals', '/manage/staff', '/manage/people', '/manage/certifications']);
    expect(tabsFor('UNION_STEWARD')).toEqual(['/union']);
  });
});
