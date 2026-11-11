/**
 * Ages the public forms check: the age of majority (sign-up portal: the person filling the form
 * is an adult, and registers children as their parent or guardian) and the minimum working age
 * (careers page: young applicants need a parent's or guardian's consent).
 *
 * Age of majority: 19 in BC, NB, NL, NS, NT, NU and YT; 18 elsewhere (each province's Age of
 * Majority Act).
 *
 * Working age: deliberately conservative and the same everywhere, because the provincial rules
 * differ by industry and change often. Applicants 16 or older apply on their own; 14 and 15 year
 * olds apply with a parent's or guardian's consent (several provinces require written consent
 * for that age: BC under 16, AB, SK, MB with a readiness certificate, QC under 14 ...); under 14
 * is not taken online (BC needs a permit from the Director of Employment Standards; most provinces
 * restrict or prohibit it). Asking for consent where a province doesn't require it is harmless.
 * The table is marked for counsel review in docs/COMPLIANCE.md (Age and consent).
 */
export const PROVINCES = ['BC', 'AB', 'SK', 'MB', 'ON', 'QC', 'NB', 'NS', 'PE', 'NL', 'YT', 'NT', 'NU'] as const;
export type ProvinceCode = (typeof PROVINCES)[number];

const MAJORITY_19 = new Set<string>(['BC', 'NB', 'NL', 'NS', 'NT', 'NU', 'YT']);

/** Age of majority in a province; unknown = 19 (the higher, so never too low). */
export function ageOfMajority(province: string | null | undefined): 18 | 19 {
  if (!province) return 19;
  return MAJORITY_19.has(province) ? 19 : 18;
}

/**
 * Government pages on young workers, by province (shown next to the consent box). Only BC's is
 * filled in (permits under 14, consent under 16); the others are left for counsel to add once
 * checked, rather than guessed. COUNSEL: verify this URL and add the other provinces.
 */
const YOUNG_WORKER_LINKS: Partial<Record<ProvinceCode, string>> = {
  BC: 'https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/hiring/young-people-and-work',
};

export interface WorkAge {
  province: string | null;
  /** Applicants this age or older apply on their own. */
  adultAge: number;
  /** Below adultAge and at least this: apply with a parent's or guardian's consent. Below this: not online. */
  minAge: number;
  /** The province's page on young workers (BC: permits under 14, consent under 16). */
  link: string | null;
}

export function workAge(province: string | null | undefined): WorkAge {
  const p = province && (PROVINCES as readonly string[]).includes(province) ? (province as ProvinceCode) : null;
  return { province: p, adultAge: 16, minAge: 14, link: (p && YOUNG_WORKER_LINKS[p]) || null };
}

/** Whole years between a birth date and a day (both YYYY-MM-DD). */
export function yearsOld(dateOfBirth: string, on: string): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const [y, m, d] = on.split('-').map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}
