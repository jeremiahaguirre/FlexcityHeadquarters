/**
 * Email delivery from the outbox. Templates are bilingual; the recipient's
 * locale picks the language.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { tenantIds, withTenant } from '../../lib/db.js';
import { maskEmail } from '../../lib/log.js';
import { emailHtml } from './emailHtml.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  /** The branded HTML version of the same message. */
  html?: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/**
 * Development / test transport: notes the send instead of sending. It never
 * prints the message: subjects and bodies carry names, children's names and
 * sign-in links (which would let a log reader into the account). A developer
 * on their own machine can opt in with MAIL_LOG_BODY=1; production never does.
 */
export class ConsoleMailer implements Mailer {
  sent: Mail[] = [];
  constructor(private readonly quiet = false) {}
  async send(mail: Mail) {
    this.sent.push(mail);
    if (this.quiet) return;
    const local = process.env.MAIL_LOG_BODY === '1' && process.env.NODE_ENV !== 'production';
    console.log(local ? `[mail] to=${mail.to} subject="${mail.subject}"\n${mail.text}\n` : `[mail] to=${maskEmail(mail.to)} (${mail.text.length} characters, contents not logged)`);
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
  bank_changed: {
    'en-CA': (p) => ({ subject: 'Your direct deposit details were changed', text: `New banking details ending in ${p.last4} were added for your pay. They'll be used once payroll verifies them.\n\nIf you didn't make this change, tell your payroll or HR office right away.` }),
    'fr-CA': (p) => ({ subject: 'Vos renseignements de dépôt direct ont été modifiés', text: `De nouveaux renseignements bancaires se terminant par ${p.last4} ont été ajoutés pour votre paie. Ils seront utilisés une fois vérifiés par la paie.\n\nSi vous n'avez pas fait ce changement, avisez immédiatement la paie ou les RH.` }),
  },
  bank_active: {
    'en-CA': (p) => ({ subject: 'Direct deposit set up', text: `Your pay will now be deposited to the account ending in ${p.last4}.\n\nIf you didn't ask for this, tell your payroll or HR office right away.` }),
    'fr-CA': (p) => ({ subject: 'Dépôt direct en place', text: `Votre paie sera maintenant déposée dans le compte se terminant par ${p.last4}.\n\nSi vous n'avez pas demandé ce changement, avisez immédiatement la paie ou les RH.` }),
  },
  bank_rejected: {
    'en-CA': (p) => ({ subject: 'Direct deposit details not accepted', text: `Payroll couldn't verify the account ending in ${p.last4}. Your pay continues to go where it did before. Check the details in the app or contact payroll:\n${APP_URL()}/pay` }),
    'fr-CA': (p) => ({ subject: 'Renseignements de dépôt direct refusés', text: `La paie n'a pas pu vérifier le compte se terminant par ${p.last4}. Votre paie continue d'être versée comme avant. Vérifiez les renseignements dans l'application ou communiquez avec la paie :\n${APP_URL()}/pay` }),
  },
  pay_statement_ready: {
    'en-CA': (p) => ({ subject: `Your pay statement for ${p.payDate}`, text: `Your pay statement for ${p.payDate} is ready in the app:\n${APP_URL()}/pay` }),
    'fr-CA': (p) => ({ subject: `Votre relevé de paie du ${p.payDate}`, text: `Votre relevé de paie du ${p.payDate} est prêt dans l'application :\n${APP_URL()}/pay` }),
  },
  report_ready: {
    'en-CA': (p) => ({ subject: `Report: ${p.name} (${p.from} to ${p.to})`, text: `${p.name}, ${p.from} to ${p.to}: ${p.count} row(s).\n\n${p.preview}\n\nOpen the full report and download it as a spreadsheet:\n${APP_URL()}/manage/reports` }),
    'fr-CA': (p) => ({ subject: `Rapport : ${p.name} (du ${p.from} au ${p.to})`, text: `${p.name}, du ${p.from} au ${p.to} : ${p.count} ligne(s).\n\n${p.preview}\n\nOuvrez le rapport complet et téléchargez-le en tableur :\n${APP_URL()}/manage/reports` }),
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
  data_export_ready: {
    'en-CA': (p) => ({
      subject: `Download ${p.organization}'s data from FlexcityHeadquarters`,
      text: `${p.organization}'s FlexcityHeadquarters account is closed. Administrators can still sign in, only to download a complete export of your data (staff records, schedules, time, payroll, incidents, documents), until ${p.until}. After that date it is deleted.\n${p.url}`,
    }),
    'fr-CA': (p) => ({
      subject: `Téléchargez les données de ${p.organization} de FlexcityHeadquarters`,
      text: `Le compte FlexcityHeadquarters de ${p.organization} est fermé. Les administrateurs peuvent encore se connecter, seulement pour télécharger une exportation complète de vos données (dossiers du personnel, horaires, temps, paie, incidents, documents), jusqu’au ${p.until}. Après cette date, elles sont supprimées.\n${p.url}`,
    }),
  },
  webhook_disabled: {
    'en-CA': (p) => ({
      subject: 'A webhook was turned off after repeated failures',
      text: `FlexcityHeadquarters couldn't deliver events to ${p.host} (${p.failures} tries in a row failed), so the webhook was turned off. Check the receiving system, then turn it back on in Settings › Integrations. Missed events can be sent again from the deliveries list.\n${APP_URL()}/manage/settings?tab=integrations`,
    }),
    'fr-CA': (p) => ({
      subject: 'Un webhook a été désactivé après des échecs répétés',
      text: `FlexcityHeadquarters n’a pas pu livrer d’événements à ${p.host} (${p.failures} essais de suite ont échoué); le webhook a donc été désactivé. Vérifiez le système qui les reçoit, puis réactivez-le dans Paramètres › Intégrations. Les événements manqués peuvent être renvoyés depuis la liste des livraisons.\n${APP_URL()}/manage/settings?tab=integrations`,
    }),
  },
  sso_changed: {
    'en-CA': () => ({
      subject: 'Single sign-on settings were changed',
      text: `Someone changed how your organization signs in to FlexcityHeadquarters (single sign-on). If this wasn't planned, review it now in Settings and check the audit log.`,
    }),
    'fr-CA': () => ({
      subject: 'Les paramètres d’authentification unique ont été modifiés',
      text: `Quelqu’un a modifié la façon dont votre organisation se connecte à FlexcityHeadquarters (authentification unique). Si ce n’était pas prévu, vérifiez-le maintenant dans les paramètres et consultez le journal d’audit.`,
    }),
  },
  email_changed: {
    'en-CA': (p) => ({
      subject: 'Your FlexcityHeadquarters sign-in email was changed',
      text: `Your organization changed the email you sign in with to ${p.newEmail}, and signed you out everywhere. If you didn't expect this, contact your HR department right away.`,
    }),
    'fr-CA': (p) => ({
      subject: 'Votre courriel de connexion FlexcityHeadquarters a été modifié',
      text: `Votre organisation a remplacé le courriel avec lequel vous vous connectez par ${p.newEmail}, et vous a déconnecté partout. Si vous ne vous y attendiez pas, communiquez sans tarder avec vos RH.`,
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
      text: `Hello ${p.organization},\n\nInvoice ${p.number} for ${p.period} is ${p.total}, due ${p.dueDate}.\n\n${p.padAccount ? `Under your pre-authorized debit agreement, ${p.total} will be debited from account ${p.padAccount} on or after ${p.dueDate}. Nothing else to do.` : p.remittance}\n\nQuestions about this invoice: ${p.contact}`,
    }),
    'fr-CA': (p) => ({
      subject: `Facture ${p.number} de ${p.from} : ${p.total}`,
      text: `Bonjour ${p.organization},\n\nLa facture ${p.number} pour la période du ${p.period} s'élève à ${p.total}, payable au plus tard le ${p.dueDate}.\n\n${p.padAccount ? `Selon votre entente de débit préautorisé, ${p.total} sera prélevé du compte ${p.padAccount} à compter du ${p.dueDate}. Vous n'avez rien d'autre à faire.` : p.remittance}\n\nQuestions sur cette facture : ${p.contact}`,
    }),
  },
  pad_confirmation: {
    'en-CA': (p) => ({
      subject: `Pre-authorized debit agreement confirmed: ${p.payee}`,
      text: `This confirms the business pre-authorized debit agreement between ${p.payor} and ${p.payee}, authorized on ${p.date} by ${p.signer}.\n\nAccount: ${p.account}\n\n${p.terms}\n\nKeep this email for your records. To change or cancel the agreement: ${p.contact}`,
    }),
    'fr-CA': (p) => ({
      subject: `Entente de débit préautorisé confirmée : ${p.payee}`,
      text: `Ceci confirme l'entente de débit préautorisé d'entreprise entre ${p.payor} et ${p.payee}, autorisée le ${p.date} par ${p.signer}.\n\nCompte : ${p.account}\n\n${p.terms}\n\nConservez ce courriel dans vos dossiers. Pour modifier ou annuler l'entente : ${p.contact}`,
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

/** Emails that go with a safety alert (services/notifications/sms.ts SAFETY_TEMPLATES): sent first. */
const SAFETY_EMAILS = ['lonework_escalated', 'lonework_help', 'callout_offer'];
const RETRY_AT_KEY = '_retryAt';
/** After the nth failure: 1, 2, 4, 8 minutes. */
const emailRetryMs = (failures: number) => 60_000 * 2 ** Math.min(Math.max(failures - 1, 0), 3);

/**
 * Sends one organization's due emails, safety alerts first, under row-level security. Each one is
 * claimed with `FOR UPDATE SKIP LOCKED` and sent while the row lock is held, so the API process
 * that queued it (straight after its commit) and the worker never both send it. Retries up to 5
 * times with a growing wait; failures are recorded on the row.
 */
export async function deliverEmailTenant(tenantId: string, mailer: Mailer, opts: { prisma?: PrismaClient; limit?: number } = {}): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  const safety = Prisma.join(SAFETY_EMAILS);
  for (let i = 0; i < (opts.limit ?? 50); i++) {
    const r = await withTenant(
      tenantId,
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string; toEmail: string; template: string; params: Params; locale: string; attempts: number }>>`
          SELECT id, "toEmail", template, params, locale, attempts FROM "EmailOutbox"
           WHERE "sentAt" IS NULL AND attempts < 5
             AND (params->>${RETRY_AT_KEY} IS NULL OR (params->>${RETRY_AT_KEY})::timestamptz <= now())
           ORDER BY CASE WHEN template IN (${safety}) THEN 0 ELSE 1 END, "createdAt"
           LIMIT 1 FOR UPDATE SKIP LOCKED`;
        const m = rows[0];
        if (!m) return null;
        let error: string | null = null;
        try {
          const { subject, text } = renderEmail(m.template, m.locale, m.params);
          await mailer.send({ to: m.toEmail, subject, text, html: emailHtml(subject, text, m.locale) });
        } catch (err) {
          error = String(err instanceof Error ? err.message : err).slice(0, 500);
        }
        const attempts = m.attempts + 1;
        // Once sent (or given up on), the message's contents are dropped: sign-in links and names
        // shouldn't sit in the database where anyone with database access could read them.
        await tx.emailOutbox.update({
          where: { id: m.id },
          data: error
            ? { attempts, lastError: error, params: attempts >= 5 ? {} : ({ ...m.params, [RETRY_AT_KEY]: new Date(Date.now() + emailRetryMs(attempts)).toISOString() } as Prisma.InputJsonValue) }
            : { sentAt: new Date(), attempts, params: {}, lastError: null },
        });
        return error ? 'failed' : 'sent';
      },
      { prisma: opts.prisma, timeoutMs: 30_000 },
    );
    if (!r) break;
    if (r === 'sent') sent++;
    else failed++;
  }
  return { sent, failed };
}

/** Every organization's due emails (the worker, every minute). */
export async function deliverOutbox(prisma: PrismaClient, mailer: Mailer, batch = 50): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const tenantId of await tenantIds(prisma)) {
    const r = await deliverEmailTenant(tenantId, mailer, { prisma, limit: batch });
    sent += r.sent;
    failed += r.failed;
  }
  return { sent, failed };
}
