/** Pools as the deck sees them (GET /api/ops/headcounts/current). */
export interface DeckPool {
  id: string;
  name: string;
  kind: string;
  status: 'OPEN' | 'CLOSURE_RECOMMENDED' | 'CLOSED';
  facility: { id: string; name: string };
  maxCapacity: number | null;
  bathersPerLifeguard: number | null;
  limitsSet: boolean;
  last: { count: number; overCapacity: boolean; localRecordedAt: string; by: string | null; lifeguardsRequired: number | null } | null;
}

export type ReportRange = 'today' | 'week' | 'month';

/** Midnight-to-midnight in the browser's time, going back 1, 7 or 30 days. */
export function rangeBounds(range: ReportRange): { from: string; to: string } {
  const end = new Date();
  end.setHours(24, 0, 0, 0);
  const days = range === 'today' ? 1 : range === 'week' ? 7 : 30;
  return { from: new Date(end.getTime() - days * 86_400_000).toISOString(), to: end.toISOString() };
}

export function csv(rows: Array<Array<string | number | null>>): Blob {
  const cell = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return new Blob([rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' });
}
