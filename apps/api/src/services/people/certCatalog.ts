/**
 * The organization's certificate catalog (Settings › Positions): the certificates and licences its
 * positions, coverage rules and vehicles can require, and that staff add to their profiles.
 *
 * A new city starts with an empty catalog, so the editor offers a starter list for the departments
 * beyond aquatics (arena plant operators, water and wastewater operators, driver's licence classes).
 * The city picks what it uses; each pick becomes an ordinary catalog row it can correct afterwards.
 * Validity is left blank where it depends on the holder or the jurisdiction: the city sets it.
 */
import { z } from 'zod';
import type { Tx } from '../../lib/db.js';
import { conflict } from '../../lib/errors.js';

export interface StarterCert {
  key: string;
  group: 'aquatics' | 'arena' | 'water' | 'wastewater' | 'licence';
  name: string;
  nameFr: string;
  issuingBody: string;
  validityMonths: number | null;
}

const EOCP = 'Environmental Operators Certification Program (EOCP)';
const TSBC = 'Technical Safety BC';
const ICBC = 'ICBC';
const LEVELS = [
  ['I', 'I'],
  ['II', 'II'],
  ['III', 'III'],
  ['IV', 'IV'],
] as const;

const levels = (group: StarterCert['group'], key: string, name: string, nameFr: string): StarterCert[] =>
  LEVELS.map(([en, fr], i) => ({ key: `${key}-${i + 1}`, group, name: `${name} – Level ${en}`, nameFr: `${nameFr} – niveau ${fr}`, issuingBody: EOCP, validityMonths: null }));

export const STARTER_CERTS: readonly StarterCert[] = [
  { key: 'sfa-cpr-c', group: 'aquatics', name: 'Standard First Aid with CPR-C', nameFr: 'Secourisme général avec RCR-C', issuingBody: 'Lifesaving Society / Canadian Red Cross', validityMonths: 36 },
  { key: 'nl-pool', group: 'aquatics', name: 'National Lifeguard – Pool', nameFr: 'Sauveteur national – Piscine', issuingBody: 'Lifesaving Society', validityMonths: 24 },
  { key: 'swim-instructor', group: 'aquatics', name: 'Swim Instructor', nameFr: 'Moniteur de natation', issuingBody: 'Lifesaving Society', validityMonths: 24 },
  { key: 'refrigeration-operator', group: 'arena', name: 'Refrigeration Operator', nameFr: 'Opérateur de systèmes de réfrigération', issuingBody: TSBC, validityMonths: null },
  { key: 'power-engineer-5', group: 'arena', name: 'Power Engineer – 5th Class', nameFr: 'Mécanicien de machines fixes – 5e classe', issuingBody: TSBC, validityMonths: null },
  { key: 'power-engineer-4', group: 'arena', name: 'Power Engineer – 4th Class', nameFr: 'Mécanicien de machines fixes – 4e classe', issuingBody: TSBC, validityMonths: null },
  { key: 'ice-facility-operator', group: 'arena', name: 'Ice Facility Operator', nameFr: 'Opérateur d’installation de glace', issuingBody: 'Recreation Facilities Association of BC', validityMonths: null },
  ...levels('water', 'water-treatment', 'Water Treatment', 'Traitement de l’eau potable'),
  ...levels('water', 'water-distribution', 'Water Distribution', 'Distribution de l’eau potable'),
  { key: 'small-water-system', group: 'water', name: 'Small Water System', nameFr: 'Petit réseau d’eau potable', issuingBody: EOCP, validityMonths: null },
  ...levels('wastewater', 'wastewater-treatment', 'Wastewater Treatment', 'Traitement des eaux usées'),
  ...levels('wastewater', 'wastewater-collection', 'Wastewater Collection', 'Collecte des eaux usées'),
  ...[1, 2, 3, 4, 5].map((n) => ({ key: `licence-class-${n}`, group: 'licence' as const, name: `Driver’s licence – Class ${n}`, nameFr: `Permis de conduire – classe ${n}`, issuingBody: ICBC, validityMonths: null })),
  { key: 'air-brake', group: 'licence', name: 'Air brake endorsement', nameFr: 'Mention freins à air', issuingBody: ICBC, validityMonths: null },
];

export const certBody = z.object({
  name: z.string().trim().min(2).max(120),
  nameFr: z.string().trim().max(120).nullable().optional(),
  issuingBody: z.string().trim().min(2).max(120),
  validityMonths: z.number().int().min(1).max(120).nullable(),
});
export type CertInput = z.infer<typeof certBody>;

/** The organization already has a certificate with this name (its own or a shared one). */
export async function assertCertNameFree(tx: Tx, name: string, exceptId: string | null = null) {
  const clash = await tx.certification.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  if (clash) throw conflict('CERT_EXISTS', 'There is already a certificate with that name.', { field: 'name' });
}

/** Names already in the catalog, lower-cased, to mark which starter entries were added. */
export async function catalogNames(tx: Tx): Promise<Set<string>> {
  return new Set((await tx.certification.findMany({ select: { name: true } })).map((c) => c.name.trim().toLowerCase()));
}
