/**
 * Trust exports (both need a passkey step-up and are audited):
 * - the auditor bundle for one framework: a ZIP of CSVs (requirements and their controls, controls
 *   and statuses, the evidence index, test history, policies, risks, vendors) and a README;
 *   evidence files themselves stay in the console (the index names each one and its SHA-256);
 * - the posture summary for a customer: a one-page PDF or a CSV with readiness bands and the
 *   controls in place, never failing-test details, risks or other customers' commitments.
 */
import type { PrismaClient } from '../../generated/prisma/client.js';
import { strToU8, zipSync } from 'fflate';
import PDFDocument from 'pdfkit';
import { config } from '../../config.js';
import { csvCell } from '../payroll/export.js';
import { CONTROLS, FRAMEWORKS, LIBRARY_VERSION, frameworkByKey, type FrameworkKey } from './library.js';
import { MONITORS } from './monitors.js';
import { controlStatuses, defaultScope, settings } from './posture.js';
import { frameworkReadiness, postureScore, readinessBand } from './scoring.js';

const csv = (rows: Array<Array<string | number | null | undefined>>) => `﻿${rows.map((r) => r.map((v) => csvCell(v === null || v === undefined ? '' : String(v))).join(',')).join('\r\n')}\r\n`;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : '');

/** Column headings and words of the auditor bundle, in English and French. Status codes (PASSING, FAIL…) stay as codes. */
const BUNDLE = {
  en: {
    title: (fw: string) => `FlexcityHeadquarters: ${fw} evidence bundle`,
    generated: (at: string, lib: string) => `Generated ${at} from control library ${lib}.`,
    readiness: (r: { readiness: number; met: number; partial: number; gaps: number; notApplicable: number }) => `Readiness: ${r.readiness}% (${r.met} requirements met, ${r.partial} partly, ${r.gaps} gaps, ${r.notApplicable} not applicable).`,
    notOpinion: 'This is a self-assessment prepared for an auditor. It is not an audit opinion or a certification.',
    files: [
      'requirements.csv  each requirement, the controls mapped to it and their status',
      'controls.csv      each control: owner, status, how it is proven (tests, evidence), justification',
      'evidence.csv      every evidence item with its SHA-256; files can be opened in the Dev console',
      'tests.csv         the latest result of each automated test',
      'test-history.csv  test results over the last 12 months (a row per change, at most hourly)',
      'policies.csv, risks.csv, vendors.csv',
    ],
    requirements: ['Requirement', 'Group', 'Title', 'Controls', 'Statuses', 'Not applicable'],
    controls: ['Control', 'Title', 'Category', 'Status', 'Owner', 'Automated tests', 'Evidence renewed (days)', 'Inherited', 'Justification', 'Requirements'],
    evidence: ['Evidence id', 'Control', 'Kind', 'Title', 'Link', 'CI result', 'File', 'Bytes', 'SHA-256', 'Valid until', 'Added', 'Added by', 'Removed', 'From test'],
    tests: ['Test', 'Title', 'Status', 'Summary', 'Last run', 'Owner', 'Controls'],
    history: ['At', 'Test', 'Status', 'Summary', 'Trigger', 'Duration (ms)'],
    policies: ['Policy', 'Version', 'Status', 'Approved', 'Approved by', 'Published', 'Acknowledgements', 'Next review'],
    risks: ['Ref', 'Title', 'Category', 'Likelihood', 'Impact', 'Residual likelihood', 'Residual impact', 'Treatment', 'Plan', 'Owner', 'Due', 'Last reviewed', 'Status', 'Controls'],
    vendors: ['Vendor', 'Purpose', 'Criticality', 'Personal information', 'Data location', 'In Canada', 'DPA signed', 'DPA expires', 'SOC 2 expires', 'ISO expires', 'Last review', 'Next review', 'Questionnaire score', 'Status'],
    yes: 'yes',
    no: 'no',
  },
  fr: {
    title: (fw: string) => `FlexcityHeadquarters : dossier de preuves ${fw}`,
    generated: (at: string, lib: string) => `Produit le ${at} à partir de la bibliothèque de contrôles ${lib}.`,
    readiness: (r: { readiness: number; met: number; partial: number; gaps: number; notApplicable: number }) => `Préparation : ${r.readiness}\u00a0% (${r.met} exigences satisfaites, ${r.partial} en partie, ${r.gaps} lacunes, ${r.notApplicable} sans objet).`,
    notOpinion: 'Autoévaluation préparée pour un auditeur. Ce n’est ni une opinion d’audit ni une certification.',
    files: [
      'requirements.csv  chaque exigence, les contrôles qui y répondent et leur état',
      'controls.csv      chaque contrôle : responsable, état, façon de le prouver (tests, preuves), justification',
      'evidence.csv      chaque preuve avec son SHA-256; les fichiers s’ouvrent dans la console Dev',
      'tests.csv         le dernier résultat de chaque test automatisé',
      'test-history.csv  les résultats des tests des 12 derniers mois (une ligne par changement, au plus une par heure)',
      'policies.csv, risks.csv, vendors.csv',
    ],
    requirements: ['Exigence', 'Groupe', 'Titre', 'Contrôles', 'États', 'Sans objet'],
    controls: ['Contrôle', 'Titre', 'Catégorie', 'État', 'Responsable', 'Tests automatisés', 'Preuve renouvelée (jours)', 'Hérité', 'Justification', 'Exigences'],
    evidence: ['Identifiant de la preuve', 'Contrôle', 'Type', 'Titre', 'Lien', 'Résultat CI', 'Fichier', 'Octets', 'SHA-256', 'Valide jusqu’au', 'Ajoutée', 'Ajoutée par', 'Retirée', 'Issue du test'],
    tests: ['Test', 'Titre', 'État', 'Résumé', 'Dernière exécution', 'Responsable', 'Contrôles'],
    history: ['Moment', 'Test', 'État', 'Résumé', 'Déclencheur', 'Durée (ms)'],
    policies: ['Politique', 'Version', 'État', 'Approuvée', 'Approuvée par', 'Publiée', 'Acceptations', 'Prochaine revue'],
    risks: ['Réf.', 'Titre', 'Catégorie', 'Probabilité', 'Impact', 'Probabilité résiduelle', 'Impact résiduel', 'Traitement', 'Plan', 'Responsable', 'Échéance', 'Dernière revue', 'État', 'Contrôles'],
    vendors: ['Fournisseur', 'Utilité', 'Criticité', 'Renseignements personnels', 'Lieu des données', 'Au Canada', 'Entente signée', 'Entente expire', 'SOC 2 expire', 'ISO expire', 'Dernière revue', 'Prochaine revue', 'Score du questionnaire', 'État'],
    yes: 'oui',
    no: 'non',
  },
};

/** The French sentence a test result carries in its details. */
const summaryFr = (details: unknown, fallback: string | null | undefined) => (details && typeof details === 'object' && typeof (details as { summaryFr?: unknown }).summaryFr === 'string' ? (details as { summaryFr: string }).summaryFr : fallback);

export async function auditorBundle(p: PrismaClient, fw: FrameworkKey, now = new Date(), fr = false): Promise<{ zip: Uint8Array; files: number }> {
  const L = fr ? BUNDLE.fr : BUNDLE.en;
  const framework = frameworkByKey.get(fw)!;
  const { statuses, states } = await controlStatuses(p, now);
  const ready = frameworkReadiness(fw, statuses);
  const inFw = CONTROLS.filter((c) => c.maps.some((x) => x.startsWith(`${fw}:`)));
  const keys = inFw.map((c) => c.key);
  const [evidence, runs, tests, policies, risks, vendors, admins] = await Promise.all([
    p.trustEvidence.findMany({ where: { controlKey: { in: keys } }, orderBy: { createdAt: 'desc' }, select: { id: true, controlKey: true, kind: true, title: true, url: true, result: true, fileName: true, size: true, sha256: true, validUntil: true, createdAt: true, addedById: true, deletedAt: true, testKey: true } }),
    p.trustTestRun.findMany({ where: { at: { gte: new Date(now.getTime() - 365 * 86_400_000) }, testKey: { in: [...new Set(inFw.flatMap((c) => c.tests))] } }, orderBy: { at: 'desc' }, take: 20_000 }),
    p.trustTest.findMany(),
    p.trustPolicy.findMany({ include: { versions: { orderBy: { version: 'desc' }, include: { _count: { select: { acks: true } } } } } }),
    p.trustRisk.findMany({ orderBy: { ref: 'asc' } }),
    p.trustVendor.findMany({ orderBy: { name: 'asc' } }),
    p.platformAdmin.findMany({ select: { id: true, name: true } }),
  ]);
  const who = (id: string | null | undefined) => admins.find((a) => a.id === id)?.name ?? '';
  const files: Record<string, Uint8Array> = {};
  files['README.txt'] = strToU8(
    [
      L.title(fr ? framework.nameFr : framework.name),
      L.generated(now.toISOString(), LIBRARY_VERSION),
      L.readiness(ready),
      L.notOpinion,
      '',
      ...L.files,
    ].join('\r\n'),
  );
  files['requirements.csv'] = strToU8(csv([L.requirements, ...framework.requirements.map((r) => {
    const cs = inFw.filter((c) => c.maps.includes(`${fw}:${r.id}`));
    return [r.id, fr ? r.groupFr : r.group, fr ? r.titleFr : r.title, cs.map((c) => c.key).join(' '), cs.map((c) => statuses[c.key]).join(' '), (fr ? r.naFr : r.na) ?? ''];
  })]));
  files['controls.csv'] = strToU8(csv([L.controls, ...inFw.map((c) => {
    const s = states.find((x) => x.key === c.key);
    return [c.key, fr ? c.titleFr : c.title, c.category, statuses[c.key], who(s?.ownerId), c.tests.join(' '), c.evidenceDays ?? '', c.inherited ? L.yes : '', s?.justification ?? '', c.maps.filter((x) => x.startsWith(`${fw}:`)).map((x) => x.split(':')[1]).join(' ')];
  })]));
  files['evidence.csv'] = strToU8(csv([L.evidence, ...evidence.map((e) => [e.id, e.controlKey, e.kind, e.title, e.url, e.result, e.fileName, e.size, e.sha256, iso(e.validUntil), iso(e.createdAt), who(e.addedById), iso(e.deletedAt), e.testKey])]));
  files['tests.csv'] = strToU8(csv([L.tests, ...MONITORS.map((m) => {
    const t = tests.find((x) => x.key === m.key);
    return [m.key, fr ? m.titleFr : m.title, t?.lastStatus, fr ? summaryFr(t?.lastDetails, t?.lastSummary) : t?.lastSummary, iso(t?.lastRunAt), who(t?.ownerId), CONTROLS.filter((c) => c.tests.includes(m.key)).map((c) => c.key).join(' ')];
  })]));
  files['test-history.csv'] = strToU8(csv([L.history, ...runs.map((x) => [iso(x.at), x.testKey, x.status, fr ? summaryFr(x.details, x.summary) : x.summary, x.trigger, x.durationMs])]));
  files['policies.csv'] = strToU8(csv([L.policies, ...policies.flatMap((x) => x.versions.map((v) => [fr ? x.titleFr : x.title, v.version, v.status, iso(v.approvedAt), who(v.approvedById), iso(v.publishedAt), v._count.acks, iso(x.nextReviewAt)]))]));
  files['risks.csv'] = strToU8(csv([L.risks, ...risks.map((x) => [x.ref, (fr ? x.titleFr : null) ?? x.title, x.category, x.likelihood, x.impact, x.residualLikelihood, x.residualImpact, x.treatment, x.treatmentPlan, who(x.ownerId), iso(x.dueAt), iso(x.lastReviewedAt), x.status, x.controlKeys.join(' ')])]));
  files['vendors.csv'] = strToU8(csv([L.vendors, ...vendors.map((v) => [v.name, (fr ? v.purposeFr : null) ?? v.purpose, v.criticality, v.personalInfo ? L.yes : L.no, v.dataLocation, v.inCanada ? L.yes : L.no, iso(v.dpaSignedAt), iso(v.dpaExpiresAt), iso(v.soc2ExpiresAt), iso(v.isoExpiresAt), iso(v.lastReviewedAt), iso(v.nextReviewAt), v.score, v.status])]));
  return { zip: zipSync(files, { level: 6 }), files: Object.keys(files).length };
}

/** What a customer may see: readiness bands, the controls in place, subprocessors. Nothing failing is named. */
export async function postureSummary(p: PrismaClient, now = new Date()) {
  const s = await settings(p);
  const scope = defaultScope(s.frameworks);
  const { statuses } = await controlStatuses(p, now);
  const audited = await p.trustEvidence.findMany({ where: { controlKey: 'GV-03', kind: 'FILE', title: { contains: 'audit report', mode: 'insensitive' }, deletedAt: null }, select: { id: true } });
  const vendors = await p.trustVendor.findMany({ where: { status: 'ACTIVE', personalInfo: true }, select: { name: true, purpose: true, purposeFr: true, dataLocation: true }, orderBy: { name: 'asc' } });
  return {
    generatedAt: now.toISOString(),
    libraryVersion: LIBRARY_VERSION,
    score: postureScore(statuses, scope),
    /** True only when an audit report is on file; until then every framework reads "preparing". */
    auditReportOnFile: audited.length > 0,
    frameworks: FRAMEWORKS.filter((f) => scope.includes(f.key)).map((f) => {
      const r = frameworkReadiness(f.key, statuses);
      return { key: f.key, name: f.name, nameFr: f.nameFr, readiness: r.readiness, band: readinessBand(r.readiness) };
    }),
    inPlace: CONTROLS.filter((c) => statuses[c.key] === 'PASSING').map((c) => ({ key: c.key, title: c.title, titleFr: c.titleFr, category: c.category })),
    subprocessors: vendors,
    /** Where to report a security issue (SECURITY_EMAIL), or null when none is configured. */
    securityContact: config().SECURITY_EMAIL || null,
  };
}

export async function postureSummaryCsv(p: PrismaClient, fr: boolean): Promise<string> {
  const s = await postureSummary(p);
  return csv([
    [fr ? 'FlexcityHeadquarters : résumé de la posture de sécurité' : 'FlexcityHeadquarters: security posture summary', s.generatedAt],
    [fr ? 'Autoévaluation, pas une certification' : 'Self-assessment, not a certification'],
    [],
    [fr ? 'Cadre' : 'Framework', fr ? 'État' : 'Status', fr ? 'Préparation (%)' : 'Readiness (%)'],
    ...s.frameworks.map((f) => [fr ? f.nameFr : f.name, fr ? 'En préparation' : 'Preparing', f.readiness]),
    [],
    [fr ? 'Contrôles en place' : 'Controls in place'],
    ...s.inPlace.map((c) => [c.key, fr ? c.titleFr : c.title]),
    [],
    [fr ? 'Sous-traitants' : 'Subprocessors', fr ? 'Utilité' : 'Purpose', fr ? 'Lieu des données' : 'Data location'],
    ...s.subprocessors.map((v) => [v.name, fr ? (v.purposeFr ?? v.purpose) : v.purpose, v.dataLocation]),
  ]);
}

export async function postureSummaryPdf(p: PrismaClient, fr: boolean): Promise<Buffer> {
  const s = await postureSummary(p);
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 56, bottom: 56, left: 56, right: 56 }, info: { Title: fr ? 'Résumé de la posture de sécurité' : 'Security posture summary', Creator: 'FlexcityHeadquarters' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const ink = '#0B1F22';
  const muted = '#4A5C5E';
  const accent = '#0D5F59';
  const width = doc.page.width - 112;
  doc.fillColor(accent).fontSize(10).text('FlexcityHeadquarters');
  doc.moveDown(0.3).fillColor(ink).fontSize(20).text(fr ? 'Résumé de la posture de sécurité' : 'Security posture summary');
  doc.moveDown(0.3).fillColor(muted).fontSize(9).text(`${fr ? 'Produit le' : 'Generated'} ${s.generatedAt.slice(0, 16).replace('T', ' ')} UTC · ${fr ? 'bibliothèque' : 'library'} ${s.libraryVersion}`);
  doc.moveDown(0.6).fillColor(ink).fontSize(10).text(fr ? 'Autoévaluation continue de nos contrôles, et non une certification ni l’opinion d’un auditeur. Les tests automatisés vérifient l’état réel de la plateforme aux quelques minutes.' : 'A continuous self-assessment of our controls, not a certification or an auditor’s opinion. Automated tests check the platform’s real state every few minutes.', { width });
  doc.moveDown(1).fontSize(13).fillColor(ink).text(fr ? 'Cadres' : 'Frameworks');
  for (const f of s.frameworks) {
    const y = doc.y + 6;
    doc.fontSize(10).fillColor(ink).text(fr ? `${f.nameFr}\u00a0: en préparation (${f.readiness}\u00a0%)` : `${f.name}: preparing (${f.readiness}%)`, 56, y);
    doc.roundedRect(330, y + 2, 200, 7, 3.5).fill('#E3ECEB');
    if (f.readiness > 0) doc.roundedRect(330, y + 2, Math.max(7, 2 * f.readiness), 7, 3.5).fill(accent);
    doc.x = 56;
  }
  doc.moveDown(1.2).fontSize(13).fillColor(ink).text(fr ? 'Contrôles en place' : 'Controls in place', 56);
  doc.moveDown(0.2).fontSize(9.5).fillColor(ink);
  for (const c of s.inPlace) doc.text(`•  ${fr ? c.titleFr : c.title}`, { width });
  if (!s.inPlace.length) doc.fillColor(muted).text(fr ? 'Les contrôles sont en cours de vérification.' : 'Controls are being verified.');
  doc.moveDown(1).fontSize(13).fillColor(ink).text(fr ? 'Sous-traitants qui traitent des renseignements personnels' : 'Subprocessors handling personal information');
  doc.moveDown(0.2).fontSize(9.5);
  for (const v of s.subprocessors) doc.fillColor(ink).text(`${v.name}`, { continued: true }).fillColor(muted).text(`${fr ? '\u00a0: ' : ': '}${fr ? (v.purposeFr ?? v.purpose) : v.purpose} (${v.dataLocation})`, { width });
  // Only a real address (SECURITY_EMAIL): a customer-facing page never shows a placeholder.
  if (s.securityContact) doc.moveDown(1).fontSize(9).fillColor(muted).text(fr ? `Signaler un problème de sécurité\u00a0: ${s.securityContact}` : `Report a security issue: ${s.securityContact}`);
  doc.end();
  return done;
}
