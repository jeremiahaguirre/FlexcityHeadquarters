import { BadgeCheck, Building2, Calculator, CalendarDays, Clock, Droplet, FlaskConical, Repeat, ShieldCheck, Trees, Users, Waves, Wrench, type LucideIcon } from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  calendar: CalendarDays, repeat: Repeat, clock: Clock, calculator: Calculator, flask: FlaskConical, shield: ShieldCheck,
  badge: BadgeCheck, waves: Waves, building: Building2, trees: Trees, droplet: Droplet, wrench: Wrench, users: Users,
};

export function Icon({ name, className = 'h-6 w-6' }: { name: string; className?: string }) {
  const I = ICONS[name] ?? ShieldCheck;
  return <I className={className} aria-hidden="true" />;
}
