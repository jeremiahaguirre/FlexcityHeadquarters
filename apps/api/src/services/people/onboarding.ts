/**
 * Employee onboarding. Each city has a catalogue of items (checks, training,
 * policies, documents, tasks) owned by HR, the supervisor or the employee.
 * Items apply to everyone or to the positions switched on for them; items
 * marked as blocking must be done before the person can be scheduled.
 *
 * Privacy by design: for police checks and identity documents the app keeps
 * only that they were seen, when, by whom and when they expire — never the
 * result, the document or a SIN.
 */
import type { OnboardingKind, OnboardingOwner } from '../../generated/prisma/client.js';
import type { Tx } from '../../lib/db.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';

interface DefaultItem { key: string; name: string; nameFr: string; description: string; descriptionFr: string; owner: OnboardingOwner; kind: OnboardingKind; allStaff?: boolean; blocksScheduling?: boolean; validityMonths?: number; policyText?: string }

/** The built-in catalogue. Cities switch items on per position and can add their own. */
export const DEFAULT_ITEMS: DefaultItem[] = [
  // HR
  { key: 'employment_agreement', owner: 'HR', kind: 'DOCUMENT', allStaff: true, name: 'Offer letter or employment agreement signed', nameFr: 'Lettre d’offre ou contrat de travail signé', description: 'Signed copy on the personnel file.', descriptionFr: 'Copie signée au dossier du personnel.' },
  { key: 'td1', owner: 'HR', kind: 'DOCUMENT', allStaff: true, name: 'TD1 tax forms received', nameFr: 'Formulaires d’impôt TD1 reçus', description: 'Federal and provincial TD1 (Quebec: TP-1015.3).', descriptionFr: 'TD1 fédéral et provincial (Québec : TP-1015.3).' },
  { key: 'direct_deposit', owner: 'HR', kind: 'DOCUMENT', allStaff: true, name: 'Direct deposit set up', nameFr: 'Dépôt direct configuré', description: 'Entered in the payroll system. Banking details are not kept here.', descriptionFr: 'Saisi dans le système de paie. Les coordonnées bancaires ne sont pas conservées ici.' },
  { key: 'identity', owner: 'HR', kind: 'TASK', allStaff: true, name: 'Identity and eligibility to work verified', nameFr: 'Identité et admissibilité au travail vérifiées', description: 'Seen in person. The SIN goes in payroll only, never here.', descriptionFr: 'Vu en personne. Le NAS va dans la paie seulement, jamais ici.' },
  { key: 'emergency_contact', owner: 'HR', kind: 'TASK', allStaff: true, name: 'Emergency contact on file', nameFr: 'Personne à joindre en cas d’urgence au dossier', description: '', descriptionFr: '' },
  { key: 'crc', owner: 'HR', kind: 'CHECK', blocksScheduling: true, validityMonths: 36, name: 'Criminal record check', nameFr: 'Vérification du casier judiciaire', description: 'Record the date seen and that it met the position’s standard. Do not record the result.', descriptionFr: 'Inscrivez la date de consultation et sa conformité à la norme du poste. N’inscrivez pas le résultat.' },
  { key: 'vsc', owner: 'HR', kind: 'CHECK', blocksScheduling: true, validityMonths: 36, name: 'Vulnerable sector check', nameFr: 'Vérification des antécédents en vue d’un travail auprès de personnes vulnérables', description: 'For positions working with children or vulnerable people. Obtained through the local police service.', descriptionFr: 'Pour les postes auprès d’enfants ou de personnes vulnérables. Obtenue auprès du service de police local.' },
  { key: 'child_protection', owner: 'HR', kind: 'TRAINING', blocksScheduling: true, validityMonths: 36, name: 'Child protection training', nameFr: 'Formation sur la protection de l’enfance', description: 'For example Commit to Kids or Respect in Sport. Keep the certificate date.', descriptionFr: 'Par exemple Priorité Jeunesse ou Respect et Sport. Conservez la date du certificat.' },
  { key: 'high_five', owner: 'HR', kind: 'TRAINING', name: 'HIGH FIVE Principles of Healthy Child Development', nameFr: 'HIGH FIVE : principes du développement sain de l’enfant', description: 'For recreation leaders, camp and program staff.', descriptionFr: 'Pour les animateurs, le personnel de camp et de programmes.' },
  { key: 'whmis', owner: 'HR', kind: 'TRAINING', allStaff: true, validityMonths: 12, name: 'WHMIS training', nameFr: 'Formation SIMDUT', description: 'Workplace hazardous materials, reviewed yearly.', descriptionFr: 'Matières dangereuses au travail, revue chaque année.' },
  { key: 'hs_awareness', owner: 'HR', kind: 'TRAINING', allStaff: true, name: 'Health and safety awareness training', nameFr: 'Formation de sensibilisation à la santé et à la sécurité', description: 'For example Ontario’s Worker Health and Safety Awareness in 4 Steps.', descriptionFr: 'Par exemple, en Ontario, Sensibilisation à la santé et à la sécurité des travailleurs en 4 étapes.' },
  { key: 'accessibility', owner: 'HR', kind: 'TRAINING', allStaff: true, name: 'Accessible customer service training', nameFr: 'Formation sur le service à la clientèle accessible', description: 'Required for public-facing staff in Ontario (AODA) and good practice everywhere.', descriptionFr: 'Exigée en Ontario (LAPHO) pour le personnel en contact avec le public, et bonne pratique partout.' },
  // Employee acknowledgements
  { key: 'harassment_policy', owner: 'EMPLOYEE', kind: 'ACKNOWLEDGEMENT', allStaff: true, name: 'Workplace harassment and violence policy', nameFr: 'Politique sur le harcèlement et la violence au travail', description: 'Read and acknowledge.', descriptionFr: 'Lire et confirmer.', policyText: 'Our organization does not tolerate harassment or violence. Report concerns to your supervisor, HR or the health and safety committee. Reports are investigated promptly and kept confidential as far as possible. Nobody will face reprisal for reporting in good faith.' },
  { key: 'privacy_policy', owner: 'EMPLOYEE', kind: 'ACKNOWLEDGEMENT', allStaff: true, name: 'Privacy and confidentiality', nameFr: 'Confidentialité et protection des renseignements', description: 'Read and acknowledge.', descriptionFr: 'Lire et confirmer.', policyText: 'You may see personal information about the public and coworkers. Use it only for your job, never share it outside work, and report any loss or misuse to your supervisor right away.' },
  { key: 'code_of_conduct', owner: 'EMPLOYEE', kind: 'ACKNOWLEDGEMENT', allStaff: true, name: 'Code of conduct', nameFr: 'Code de conduite', description: 'Read and acknowledge.', descriptionFr: 'Lire et confirmer.', policyText: 'Treat the public and coworkers with respect, follow safety procedures, be on time, and raise concerns early.' },
  // Supervisor
  { key: 'orientation', owner: 'SUPERVISOR', kind: 'TASK', allStaff: true, name: 'Facility orientation and tour', nameFr: 'Accueil et visite de l’installation', description: 'Exits, first aid, alarms, staff areas.', descriptionFr: 'Sorties, premiers soins, alarmes, aires du personnel.' },
  { key: 'emergency_plan', owner: 'SUPERVISOR', kind: 'TASK', allStaff: true, name: 'Emergency action plan reviewed', nameFr: 'Plan d’intervention d’urgence revu', description: 'Including the person’s role in each procedure.', descriptionFr: 'Y compris le rôle de la personne dans chaque procédure.' },
  { key: 'equipment', owner: 'SUPERVISOR', kind: 'TASK', allStaff: true, name: 'Uniform, equipment and keys issued', nameFr: 'Uniforme, équipement et clés remis', description: '', descriptionFr: '' },
  { key: 'shadow', owner: 'SUPERVISOR', kind: 'TASK', name: 'Shadow shifts completed', nameFr: 'Quarts d’observation terminés', description: 'Worked alongside an experienced colleague.', descriptionFr: 'Travail aux côtés d’un collègue expérimenté.' },
  { key: 'skills_check', owner: 'SUPERVISOR', kind: 'TRAINING', validityMonths: 12, name: 'Job skills check or in-service', nameFr: 'Vérification des compétences ou formation en cours d’emploi', description: 'For example a lifeguard skills check before the first shift.', descriptionFr: 'Par exemple une vérification des compétences de sauveteur avant le premier quart.' },
];

/** The set switched on together for positions with minors or vulnerable people. */
export const MINORS_SET = ['vsc', 'child_protection', 'high_five'];

/** Adds any missing built-in items (idempotent). */
export async function ensureDefaults(tx: Tx, tenantId: string) {
  const have = new Set((await tx.onboardingItem.findMany({ where: { key: { not: null } }, select: { key: true } })).map((r) => r.key));
  const missing = DEFAULT_ITEMS.filter((d) => !have.has(d.key));
  if (missing.length) {
    await tx.onboardingItem.createMany({
      data: missing.map((d) => ({ tenantId, key: d.key, name: d.name, nameFr: d.nameFr, description: d.description || null, descriptionFr: d.descriptionFr || null, owner: d.owner, kind: d.kind, allStaff: d.allStaff ?? false, blocksScheduling: d.blocksScheduling ?? false, validityMonths: d.validityMonths ?? null, policyText: d.policyText ?? null, sortOrder: DEFAULT_ITEMS.indexOf(d) })),
      skipDuplicates: true,
    });
  }
}

export type ItemState = 'DONE' | 'WAIVED' | 'EXPIRING' | 'EXPIRED' | 'PENDING';
const day = (d: Date) => d.toISOString().slice(0, 10);

/** State of an item from its latest record. Expiring = within 30 days. */
export function itemState(latest: { status: 'COMPLETE' | 'WAIVED'; expiresOn: Date | null } | null, today: Date): ItemState {
  if (!latest) return 'PENDING';
  if (latest.status === 'WAIVED') return 'WAIVED';
  if (latest.expiresOn) {
    const t = day(today);
    if (day(latest.expiresOn) < t) return 'EXPIRED';
    if (day(latest.expiresOn) <= day(new Date(today.getTime() + 30 * 86_400_000))) return 'EXPIRING';
  }
  return 'DONE';
}

export const addMonths = (d: Date, months: number) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + months);
  return x;
};

/** Items a person needs: everyone's items plus those switched on for their positions. */
export async function requiredItems(tx: Tx, userId: string) {
  const positions = await tx.userPosition.findMany({ where: { userId }, select: { positionId: true } });
  return tx.onboardingItem.findMany({
    where: { archivedAt: null, OR: [{ allStaff: true }, { positions: { some: { positionId: { in: positions.map((p) => p.positionId) } } } }] },
    orderBy: [{ owner: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export async function checklist(tx: Tx, userId: string, now = new Date()) {
  const [items, records] = await Promise.all([requiredItems(tx, userId), tx.onboardingRecord.findMany({ where: { userId }, orderBy: { recordedAt: 'desc' } })]);
  return items.map((i) => {
    const latest = records.find((r) => r.itemId === i.id) ?? null;
    return {
      id: i.id,
      key: i.key,
      name: i.name,
      nameFr: i.nameFr,
      description: i.description,
      descriptionFr: i.descriptionFr,
      owner: i.owner,
      kind: i.kind,
      blocksScheduling: i.blocksScheduling,
      validityMonths: i.validityMonths,
      policyText: i.policyText,
      state: itemState(latest, now),
      completedOn: latest ? day(latest.completedOn) : null,
      expiresOn: latest?.expiresOn ? day(latest.expiresOn) : null,
      note: latest?.note ?? null,
      waivedReason: latest?.waivedReason ?? null,
    };
  });
}

/** Who may complete an item: HR any; supervisors their own items; the employee their own acknowledgements. */
export function canComplete(owner: OnboardingOwner, perms: { hr: boolean; lead: boolean }) {
  return perms.hr || (owner === 'SUPERVISOR' && perms.lead);
}

export async function recordItem(
  tx: Tx,
  tenantId: string,
  actorId: string,
  userId: string,
  itemId: string,
  input: { action: 'complete' | 'waive'; completedOn: string; note?: string | null; reason?: string | null },
  perms: { hr: boolean; lead: boolean; self: boolean },
) {
  const item = await tx.onboardingItem.findUnique({ where: { id: itemId } });
  if (!item || item.archivedAt) throw notFound('Onboarding item');
  const selfAck = perms.self && item.owner === 'EMPLOYEE' && item.kind === 'ACKNOWLEDGEMENT' && input.action === 'complete';
  if (!selfAck && !canComplete(item.owner, perms)) throw forbidden('This item is completed by someone else.');
  if (input.action === 'waive' && !perms.hr) throw forbidden('Only HR can waive an item.');
  if (input.action === 'waive' && !input.reason) throw badRequest('Say why the item is waived.');
  const completedOn = new Date(`${input.completedOn}T00:00:00Z`);
  if (completedOn.getTime() > Date.now() + 86_400_000) throw badRequest('That date is in the future.');
  return tx.onboardingRecord.create({
    data: {
      tenantId,
      userId,
      itemId,
      status: input.action === 'waive' ? 'WAIVED' : 'COMPLETE',
      completedOn,
      expiresOn: input.action === 'complete' && item.validityMonths ? addMonths(completedOn, item.validityMonths) : null,
      recordedById: actorId,
      note: input.note ?? null,
      waivedReason: input.action === 'waive' ? input.reason : null,
    },
  });
}

/** Blocking items for a position (everyone's plus the position's), for scheduling. */
export async function blockingItemsForPosition(tx: Tx, positionId: string) {
  const items = await tx.onboardingItem.findMany({
    where: { archivedAt: null, blocksScheduling: true, OR: [{ allStaff: true }, { positions: { some: { positionId } } }] },
    select: { id: true, name: true },
  });
  return items;
}
