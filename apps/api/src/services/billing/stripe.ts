/**
 * Online payment through Stripe Checkout, by card or Canadian pre-authorized
 * debit (PAD, "acss_debit"). No card details ever reach our servers: the
 * person pays on Stripe's page and Stripe tells us by webhook.
 *
 * Plain HTTPS calls (no SDK); the keys come from the environment.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../../lib/errors.js';

const key = () => process.env.STRIPE_SECRET_KEY ?? '';
const base = () => process.env.STRIPE_API_BASE ?? 'https://api.stripe.com';
export const onlinePaymentsEnabled = () => key().length > 0;

function form(obj: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) p.append(k, String(v));
  return p.toString();
}

export interface CheckoutInput {
  invoiceId: string;
  tenantId: string;
  number: string;
  amountCents: number;
  email: string;
  method: 'card' | 'pad';
  successUrl: string;
  cancelUrl: string;
  locale: string;
}

export async function createCheckout(i: CheckoutInput): Promise<{ id: string; url: string }> {
  if (!onlinePaymentsEnabled()) throw new HttpError(409, 'ONLINE_PAYMENTS_OFF', 'Online payment isn’t set up. Pay by EFT or cheque.');
  const body = form({
    mode: 'payment',
    'payment_method_types[0]': i.method === 'card' ? 'card' : 'acss_debit',
    ...(i.method === 'pad'
      ? {
          'payment_method_options[acss_debit][currency]': 'cad',
          'payment_method_options[acss_debit][mandate_options][payment_schedule]': 'sporadic',
          'payment_method_options[acss_debit][mandate_options][transaction_type]': 'business',
        }
      : {}),
    'line_items[0][quantity]': 1,
    'line_items[0][price_data][currency]': 'cad',
    'line_items[0][price_data][unit_amount]': i.amountCents,
    'line_items[0][price_data][product_data][name]': `FlexcityHeadquarters invoice ${i.number}`,
    customer_email: i.email,
    client_reference_id: i.invoiceId,
    'metadata[invoiceId]': i.invoiceId,
    'metadata[tenantId]': i.tenantId,
    'payment_intent_data[metadata][invoiceId]': i.invoiceId,
    locale: i.locale.startsWith('fr') ? 'fr-CA' : 'en',
    success_url: i.successUrl,
    cancel_url: i.cancelUrl,
  });
  const r = await fetch(`${base()}/v1/checkout/sessions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key()}`, 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': `${i.invoiceId}:${i.method}:${i.amountCents}:${Math.floor(Date.now() / 600_000)}` },
    body,
  });
  const json = (await r.json().catch(() => ({}))) as { id?: string; url?: string; error?: { message?: string } };
  if (!r.ok || !json.id || !json.url) throw new HttpError(502, 'PAYMENT_PROVIDER', json.error?.message ?? 'The payment page couldn’t be opened. Try again shortly.');
  return { id: json.id, url: json.url };
}

/**
 * Checks Stripe's webhook signature (`t=…,v1=…`, HMAC-SHA256 of "t.payload")
 * and refuses events older than 5 minutes.
 */
export function verifyWebhook(payload: Buffer, header: string | undefined, secret: string, now = Date.now()): unknown {
  if (!header) throw new HttpError(400, 'BAD_SIGNATURE', 'Missing signature');
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
  const t = Number(parts.t);
  const sigs = header.split(',').filter((kv) => kv.startsWith('v1=')).map((kv) => kv.slice(3));
  if (!t || !sigs.length) throw new HttpError(400, 'BAD_SIGNATURE', 'Malformed signature');
  if (Math.abs(now / 1000 - t) > 300) throw new HttpError(400, 'BAD_SIGNATURE', 'Signature too old');
  const expected = createHmac('sha256', secret).update(`${t}.${payload.toString('utf8')}`).digest();
  const ok = sigs.some((s) => {
    const got = Buffer.from(s, 'hex');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  if (!ok) throw new HttpError(400, 'BAD_SIGNATURE', 'Signature mismatch');
  return JSON.parse(payload.toString('utf8'));
}

export function signForTest(payload: string, secret: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;
}
