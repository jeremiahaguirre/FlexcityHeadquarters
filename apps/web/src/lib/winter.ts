export const CONDITIONS = ['CLEAR', 'WET', 'SLUSH', 'SNOW_PACKED', 'LOOSE_SNOW', 'ICE', 'BLACK_ICE', 'DRIFTING', 'FREEZING_RAIN'] as const;
export const ACTIONS = ['INSPECTED', 'PLOWED', 'SALTED', 'SANDED', 'BRINE', 'HAZARD_REPORTED'] as const;

export interface WinterSettings {
  callOutsOn: boolean;
  patrolsOn: boolean;
  season: { start: string; end: string };
  callOuts: { responseMinutes: number; minRestHours: number };
  patrols: { graceMinutes: number };
}
export interface RouteStatus { id: string; name: string; roadClass: string | null; intervalHours: number; active: boolean; lastPatrolAt: string | null; dueAt: string | null; overdue: boolean; inSeason: boolean }
export interface Patrol { id: string; routeId: string; route: string; person: string; startedAt: string; endedAt: string | null; conditions: string[]; actions: string[]; snowCm: number | null; airTempC: number | null; roadTempC: number | null; materialTonnes: number | null; vehicle: string | null; notes: string | null }
export interface CallOutContact { id: string; userId: string; name: string; phone: string | null; rank: number; status: 'WAITING' | 'OFFERED' | 'ACCEPTED' | 'DECLINED' | 'NO_ANSWER' | 'SKIPPED' | 'NOT_NEEDED'; skipReason: string | null; offeredAt: string | null }
export interface CallOut { id: string; reason: string; status: 'OPEN' | 'FILLED' | 'CANCELLED'; startsAt: string; endsAt: string; responseMinutes: number; facility: string; position: { name: string; nameFr: string | null } | null; filledBy: string | null; contacts: CallOutContact[] }

export const toLocalInput = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
/** A chip-style multi-select: checkboxes that look like toggles. */
export const chip = (on: boolean) => `inline-flex cursor-pointer select-none items-center rounded-full border px-3 py-1.5 text-small font-semibold transition-colors ${on ? 'border-brand bg-brand/10 text-brand-text' : 'border-line text-muted hover:bg-surface'}`;
