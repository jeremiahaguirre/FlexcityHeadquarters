/**
 * Program level presets (swimming and skating) with the ages each program
 * publishes. Lifesaving Society Swim for Life is the main swim ladder; YMCA
 * stages and Skate Canada CanSkate are offered too, and cities add their own
 * levels for anything else (hockey skills, gymnastics, dance, fitness). Every
 * level stays editable so the city can match the standards it teaches.
 * Ages are in months. Confirm against the program's current materials.
 */
export interface LevelPreset { name: string; nameFr: string; minAgeMonths: number; maxAgeMonths: number | null; parentInWater?: boolean; ratio: number; durationMinutes: number; /** Lifesaving and leadership awards, loaded only when asked for. */ advanced?: boolean; note?: string }

const range = (prefix: string, prefixFr: string, from: number, to: number, base: Omit<LevelPreset, 'name' | 'nameFr'>, tweak?: (n: number, l: LevelPreset) => LevelPreset) =>
  Array.from({ length: to - from + 1 }, (_, i) => {
    const n = from + i;
    const l = { ...base, name: `${prefix} ${n}`, nameFr: `${prefixFr} ${n}` };
    return tweak ? tweak(n, l) : l;
  });

export type PresetKey = 'LIFESAVING' | 'YMCA' | 'CANSKATE';
export const PRESETS: Record<PresetKey, { program: string; levels: LevelPreset[] }> = {
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
      { name: 'Adult Learn to Swim', nameFr: 'Apprendre à nager adulte', minAgeMonths: 168, maxAgeMonths: null, ratio: 8, durationMinutes: 45 },
      // Advanced: the Bronze awards and National Lifeguard, toward working as a lifeguard.
      { name: 'Bronze Star', nameFr: 'Étoile de bronze', minAgeMonths: 120, maxAgeMonths: null, ratio: 10, durationMinutes: 60, advanced: true },
      { name: 'Bronze Medallion', nameFr: 'Médaille de bronze', minAgeMonths: 156, maxAgeMonths: null, ratio: 12, durationMinutes: 120, advanced: true, note: '13 years old by the exam, or holds Bronze Star' },
      { name: 'Bronze Cross', nameFr: 'Croix de bronze', minAgeMonths: 156, maxAgeMonths: null, ratio: 12, durationMinutes: 120, advanced: true, note: 'Holds Bronze Medallion' },
      { name: 'National Lifeguard', nameFr: 'Sauveteur national', minAgeMonths: 192, maxAgeMonths: null, ratio: 12, durationMinutes: 180, advanced: true, note: '16 years old by the exam; holds Bronze Cross and Standard First Aid' },
    ],
  },
  /**
   * YMCA swim lessons by stage: Swim Starters with a parent, then Preschool and
   * School Age stages. Ys set their own programs; confirm with the local Y.
   */
  YMCA: {
    program: 'YMCA Swim Lessons',
    levels: [
      { name: 'Swim Starters A: Water Discovery', nameFr: 'Débutants A : découverte de l’eau', minAgeMonths: 6, maxAgeMonths: 36, parentInWater: true, ratio: 8, durationMinutes: 30 },
      { name: 'Swim Starters B: Water Exploration', nameFr: 'Débutants B : exploration de l’eau', minAgeMonths: 6, maxAgeMonths: 36, parentInWater: true, ratio: 8, durationMinutes: 30 },
      ...['Water Acclimation', 'Water Movement', 'Water Stamina', 'Stroke Introduction'].map((x, i) => ({ name: `Preschool Stage ${i + 1}: ${x}`, nameFr: `Préscolaire étape ${i + 1}`, minAgeMonths: 36, maxAgeMonths: 72, ratio: 5, durationMinutes: 30 })),
      ...['Water Acclimation', 'Water Movement', 'Water Stamina', 'Stroke Introduction', 'Stroke Development', 'Stroke Mechanics'].map((x, i) => ({ name: `School Age Stage ${i + 1}: ${x}`, nameFr: `Âge scolaire étape ${i + 1}`, minAgeMonths: 72, maxAgeMonths: 156, ratio: 6, durationMinutes: 45 })),
      { name: 'Teen & Adult Swim', nameFr: 'Natation ados et adultes', minAgeMonths: 156, maxAgeMonths: null, ratio: 8, durationMinutes: 45 },
    ],
  },
  /** Skate Canada's learn-to-skate program: stages taught on ice, in groups led by coaches. */
  CANSKATE: {
    program: 'Skate Canada CanSkate',
    levels: [
      { name: 'Pre-CanSkate', nameFr: 'Pré-Patinage Plus', minAgeMonths: 36, maxAgeMonths: 60, ratio: 6, durationMinutes: 30 },
      ...range('CanSkate Stage', 'Patinage Plus étape', 1, 6, { minAgeMonths: 48, maxAgeMonths: null, ratio: 10, durationMinutes: 45 }),
      { name: 'Adult Learn to Skate', nameFr: 'Apprendre à patiner adulte', minAgeMonths: 216, maxAgeMonths: null, ratio: 10, durationMinutes: 45 },
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
