/**
 * Push notifications to phones and computers (Web Push with VAPID).
 *
 * Each in-app notification is also pushed to the person's devices, once. The message is
 * encrypted end to end for the device (the push service can't read it), and what appears on
 * a lock screen is deliberately short: for sensitive kinds (discipline, care, accommodation,
 * banking, documents) only "You have a new message", never details.
 */
import { Prisma, type Notification, type PushSubscription } from '@prisma/client';
import webpush from 'web-push';
import { config } from '../../config.js';
import type { Tx } from '../../lib/db.js';
import { logError } from '../../lib/log.js';

export function pushEnabled(): boolean {
  const c = config();
  return !!(c.VAPID_PUBLIC_KEY && c.VAPID_PRIVATE_KEY);
}

let configured = false;
function setup() {
  if (configured) return;
  const c = config();
  webpush.setVapidDetails(c.VAPID_SUBJECT, c.VAPID_PUBLIC_KEY!, c.VAPID_PRIVATE_KEY!);
  configured = true;
}

type Lang = 'en' | 'fr';
/** Title and body per kind of notification. Sensitive kinds say only that there's something new. */
const TEXT: Record<string, Record<Lang, [string, string]>> = {
  lonework_check_in_now: { en: ['Check in now', 'Your working-alone check-in is due. Tap to check in.'], fr: ['Vérification maintenant', 'Votre vérification de travail seul est due. Touchez pour la faire.'] },
  lonework_due_soon: { en: ['Check-in due soon', 'Your working-alone check-in is due in 5 minutes.'], fr: ['Vérification bientôt', 'Votre vérification de travail seul est due dans 5 minutes.'] },
  lonework_overdue: { en: ['Missed check-in', 'Someone working alone missed a check-in.'], fr: ['Vérification manquée', 'Une personne qui travaille seule a manqué une vérification.'] },
  lonework_escalated: { en: ['URGENT: no response', 'Someone working alone hasn’t answered. Act now.'], fr: ['URGENT : aucune réponse', 'Une personne qui travaille seule ne répond pas. Intervenez maintenant.'] },
  lonework_help: { en: ['URGENT: help requested', 'Someone working alone asked for help.'], fr: ['URGENT : demande d’aide', 'Une personne qui travaille seule demande de l’aide.'] },
  lonework_responding: { en: ['Help is on the way', 'Someone is responding to your alert.'], fr: ['L’aide arrive', 'Quelqu’un répond à votre alerte.'] },
  shift_available: { en: ['Shift available', 'A shift you can work is open on the board.'], fr: ['Quart offert', 'Un quart que vous pouvez faire est offert.'] },
  shift_assigned: { en: ['New shift', 'You’ve been scheduled for a shift.'], fr: ['Nouveau quart', 'Un quart vous a été attribué.'] },
  shift_changed: { en: ['Shift changed', 'One of your shifts changed.'], fr: ['Quart modifié', 'Un de vos quarts a changé.'] },
  schedule_late_change: { en: ['Late schedule change', 'Your schedule changed on short notice.'], fr: ['Changement d’horaire tardif', 'Votre horaire a changé à court préavis.'] },
  oncall_assigned: { en: ['On call', 'You’ve been put on the on-call roster.'], fr: ['De garde', 'Vous avez été inscrit au tableau de garde.'] },
  oncall_changed: { en: ['On-call change', 'Your on-call period changed.'], fr: ['Garde modifiée', 'Votre période de garde a changé.'] },
  callback_requested: { en: ['Call-back', 'You’re called back in. Open the app.'], fr: ['Rappel au travail', 'Vous êtes rappelé au travail. Ouvrez l’application.'] },
  callback_rest: { en: ['Rest after call-back', 'Someone called back may not get the rest required.'], fr: ['Repos après rappel', 'Une personne rappelée pourrait ne pas avoir le repos requis.'] },
  shift_cancelled: { en: ['Shift cancelled', 'One of your shifts was cancelled.'], fr: ['Quart annulé', 'Un de vos quarts a été annulé.'] },
  schedule_published: { en: ['Schedule published', 'Your new schedule is ready.'], fr: ['Horaire publié', 'Votre nouvel horaire est prêt.'] },
  claim_needs_approval: { en: ['Claim to approve', 'A shift claim is waiting for your decision.'], fr: ['Demande à approuver', 'Une demande de quart attend votre décision.'] },
  time_off_requested: { en: ['Time off to review', 'A time-off request is waiting for your decision.'], fr: ['Congé à examiner', 'Une demande de congé attend votre décision.'] },
  time_off_decided: { en: ['Time off decided', 'Your time-off request has an answer.'], fr: ['Congé : décision', 'Votre demande de congé a une réponse.'] },
  forgot_clock_out: { en: ['Still clocked in?', 'You haven’t clocked out yet.'], fr: ['Toujours pointé?', 'Vous n’avez pas encore pointé votre départ.'] },
  pay_statement_ready: { en: ['Pay statement ready', 'Your pay statement is in the app.'], fr: ['Relevé de paie prêt', 'Votre relevé de paie est dans l’application.'] },
  callout_offer: { en: ['Call-out', 'You’re being called out. Tap to answer.'], fr: ['Rappel au travail', 'On vous rappelle au travail. Touchez pour répondre.'] },
  coverage_gap: { en: ['Coverage gap', 'A required certificate isn’t on duty.'], fr: ['Manque de couverture', 'Un certificat requis n’est pas en service.'] },
  closure_recommended: { en: ['Closure recommended', 'A water reading calls for a closure.'], fr: ['Fermeture recommandée', 'Une lecture d’eau exige une fermeture.'] },
  front_desk_page: { en: ['Front desk', 'The front desk is calling for you.'], fr: ['Accueil', 'L’accueil vous demande.'] },
  webhook_disabled: { en: ['Webhook turned off', 'A webhook kept failing and was turned off.'], fr: ['Webhook désactivé', 'Un webhook échouait sans cesse et a été désactivé.'] },
};
const GENERIC: Record<Lang, [string, string]> = { en: ['FlexcityHeadquarters', 'You have a new message.'], fr: ['FlexcityHeadquarters', 'Vous avez un nouveau message.'] };
/** Pushed with high urgency, first, and straight after the commit (services/notifications/urgent.ts). */
export const URGENT = new Set(['lonework_help', 'lonework_escalated', 'lonework_overdue', 'lonework_check_in_now', 'callout_offer', 'closure_recommended']);

export function pushPayload(n: Pick<Notification, 'id' | 'type' | 'link'>, locale: string) {
  const lang: Lang = locale.startsWith('fr') ? 'fr' : 'en';
  const [title, body] = TEXT[n.type]?.[lang] ?? GENERIC[lang];
  return { id: n.id, title, body, link: n.link ?? '/', urgent: URGENT.has(n.type), tag: n.type };
}

/**
 * Sends each recent, not-yet-pushed notification to its person's devices: safety alerts first.
 * Runs every minute in the worker, and straight after the commit for urgent kinds
 * (services/notifications/urgent.ts). Notifications older than 15 minutes are marked and skipped
 * (a stale alert helps no one). Devices the push service says are gone are forgotten.
 *
 * Notifications are claimed with `FOR UPDATE SKIP LOCKED` and marked pushed in the same
 * transaction, so two runs at once (the API process and the worker) never push one twice.
 */
export async function deliverPush(tx: Tx, now = new Date()): Promise<number> {
  if (!pushEnabled()) return 0;
  setup();
  const fresh = new Date(now.getTime() - 15 * 60_000);
  await tx.$executeRaw`
    UPDATE "Notification" SET "pushedAt" = ${now}
     WHERE id IN (SELECT id FROM "Notification" WHERE "pushedAt" IS NULL AND "createdAt" < ${fresh} FOR UPDATE SKIP LOCKED)`;
  const urgent = Prisma.join([...URGENT]);
  const claimed = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Notification" WHERE "pushedAt" IS NULL
     ORDER BY CASE WHEN type IN (${urgent}) THEN 0 ELSE 1 END, "createdAt"
     LIMIT 200 FOR UPDATE SKIP LOCKED`;
  if (!claimed.length) return 0;
  const order = new Map(claimed.map((c, i) => [c.id, i]));
  const due = (await tx.notification.findMany({ where: { id: { in: claimed.map((c) => c.id) } } })).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const userIds = [...new Set(due.map((n) => n.userId))];
  const [subs, people] = await Promise.all([
    tx.pushSubscription.findMany({ where: { userId: { in: userIds } } }),
    tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, locale: true, status: true } }),
  ]);
  let sent = 0;
  for (const n of due) {
    const person = people.find((p) => p.id === n.userId);
    const devices = person?.status === 'ACTIVE' ? subs.filter((s) => s.userId === n.userId) : [];
    for (const d of devices) sent += (await sendOne(tx, d, pushPayload(n, person!.locale))) ? 1 : 0;
    await tx.notification.update({ where: { id: n.id }, data: { pushedAt: now } });
  }
  return sent;
}

async function sendOne(tx: Tx, d: PushSubscription, payload: ReturnType<typeof pushPayload>): Promise<boolean> {
  try {
    await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, JSON.stringify(payload), {
      TTL: payload.urgent ? 3600 : 6 * 3600,
      urgency: payload.urgent ? 'high' : 'normal',
      topic: payload.tag.slice(0, 32),
    });
    await tx.pushSubscription.update({ where: { id: d.id }, data: { lastSentAt: new Date(), failures: 0 } });
    return true;
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    // 404/410: the device unsubscribed or the app was removed.
    if (status === 404 || status === 410 || d.failures >= 9) await tx.pushSubscription.delete({ where: { id: d.id } });
    else {
      await tx.pushSubscription.update({ where: { id: d.id }, data: { failures: { increment: 1 } } });
      logError('push delivery failed', new Error(`status ${status ?? 'network'}`));
    }
    return false;
  }
}
