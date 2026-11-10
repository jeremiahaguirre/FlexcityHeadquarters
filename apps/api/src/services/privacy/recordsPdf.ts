/**
 * The records export as a printable PDF, for privacy access and
 * freedom-of-information responses: a cover page (who, when, what's excluded),
 * then one section per kind of record, each item's fields listed plainly.
 * Same content as the JSON export; the employer reviews and severs before release.
 */
import PDFDocument from 'pdfkit';
import type { exportPersonRecords } from './recordsExport.js';

type Records = Awaited<ReturnType<typeof exportPersonRecords>>;
type Lang = 'en' | 'fr';

const L = {
  en: {
    title: 'Personal records',
    for: 'Records held about',
    org: 'Organization',
    generated: 'Generated',
    reviewer: 'Prepared by',
    about: 'This file lists every record the organization holds about this person in FlexcityHeadquarters. Review it before release: information about other people may need to be severed.',
    excluded: 'Not included',
    contents: 'Contents',
    none: 'None.',
    page: 'Page',
    of: 'of',
    confidential: 'Confidential: personal information',
    sections: {
      person: 'Personal details',
      positions: 'Positions',
      certifications: 'Certifications',
      payRates: 'Pay rates',
      availability: 'Availability',
      timeOff: 'Time off',
      shifts: 'Shifts',
      punches: 'Time punches',
      attendanceEvents: 'Attendance events',
      conductNotes: 'Conduct notes',
      disciplineRecords: 'Discipline records',
      onboarding: 'Onboarding',
      workRestrictions: 'Work restrictions and accommodation',
      careCheckIns: 'Care check-ins',
      overtime: 'Overtime',
      notifications: 'Notifications',
      incidentReportsFiled: 'Incident reports filed',
      documents: 'Documents on file',
      auditTrail: 'Audit trail',
    } as Record<string, string>,
  },
  fr: {
    title: 'Renseignements personnels',
    for: 'Dossiers concernant',
    org: 'Organisation',
    generated: 'Produit le',
    reviewer: 'Préparé par',
    about: 'Ce document énumère tous les dossiers que l’organisation détient sur cette personne dans FlexcityHeadquarters. Révisez-le avant de le communiquer : les renseignements sur d’autres personnes pourraient devoir être retranchés.',
    excluded: 'Non inclus',
    contents: 'Table des matières',
    none: 'Aucun.',
    page: 'Page',
    of: 'de',
    confidential: 'Confidentiel : renseignements personnels',
    sections: {
      person: 'Renseignements personnels',
      positions: 'Postes',
      certifications: 'Certifications',
      payRates: 'Taux de salaire',
      availability: 'Disponibilités',
      timeOff: 'Congés',
      shifts: 'Quarts',
      punches: 'Pointages',
      attendanceEvents: 'Événements d’assiduité',
      conductNotes: 'Notes de conduite',
      disciplineRecords: 'Mesures disciplinaires',
      onboarding: 'Intégration',
      workRestrictions: 'Restrictions et mesures d’adaptation',
      careCheckIns: 'Suivis de soutien',
      overtime: 'Heures supplémentaires',
      notifications: 'Notifications',
      incidentReportsFiled: 'Rapports d’incident déposés',
      documents: 'Documents au dossier',
      auditTrail: 'Journal d’audit',
    } as Record<string, string>,
  },
};

const ORDER = ['person', 'positions', 'certifications', 'payRates', 'availability', 'timeOff', 'shifts', 'punches', 'attendanceEvents', 'conductNotes', 'disciplineRecords', 'onboarding', 'workRestrictions', 'careCheckIns', 'overtime', 'notifications', 'incidentReportsFiled', 'documents', 'auditTrail'] as const;
// Internal ids add length without meaning for the reader.
const HIDDEN = new Set(['tenantId', 'userId', 'id', 'positionId', 'facilityId', 'recordedById', 'issuedById', 'createdById', 'decidedById', 'acknowledgementSignature']);

const FR_FIELDS: Record<string, string> = {
  firstName: 'Prénom', lastName: 'Nom', email: 'Courriel', phone: 'Téléphone', locale: 'Langue', roles: 'Rôles', status: 'Statut',
  employmentStatus: 'Statut d’emploi', employeeNumber: 'Numéro d’employé', hireDate: 'Date d’embauche', seniorityDate: 'Date d’ancienneté',
  seniorityHours: 'Heures d’ancienneté', dateOfBirth: 'Date de naissance', unionMember: 'Membre du syndicat', createdAt: 'Créé le', name: 'Nom',
  issueDate: 'Date de délivrance', expiryDate: 'Date d’expiration', verifiedAt: 'Vérifié le', hourlyRate: 'Taux horaire', effectiveFrom: 'En vigueur du',
  effectiveTo: 'En vigueur au', dayOfWeek: 'Jour de la semaine', startMinute: 'Minute de début', endMinute: 'Minute de fin', type: 'Type',
  startsAt: 'Début', endsAt: 'Fin', note: 'Note', decisionNote: 'Note de décision', decidedAt: 'Décidé le', clockIn: 'Arrivée', clockOut: 'Départ',
  locationStatus: 'Lieu', distanceM: 'Distance (m)', occurredAt: 'Survenu le', points: 'Points', category: 'Catégorie', summary: 'Résumé',
  issuedAt: 'Remis le', level: 'Niveau', evidence: 'Faits invoqués', stewardPresent: 'Délégué présent', acknowledgedAt: 'Signé le',
  employeeResponse: 'Réponse de l’employé', respondedAt: 'Répondu le', item: 'Élément', completedOn: 'Terminé le', expiresOn: 'Expire le',
  waivedReason: 'Motif de la dispense', completedAt: 'Terminé le', hours: 'Heures', params: 'Détails', readAt: 'Lu le', action: 'Action',
  entity: 'Objet', entityId: 'Identifiant', actorId: 'Auteur', at: 'Le', excusedAt: 'Excusé le', excuseReason: 'Motif de l’excuse',
};

/** "employeeResponse" → "Employee response" (or its French name). */
const label = (key: string, lang: Lang = 'en') => (lang === 'fr' && FR_FIELDS[key] ? FR_FIELDS[key]! : labelEn(key));
const labelEn = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()).replace(/ ([A-Z])/g, (_, c: string) => ` ${c.toLowerCase()}`);

function show(v: unknown, lang: Lang): string {
  if (v === null || v === undefined || v === '') return '—';
  // Plain dates (stored at midnight UTC) show as a date; moments show the time too.
  const when = (iso: string) => (iso.slice(11, 23) === '00:00:00.000' ? iso.slice(0, 10) : `${iso.replace('T', ' ').slice(0, 16)} UTC`);
  if (v instanceof Date) return when(v.toISOString());
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return when(v);
  if (typeof v === 'boolean') return lang === 'fr' ? (v ? 'Oui' : 'Non') : v ? 'Yes' : 'No';
  if (typeof v === 'object' && 'toFixed' in (v as object)) return String(v); // Prisma Decimal
  if (Array.isArray(v)) return v.length ? v.map((x) => show(x, lang)).join('; ') : '—';
  if (typeof v === 'object') return Object.entries(v as object).filter(([k]) => !HIDDEN.has(k)).map(([k, x]) => `${label(k, lang)}: ${show(x, lang)}`).join(', ');
  return String(v);
}

export function recordsPdf(data: Records, opts: { organization: string; preparedBy: string; lang: Lang }): Promise<Buffer> {
  const t = L[opts.lang];
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 64, bottom: 64, left: 60, right: 60 }, bufferPages: true, info: { Title: `${t.title}: ${data.person.firstName} ${data.person.lastName}`, Author: opts.organization, Creator: 'FlexcityHeadquarters' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const ink = '#0B1F22';
  const muted = '#4A5C5E';
  const accent = '#0D5F59';
  const width = doc.page.width - 120;

  // Cover
  doc.fillColor(accent).font('Helvetica-Bold').fontSize(10).text(t.confidential.toUpperCase(), { characterSpacing: 1 });
  doc.moveDown(1.5).fillColor(ink).fontSize(26).text(t.title);
  doc.moveDown(0.3).font('Helvetica').fontSize(13).fillColor(muted).text(`${t.for} ${data.person.firstName} ${data.person.lastName}`);
  doc.moveDown(1.5).fontSize(10).fillColor(ink);
  for (const [k, v] of [[t.org, opts.organization], [t.generated, show(data.generatedAt, opts.lang)], [t.reviewer, opts.preparedBy]] as const) {
    doc.font('Helvetica-Bold').text(`${k}: `, { continued: true }).font('Helvetica').text(v);
  }
  doc.moveDown(1).fillColor(muted).text(t.about, { width });
  doc.moveDown(1).fillColor(ink).font('Helvetica-Bold').text(t.excluded);
  doc.font('Helvetica').fillColor(muted);
  for (const e of data.excluded) doc.text(`•  ${e}`, { width, indent: 0 });

  // Contents
  doc.moveDown(1.5).fillColor(ink).font('Helvetica-Bold').text(t.contents);
  doc.font('Helvetica').fillColor(muted);
  for (const key of ORDER) {
    const v = (data as Record<string, unknown>)[key];
    const n = Array.isArray(v) ? v.length : 1;
    doc.text(`${t.sections[key]} (${n})`);
  }

  // Sections follow one another; a new page only when there's no room for a heading and a line or two.
  doc.addPage();
  for (const [n, key] of ORDER.entries()) {
    if (n > 0) doc.moveDown(1.2);
    if (doc.y > doc.page.height - 160) doc.addPage();
    const v = (data as Record<string, unknown>)[key];
    const items = Array.isArray(v) ? v : [v];
    doc.fillColor(accent).font('Helvetica-Bold').fontSize(16).text(t.sections[key]!);
    doc.moveDown(0.6).fontSize(9.5);
    if (!items.length) {
      doc.fillColor(muted).font('Helvetica').text(t.none);
      continue;
    }
    items.forEach((item, n) => {
      if (doc.y > doc.page.height - 120) doc.addPage();
      if (typeof item !== 'object' || item === null) {
        doc.fillColor(ink).font('Helvetica').text(`•  ${show(item, opts.lang)}`, { width });
        return;
      }
      if (items.length > 1) doc.fillColor(muted).font('Helvetica-Bold').text(`${n + 1}.`);
      for (const [k, x] of Object.entries(item as object)) {
        if (HIDDEN.has(k)) continue;
        doc.fillColor(muted).font('Helvetica-Bold').text(`${label(k, opts.lang)}: `, { continued: true, width }).fillColor(ink).font('Helvetica').text(show(x, opts.lang), { width });
      }
      doc.moveDown(0.5);
    });
  }

  // Footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc.fontSize(8).fillColor(muted).font('Helvetica').text(`${data.person.firstName} ${data.person.lastName} · ${t.confidential} · ${t.page} ${i + 1} ${t.of} ${range.count}`, 60, doc.page.height - 40, { width, align: 'center' });
  }
  doc.end();
  return done;
}
