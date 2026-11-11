/**
 * Texts and voice calls for the few alerts that can't wait for someone to open
 * the app: a missed working-alone check-in, a call for help, a winter call-out,
 * an open shift starting soon. Only for organizations that turn text alerts on,
 * and only to people who confirmed their mobile number with a texted code.
 *
 * Messages carry no links (people are taught not to tap links in texts) and as
 * little personal information as the alert needs. Calls read the same words
 * twice. Bodies are rendered when sent; the params are dropped afterwards.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { config } from '../../config.js';
import { tenantIds, withTenant } from '../../lib/db.js';
import { captureError } from '../../lib/errorReporter.js';
import { smsQueueToSent, smsSends } from '../../lib/metrics.js';

type Params = Record<string, unknown>;
type Render = (p: Params) => string;
const s = (v: unknown) => String(v ?? '');
/** "Sat, Nov 14, 6:00 a.m." in the facility's time zone. */
const when = (p: Params, locale: string) =>
  new Date(s(p.startsAt)).toLocaleString(locale, { timeZone: s(p.tz) || 'America/Vancouver', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const TEMPLATES: Record<string, { 'en-CA': Render; 'fr-CA': Render }> = {
  sms_verify: {
    'en-CA': (p) => `FlexcityHeadquarters: your code is ${s(p.code)}. It expires in 10 minutes.`,
    'fr-CA': (p) => `FlexcityHeadquarters : votre code est ${s(p.code)}. Il expire dans 10 minutes.`,
  },
  // A sign-in code (second factor). Straight apostrophes (and only GSM accents) keep it a plain text.
  mfa_code: {
    'en-CA': (p) => `FlexcityHeadquarters: ${s(p.code)} is your sign-in code for ${s(p.organization)}. It expires in 10 minutes. Don't share it. Not you? Change your password now.`,
    'fr-CA': (p) => `FlexcityHeadquarters : ${s(p.code)} est votre code de connexion pour ${s(p.organization)}. Il expire dans 10 minutes. Ne le donnez à personne. Ce n'était pas vous? Changez votre mot de passe maintenant.`,
  },
  lonework_check_in_now: {
    'en-CA': (p) => `FH: you missed your working-alone check-in at ${s(p.location)}. Open FH and check in now.`,
    'fr-CA': (p) => `FH : vous avez manqué votre vérification de travail isolé à ${s(p.location)}. Ouvrez FH et confirmez maintenant.`,
  },
  lonework_overdue: {
    'en-CA': (p) => `FH: ${s(p.name)} missed a working-alone check-in at ${s(p.location)}. Call them now.`,
    'fr-CA': (p) => `FH : ${s(p.name)} a manqué une vérification de travail isolé à ${s(p.location)}. Appelez cette personne maintenant.`,
  },
  lonework_escalated: {
    'en-CA': (p) => `URGENT, FlexcityHeadquarters. ${s(p.name)} has not checked in while working alone at ${s(p.location)}. Call them now, and send someone if you can't reach them.`,
    'fr-CA': (p) => `URGENT, FlexcityHeadquarters. ${s(p.name)} ne s'est pas manifesté en travaillant seul à ${s(p.location)}. Appelez cette personne maintenant, et envoyez quelqu'un si vous ne la joignez pas.`,
  },
  lonework_help: {
    'en-CA': (p) => `URGENT, FlexcityHeadquarters. ${s(p.name)} asked for help while working alone at ${s(p.location)}. ${p.note ? `They said: ${s(p.note)}. ` : ''}Respond now.`,
    'fr-CA': (p) => `URGENT, FlexcityHeadquarters. ${s(p.name)} demande de l'aide en travaillant seul à ${s(p.location)}. ${p.note ? `Message : ${s(p.note)}. ` : ''}Intervenez maintenant.`,
  },
  callout_offer: {
    'en-CA': (p) => `FH call-out: ${s(p.reason)} at ${s(p.facility)}. You're next in line. Answer in FH within ${s(p.minutes)} minutes.`,
    'fr-CA': (p) => `FH, rappel au travail : ${s(p.reason)} à ${s(p.facility)}. Vous êtes le prochain sur la liste. Répondez dans FH d'ici ${s(p.minutes)} minutes.`,
  },
  callback_requested: {
    'en-CA': (p) => `FH call-back: you're called back in (${s(p.reason)}). Open FH for the details.`,
    'fr-CA': (p) => `FH, rappel : vous êtes rappelé au travail (${s(p.reason)}). Ouvrez FH pour les détails.`,
  },
  shift_urgent: {
    'en-CA': (p) => `FH: an open ${s(p.position)} shift at ${s(p.facility)} starts ${when(p, 'en-CA')}. Open the shift board in FH to take it.`,
    'fr-CA': (p) => `FH : un quart libre de ${s(p.position)} à ${s(p.facility)} commence ${when(p, 'fr-CA')}. Ouvrez le tableau des quarts dans FH pour le prendre.`,
  },
};

export function renderSms(template: string, locale: string, params: Params): string {
  const t = TEMPLATES[template];
  if (!t) throw new Error(`Unknown text template: ${template}`);
  return (locale.startsWith('fr') ? t['fr-CA'] : t['en-CA'])(params);
}

/** North American numbers only for now: 10 digits, or 11 starting with 1. */
export function toE164(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  if (d.length === 10 && /^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1') && /^[2-9]\d{2}[2-9]\d{6}$/.test(d.slice(1))) return `+${d}`;
  return null;
}

export const maskPhone = (e164: string) => `•••-•••-${e164.slice(-4)}`;

export interface SmsSender {
  text(to: string, body: string): Promise<void>;
  call(to: string, words: string, locale: string): Promise<void>;
}

export class ConsoleSms implements SmsSender {
  sent: Array<{ kind: 'TEXT' | 'CALL'; to: string; body: string }> = [];
  constructor(private readonly quiet = false) {}
  async text(to: string, body: string) {
    this.sent.push({ kind: 'TEXT', to, body });
    if (!this.quiet) console.log(`[sms] to=${maskPhone(to)} (${body.length} characters, contents not logged)`);
  }
  async call(to: string, words: string) {
    this.sent.push({ kind: 'CALL', to, body: words });
    if (!this.quiet) console.log(`[call] to=${maskPhone(to)} (${words.length} characters, contents not logged)`);
  }
}

const xml = (v: string) => v.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

/** Twilio's Messages and Calls APIs. The call reads the message twice, in the person's language. */
export class TwilioSms implements SmsSender {
  constructor(private readonly sid: string, private readonly token: string, private readonly from: string, private readonly fetchImpl: typeof fetch = fetch) {}
  private async post(path: string, form: Record<string, string>) {
    const r = await this.fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.sid)}/${path}`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${this.sid}:${this.token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`Twilio ${path} answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  text(to: string, body: string) {
    return this.post('Messages.json', { To: to, From: this.from, Body: body });
  }
  call(to: string, words: string, locale: string) {
    const lang = locale.startsWith('fr') ? 'fr-CA' : 'en-CA';
    const say = `<Say language="${lang}">${xml(words)}</Say><Pause length="1"/>`;
    return this.post('Calls.json', { To: to, From: this.from, Twiml: `<Response>${say}${say}</Response>` });
  }
}

export function smsSender(): SmsSender {
  const c = config();
  if (c.SMS_PROVIDER === 'twilio') {
    if (!c.TWILIO_ACCOUNT_SID || !c.TWILIO_AUTH_TOKEN || !c.SMS_FROM) throw new Error('SMS_PROVIDER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and SMS_FROM.');
    return new TwilioSms(c.TWILIO_ACCOUNT_SID, c.TWILIO_AUTH_TOKEN, c.SMS_FROM);
  }
  return new ConsoleSms();
}

/**
 * Safety alerts: someone may be hurt or alone without help. They go out first, retry soon after a
 * failure, and raise an alert when still unsent after SAFETY_SMS_ALERT_S (services/notifications/
 * urgent.ts). Keep in step with the list in db/rls.sql (outbox_backlog, safety_sms_overdue).
 */
export const SAFETY_TEMPLATES: readonly string[] = ['lonework_check_in_now', 'lonework_overdue', 'lonework_escalated', 'lonework_help', 'callout_offer'];
export const isSafetyTemplate = (t: string) => SAFETY_TEMPLATES.includes(t);
/** Codes the person is waiting for right now (confirming a number, signing in): sent right after safety alerts. */
export const CODE_TEMPLATES: readonly string[] = ['sms_verify', 'mfa_code'];
export const SMS_MAX_ATTEMPTS = 5;
/** Wait before the next try after the nth failure: short for safety alerts, longer for the rest. */
const SAFETY_RETRY_S = [15, 30, 60, 120];
const OTHER_RETRY_S = [60, 120, 300, 600];
export const smsRetryDelayMs = (safety: boolean, failures: number) => {
  const steps = safety ? SAFETY_RETRY_S : OTHER_RETRY_S;
  return steps[Math.min(Math.max(failures, 1), steps.length) - 1]! * 1000;
};
/**
 * The next try's time is kept in the row's params (there is no column for it): params are only
 * read to render the message, and they are dropped once it is sent or given up on.
 */
export const RETRY_AT_KEY = '_retryAt';

export interface DeliveryResult {
  sent: number;
  failed: number;
  /** When the soonest retry of a failed message is due (ms from now), if any. */
  retryInMs: number | null;
}

interface ClaimedSms {
  id: string;
  toPhone: string;
  kind: 'TEXT' | 'CALL';
  template: string;
  params: Params;
  locale: string;
  attempts: number;
  createdAt: Date;
}

const errorText = (err: unknown) => String(err instanceof Error ? err.message : err).slice(0, 500);

/**
 * Sends one organization's due texts and calls: safety alerts first, then sign-in codes, then the
 * rest; oldest first within each.
 *
 * Each message is claimed with `SELECT … FOR UPDATE SKIP LOCKED` in its own transaction, sent while
 * that row lock is held, and marked sent before the commit. Any number of processes (the API that
 * queued it, right after its commit; the worker, on a pg_notify or its sweep) can run this at once:
 * a message another one holds is skipped, never sent twice. If the process dies between the
 * provider accepting a message and the commit, the message is sent again later: at least once,
 * as for the event outbox. (Twilio's Messages and Calls APIs take no idempotency key, so the row
 * lock is the guard.)
 */
export async function deliverSmsTenant(tenantId: string, sender: SmsSender, opts: { prisma?: PrismaClient; limit?: number } = {}): Promise<DeliveryResult> {
  const out: DeliveryResult = { sent: 0, failed: 0, retryInMs: null };
  const safety = Prisma.join(SAFETY_TEMPLATES);
  const codes = Prisma.join(CODE_TEMPLATES);
  for (let i = 0; i < (opts.limit ?? 50); i++) {
    const r = await withTenant(
      tenantId,
      async (tx) => {
        const rows = await tx.$queryRaw<ClaimedSms[]>`
          SELECT id, "toPhone", kind::text AS kind, template, params, locale, attempts, "createdAt" FROM "SmsOutbox"
           WHERE "tenantId" = ${tenantId}::uuid AND "sentAt" IS NULL AND attempts < ${SMS_MAX_ATTEMPTS}
             AND (params->>${RETRY_AT_KEY} IS NULL OR (params->>${RETRY_AT_KEY})::timestamptz <= now())
           ORDER BY CASE WHEN template IN (${safety}) THEN 0 WHEN template IN (${codes}) THEN 1 ELSE 2 END,
                    "createdAt", CASE WHEN kind = 'CALL' THEN 0 ELSE 1 END
           LIMIT 1 FOR UPDATE SKIP LOCKED`;
        const m = rows[0];
        if (!m) return null;
        const isSafety = isSafetyTemplate(m.template);
        const priority = isSafety ? 'safety' : 'other';
        let error: string | null = null;
        try {
          const body = renderSms(m.template, m.locale, m.params);
          if (m.kind === 'CALL') await sender.call(m.toPhone, body, m.locale);
          else await sender.text(m.toPhone, body);
        } catch (err) {
          error = errorText(err);
        }
        const now = new Date();
        if (!error) {
          await tx.smsOutbox.update({ where: { id: m.id }, data: { sentAt: now, attempts: m.attempts + 1, params: {}, lastError: null } });
          smsQueueToSent.observe({ priority, kind: m.kind }, Math.max(0, now.getTime() - new Date(m.createdAt).getTime()) / 1000);
          smsSends.inc({ priority, outcome: 'sent' });
          return { sent: true, retryInMs: null };
        }
        const attempts = m.attempts + 1;
        const gaveUp = attempts >= SMS_MAX_ATTEMPTS;
        const wait = smsRetryDelayMs(isSafety, attempts);
        await tx.smsOutbox.update({
          where: { id: m.id },
          data: { attempts, lastError: error, params: gaveUp ? {} : ({ ...m.params, [RETRY_AT_KEY]: new Date(now.getTime() + wait).toISOString() } as Prisma.InputJsonValue) },
        });
        smsSends.inc({ priority, outcome: gaveUp ? 'gave_up' : 'retry' });
        // Ids and the template only: never the number or the words.
        if (gaveUp) captureError(new Error(`${isSafety ? 'Safety text' : 'Text'} (${m.template}, ${m.kind}) not sent after ${attempts} attempts`), { source: 'job', tenantId, tags: { task: 'sms', template: m.template } });
        return { sent: false, retryInMs: gaveUp ? null : wait };
      },
      { prisma: opts.prisma, timeoutMs: 30_000 },
    );
    if (!r) break;
    if (r.sent) out.sent++;
    else out.failed++;
    if (r.retryInMs !== null) out.retryInMs = Math.min(out.retryInMs ?? Infinity, r.retryInMs);
  }
  return out;
}

/** Every organization's due texts and calls (the worker's backstop). Up to 5 tries; contents dropped once sent or given up on. */
export async function deliverSms(prisma: PrismaClient, sender: SmsSender, batch = 50): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const tenantId of await tenantIds(prisma)) {
    const r = await deliverSmsTenant(tenantId, sender, { prisma, limit: batch });
    sent += r.sent;
    failed += r.failed;
  }
  return { sent, failed };
}
