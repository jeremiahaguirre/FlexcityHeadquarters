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
      items: ['/today', '/schedule', '/board', '/timeclock', '/time-off', '/availability', '/lessons', '/ops', '/incidents'],
      home: '/today',
    });
  });

  it('front desk: shifts, clock and the live pool board, nothing else', () => {
    expect(menu('FRONT_DESK').items).toEqual(['/today', '/schedule', '/timeclock', '/status']);
  });

  it('HR administrator: people, pay and settings, no personal shift screens or pool deck', () => {
    expect(menu('HR_ADMIN')).toEqual({
      items: ['/manage/approvals', '/manage/staff', '/manage/certifications', '/manage/jobs', '/manage/payroll', '/manage/settings'],
      home: '/manage/approvals',
    });
  });

  it('a steward who is also a lifeguard gets both', () => {
    expect(menu('UNION_STEWARD', 'STAFF').items).toContain('/board');
  });

  it('phones get useful tabs for every role', () => {
    const tabsFor = (role: keyof typeof ROLE_PERMISSIONS) => {
      const perms = new Set(ROLE_PERMISSIONS[role]);
      return phoneTabs(visibleNav((p) => perms.has(p as never))).tabs.map((n) => n.href);
    };
    expect(tabsFor('STAFF')).toEqual(['/today', '/schedule', '/board', '/timeclock']);
    expect(tabsFor('HR_ADMIN')).toEqual(['/manage/approvals', '/manage/staff', '/manage/certifications', '/manage/jobs']);
    expect(tabsFor('UNION_STEWARD')).toEqual(['/union']);
  });
});
