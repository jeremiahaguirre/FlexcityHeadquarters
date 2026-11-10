import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS } from '../../../api/src/auth/permissions';
import { MENU } from '../../../api/src/auth/menu';
import { NAV, homePath, phoneTabs, visibleNav } from './nav';

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
      items: ['/today', '/schedule', '/board', '/timeclock', '/time-off', '/availability', '/lessons', '/alone', '/headcount', '/ops', '/incidents'],
      home: '/today',
    });
  });

  it('front desk: shifts, clock and the live pool board, nothing else', () => {
    expect(menu('FRONT_DESK').items).toEqual(['/today', '/schedule', '/timeclock', '/status', '/members', '/manage/bookings']);
  });

  it('HR administrator: people, pay and settings, no personal shift screens or pool deck', () => {
    expect(menu('HR_ADMIN')).toEqual({
      items: ['/manage/approvals', '/manage/staff', '/manage/overtime', '/manage/onboarding', '/manage/care', '/manage/lone-work', '/manage/call-outs', '/manage/winter', '/manage/people', '/manage/compliance', '/manage/fleet', '/manage/coverage', '/manage/benchmarks', '/manage/certifications', '/manage/jobs', '/manage/payroll', '/manage/fees', '/manage/bookings', '/manage/roles', '/manage/billing', '/manage/settings'],
      home: '/manage/approvals',
    });
  });

  it('general employee (water works, maintenance…): their own work, no pool screens at all', () => {
    expect(menu('EMPLOYEE')).toEqual({ items: ['/today', '/schedule', '/timeclock', '/time-off', '/availability', '/alone', '/patrol', '/pretrip'], home: '/today' });
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
    expect(tabsFor('HR_ADMIN')).toEqual(['/manage/approvals', '/manage/staff', '/manage/overtime', '/manage/onboarding']);
    expect(tabsFor('UNION_STEWARD')).toEqual(['/union']);
  });

  it('matches the API menu, so the Dev console can switch every item', () => {
    const web = NAV.filter((n) => n.ready).map((n) => ({ href: n.href, key: n.key, group: n.group, permissions: [n.permission].flat() }));
    expect(web).toEqual(MENU);
  });

  it('a menu item the city hid is gone even with the permission', () => {
    const perms = new Set(ROLE_PERMISSIONS.STAFF);
    expect(visibleNav((p) => perms.has(p as never), ['/board']).map((n) => n.href)).not.toContain('/board');
  });
});
