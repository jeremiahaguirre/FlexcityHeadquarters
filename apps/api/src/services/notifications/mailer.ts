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
  injury_report_due: {
    'en-CA': (p) => ({ subject: `Injury report to ${p.board} due`, text: `An employee injury report to ${p.board} is due by ${p.due} and isn't recorded as filed yet.\n${APP_URL()}/manage/injuries` }),
    'fr-CA': (p) => ({ subject: `Déclaration de lésion à ${p.board} à remettre`, text: `Une déclaration de lésion d'un employé à ${p.board} doit être faite d'ici ${p.due} et n'est pas encore inscrite comme envoyée.\n${APP_URL()}/manage/injuries` }),
  },
  vehicle_out_of_service: {
    'en-CA': (p) => ({ subject: `Vehicle ${p.unit} out of service`, text: `A pre-trip inspection found a major defect on unit ${p.unit}: ${p.reason}.\nIt's out of service until a repair is recorded:\n${APP_URL()}/manage/fleet` }),
    'fr-CA': (p) => ({ subject: `Véhicule ${p.unit} hors service`, text: `Une inspection avant départ a relevé une défectuosité majeure sur l'unité ${p.unit} : ${p.reason}.\nIl est hors service jusqu'à ce qu'une réparation soit consignée :\n${APP_URL()}/manage/fleet` }),
  },
  coverage_gap: {
    'en-CA': (p) => ({ subject: `Coverage gap: ${p.rule}`, text: `The schedule doesn't cover "${p.rule}" in the next two days (${p.count} gap${Number(p.count) === 1 ? '' : 's'}). Assign someone who holds the certificate:\n${APP_URL()}/manage/coverage` }),
    'fr-CA': (p) => ({ subject: `Couverture manquante : ${p.rule}`, text: `L'horaire ne couvre pas « ${p.rule} » dans les deux prochains jours (${p.count} trou(s)). Affectez une personne qui détient le certificat :\n${APP_URL()}/manage/coverage` }),
  },
  signup_confirmation: {
    'en-CA': (p) => ({
      subject: `${p.status === 'WAITLISTED' ? 'Waitlist' : 'Registration'} received: ${p.participant} in ${p.set}`,
      text: `Thanks for signing up with ${p.organization}.\n\nReference: ${p.reference}\nParticipant: ${p.participant}\nProgram: ${p.set} (${p.campaign})\nWhen: ${p.when}\nPrice: ${p.price}\n\n${p.status === 'WAITLISTED' ? "The program is full, so you're on the waitlist. We'll contact you if a spot opens; nothing is owed until then." : p.payment || 'We will contact you about payment.'}\n\nQuestions? Contact the facility and quote your reference.`,
    }),
    'fr-CA': (p) => ({
      subject: `${p.status === 'WAITLISTED' ? 'Liste d’attente' : 'Inscription'} reçue : ${p.participant}, ${p.set}`,
      text: `Merci de votre inscription auprès de ${p.organization}.\n\nRéférence : ${p.reference}\nParticipant : ${p.participant}\nProgramme : ${p.set} (${p.campaign})\nQuand : ${p.when}\nPrix : ${p.price}\n\n${p.status === 'WAITLISTED' ? 'Le programme est complet : vous êtes sur la liste d’attente. Nous vous contacterons si une place se libère; rien n’est dû d’ici là.' : p.payment || 'Nous communiquerons avec vous pour le paiement.'}\n\nDes questions? Communiquez avec l’installation en indiquant votre référence.`,
    }),
  },
  booking_received: {
    'en-CA': (p) => ({ subject: `Booking request received: ${p.service}`, text: `We received your request for ${p.service} on ${p.when}.\nReference: ${p.reference}\n\nThis is a request, not a confirmation. Staff will confirm or contact you shortly.` }),
    'fr-CA': (p) => ({ subject: `Demande de réservation reçue : ${p.service}`, text: `Nous avons reçu votre demande pour ${p.service} le ${p.when}.\nRéférence : ${p.reference}\n\nIl s’agit d’une demande, pas d’une confirmation. Le personnel la confirmera ou communiquera avec vous sous peu.` }),
  },
  booking_decided: {
    'en-CA': (p) => ({ subject: `Booking ${p.confirmed ? 'confirmed' : 'not available'}: ${p.service}`, text: `${p.confirmed ? `Your booking for ${p.service} on ${p.when} is confirmed.` : `Sorry, we can't book ${p.service} on ${p.when}.`}\nReference: ${p.reference}${p.note ? `\n\n${p.note}` : ''}` }),
    'fr-CA': (p) => ({ subject: `Réservation ${p.confirmed ? 'confirmée' : 'non disponible'} : ${p.service}`, text: `${p.confirmed ? `Votre réservation pour ${p.service} le ${p.when} est confirmée.` : `Désolés, nous ne pouvons pas réserver ${p.service} le ${p.when}.`}\nRéférence : ${p.reference}${p.note ? `\n\n${p.note}` : ''}` }),
  },
  callout_offer: {
    'en-CA': (p) => ({
      subject: `Call-out: can you work? Answer within ${p.minutes} minutes`,
      text: `${p.reason} at ${p.facility}. You're next in line for this overtime. Answer in the app within ${p.minutes} minutes, or it goes to the next person:\n${APP_URL()}/call-outs`,
    }),
    'fr-CA': (p) => ({
      subject: `Rappel au travail : êtes-vous disponible? Répondez d'ici ${p.minutes} minutes`,
      text: `${p.reason} à ${p.facility}. Vous êtes le prochain sur la liste pour ces heures supplémentaires. Répondez dans l'application d'ici ${p.minutes} minutes, sinon l'offre passe à la personne suivante :\n${APP_URL()}/call-outs`,
    }),
  },
  lonework_escalated: {
    'en-CA': (p) => ({
      subject: `URGENT: ${p.name} hasn't checked in while working alone`,
      text: `${p.name} missed a check-in at ${p.location} and still hasn't answered. Call them now, and send someone if you can't reach them.\n${APP_URL()}/manage/lone-work`,
    }),
    'fr-CA': (p) => ({
      subject: `URGENT : ${p.name} ne s'est pas manifesté en travaillant seul`,
      text: `${p.name} a manqué une vérification à ${p.location} et ne répond toujours pas. Appelez cette personne maintenant et envoyez quelqu'un si vous ne la joignez pas.\n${APP_URL()}/manage/lone-work`,
    }),
  },
  lonework_help: {
    'en-CA': (p) => ({
      subject: `URGENT: ${p.name} asked for help while working alone`,
      text: `${p.name} pressed "I need help" at ${p.location}.${p.note ? ` Note: ${p.note}` : ''} Respond now; call 911 if anyone may be hurt.\n${APP_URL()}/manage/lone-work`,
    }),
    'fr-CA': (p) => ({
      subject: `URGENT : ${p.name} demande de l'aide en travaillant seul`,
      text: `${p.name} a appuyé sur « J'ai besoin d'aide » à ${p.location}.${p.note ? ` Note : ${p.note}` : ''} Intervenez maintenant; composez le 911 si quelqu'un pourrait être blessé.\n${APP_URL()}/manage/lone-work`,
    }),
  },
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
