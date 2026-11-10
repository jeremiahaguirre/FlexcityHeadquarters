import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  /** Runtime connection: the non-owner `flexcity_app` role, so RLS applies. */
  APP_DATABASE_URL: z.string().url(),
  /** Union Hub only: the `flexcity_union` role. Optional when no tenant enables the hub. */
  UNION_DATABASE_URL: z.string().url().optional(),
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
  /** Local/dev key-encryption key. Production uses AWS KMS (KMS_KEY_ARN). */
  LOCAL_KEK_BASE64: z.string().optional(),
  KMS_KEY_ARN: z.string().optional(),
  AWS_REGION: z.string().default('ca-central-1'),
  /** Web push to phones and desktops. Unset = push is off (in-app and email still work). */
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:support@flexcityhq.example'),
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
    cached = parsed.data;
  }
  return cached;
}
