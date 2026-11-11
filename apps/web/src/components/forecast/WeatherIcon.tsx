import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Snowflake, Sun, type LucideIcon } from 'lucide-react';
import type { Condition } from '@/lib/forecast';

const ICONS: Record<Condition, LucideIcon> = {
  sunny: Sun,
  partly: CloudSun,
  cloudy: Cloud,
  showers: CloudDrizzle,
  rain: CloudRain,
  thunder: CloudLightning,
  snow: Snowflake,
  mixed: CloudSnow,
  fog: CloudFog,
};

/** A weather condition as an icon; decorative (the words go next to it or in a label). */
export function WeatherIcon({ condition, className = 'h-4 w-4' }: { condition: Condition; className?: string }) {
  const Icon = ICONS[condition] ?? Cloud;
  const tone = condition === 'sunny' || condition === 'partly' ? 'text-warn' : condition === 'thunder' ? 'text-danger' : 'text-brand-text';
  return <Icon className={`${className} shrink-0 ${tone}`} aria-hidden="true" />;
}
