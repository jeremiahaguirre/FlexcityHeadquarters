/**
 * Chemical log evaluation.
 *
 * - Thresholds are per pool body and come from the applicable provincial
 *   regulation / health-authority permit. There are NO built-in defaults
 *   (MAHC is a US code). A pool with no thresholds configured cannot accept
 *   readings — that is a setup error, surfaced loudly.
 * - Out-of-range readings RECOMMEND closure (amber on the front-desk board);
 *   a Head Lifeguard or Supervisor confirms or dismisses. Software never
 *   closes a pool on its own — a typo must not empty a pool deck.
 */
import { Decimal } from '../../lib/money.js';

export interface Thresholds {
  freeChlorineMinPpm: Decimal | null;
  freeChlorineMaxPpm: Decimal | null;
  combinedChlorineMaxPpm: Decimal | null;
  phMin: Decimal | null;
  phMax: Decimal | null;
}

export interface Reading {
  freeChlorinePpm: Decimal | null;
  totalChlorinePpm: Decimal | null;
  ph: Decimal | null;
}

export class ThresholdsNotConfiguredError extends Error {
  constructor() {
    super('Chemical thresholds are not configured for this pool. A supervisor must set them from the facility permit / provincial regulation.');
  }
}

/** Obviously impossible values are rejected as input errors, not treated as closures. */
export function validateReading(r: Reading): string[] {
  const errors: string[] = [];
  if (r.ph && (r.ph.lt(0) || r.ph.gt(14))) errors.push('pH must be between 0 and 14.');
  if (r.freeChlorinePpm && (r.freeChlorinePpm.lt(0) || r.freeChlorinePpm.gt(50))) errors.push('Free chlorine looks wrong (0–50 ppm).');
  if (r.totalChlorinePpm && r.freeChlorinePpm && r.totalChlorinePpm.lt(r.freeChlorinePpm)) {
    errors.push('Total chlorine cannot be lower than free chlorine.');
  }
  return errors;
}

export function evaluateReading(t: Thresholds, r: Reading): { outOfRange: boolean; reasons: string[] } {
  const configured = t.freeChlorineMinPpm !== null || t.phMin !== null || t.phMax !== null;
  if (!configured) throw new ThresholdsNotConfiguredError();

  const reasons: string[] = [];
  const below = (v: Decimal | null, min: Decimal | null, label: string) => {
    if (v !== null && min !== null && v.lt(min)) reasons.push(`${label} ${v.toString()} below minimum ${min.toString()}`);
  };
  const above = (v: Decimal | null, max: Decimal | null, label: string) => {
    if (v !== null && max !== null && v.gt(max)) reasons.push(`${label} ${v.toString()} above maximum ${max.toString()}`);
  };
  below(r.freeChlorinePpm, t.freeChlorineMinPpm, 'Free chlorine');
  above(r.freeChlorinePpm, t.freeChlorineMaxPpm, 'Free chlorine');
  below(r.ph, t.phMin, 'pH');
  above(r.ph, t.phMax, 'pH');
  if (r.totalChlorinePpm !== null && r.freeChlorinePpm !== null) {
    const combined = r.totalChlorinePpm.minus(r.freeChlorinePpm);
    above(combined, t.combinedChlorineMaxPpm, 'Combined chlorine');
  }
  if (r.freeChlorinePpm === null && t.freeChlorineMinPpm !== null) reasons.push('Free chlorine not recorded');
  if (r.ph === null && (t.phMin !== null || t.phMax !== null)) reasons.push('pH not recorded');
  return { outOfRange: reasons.length > 0, reasons };
}

/** Lifeguards required for a bather count, per the pool's configured ratio. */
export function lifeguardsRequired(batherCount: number, bathersPerLifeguard: number | null): number | null {
  if (bathersPerLifeguard === null || bathersPerLifeguard <= 0) return null;
  return Math.max(1, Math.ceil(batherCount / bathersPerLifeguard));
}
