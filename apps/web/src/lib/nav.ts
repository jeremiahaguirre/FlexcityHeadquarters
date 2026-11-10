import { Activity, Armchair, BadgeCheck, Banknote, BarChart3, Receipt, UserCog, Snowflake, Siren, IdCard, Layers, Tags, Globe, Truck, Bandage, Briefcase, Calculator, CalendarClock, CalendarDays, CalendarRange, ClipboardCheck, ClipboardList, Clock, Droplets, FileSearch, GraduationCap, HeartHandshake, Home, Megaphone, Repeat, Scale, Settings, ShieldAlert, ShieldCheck, TrendingUp, Radio, UserCheck, Users, Waves, type LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  /** i18n key under "nav." */
  key: string;
  icon: LucideIcon;
  group: 'mine' | 'deck' | 'manage' | 'union';
  /** Shown only when the person has this permission (or any of these). */
  permission?: string | string[];
  /** Order in the phone tab bar (lower first); omitted = only under "More". */
  tab?: number;
  /** Set once the screen exists, so navigation never leads to a missing page. */
  ready: boolean;
}

export const NAV: NavItem[] = [
  { href: '/today', key: 'today', icon: Home, group: 'mine', permission: 'shifts.self', tab: 1, ready: true },
  { href: '/schedule', key: 'schedule', icon: CalendarDays, group: 'mine', permission: 'shifts.self', tab: 2, ready: true },
  { href: '/board', key: 'board', icon: Repeat, group: 'mine', permission: 'shiftboard.claim', tab: 4, ready: true },
  { href: '/timeclock', key: 'timeclock', icon: Clock, group: 'mine', permission: 'timeclock.punch', tab: 5, ready: true },
  { href: '/time-off', key: 'timeOff', icon: CalendarClock, group: 'mine', permission: 'timeoff.self', ready: true },
  { href: '/availability', key: 'availability', icon: CalendarRange, group: 'mine', permission: 'availability.self', ready: true },
  { href: '/lessons', key: 'lessons', icon: GraduationCap, group: 'mine', permission: 'lessons.teach', ready: true },
  { href: '/alone', key: 'loneWork', icon: ShieldCheck, group: 'mine', permission: 'lonework.self', ready: true },
  { href: '/patrol', key: 'patrol', icon: Snowflake, group: 'mine', permission: 'winter.patrol', ready: true },
  { href: '/pretrip', key: 'pretrip', icon: Truck, group: 'mine', permission: 'fleet.inspect', ready: true },
  { href: '/headcount', key: 'headcount', icon: Calculator, group: 'deck', permission: 'ops.headcount.record', tab: 3, ready: true },
  { href: '/deck', key: 'deck', icon: Armchair, group: 'deck', permission: 'deck.rotate', ready: true },
  { href: '/status', key: 'status', icon: Waves, group: 'deck', permission: 'ops.status.read', tab: 6, ready: true },
  { href: '/ops', key: 'ops', icon: Droplets, group: 'deck', permission: 'ops.chemical.record', ready: true },
  { href: '/incidents', key: 'incidents', icon: ShieldAlert, group: 'deck', permission: 'incidents.create', ready: true },
  { href: '/members', key: 'members', icon: IdCard, group: 'manage', permission: 'members.manage', tab: 7, ready: true },
  { href: '/manage/programs', key: 'programs', icon: Layers, group: 'manage', permission: 'lessons.plan', ready: true },
  { href: '/manage/schedule', key: 'manageSchedule', icon: Activity, group: 'manage', permission: 'schedule.write', ready: true },
  { href: '/manage/forecast', key: 'forecast', icon: TrendingUp, group: 'manage', permission: 'schedule.write', ready: true },
  { href: '/manage/approvals', key: 'approvals', icon: ClipboardCheck, group: 'manage', permission: 'timeclock.review', ready: true },
  { href: '/manage/staff', key: 'staff', icon: Users, group: 'manage', permission: 'users.read', ready: true },
  { href: '/manage/overtime', key: 'overtime', icon: Scale, group: 'manage', permission: 'overtime.manage', ready: true },
  { href: '/manage/onboarding', key: 'onboarding', icon: ClipboardList, group: 'manage', permission: ['onboarding.hr', 'onboarding.lead'], ready: true },
  { href: '/manage/injuries', key: 'injuries', icon: Bandage, group: 'manage', permission: 'injury.manage', ready: true },
  { href: '/manage/care', key: 'care', icon: HeartHandshake, group: 'manage', permission: 'care.manage', ready: true },
  { href: '/manage/lone-work', key: 'loneWorkMonitor', icon: Radio, group: 'manage', permission: 'lonework.monitor', ready: true },
  { href: '/manage/call-outs', key: 'callOuts', icon: Siren, group: 'manage', permission: 'winter.callout', ready: true },
  { href: '/manage/winter', key: 'winter', icon: Snowflake, group: 'manage', permission: ['winter.manage', 'winter.records'], ready: true },
  { href: '/manage/people', key: 'people', icon: UserCheck, group: 'manage', permission: 'reliability.read', ready: true },
  { href: '/manage/compliance', key: 'compliance', icon: FileSearch, group: 'manage', permission: 'compliance.report', ready: true },
  { href: '/manage/fleet', key: 'fleet', icon: Truck, group: 'manage', permission: 'fleet.manage', ready: true },
  { href: '/manage/coverage', key: 'coverage', icon: BadgeCheck, group: 'manage', permission: ['coverage.manage', 'schedule.write'], ready: true },
  { href: '/manage/benchmarks', key: 'benchmarks', icon: BarChart3, group: 'manage', permission: ['tenant.configure', 'reliability.read'], ready: true },
  { href: '/manage/certifications', key: 'certifications', icon: BadgeCheck, group: 'manage', permission: 'certs.verify', ready: true },
  { href: '/manage/jobs', key: 'jobs', icon: Briefcase, group: 'manage', permission: 'jobs.manage', ready: true },
  { href: '/manage/payroll', key: 'payroll', icon: Banknote, group: 'manage', permission: 'payroll.export', ready: true },
  { href: '/manage/fees', key: 'fees', icon: Tags, group: 'manage', permission: 'fees.manage', ready: true },
  { href: '/manage/bookings', key: 'bookings', icon: Globe, group: 'manage', permission: 'bookings.manage', ready: true },
  { href: '/manage/roles', key: 'roles', icon: UserCog, group: 'manage', permission: 'roles.manage', ready: true },
  { href: '/manage/billing', key: 'billing', icon: Receipt, group: 'manage', permission: 'billing.manage', ready: true },
  { href: '/manage/settings', key: 'settings', icon: Settings, group: 'manage', permission: ['tenant.configure', 'ops.configure'], ready: true },
  { href: '/union', key: 'union', icon: Megaphone, group: 'union', permission: 'union.hub', ready: true },
];

/** Menu items a person may open, minus any the city's Dev console hid for their roles. */
export function visibleNav(can: (p: string) => boolean, hidden: readonly string[] = []): NavItem[] {
  return NAV.filter((n) => n.ready && !hidden.includes(n.href) && (!n.permission || [n.permission].flat().some(can)));
}

/**
 * Up to four tabs on phones; everything else lives under "More". Roles without
 * shift screens (HR, union stewards) get their own first screens as tabs.
 */
export function phoneTabs(items: NavItem[]): { tabs: NavItem[]; more: NavItem[] } {
  const tabbable = items.filter((n) => n.tab !== undefined).sort((a, b) => a.tab! - b.tab!);
  const fill = items.filter((n) => n.tab === undefined);
  const tabs = [...tabbable, ...fill].slice(0, 4);
  return { tabs, more: items.filter((n) => !tabs.includes(n)) };
}

export function homePath(can: (p: string) => boolean, hidden: readonly string[] = []): string {
  return visibleNav(can, hidden)[0]?.href ?? '/profile';
}
