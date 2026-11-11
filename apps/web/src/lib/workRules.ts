/** Work rules (breaks, call-in minimum, notice premiums, shift premiums, standby), rotations and on-call: API shapes and helpers. */

export interface BreakSettings { breakAfterHours: number | null; warnMissing: boolean }
export interface CallInSettings { enabled: boolean; minHours: number | null }
export interface NoticeSettings { postDaysAhead: number | null; lateChangeHours: number | null; premiumKind: 'multiplier' | 'flat'; multiplier: number; flatAmount: number }
export interface StandbySettings { perDay: number | null; hoursPerDay: number | null; percent: number | null; callbackMinHours: number | null; callbackMultiplier: number }
export type PremiumKind = 'evening' | 'night' | 'weekend' | 'holiday' | 'custom';
export interface PremiumRule {
  id: string;
  name: string;
  nameFr?: string | null;
  kind: PremiumKind;
  days: number[];
  startMinute: number;
  endMinute: number;
  holidaysOnly: boolean;
  perHour: number | null;
  percent: number | null;
  departmentIds: string[];
  positionIds: string[];
  active: boolean;
}
export interface OrgRules { breaks: BreakSettings; callIn: CallInSettings; notice: NoticeSettings; standby: StandbySettings; premiums: PremiumRule[] }
export interface DepartmentRules { breaks?: Partial<BreakSettings>; callIn?: Partial<CallInSettings>; notice?: Partial<NoticeSettings>; standby?: Partial<StandbySettings> }
export interface StatutoryRow { province: string; mealBreak: { minutes: number; afterHours: number; everyHours?: number | null; source: string; counselVerify?: boolean } | null; reportingPay: { minHours: number; longShiftOverHours?: number | null; longShiftMinHours?: number | null; source: string; counselVerify?: boolean } | null }
export interface WorkRulesView {
  organization: OrgRules;
  departments: Array<{ id: string; name: string; nameFr: string | null; own: DepartmentRules; effective: OrgRules; limits: { maxConsecutiveDays?: number; maxDailyHours?: number }; federallyRegulated: boolean | null; effectiveLimits: { maxConsecutiveDays: number; maxDailyHours: number }; effectiveFederal: boolean }>;
  organizationLimits: { maxConsecutiveDays: number; maxDailyHours: number };
  organizationFederal: boolean;
  provinces: StatutoryRow[];
  federal: Omit<StatutoryRow, 'province'>;
  positions: Array<{ id: string; name: string; nameFr: string | null; departmentId: string | null; unpaidBreakMinutes: number | null; neverAlone: boolean }>;
  canConfigure: boolean;
}
export interface LateChange {
  id: string;
  shiftId: string;
  kind: 'TIME' | 'ADDED' | 'REMOVED';
  person: string;
  facility: string;
  position: { name: string; nameFr: string | null };
  oldStartsAt: string | null;
  oldEndsAt: string | null;
  newStartsAt: string | null;
  newEndsAt: string | null;
  noticeHours: number;
  requiredHours: number | null;
  late: boolean;
  premiumHours: number | null;
  multiplier: number | null;
  flatAmount: number | null;
  payOn: string | null;
  waived: boolean;
  createdAt: string;
}
export interface ChangeEffect { userId: string; kind: 'TIME' | 'ADDED' | 'REMOVED'; noticeHours: number; requiredHours: number | null; late: boolean; premiumHours: number; multiplier: number | null; flatAmount: number | null }
export interface ChangePreview { published: boolean; late: boolean; effects: ChangeEffect[] }

/** Common premium rules to start from. */
export const PREMIUM_PRESETS: Record<Exclude<PremiumKind, 'custom'>, Omit<PremiumRule, 'id' | 'name' | 'nameFr'>> = {
  evening: { kind: 'evening', days: [], startMinute: 18 * 60, endMinute: 23 * 60, holidaysOnly: false, perHour: 1.5, percent: null, departmentIds: [], positionIds: [], active: true },
  night: { kind: 'night', days: [], startMinute: 23 * 60, endMinute: 31 * 60, holidaysOnly: false, perHour: 2, percent: null, departmentIds: [], positionIds: [], active: true },
  weekend: { kind: 'weekend', days: [0, 6], startMinute: 0, endMinute: 1440, holidaysOnly: false, perHour: 1, percent: null, departmentIds: [], positionIds: [], active: true },
  holiday: { kind: 'holiday', days: [], startMinute: 0, endMinute: 1440, holidaysOnly: true, perHour: null, percent: 50, departmentIds: [], positionIds: [], active: true },
};

/** "HH:MM" for a minute of the day (past midnight wraps: 1860 → "07:00"). */
export const clock = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
/** Minutes from "HH:MM"; an end at or before the start runs past midnight. */
export function windowMinutes(start: string, end: string): { startMinute: number; endMinute: number } {
  const m = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
  const s = m(start);
  let e = m(end);
  if (e <= s) e += 1440;
  return { startMinute: s, endMinute: e };
}

/** A number field's value: blank = null (use the organization's / the law's). */
export const numOrNull = (v: string): number | null => (v.trim() === '' ? null : Number(v));

export interface PatternDay { day: number; start: string; end: string; label?: 'day' | 'evening' | 'night' | null }
export interface Crew { name: string; offsetDays: number; userIds: string[]; openSlots: number }
export interface RotationTemplate { id: string; name: string; departmentId: string | null; facilityId: string; positionId: string; cycleDays: number; anchorDate: string; pattern: PatternDay[]; crews: Crew[]; unpaidBreakMinutes: number | null; active: boolean }
export type PresetKey = 'FOUR_ON_FOUR_OFF' | 'PITMAN_2_2_3' | 'WEEKDAYS' | 'DAYS_NIGHTS_4_WEEK';
export interface RotationsView { templates: RotationTemplate[]; presets: Array<{ key: PresetKey; cycleDays: number; pattern: PatternDay[]; crews: Crew[] }>; maxDays: number }
export interface GenerateResult { templates: number; created: number; assigned: number; open: number; existing: number; holidays: number; items: Array<{ templateId: string; date: string; crew: string; startsAt: string; endsAt: string; userId: string | null; status: 'assigned' | 'open' | 'existing' | 'holiday'; reason: string | null }> }

/** Which crew works which day of the cycle: a row of the cycle per crew, for the editor's preview. */
export function cycleGrid(t: Pick<RotationTemplate, 'cycleDays' | 'pattern' | 'crews'>): Array<{ crew: string; days: Array<PatternDay['label'] | 'off'> }> {
  return t.crews.map((c) => ({
    crew: c.name,
    days: Array.from({ length: t.cycleDays }, (_, d) => {
      const idx = (((d - c.offsetDays) % t.cycleDays) + t.cycleDays) % t.cycleDays;
      const p = t.pattern.find((x) => x.day === idx);
      return p ? (p.label ?? 'day') : 'off';
    }),
  }));
}

export interface OnCallPeriod { id: string; departmentId: string; userId: string; name: string; phone: string | null; startsAt: string; endsAt: string; localStartsAt: string; localEndsAt: string; note: string | null; now: boolean }
export interface OnCallView { timezone: string; departments: Array<{ id: string; name: string; nameFr: string | null }>; periods: OnCallPeriod[] }

/** Shift warnings from the API (planner, publish check): codes with numbers. */
export interface ShiftWarning { code: 'BREAK_MISSING' | 'BREAK_SHORT' | 'SHORT_SHIFT' | 'TWO_PERSON'; n: number[] }
