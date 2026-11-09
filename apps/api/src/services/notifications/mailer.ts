/**
 * Email delivery from the outbox. Templates are bilingual; the recipient's
 * locale picks the language.
 */
import type { PrismaClient } from '@prisma/client';
import { tenantIds, withTenant } from '../../lib/db.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Development / test transport: prints instead of sending. */
export class ConsoleMailer implements Mailer {
  sent: Mail[] = [];
  constructor(private readonly quiet = false) {}
  async send(mail: Mail) {
    this.sent.push(mail);
    if (!this.quiet) console.log(`[mail] to=${mail.to} subject="${mail.subject}"\n${mail.text}\n`);
  }
}

type Params = Record<string, unknown>;
type Template = (p: Params) => { subject: string; text: string };

const APP_URL = () => process.env.PUBLIC_APP_URL ?? 'http://localhost:3000';

const TEMPLATES: Record<string, { 'en-CA': Template; 'fr-CA': Template }> = {
  password_reset: {
    'en-CA': (p) => ({
      subject: 'Reset your FlexcityHeadquarters password',
      text: `Use this link within 1 hour to choose a new password:\n${p.url}\n\nIf you didn't ask for this, you can ignore this email.`,
    }),
    'fr-CA': (p) => ({
      subject: 'Réinitialisez votre mot de passe FlexcityHeadquarters',
      text: `Utilisez ce lien dans l'heure qui suit pour choisir un nouveau mot de passe :\n${p.url}\n\nSi vous n'avez rien demandé, ignorez ce courriel.`,
    }),
  },
  invite: {
    'en-CA': (p) => ({
      subject: `You're invited to ${p.organization} on FlexcityHeadquarters`,
      text: `Set your password to get started (link valid 7 days):\n${p.url}`,
    }),
    'fr-CA': (p) => ({
      subject: `Invitation à rejoindre ${p.organization} sur FlexcityHeadquarters`,
      text: `Choisissez votre mot de passe pour commencer (lien valide 7 jours) :\n${p.url}`,
    }),
  },
  shift_assigned: {
    'en-CA': () => ({ subject: 'A shift was added to your schedule', text: `See your schedule: ${APP_URL()}/schedule` }),
    'fr-CA': () => ({ subject: 'Un quart a été ajouté à votre horaire', text: `Consultez votre horaire : ${APP_URL()}/schedule` }),
  },
  claim_needs_approval: {
    'en-CA': (p) => ({
      subject: 'A shift claim needs your approval',
      text: `A claim would add ${p.overtimeHours} h of overtime. Review it: ${APP_URL()}/manage/approvals`,
    }),
    'fr-CA': (p) => ({
      subject: 'Une demande de quart attend votre approbation',
      text: `Cette demande ajouterait ${p.overtimeHours} h d'heures supplémentaires. À examiner : ${APP_URL()}/manage/approvals`,
    }),
  },
  time_off_decided: {
    'en-CA': (p) => ({
      subject: `Your time-off request was ${p.status === 'APPROVED' ? 'approved' : 'declined'}`,
      text: `Details: ${APP_URL()}/time-off`,
    }),
    'fr-CA': (p) => ({
      subject: `Votre demande de congé a été ${p.status === 'APPROVED' ? 'approuvée' : 'refusée'}`,
      text: `Détails : ${APP_URL()}/time-off`,
    }),
  },
  cert_expiring: {
    'en-CA': (p) => ({
      subject: `${p.certification} expires in ${p.days} days`,
      text: `Renew it before ${p.expiryDate} to stay eligible for shifts. ${APP_URL()}/profile`,
    }),
    'fr-CA': (p) => ({
      subject: `${p.certification} expire dans ${p.days} jours`,
      text: `Renouvelez-la avant le ${p.expiryDate} pour rester admissible aux quarts. ${APP_URL()}/profile`,
    }),
  },
  invoice: {
    'en-CA': (p) => ({
      subject: `Invoice ${p.number} from ${p.from}: ${p.total}`,
      text: `Hello ${p.organization},\n\nInvoice ${p.number} for ${p.period} is ${p.total}, due ${p.dueDate}.\n\n${p.remittance}\n\nQuestions about this invoice: ${p.contact}`,
    }),
    'fr-CA': (p) => ({
      subject: `Facture ${p.number} de ${p.from} : ${p.total}`,
      text: `Bonjour ${p.organization},\n\nLa facture ${p.number} pour la période du ${p.period} s'élève à ${p.total}, payable au plus tard le ${p.dueDate}.\n\n${p.remittance}\n\nQuestions sur cette facture : ${p.contact}`,
    }),
  },
};

export function renderEmail(template: string, locale: string, params: Params): { subject: string; text: string } {
  const t = TEMPLATES[template];
  if (!t) throw new Error(`Unknown email template: ${template}`);
  return (locale.startsWith('fr') ? t['fr-CA'] : t['en-CA'])(params);
}

export function hasEmailTemplate(template: string): boolean {
  return template in TEMPLATES;
}

/**
 * Sends pending outbox emails, tenant by tenant under row-level security.
 * Retries up to 5 times; failures are recorded on the row.
 */
export async function deliverOutbox(prisma: PrismaClient, mailer: Mailer, batch = 50): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const tenantId of await tenantIds(prisma)) {
    const pending = await withTenant(
      tenantId,
      (tx) => tx.emailOutbox.findMany({ where: { sentAt: null, attempts: { lt: 5 } }, orderBy: { createdAt: 'asc' }, take: batch }),
      { prisma },
    );
    for (const m of pending) {
      let error: string | null = null;
      try {
        const { subject, text } = renderEmail(m.template, m.locale, m.params as Params);
        await mailer.send({ to: m.toEmail, subject, text });
        sent++;
      } catch (err) {
        error = String(err instanceof Error ? err.message : err).slice(0, 500);
        failed++;
      }
      await withTenant(
        tenantId,
        (tx) => tx.emailOutbox.update({ where: { id: m.id }, data: error ? { attempts: { increment: 1 }, lastError: error } : { sentAt: new Date(), attempts: { increment: 1 } } }),
        { prisma },
      );
    }
  }
  return { sent, failed };
}
