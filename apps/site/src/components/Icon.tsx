import { Armchair, BadgeCheck, Building2, ClipboardList, FileSearch, HeartHandshake, TrendingUp, Calculator, CalendarDays, Clock, Droplet, FlaskConical, Receipt, Repeat, ShieldCheck, Trees, Users, Waves, Wrench, type LucideIcon } from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  calendar: CalendarDays, repeat: Repeat, clock: Clock, calculator: Calculator, flask: FlaskConical, shield: ShieldCheck,
  badge: BadgeCheck, waves: Waves, building: Building2, trees: Trees, droplet: Droplet, wrench: Wrench, users: Users,
  clipboard: ClipboardList, armchair: Armchair, filesearch: FileSearch, heart: HeartHandshake, trending: TrendingUp, receipt: Receipt,
};

export function Icon({ name, className = 'h-6 w-6' }: { name: string; className?: string }) {
  const I = ICONS[name] ?? ShieldCheck;
  return <I className={className} aria-hidden="true" />;
}
