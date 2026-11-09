import {
  Activity,
  BadgeCheck,
  Banknote,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  Clock,
  Droplets,
  GraduationCap,
  Home,
  type LucideIcon,
  Megaphone,
  Repeat,
  Settings,
  ShieldAlert,
  Users,
  Waves,
} from 'lucide-react';

export interface NavItem {
  href: string;
  /** i18n key under "nav." */
  key: string;
  icon: LucideIcon;
  group: 'mine' | 'deck' | 'manage' | 'union';
  /** Shown only when the person has this permission. */
  permission?: string;
  /** Order in the phone tab bar (lower first); omitted = only under "More". */
  tab?: number;
  /** Set once the screen exists, so navigation never leads to a missing page. */
  ready: boolean;
}

export const NAV: NavItem[] = [
  { href: '/today', key: 'today', icon: Home, group: 'mine', tab: 1, ready: false },
  { href: '/schedule', key: 'schedule', icon: CalendarDays, group: 'mine', permission: 'schedule.read', tab: 2, ready: false },
  { href: '/board', key: 'board', icon: Repeat, group: 'mine', permission: 'shiftboard.claim', tab: 3, ready: true },
  { href: '/timeclock', key: 'timeclock', icon: Clock, group: 'mine', permission: 'timeclock.punch', tab: 4, ready: false },
  { href: '/time-off', key: 'timeOff', icon: CalendarClock, group: 'mine', permission: 'timeoff.self', ready: false },
  { href: '/availability', key: 'availability', icon: CalendarRange, group: 'mine', permission: 'availability.self', ready: false },
  { href: '/lessons', key: 'lessons', icon: GraduationCap, group: 'mine', permission: 'schedule.read', ready: false },
  { href: '/status', key: 'status', icon: Waves, group: 'deck', permission: 'ops.status.read', tab: 5, ready: true },
  { href: '/ops', key: 'ops', icon: Droplets, group: 'deck', permission: 'ops.chemical.record', ready: false },
  { href: '/incidents', key: 'incidents', icon: ShieldAlert, group: 'deck', permission: 'incidents.create', ready: false },
  { href: '/manage/schedule', key: 'manageSchedule', icon: Activity, group: 'manage', permission: 'schedule.write', ready: false },
  { href: '/manage/approvals', key: 'approvals', icon: ClipboardCheck, group: 'manage', permission: 'timeclock.review', ready: false },
  { href: '/manage/staff', key: 'staff', icon: Users, group: 'manage', permission: 'users.read', ready: false },
  { href: '/manage/certifications', key: 'certifications', icon: BadgeCheck, group: 'manage', permission: 'certs.verify', ready: false },
  { href: '/manage/payroll', key: 'payroll', icon: Banknote, group: 'manage', permission: 'payroll.export', ready: false },
  { href: '/manage/settings', key: 'settings', icon: Settings, group: 'manage', permission: 'tenant.configure', ready: false },
  { href: '/union', key: 'union', icon: Megaphone, group: 'union', permission: 'union.hub', ready: false },
];

export function visibleNav(can: (p: string) => boolean): NavItem[] {
  return NAV.filter((n) => n.ready && (!n.permission || can(n.permission)));
}

/** Up to four tabs on phones; everything else lives under "More". */
export function phoneTabs(items: NavItem[]): { tabs: NavItem[]; more: NavItem[] } {
  const tabbable = items.filter((n) => n.tab !== undefined).sort((a, b) => a.tab! - b.tab!);
  const tabs = tabbable.slice(0, 4);
  return { tabs, more: items.filter((n) => !tabs.includes(n)) };
}

export function homePath(can: (p: string) => boolean): string {
  return visibleNav(can)[0]?.href ?? '/profile';
}
