/**
 * The employer's deadline to report a worker's injury to the province's
 * workers' compensation board, counted from when the employer learned of it.
 * A report is needed when the worker loses time from work beyond the day of
 * the injury, or gets health care beyond first aid.
 *
 * NOT YET REVIEWED by counsel (verified: false), like the other rule tables:
 * confirm each against the board's current requirements before relying on it.
 */
import type { Province } from '@prisma/client';

export interface BoardRule { board: string; form: string; days: number; businessDays: boolean; verified: boolean }

export const BOARDS: Record<Province, BoardRule> = {
  ON: { board: 'WSIB', form: 'Form 7 (Employer’s Report of Injury/Disease)', days: 3, businessDays: false, verified: false },
  BC: { board: 'WorkSafeBC', form: 'Form 7 (Employer’s Report of Injury or Occupational Disease)', days: 3, businessDays: false, verified: false },
  AB: { board: 'WCB-Alberta', form: 'Employer Report of Injury', days: 3, businessDays: false, verified: false },
  SK: { board: 'WCB Saskatchewan', form: 'Employer’s Initial Report of Injury (E1)', days: 5, businessDays: false, verified: false },
  MB: { board: 'WCB of Manitoba', form: 'Employer Incident Report', days: 5, businessDays: true, verified: false },
  QC: { board: 'CNESST', form: 'Avis de l’employeur et demande de remboursement', days: 2, businessDays: false, verified: false },
  NB: { board: 'WorkSafeNB', form: 'Form 67 (Employer’s Report of Accident)', days: 3, businessDays: false, verified: false },
  NS: { board: 'WCB Nova Scotia', form: 'Employer’s Report of Injury (Form 67)', days: 5, businessDays: true, verified: false },
  PE: { board: 'WCB PEI', form: 'Employer’s Report of Accident', days: 3, businessDays: false, verified: false },
  NL: { board: 'WorkplaceNL', form: 'Form 7 (Employer’s Report of Injury)', days: 3, businessDays: false, verified: false },
  YT: { board: 'Yukon WSCB', form: 'Employer’s Report of Injury', days: 3, businessDays: false, verified: false },
  NT: { board: 'WSCC', form: 'Employer’s Report of Injury', days: 3, businessDays: false, verified: false },
  NU: { board: 'WSCC', form: 'Employer’s Report of Injury', days: 3, businessDays: false, verified: false },
};

/** Deadline: learned + N days (or business days, skipping Saturdays and Sundays), at the same time of day. */
export function reportDue(province: Province, learnedAt: Date): Date {
  const r = BOARDS[province];
  const d = new Date(learnedAt);
  let left = r.days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (!r.businessDays || (dow !== 0 && dow !== 6)) left--;
  }
  return d;
}

export const reportRequired = (lostTime: boolean, healthCare: boolean) => lostTime || healthCare;
