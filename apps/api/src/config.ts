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
  /** Root domain for tenant subdomains, e.g. "flexcity.ca" → kelowna.flexcity.ca */
  ROOT_DOMAIN: z.string().default('localhost'),
  /** Local/dev key-encryption key. Production uses AWS KMS (KMS_KEY_ARN). */
  LOCAL_KEK_BASE64: z.string().optional(),
  KMS_KEY_ARN: z.string().optional(),
  AWS_REGION: z.string().default('ca-central-1'),
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
    cached = parsed.data;
  }
  return cached;
}
