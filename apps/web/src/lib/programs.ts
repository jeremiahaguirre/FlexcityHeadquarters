export interface SwimLevel { id: string; program: string; name: string; nameFr: string | null; minAgeMonths: number; maxAgeMonths: number | null; parentInWater: boolean; ratio: number; durationMinutes: number; sortOrder: number; active: boolean }
export interface LessonSet { id: string; name: string; level: string | null; levelId: string | null; facilityId: string; positionId: string; daysOfWeek: number[]; startMinute: number; endMinute: number; startsOn: string; endsOn: string; sessions: number; capacity: number; enrolled: number; waitlisted: number; spotsLeft: number; minAgeMonths: number | null; maxAgeMonths: number | null; priceCents: number | null; memberPriceCents: number | null; published: boolean; facility?: string; ageFits?: boolean | null; ageAtStartMonths?: number | null }
export interface Campaign { id: string; name: string; nameFr: string | null; kind: 'LESSONS' | 'SWIM_CLUB' | 'CAMP' | 'OTHER'; status: 'DRAFT' | 'PUBLISHED' | 'CLOSED'; startsOn: string; endsOn: string; registrationOpensAt: string | null; registrationClosesAt: string | null; skipDates: string[]; notes: string | null; setCount?: number; sets?: LessonSet[] }
export interface Fee { id: string; facilityId: string | null; kind: 'MEMBERSHIP' | 'DROP_IN' | 'PASS' | 'PROGRAM'; period: 'YEAR' | 'MONTH' | 'VISIT' | 'NONE'; ageGroup: string; name: string; nameFr: string | null; priceCents: number; visits: number | null; active: boolean }

/** Day patterns planners pick from (0 = Sunday). */
export const PATTERNS: Record<string, number[]> = {
  weekly: [],
  twiceTueThu: [2, 4],
  monWedFri: [1, 3, 5],
  monToFri: [1, 2, 3, 4, 5],
  weekend: [0, 6],
};
export const PAYMENT_METHODS = ['DEBIT', 'CREDIT', 'CASH', 'ON_ACCOUNT', 'COMPLIMENTARY'] as const;

export const money = (cents: number | null | undefined, lng: string) => (cents == null ? '—' : new Intl.NumberFormat(lng, { style: 'currency', currency: 'CAD' }).format(cents / 100));
export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const toMinutes = (v: string) => {
  const [h, m] = v.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
export const addDaysIso = (iso: string, n: number) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** "4 months", "2 years", "3½"… as words the front desk can say out loud. */
export function ageLabel(months: number | null, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (months === null) return '';
  if (months < 24) return t('programs.ageMonths', { count: months });
  const y = Math.floor(months / 12);
  return t('programs.ageYears', { count: y });
}
export function ageRange(min: number | null, max: number | null, t: (k: string, o?: Record<string, unknown>) => string): string {
  const one = (m: number) => (m < 24 ? t('programs.ageMonths', { count: m }) : t('programs.ageYears', { count: Math.floor(m / 12) }));
  if (min === null && max === null) return t('programs.allAges');
  if (max === null) return t('programs.agePlus', { min: one(min ?? 0) });
  return t('programs.ageBetween', { min: one(min ?? 0), max: one(max) });
}
