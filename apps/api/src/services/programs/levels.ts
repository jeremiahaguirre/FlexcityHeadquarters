/**
 * Swim level presets with the ages each program publishes. The Canadian Red
 * Cross ended its swim program at the end of 2022 and many cities now teach
 * the Lifesaving Society's Swim for Life; both are offered, and every level
 * stays editable so the city can match the standards it actually teaches.
 * Ages are in months. Confirm against the program's current materials.
 */
export interface LevelPreset { name: string; nameFr: string; minAgeMonths: number; maxAgeMonths: number | null; parentInWater?: boolean; ratio: number; durationMinutes: number }

const range = (prefix: string, prefixFr: string, from: number, to: number, base: Omit<LevelPreset, 'name' | 'nameFr'>, tweak?: (n: number, l: LevelPreset) => LevelPreset) =>
  Array.from({ length: to - from + 1 }, (_, i) => {
    const n = from + i;
    const l = { ...base, name: `${prefix} ${n}`, nameFr: `${prefixFr} ${n}` };
    return tweak ? tweak(n, l) : l;
  });

export const PRESETS: Record<'RED_CROSS' | 'LIFESAVING', { program: string; levels: LevelPreset[] }> = {
  RED_CROSS: {
    program: 'Red Cross Swim',
    levels: [
      { name: 'Parent & Tot 1', nameFr: 'Parent et bambin 1', minAgeMonths: 4, maxAgeMonths: 12, parentInWater: true, ratio: 8, durationMinutes: 30 },
      { name: 'Parent & Tot 2', nameFr: 'Parent et bambin 2', minAgeMonths: 12, maxAgeMonths: 24, parentInWater: true, ratio: 8, durationMinutes: 30 },
      { name: 'Parent & Tot 3', nameFr: 'Parent et bambin 3', minAgeMonths: 24, maxAgeMonths: 36, parentInWater: true, ratio: 8, durationMinutes: 30 },
      ...range('Preschool', 'Préscolaire', 1, 5, { minAgeMonths: 36, maxAgeMonths: 72, ratio: 5, durationMinutes: 30 }),
      ...range('Swim Kids', 'Natation junior', 1, 10, { minAgeMonths: 60, maxAgeMonths: null, ratio: 6, durationMinutes: 30 }, (n, l) => (n >= 5 ? { ...l, ratio: 8, durationMinutes: 45 } : l)),
      { name: 'Adult & Teen', nameFr: 'Adultes et ados', minAgeMonths: 156, maxAgeMonths: null, ratio: 8, durationMinutes: 45 },
    ],
  },
  LIFESAVING: {
    program: 'Lifesaving Society Swim for Life',
    levels: [
      { name: 'Parent & Tot 1', nameFr: 'Parent et enfant 1', minAgeMonths: 4, maxAgeMonths: 12, parentInWater: true, ratio: 8, durationMinutes: 30 },
      { name: 'Parent & Tot 2', nameFr: 'Parent et enfant 2', minAgeMonths: 12, maxAgeMonths: 24, parentInWater: true, ratio: 8, durationMinutes: 30 },
      { name: 'Parent & Tot 3', nameFr: 'Parent et enfant 3', minAgeMonths: 24, maxAgeMonths: 36, parentInWater: true, ratio: 8, durationMinutes: 30 },
      ...range('Preschool', 'Préscolaire', 1, 5, { minAgeMonths: 36, maxAgeMonths: 72, ratio: 5, durationMinutes: 30 }),
      ...range('Swimmer', 'Nageur', 1, 6, { minAgeMonths: 60, maxAgeMonths: 156, ratio: 6, durationMinutes: 45 }, (n, l) => (n >= 4 ? { ...l, ratio: 8 } : l)),
      { name: 'Rookie Patrol', nameFr: 'Patrouille recrue', minAgeMonths: 96, maxAgeMonths: null, ratio: 8, durationMinutes: 45 },
      { name: 'Ranger Patrol', nameFr: 'Patrouille ranger', minAgeMonths: 96, maxAgeMonths: null, ratio: 8, durationMinutes: 45 },
      { name: 'Star Patrol', nameFr: 'Patrouille étoile', minAgeMonths: 96, maxAgeMonths: null, ratio: 8, durationMinutes: 60 },
      { name: 'Bronze Star', nameFr: 'Étoile de bronze', minAgeMonths: 120, maxAgeMonths: null, ratio: 10, durationMinutes: 60 },
      { name: 'Adult Learn to Swim', nameFr: 'Apprendre à nager adulte', minAgeMonths: 168, maxAgeMonths: null, ratio: 8, durationMinutes: 45 },
    ],
  },
};

/** Whole months between a birth date and a day (both YYYY-MM-DD). */
export function ageInMonths(dob: string, on: string): number {
  const [by, bm, bd] = dob.split('-').map(Number) as [number, number, number];
  const [y, m, d] = on.split('-').map(Number) as [number, number, number];
  return (y - by) * 12 + (m - bm) - (d < bd ? 1 : 0);
}

export function fitsAge(months: number, min: number | null, max: number | null): boolean {
  // The upper age is exclusive: Parent & Tot 1 (4–12 months) ends when the child turns 12 months.
  return (min === null || months >= min) && (max === null || months < max);
}
