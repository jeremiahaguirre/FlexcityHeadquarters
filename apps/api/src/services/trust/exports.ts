/**
 * Trust exports (both need a passkey step-up and are audited):
 * - the auditor bundle for one framework: a ZIP of CSVs (requirements and their controls, controls
 *   and statuses, the evidence index, test history, policies, risks, vendors) and a README;
 *   evidence files themselves stay in the console (the index names each one and its SHA-256);
 * - the posture summary for a customer: a one-page PDF or a CSV with readiness bands and the
 *   controls in place, never failing-test details, risks or other customers' commitments.
 */
import type { PrismaClient } from '@prisma/client';
import { strToU8, zipSync } from 'fflate';
import PDFDocument from 'pdfkit';
import { csvCell } from '../payroll/export.js';
import { CONTROLS, FRAMEWORKS, LIBRARY_VERSION, frameworkByKey, type FrameworkKey } from './library.js';
import { MONITORS } from './monitors.js';
import { controlStatuses, defaultScope, settings } from './posture.js';
import { frameworkReadiness, postureScore, readinessBand } from './scoring.js';

const csv = (rows: Array<Array<string | number | null | undefined>>) => `﻿${rows.map((r) => r.map((v) => csvCell(v === null || v === undefined ? '' : String(v))).join(',')).join('\r\n')}\r\n`;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : '');

export async function auditorBundle(p: PrismaClient, fw: FrameworkKey, now = new Date()): Promise<{ zip: Uint8Array; files: number }> {
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
      `FlexcityHeadquarters: ${framework.name} evidence bundle`,
      `Generated ${now.toISOString()} from control library ${LIBRARY_VERSION}.`,
      `Readiness: ${ready.readiness}% (${ready.met} requirements met, ${ready.partial} partly, ${ready.gaps} gaps, ${ready.notApplicable} not applicable).`,
      'This is a self-assessment prepared for an auditor. It is not an audit opinion or a certification.',
      '',
      'requirements.csv  each requirement, the controls mapped to it and their status',
      'controls.csv      each control: owner, status, how it is proven (tests, evidence), justification',
      'evidence.csv      every evidence item with its SHA-256; files can be opened in the Dev console',
      'tests.csv         the latest result of each automated test',
      'test-history.csv  test results over the last 12 months (a row per change, at most hourly)',
      'policies.csv, risks.csv, vendors.csv',
    ].join('\r\n'),
  );
  files['requirements.csv'] = strToU8(csv([['Requirement', 'Group', 'Title', 'Controls', 'Statuses', 'Not applicable'], ...framework.requirements.map((r) => {
    const cs = inFw.filter((c) => c.maps.includes(`${fw}:${r.id}`));
    return [r.id, r.group, r.title, cs.map((c) => c.key).join(' '), cs.map((c) => statuses[c.key]).join(' '), r.na ?? ''];
  })]));
  files['controls.csv'] = strToU8(csv([['Control', 'Title', 'Category', 'Status', 'Owner', 'Automated tests', 'Evidence renewed (days)', 'Inherited', 'Justification', 'Requirements'], ...inFw.map((c) => {
    const s = states.find((x) => x.key === c.key);
    return [c.key, c.title, c.category, statuses[c.key], who(s?.ownerId), c.tests.join(' '), c.evidenceDays ?? '', c.inherited ? 'yes' : '', s?.justification ?? '', c.maps.filter((x) => x.startsWith(`${fw}:`)).map((x) => x.split(':')[1]).join(' ')];
  })]));
  files['evidence.csv'] = strToU8(csv([['Evidence id', 'Control', 'Kind', 'Title', 'Link', 'CI result', 'File', 'Bytes', 'SHA-256', 'Valid until', 'Added', 'Added by', 'Removed', 'From test'], ...evidence.map((e) => [e.id, e.controlKey, e.kind, e.title, e.url, e.result, e.fileName, e.size, e.sha256, iso(e.validUntil), iso(e.createdAt), who(e.addedById), iso(e.deletedAt), e.testKey])]));
  files['tests.csv'] = strToU8(csv([['Test', 'Title', 'Status', 'Summary', 'Last run', 'Owner', 'Controls'], ...MONITORS.map((m) => {
    const t = tests.find((x) => x.key === m.key);
    return [m.key, m.title, t?.lastStatus, t?.lastSummary, iso(t?.lastRunAt), who(t?.ownerId), CONTROLS.filter((c) => c.tests.includes(m.key)).map((c) => c.key).join(' ')];
  })]));
  files['test-history.csv'] = strToU8(csv([['At', 'Test', 'Status', 'Summary', 'Trigger', 'Duration (ms)'], ...runs.map((x) => [iso(x.at), x.testKey, x.status, x.summary, x.trigger, x.durationMs])]));
  files['policies.csv'] = strToU8(csv([['Policy', 'Version', 'Status', 'Approved', 'Approved by', 'Published', 'Acknowledgements', 'Next review'], ...policies.flatMap((x) => x.versions.map((v) => [x.title, v.version, v.status, iso(v.approvedAt), who(v.approvedById), iso(v.publishedAt), v._count.acks, iso(x.nextReviewAt)]))]));
  files['risks.csv'] = strToU8(csv([['Ref', 'Title', 'Category', 'Likelihood', 'Impact', 'Residual likelihood', 'Residual impact', 'Treatment', 'Plan', 'Owner', 'Due', 'Last reviewed', 'Status', 'Controls'], ...risks.map((x) => [x.ref, x.title, x.category, x.likelihood, x.impact, x.residualLikelihood, x.residualImpact, x.treatment, x.treatmentPlan, who(x.ownerId), iso(x.dueAt), iso(x.lastReviewedAt), x.status, x.controlKeys.join(' ')])]));
  files['vendors.csv'] = strToU8(csv([['Vendor', 'Purpose', 'Criticality', 'Personal information', 'Data location', 'In Canada', 'DPA signed', 'DPA expires', 'SOC 2 expires', 'ISO expires', 'Last review', 'Next review', 'Questionnaire score', 'Status'], ...vendors.map((v) => [v.name, v.purpose, v.criticality, v.personalInfo ? 'yes' : 'no', v.dataLocation, v.inCanada ? 'yes' : 'no', iso(v.dpaSignedAt), iso(v.dpaExpiresAt), iso(v.soc2ExpiresAt), iso(v.isoExpiresAt), iso(v.lastReviewedAt), iso(v.nextReviewAt), v.score, v.status])]));
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
    [fr ? 'Sous-traitants' : 'Subprocessors', fr ? 'Fin' : 'Purpose', fr ? 'Lieu des données' : 'Data location'],
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
    doc.fontSize(10).fillColor(ink).text(`${fr ? f.nameFr : f.name}: ${fr ? 'en préparation' : 'preparing'} (${f.readiness} %)`, 56, y);
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
  for (const v of s.subprocessors) doc.fillColor(ink).text(`${v.name}`, { continued: true }).fillColor(muted).text(`: ${fr ? (v.purposeFr ?? v.purpose) : v.purpose} (${v.dataLocation})`, { width });
  doc.moveDown(1).fontSize(9).fillColor(muted).text(fr ? 'Signaler un problème de sécurité : security@flexcityhq.example' : 'Report a security issue: security@flexcityhq.example');
  doc.end();
  return done;
}
