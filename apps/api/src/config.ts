import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  /** Runtime connection: the non-owner `flexcity_app` role, so RLS applies. */
  APP_DATABASE_URL: z.string().url(),
  /** Union Hub only: the `flexcity_union` role. Optional when no tenant enables the hub. */
  UNION_DATABASE_URL: z.string().url().optional(),
  /**
   * Database connections per API instance, and how long a request may wait for one (seconds).
   * Every request runs in a transaction (for row-level security), so this is the instance's
   * ceiling on concurrent work: size it to the database's max_connections ÷ instances, leaving
   * room for the worker and migrations (see docs/SCALABILITY.md). Ignored when the URL sets
   * connection_limit itself.
   */
  DB_POOL_SIZE: z.coerce.number().int().min(2).max(500).default(25),
  DB_POOL_TIMEOUT_S: z.coerce.number().int().min(1).max(120).default(20),
  /** API worker processes in this container (Node uses one core each). */
  WEB_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(1),
  /**
   * The one LISTEN connection each API process (and the worker) holds for pg_notify (lib/listen.ts):
   * live notifications and cache invalidation across processes. Must reach Postgres directly, or a
   * PgBouncer pool in session mode: transaction pooling drops LISTEN. Defaults to APP_DATABASE_URL.
   */
  LISTEN_DATABASE_URL: z.string().url().optional(),
  /** Domain events: delivery tries before an event is set aside as dead (lib/outbox.ts). */
  EVENT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8),
  /** Webhooks (services/integrations/webhooks.ts): tries per delivery, failed tries in a row before an endpoint is turned off, and how long to wait for an answer. */
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(8),
  WEBHOOK_DISABLE_AFTER: z.coerce.number().int().min(1).max(1000).default(20),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(10_000),
  /**
   * Weather for the demand forecast: Environment and Climate Change Canada's open data (MSC GeoMet
   * OGC API, no key). "off" stops the worker fetching it; the forecast then runs without weather.
   */
  WEATHER: z.enum(['on', 'off']).default('on'),
  ECCC_API_BASE: z.string().url().default('https://api.weather.gc.ca'),
  WEATHER_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(10_000),
  /** Hours between forecast fetches for one site. */
  WEATHER_REFRESH_HOURS: z.coerce.number().min(1).max(24).default(3),
  /**
   * Where the Union Hub runs: "embedded" in this API (the default), or "separate", its own service
   * (src/unionServer.ts) behind the same address at /api/union. In "separate" mode this API holds no
   * union database credentials at all, and the union service must be the one given them.
   */
  UNION_HUB_MODE: z.enum(['embedded', 'separate']).default('embedded'),
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(14),
  /** Dev console second factor. Always required in production; tests switch it on where they need it. */
  PLATFORM_MFA: z.enum(['required', 'off']).optional(),
  /** Root domain for tenant subdomains, e.g. "flexcity.ca" → kelowna.flexcity.ca */
  ROOT_DOMAIN: z.string().default('localhost'),
  /** Link template for emails; {subdomain} is replaced per organization. */
  PUBLIC_APP_URL: z.string().default('http://{subdomain}.localhost:3000'),
  /** Marketing site origins allowed to post enquiries (comma-separated). */
  MARKETING_ORIGINS: z.string().default('http://localhost:3100'),
  /**
   * Sender identification for every email (CASL s. 6(2) and the CASL regulations): FH's legal name
   * and a mailing address valid for at least 60 days. Commercial email refuses to send in production
   * until both are set (services/marketing/casl.ts). Empty = a marked placeholder in development.
   */
  COMPANY_LEGAL_NAME: z.string().default(''),
  COMPANY_MAILING_ADDRESS: z.string().default(''),
  /** How people reach FH about email (shown in commercial email footers); defaults to BILLING_EMAIL. */
  COMPANY_CONTACT_EMAIL: z.string().default(''),
  /** Shown on FH's invoices to organizations. */
  BILLING_LEGAL_NAME: z.string().default('FlexcityHeadquarters'),
  BILLING_ADDRESS: z.string().default(''),
  BILLING_EMAIL: z.string().default('billing@flexcityhq.example'),
  BILLING_GST_NUMBER: z.string().default(''),
  BILLING_QST_NUMBER: z.string().default(''),
  /** Card and pre-authorized debit payments through Stripe Checkout. Unset = invoices are paid by EFT or cheque only. */
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  BILLING_REMITTANCE: z.string().default('Pay by EFT or cheque. Banking details are on file with your accounts payable team; quote the invoice number.'),
  BILLING_REMITTANCE_FR: z.string().default('Payez par TEF ou par chèque. Les coordonnées bancaires sont au dossier de votre service des comptes fournisseurs; indiquez le numéro de facture.'),
  /** Local/dev key-encryption key. Production uses AWS KMS (KMS_KEY_ARN). */
  LOCAL_KEK_BASE64: z.string().optional(),
  KMS_KEY_ARN: z.string().optional(),
  AWS_REGION: z.string().default('ca-central-1'),
  /** Texts and voice calls (urgent alerts). "console" logs them; "twilio" sends them. */
  SMS_PROVIDER: z.enum(['console', 'twilio']).default('console'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  /** The number texts and calls come from, e.g. +12505550100. */
  SMS_FROM: z.string().optional(),
  /** Web push to phones and desktops. Unset = push is off (in-app and email still work). */
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:support@flexcityhq.example'),
  /** Bearer token for GET /metrics (Prometheus). Unset = /metrics answers 404. */
  METRICS_TOKEN: z.string().min(16).optional(),
  /**
   * Error reports to a Sentry-compatible service (Sentry, GlitchTip), e.g. https://key@errors.example.ca/3.
   * Unset = errors are only logged. Reports are scrubbed of personal information first (lib/scrub.ts).
   */
  SENTRY_DSN: z.string().url().optional(),
  /** Shown on error reports: which deployment ("production", "staging") and which build. */
  SENTRY_ENVIRONMENT: z.string().optional(),
  RELEASE: z.string().optional(),
  /** Readiness (GET /readyz): how long the database check may take, in milliseconds. */
  READY_DB_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(1500),
  /** Readiness fails when the oldest unsent email or text has waited longer than this (seconds). */
  READY_OUTBOX_MAX_AGE_S: z.coerce.number().int().min(60).default(15 * 60),
  /**
   * A safety text or call (working alone, help, call-out) still unsent after this long (seconds)
   * raises an alert (error report, fh_safety_sms_overdue_alerts_total) and a readiness warning.
   */
  SAFETY_SMS_ALERT_S: z.coerce.number().int().min(30).default(120),
  /** Readiness fails when no background worker has reported in for this long (seconds). */
  READY_WORKER_MAX_AGE_S: z.coerce.number().int().min(60).default(5 * 60),
  /**
   * Whether a stale outbox or a missing worker makes /readyz answer 503. Off by default: they're
   * reported in the body either way, but a load balancer shouldn't pull every API server out
   * because the worker is down. Turn it on where /readyz feeds an alert rather than routing.
   */
  READY_STRICT: z.enum(['on', 'off']).default('off'),
});

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;
export function config(): Config {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    }
    if (parsed.data.NODE_ENV === 'production' && !parsed.data.KMS_KEY_ARN) {
      throw new Error('KMS_KEY_ARN is required in production');
    }
    if (parsed.data.NODE_ENV === 'production' && !parsed.data.AWS_REGION.startsWith('ca-')) {
      throw new Error('Data residency: AWS_REGION must be a Canadian region');
    }
    // Encryption in transit to the database, not just to the browser.
    if (parsed.data.NODE_ENV === 'production') {
      for (const [name, url] of [['APP_DATABASE_URL', parsed.data.APP_DATABASE_URL], ['UNION_DATABASE_URL', parsed.data.UNION_DATABASE_URL]] as const) {
        if (url && !/[?&]sslmode=(require|verify-ca|verify-full)\b/.test(url)) throw new Error(`${name} must use TLS in production (sslmode=verify-full)`);
      }
    }
    // Separate Union Hub: the main API must not be handed the union role's credentials.
    if (parsed.data.UNION_HUB_MODE === 'separate' && parsed.data.UNION_DATABASE_URL && process.env.FLEXCITY_SERVICE !== 'union') {
      throw new Error('UNION_HUB_MODE=separate: give UNION_DATABASE_URL to the Union Hub service only, not to this API.');
    }
    cached = parsed.data;
  }
  return cached;
}
