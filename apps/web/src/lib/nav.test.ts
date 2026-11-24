import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../../../api/src/auth/permissions';
import { FEATURES } from '../../../api/src/services/platform/features';
import { MENU } from '../../../api/src/auth/menu';
import { NAV, homePath, phoneTabs, visibleNav } from './nav';

/** Each sign-in sees only the screens its job needs (permissions come from the API's matrix). */
function menu(...roles: Array<keyof typeof ROLE_PERMISSIONS>) {
  const perms = new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r]));
  const can = (p: string) => perms.has(p as never);
  return { items: visibleNav(can).map((n) => n.href), home: homePath(can) };
}

describe('menus per role', () => {
  it('union steward: the Union hub, which is also their home page, and the overtime order (read only)', () => {
    expect(menu('UNION_STEWARD')).toEqual({ items: ['/manage/overtime', '/union', '/union/bids'], home: '/union' });
  });

  it('lifeguard / instructor: their own work and the pool deck tasks', () => {
    expect(menu('STAFF')).toEqual({
      items: ['/today', '/schedule', '/board', '/timeclock', '/time-off', '/availability', '/preferences', '/bids', '/lessons', '/alone', '/pay', '/expenses', '/logbook', '/messages', '/headcount', '/ops', '/incidents', '/surveys'],
      home: '/today',
    });
  });

  it('front desk: shifts, clock, their pay and the live pool board, nothing else', () => {
    expect(menu('FRONT_DESK').items).toEqual(['/today', '/schedule', '/timeclock', '/pay', '/logbook', '/messages', '/status', '/members', '/manage/bookings', '/surveys']);
  });

  it('HR administrator: people, pay and settings, no personal shift screens or pool deck', () => {
    expect(menu('HR_ADMIN')).toEqual({
      items: ['/pay', '/messages', '/manage/hr', '/manage/approvals', '/manage/staff', '/manage/overtime', '/manage/onboarding', '/manage/training', '/manage/injuries', '/manage/care', '/manage/lone-work', '/manage/call-outs', '/manage/winter', '/manage/bids', '/manage/on-call', '/manage/work-rules', '/manage/people', '/manage/org-chart', '/manage/compliance', '/manage/fleet', '/manage/coverage', '/manage/benchmarks', '/manage/certifications', '/manage/jobs', '/manage/payroll', '/manage/expenses', '/manage/benefits', '/manage/accounting', '/manage/fees', '/manage/bookings', '/manage/reports', '/manage/announcements', '/manage/messages', '/manage/surveys', '/manage/roles', '/manage/billing', '/manage/settings', '/surveys'],
      home: '/manage/hr',
    });
  });

  it('general employee (water works, maintenance…): their own work, no pool screens at all', () => {
    expect(menu('EMPLOYEE')).toEqual({ items: ['/today', '/schedule', '/timeclock', '/time-off', '/availability', '/preferences', '/bids', '/alone', '/patrol', '/pretrip', '/pay', '/expenses', '/logbook', '/messages', '/surveys'], home: '/today' });
  });

  it('people review is for HR and supervisors only', () => {
    expect(menu('AQUATIC_SUPERVISOR').items).toContain('/manage/people');
    for (const r of ['STAFF', 'HEAD_LIFEGUARD', 'FRONT_DESK', 'UNION_STEWARD', 'EMPLOYEE'] as const) expect(menu(r).items).not.toContain('/manage/people');
  });

  it('a custom role that keeps positions and certificates (positions.manage alone) reaches Settings', () => {
    const can = (p: string) => p === 'positions.manage';
    expect(visibleNav(can).map((n) => n.href)).toContain('/manage/settings');
    expect(MENU.find((m) => m.href === '/manage/settings')?.permissions).toContain('positions.manage');
  });

  it('a steward who is also a lifeguard gets both', () => {
    expect(menu('UNION_STEWARD', 'STAFF').items).toContain('/board');
  });

  it('two or more roles: every screen of each, once, in the usual order, starting at their own work', () => {
    const both = menu('STAFF', 'FRONT_DESK');
    for (const h of [...menu('STAFF').items, ...menu('FRONT_DESK').items]) expect(both.items).toContain(h);
    expect(new Set(both.items).size).toBe(both.items.length);
    expect(both.home).toBe('/today');
    // HR who also works shifts: personal screens come back, and their day starts on Today.
    const hrGuard = menu('HR_ADMIN', 'STAFF');
    expect(hrGuard.items).toEqual(expect.arrayContaining(['/today', '/board', '/manage/payroll', '/manage/settings']));
    expect(hrGuard.home).toBe('/today');
    // A supervisor who is a steward keeps the deck and gains the union hub.
    expect(menu('AQUATIC_SUPERVISOR', 'UNION_STEWARD').items).toEqual(expect.arrayContaining(['/deck', '/manage/schedule', '/union']));
  });

  it('on phones, several roles still get four tabs and everything else under More, nothing lost', () => {
    const perms = new Set([...ROLE_PERMISSIONS.STAFF, ...ROLE_PERMISSIONS.FRONT_DESK, ...ROLE_PERMISSIONS.AQUATIC_SUPERVISOR]);
    const items = visibleNav((p) => perms.has(p as never));
    const { tabs, more } = phoneTabs(items);
    expect(tabs).toHaveLength(4);
    expect([...tabs, ...more].map((n) => n.href).sort()).toEqual(items.map((n) => n.href).sort());
  });

  it('phones get useful tabs for every role', () => {
    const tabsFor = (role: keyof typeof ROLE_PERMISSIONS) => {
      const perms = new Set(ROLE_PERMISSIONS[role]);
      return phoneTabs(visibleNav((p) => perms.has(p as never))).tabs.map((n) => n.href);
    };
    expect(tabsFor('STAFF')).toEqual(['/today', '/schedule', '/headcount', '/board']);
    expect(tabsFor('HR_ADMIN')).toEqual(['/messages', '/manage/hr', '/manage/approvals', '/manage/staff']);
    expect(tabsFor('UNION_STEWARD')).toEqual(['/union', '/union/bids']);
  });

  it('matches the API menu, so the Dev console can switch every item', () => {
    const web = NAV.filter((n) => n.ready).map((n) => ({ href: n.href, key: n.key, group: n.group, permissions: [n.permission].flat(), ...(n.feature ? { feature: n.feature } : {}) }));
    expect(web).toEqual(MENU);
  });

  it('every menu permission and feature exists, so a typo can’t hide a screen from everyone', () => {
    for (const n of NAV) {
      for (const p of [n.permission ?? []].flat()) expect(PERMISSIONS, n.href).toContain(p);
      if (n.feature) expect(Object.keys(FEATURES), n.href).toContain(n.feature);
    }
  });

  it('a screen whose API follows a feature switch leaves the menu with it, whatever the permissions', () => {
    const perms = new Set([...ROLE_PERMISSIONS.HR_ADMIN, ...ROLE_PERMISSIONS.AQUATIC_SUPERVISOR]);
    const can = (p: string) => perms.has(p as never);
    expect(visibleNav(can).map((n) => n.href)).toEqual(expect.arrayContaining(['/manage/coverage', '/manage/benchmarks']));
    const off = visibleNav(can, [], { coverage: false, benchmarks: false }).map((n) => n.href);
    expect(off).not.toContain('/manage/coverage');
    expect(off).not.toContain('/manage/benchmarks');
  });

  it('Approvals opens for whoever decides any of its requests, not only timesheet reviewers', () => {
    for (const p of ['timeclock.review', 'timeoff.approve', 'shiftboard.approve']) expect(visibleNav((x) => x === p).map((n) => n.href), p).toContain('/manage/approvals');
  });

  it('My pay is for everyone who is paid, timeclock or not, and is never their landing page', () => {
    for (const r of ['STAFF', 'FRONT_DESK', 'EMPLOYEE', 'HR_ADMIN', 'AQUATIC_SUPERVISOR', 'HEAD_LIFEGUARD'] as const) expect(menu(r).items, r).toContain('/pay');
    expect(menu('HR_ADMIN').home).toBe('/manage/hr');
  });

  it('whoever reviews punches reaches Settings for the kiosks they set up', () => {
    expect(visibleNav((p) => p === 'timeclock.review').map((n) => n.href)).toContain('/manage/settings');
  });

  it('a menu item the city hid is gone even with the permission', () => {
    const perms = new Set(ROLE_PERMISSIONS.STAFF);
    expect(visibleNav((p) => perms.has(p as never), ['/board']).map((n) => n.href)).not.toContain('/board');
  });
});
