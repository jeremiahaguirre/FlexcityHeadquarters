/**
 * Reminders: before something FH promised or owes comes due (30, 7 and 1 days before, then once
 * when overdue), the Trust feed gets an alert and its owner (or every Trust manager) an email.
 * Each (item, due date, offset) is sent once (TrustReminder), so a recurring commitment reminds
 * again for its next due date, and several workers never send twice.
 */
import type { PrismaClient } from '@prisma/client';
import { config } from '../../config.js';
import { maskEmail } from '../../lib/log.js';
import type { Mailer } from '../notifications/mailer.js';
import { daysUntil, reminderDue } from './scoring.js';

interface Due { subject: string; due: Date; ownerId: string | null; en: string; fr: string; link: string }

/** Days an admin has to accept a newly published policy. */
export const ACK_DAYS = 14;
const day = (d: Date) => d.toISOString().slice(0, 10);

export async function dueItems(p: PrismaClient): Promise<Due[]> {
  const [commitments, vendors, requests, risks, policies] = await Promise.all([
    p.trustCommitment.findMany({ where: { status: 'OPEN', dueAt: { not: null } }, select: { id: true, title: true, customer: true, dueAt: true, ownerId: true } }),
    p.trustVendor.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true, ownerId: true, nextReviewAt: true, dpaExpiresAt: true, soc2ExpiresAt: true, isoExpiresAt: true } }),
    p.trustEvidenceRequest.findMany({ where: { status: 'OPEN' }, select: { id: true, title: true, controlKey: true, dueAt: true, ownerId: true } }),
    p.trustRisk.findMany({ where: { status: 'OPEN', dueAt: { not: null } }, select: { id: true, ref: true, title: true, dueAt: true, ownerId: true } }),
    p.trustPolicy.findMany({ where: { nextReviewAt: { not: null } }, select: { id: true, title: true, titleFr: true, nextReviewAt: true, ownerId: true } }),
  ]);
  const out: Due[] = [];
  for (const c of commitments) out.push({ subject: `commitment:${c.id}`, due: c.dueAt!, ownerId: c.ownerId, en: `Commitment to ${c.customer}: ${c.title}`, fr: `Engagement envers ${c.customer} : ${c.title}`, link: `/platform/trust/commitments?id=${c.id}` });
  for (const v of vendors) {
    const add = (what: string, d: Date | null, en: string, fr: string) => d && out.push({ subject: `vendor:${v.id}:${what}`, due: d, ownerId: v.ownerId, en: `${v.name}: ${en}`, fr: `${v.name} : ${fr}`, link: `/platform/trust/vendors?id=${v.id}` });
    add('review', v.nextReviewAt, 'vendor review due', 'revue du fournisseur à faire');
    add('dpa', v.dpaExpiresAt, 'data processing agreement expires', 'l’entente de traitement des données expire');
    add('soc2', v.soc2ExpiresAt, 'SOC 2 report expires', 'le rapport SOC 2 expire');
    add('iso', v.isoExpiresAt, 'ISO 27001 certificate expires', 'le certificat ISO 27001 expire');
  }
  for (const r of requests) out.push({ subject: `evidence:${r.id}`, due: r.dueAt, ownerId: r.ownerId, en: `Evidence for ${r.controlKey}: ${r.title}`, fr: `Preuve pour ${r.controlKey} : ${r.title}`, link: `/platform/trust/evidence?id=${r.id}` });
  for (const r of risks) out.push({ subject: `risk:${r.id}`, due: r.dueAt!, ownerId: r.ownerId, en: `Risk ${r.ref} treatment: ${r.title}`, fr: `Traitement du risque ${r.ref} : ${r.title}`, link: `/platform/trust/risks?id=${r.id}` });
  // Each admin has 14 days to accept a newly published policy version; they're reminded before and once after.
  const [published, admins] = await Promise.all([
    p.trustPolicyVersion.findMany({ where: { status: 'PUBLISHED', publishedAt: { not: null } }, select: { id: true, publishedAt: true, policy: { select: { id: true, title: true, titleFr: true } }, acks: { select: { adminId: true } } } }),
    p.platformAdmin.findMany({ where: { disabledAt: null }, select: { id: true } }),
  ]);
  for (const v of published) {
    for (const a of admins.filter((x) => !v.acks.some((k) => k.adminId === x.id))) {
      out.push({ subject: `ack:${v.id}:${a.id}`, due: new Date(v.publishedAt!.getTime() + ACK_DAYS * 86_400_000), ownerId: a.id, en: `Read and accept: ${v.policy.title}`, fr: `Lire et accepter : ${v.policy.titleFr}`, link: `/platform/trust/policies?id=${v.policy.id}` });
    }
  }
  for (const x of policies) out.push({ subject: `policy:${x.id}`, due: x.nextReviewAt!, ownerId: x.ownerId, en: `Policy review: ${x.title}`, fr: `Revue de politique : ${x.titleFr}`, link: `/platform/trust/policies?id=${x.id}` });
  return out;
}

/** Raises the reminders that are due now. Returns how many. */
export async function runReminders(p: PrismaClient, now = new Date()): Promise<number> {
  const items = await dueItems(p);
  if (!items.length) return 0;
  const sentRows = await p.trustReminder.findMany({ where: { subject: { in: items.map((i) => i.subject) } }, select: { subject: true, dueKey: true, daysBefore: true } });
  let n = 0;
  for (const it of items) {
    const key = day(it.due);
    const sent = sentRows.filter((s) => s.subject === it.subject && s.dueKey === key).map((s) => s.daysBefore);
    const offset = reminderDue(it.due, now, sent);
    if (offset === null) continue;
    // The unique row claims this reminder: a second worker racing here gets a conflict and skips.
    const claimed = await p.trustReminder.createMany({ data: [{ subject: it.subject, dueKey: key, daysBefore: offset }], skipDuplicates: true });
    if (!claimed.count) continue;
    const left = daysUntil(it.due, now);
    const when = offset === 0 || left < 0 ? { en: 'overdue', fr: 'en retard' } : left === 0 ? { en: 'due today', fr: 'à échéance aujourd’hui' } : left === 1 ? { en: 'due tomorrow', fr: 'à échéance demain' } : { en: `due in ${left} days`, fr: `à échéance dans ${left} jours` };
    await p.trustAlert.create({ data: { kind: offset === 0 ? 'overdue' : 'reminder', title: `${it.en} (${when.en}, ${key})`, titleFr: `${it.fr} (${when.fr}, ${key})`, link: it.link, ownerId: it.ownerId } });
    n++;
  }
  return n;
}

/** The Dev console's address: PLATFORM_APP_URL when set, else the app address without an organization (as platformRp() does). */
export const platformAppUrl = () => (process.env.PLATFORM_APP_URL ?? config().PUBLIC_APP_URL.replace('{subdomain}.', '')).replace(/\/$/, '');
const APP = platformAppUrl;

/** Emails each new alert to its owner, or to every admin who manages Trust when it has none. */
export async function deliverTrustAlerts(p: PrismaClient, mailer: Mailer): Promise<number> {
  const alerts = await p.trustAlert.findMany({ where: { emailedAt: null }, orderBy: { createdAt: 'asc' }, take: 100 });
  if (!alerts.length) return 0;
  const admins = await p.platformAdmin.findMany({ where: { disabledAt: null }, select: { id: true, email: true, permissions: true } });
  const managers = admins.filter((a) => a.permissions.includes('trust.manage'));
  let n = 0;
  for (const a of alerts) {
    // Claim first, so two workers never email the same alert.
    const claimed = await p.trustAlert.updateMany({ where: { id: a.id, emailedAt: null }, data: { emailedAt: new Date() } });
    if (!claimed.count) continue;
    const owner = a.ownerId ? admins.find((x) => x.id === a.ownerId) : undefined;
    const to = owner ? [owner] : managers;
    for (const r of to) {
      try {
        // Console admins have no language setting: every alert email is in English and French.
        await mailer.send({ to: r.email, subject: `[FH Trust / Confiance] ${a.title} / ${a.titleFr}`, text: `${a.title}\n${a.titleFr}\n\nOpen / Ouvrir : ${APP()}${a.link ?? '/platform/trust'}\n` });
        n++;
      } catch (err) {
        console.warn(`[trust] alert email to ${maskEmail(r.email)} failed`, err instanceof Error ? err.name : '');
      }
    }
  }
  return n;
}
