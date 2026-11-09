export type PoolStatus = 'OPEN' | 'CLOSURE_RECOMMENDED' | 'CLOSED';
export interface PoolView {
  id: string;
  name: string;
  kind: string;
  status: PoolStatus;
  facility: { id: string; name: string };
  configured: boolean;
  lastReading: { id: string; localRecordedAt: string; freeChlorinePpm: string | null; ph: string | null; batherCount: number | null; outOfRange: boolean; signedOff: boolean } | null;
  lifeguardsRequired: number | null;
  maxCapacity?: number | null;
  lastHeadcount?: { count: number; overCapacity: boolean; localRecordedAt: string } | null;
  openClosure: { reason: string; confirmed: boolean } | null;
}
export const POOL_TONE = { OPEN: 'ok', CLOSURE_RECOMMENDED: 'warn', CLOSED: 'danger' } as const;
