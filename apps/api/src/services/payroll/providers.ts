/**
 * How a city runs payroll: in the app (FH's pay runs), or with a payroll provider that receives
 * each period's approved hours straight from FH over the provider's API.
 *
 * - ADP Workforce Now: OAuth 2.0 client credentials over mutual TLS (the certificate ADP issues
 *   with API access), then the period's pay data batch (ADP's import layout) to the payroll
 *   import endpoint.
 * - Ceridian Dayforce: OAuth 2.0 client credentials from Dayforce ID, then the period's import
 *   file (Dayforce's pay import layout) to the client namespace's import endpoint.
 * - Wagepoint: an API key, then the period's hours (Wagepoint's import layout) to the company's
 *   hours import endpoint.
 *
 * Each provider grants API access through its partner programme; the endpoints are pre-filled
 * with the provider's published addresses and can be changed in case the provider gives the city
 * different ones, but only to that provider's own domain. Secrets are sealed with the city's key.
 * The CSV download stays available for every provider as the fallback.
 */
import { request } from 'node:https';
import { keys, tenantKekId } from '../../routes/context.js';
import { open, seal } from '../crypto/envelope.js';
import { HttpError } from '../../lib/errors.js';

export const PROVIDERS = ['adp', 'dayforce', 'wagepoint'] as const;
export type Provider = (typeof PROVIDERS)[number];
export type PayrollMode = 'in_app' | Provider;

export interface Sealed { c: string; iv: string; t: string; k: string; kek: string }
export interface AdpConnection { tokenUrl: string; importUrl: string; clientId: string; clientSecret: Sealed; certificate: string; privateKey: Sealed; companyCode: string; batchId?: string | null }
export interface DayforceConnection { tokenUrl: string; importUrl: string; clientId: string; clientSecret: Sealed; clientNamespace: string }
export interface WagepointConnection { importUrl: string; apiKey: Sealed; companyId: string }
export interface ProviderSettings {
  mode: PayrollMode;
  adp?: AdpConnection;
  dayforce?: DayforceConnection;
  wagepoint?: WagepointConnection;
  /** Last successful connection test per provider (ISO time). */
  tested?: Partial<Record<Provider, string>>;
}

/** The provider's published addresses, pre-filled. */
export const DEFAULTS = {
  adp: { tokenUrl: 'https://accounts.adp.com/auth/oauth/v2/token', importUrl: 'https://api.adp.com/payroll/v1/payroll-imports' },
  dayforce: { tokenUrl: 'https://dfid.dayforcehcm.com/connect/token', importUrl: 'https://www.dayforcehcm.com/api/{namespace}/V1/Imports/PayrollImport' },
  wagepoint: { importUrl: 'https://api.wagepoint.com/v1/companies/{company}/hours/import' },
} as const;
/** Each provider's own domain: a connection can only be pointed inside it. */
const DOMAINS: Record<Provider, string> = { adp: 'adp.com', dayforce: 'dayforcehcm.com', wagepoint: 'wagepoint.com' };

export function checkProviderUrl(provider: Provider, url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new HttpError(400, 'PROVIDER_URL', 'That address isn’t a web address.');
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || !(host === DOMAINS[provider] || host.endsWith(`.${DOMAINS[provider]}`)) || u.username || u.password || u.port) {
    throw new HttpError(400, 'PROVIDER_URL', `Use an https address on ${DOMAINS[provider]}.`);
  }
  return u.toString();
}

const aad = (tenantId: string, provider: Provider) => `payroll-provider:${provider}:${tenantId}`;
export async function sealSecret(tenantId: string, provider: Provider, secret: string): Promise<Sealed> {
  const s = await seal(keys(), tenantKekId(tenantId), secret, aad(tenantId, provider));
  return { c: s.ciphertext.toString('base64'), iv: s.iv.toString('base64'), t: s.authTag.toString('base64'), k: s.wrappedDataKey.toString('base64'), kek: s.kekId };
}
const openSecret = (tenantId: string, provider: Provider, x: Sealed) =>
  open(keys(), { ciphertext: Buffer.from(x.c, 'base64'), iv: Buffer.from(x.iv, 'base64'), authTag: Buffer.from(x.t, 'base64'), wrappedDataKey: Buffer.from(x.k, 'base64'), kekId: x.kek }, aad(tenantId, provider));

/* ---------- HTTP (replaceable in tests) ---------- */

export interface HttpRequest { url: string; method: 'POST'; headers: Record<string, string>; body: string | Buffer; cert?: string; key?: string }
export interface HttpResponse { status: number; body: string }
export type Transport = (r: HttpRequest) => Promise<HttpResponse>;

const httpsTransport: Transport = (r) =>
  new Promise((resolve, reject) => {
    const req = request(r.url, { method: r.method, headers: r.headers, cert: r.cert, key: r.key, timeout: 30_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8').slice(0, 4000) }));
    });
    req.on('timeout', () => req.destroy(new Error('The provider didn’t answer in time.')));
    req.on('error', reject);
    req.end(r.body);
  });
let transport: Transport = httpsTransport;
/** Tests replace the network. */
export const setTransport = (t: Transport | null) => void (transport = t ?? httpsTransport);

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const describe = (status: number, body: string) => {
  try {
    const j = JSON.parse(body) as { error_description?: string; message?: string; error?: string };
    return j.error_description ?? j.message ?? j.error ?? `HTTP ${status}`;
  } catch {
    return body.slice(0, 200) || `HTTP ${status}`;
  }
};

async function token(tenantId: string, provider: 'adp' | 'dayforce', c: AdpConnection | DayforceConnection, mtls?: { cert: string; key: string }): Promise<string> {
  const secret = await openSecret(tenantId, provider, c.clientSecret);
  const r = await transport({
    url: c.tokenUrl,
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', authorization: `Basic ${Buffer.from(`${c.clientId}:${secret}`).toString('base64')}` },
    body: form({ grant_type: 'client_credentials' }),
    ...mtls,
  });
  if (r.status !== 200) throw new HttpError(502, 'PROVIDER_AUTH', `The provider refused the sign-in: ${describe(r.status, r.body)}`);
  const t = (JSON.parse(r.body) as { access_token?: string }).access_token;
  if (!t) throw new HttpError(502, 'PROVIDER_AUTH', 'The provider’s answer had no access token.');
  return t;
}

/** Signs in to the provider (no data sent). */
export async function testConnection(tenantId: string, provider: Provider, s: ProviderSettings): Promise<void> {
  if (provider === 'adp') {
    const c = need(s.adp, provider);
    await token(tenantId, 'adp', c, { cert: c.certificate, key: await openSecret(tenantId, 'adp', c.privateKey) });
  } else if (provider === 'dayforce') {
    await token(tenantId, 'dayforce', need(s.dayforce, provider));
  } else {
    const c = need(s.wagepoint, provider);
    // Wagepoint has no sign-in step: a dry run of an empty import checks the key and company.
    const r = await transport({ url: c.importUrl.replace('{company}', encodeURIComponent(c.companyId)), method: 'POST', headers: { 'x-api-key': await openSecret(tenantId, 'wagepoint', c.apiKey), 'content-type': 'text/csv', 'x-dry-run': 'true' }, body: '' });
    if (r.status === 401 || r.status === 403) throw new HttpError(502, 'PROVIDER_AUTH', `The provider refused the key: ${describe(r.status, r.body)}`);
    if (r.status >= 500 || r.status === 0) throw new HttpError(502, 'PROVIDER_DOWN', `The provider had a problem: ${describe(r.status, r.body)}`);
  }
}

/** Sends one period's file (in the provider's layout). Returns the provider's reference when it gives one. */
export async function sendPeriod(tenantId: string, provider: Provider, s: ProviderSettings, file: { csv: string; name: string; periodStart: string; periodEnd: string }): Promise<{ status: number; reference: string | null }> {
  let r: HttpResponse;
  if (provider === 'adp') {
    const c = need(s.adp, provider);
    const mtls = { cert: c.certificate, key: await openSecret(tenantId, 'adp', c.privateKey) };
    const bearer = await token(tenantId, 'adp', c, mtls);
    r = await transport({ url: c.importUrl, method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'text/csv', 'x-adp-company-code': c.companyCode, ...(c.batchId ? { 'x-adp-batch-id': c.batchId } : {}), 'x-file-name': file.name }, body: file.csv, ...mtls });
  } else if (provider === 'dayforce') {
    const c = need(s.dayforce, provider);
    const bearer = await token(tenantId, 'dayforce', c);
    r = await transport({ url: c.importUrl.replace('{namespace}', encodeURIComponent(c.clientNamespace)), method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'text/csv', 'x-file-name': file.name, 'x-period-start': file.periodStart, 'x-period-end': file.periodEnd }, body: file.csv });
  } else {
    const c = need(s.wagepoint, provider);
    r = await transport({ url: c.importUrl.replace('{company}', encodeURIComponent(c.companyId)), method: 'POST', headers: { 'x-api-key': await openSecret(tenantId, 'wagepoint', c.apiKey), 'content-type': 'text/csv', 'x-file-name': file.name }, body: file.csv });
  }
  if (r.status < 200 || r.status >= 300) throw new HttpError(502, 'PROVIDER_REJECTED', `The provider didn’t accept the file: ${describe(r.status, r.body)}`, { status: r.status });
  let reference: string | null = null;
  try {
    const j = JSON.parse(r.body) as { id?: string; batchId?: string; importId?: string; reference?: string };
    reference = j.id ?? j.batchId ?? j.importId ?? j.reference ?? null;
  } catch {
    /* plain text answer */
  }
  return { status: r.status, reference };
}

function need<T>(c: T | undefined, provider: Provider): T {
  if (!c) throw new HttpError(400, 'PROVIDER_NOT_SET', `Connect ${provider} first.`);
  return c;
}

/** What the screen may see: never a secret, only whether one is saved. */
export function providerView(s: ProviderSettings | undefined) {
  const p = s ?? { mode: 'in_app' as const };
  return {
    mode: p.mode,
    defaults: DEFAULTS,
    tested: p.tested ?? {},
    adp: p.adp ? { tokenUrl: p.adp.tokenUrl, importUrl: p.adp.importUrl, clientId: p.adp.clientId, companyCode: p.adp.companyCode, batchId: p.adp.batchId ?? null, hasSecret: true, hasCertificate: !!p.adp.certificate } : null,
    dayforce: p.dayforce ? { tokenUrl: p.dayforce.tokenUrl, importUrl: p.dayforce.importUrl, clientId: p.dayforce.clientId, clientNamespace: p.dayforce.clientNamespace, hasSecret: true } : null,
    wagepoint: p.wagepoint ? { importUrl: p.wagepoint.importUrl, companyId: p.wagepoint.companyId, hasSecret: true } : null,
  };
}
