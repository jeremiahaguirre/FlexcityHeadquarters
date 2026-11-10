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
import type { PrismaClient } from '@prisma/client';
import { config } from '../../config.js';
import { tenantIds, withTenant } from '../../lib/db.js';

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
  shift_urgent: {
    'en-CA': (p) => `FH: an open ${s(p.position)} shift at ${s(p.facility)} starts ${when(p, 'en-CA')}. Open the shift board in FH to take it.`,
    'fr-CA': (p) => `FH : un quart libre de ${s(p.position)} à ${s(p.facility)} commence ${when(p, 'fr-CA')}. Ouvrez le tableau des quarts dans FH pour le prendre.`,
  },
};

export const hasSmsTemplate = (t: string) => t in TEMPLATES;

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

/** Sends pending texts and calls, tenant by tenant. Up to 5 tries; contents dropped once sent or given up on. */
export async function deliverSms(prisma: PrismaClient, sender: SmsSender, batch = 50): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const tenantId of await tenantIds(prisma)) {
    const pending = await withTenant(tenantId, (tx) => tx.smsOutbox.findMany({ where: { sentAt: null, attempts: { lt: 5 } }, orderBy: { createdAt: 'asc' }, take: batch }), { prisma });
    for (const m of pending) {
      let error: string | null = null;
      try {
        const body = renderSms(m.template, m.locale, m.params as Params);
        if (m.kind === 'CALL') await sender.call(m.toPhone, body, m.locale);
        else await sender.text(m.toPhone, body);
        sent++;
      } catch (err) {
        error = String(err instanceof Error ? err.message : err).slice(0, 500);
        failed++;
      }
      await withTenant(
        tenantId,
        (tx) =>
          tx.smsOutbox.update({
            where: { id: m.id },
            data: error ? { attempts: { increment: 1 }, lastError: error, ...(m.attempts + 1 >= 5 ? { params: {} } : {}) } : { sentAt: new Date(), attempts: { increment: 1 }, params: {}, lastError: null },
          }),
        { prisma },
      );
    }
  }
  return { sent, failed };
}
