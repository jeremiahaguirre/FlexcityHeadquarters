import cookieParser from 'cookie-parser';
import { stripeWebhookRouter } from './routes/billing.js';
import { publicSignupRouter } from './routes/signup.js';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from './lib/errors.js';
import { authRouter } from './routes/auth.js';
import { supportAuthRouter } from './routes/support.js';
import { ssoAuthRouter } from './routes/sso.js';
import { publicJobsRouter } from './routes/jobs.js';
import { resolveTenant } from './routes/context.js';
import { api } from './routes/features.js';
import { platformRouter } from './routes/platform/index.js';
import { marketingRouter } from './routes/marketing.js';
import { passkeyAuthRouter } from './routes/passkeys.js';
import { publicLogoRouter } from './routes/publicLogo.js';
import { publicCalendarRouter } from './routes/calendar.js';
import { logError } from './lib/log.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind the AWS load balancer
  app.use(securityHeaders);
  // The marketing site's enquiry form (no organization, its own CORS).
  app.use('/api', marketingRouter);
  // Before the 100 kB body limit: the Dev console uploads logos and spreadsheets.
  app.use('/api/platform', platformRouter);
  // Stripe signs the raw body, so this comes before JSON parsing.
  app.use('/api', stripeWebhookRouter);
  // Small bodies everywhere, except document uploads (up to 10 MB, sent as base64) and signed agreements (a drawn signature).
  const smallJson = express.json({ limit: '100kb' });
  const uploadJson = express.json({ limit: '14mb' });
  const signatureJson = express.json({ limit: '400kb' });
  app.use((req, res, next) =>
    (req.method === 'POST' && /^\/api\/(me|users\/[0-9a-f-]{36})\/documents$/.test(req.path) ? uploadJson : req.method === 'POST' && req.path === '/api/me/consent' ? signatureJson : smallJson)(req, res, next),
  );
  app.use(cookieParser());

  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.use('/api', publicLogoRouter);
  // Calendar apps fetch a person's private shift feed by its link (routes/calendar.ts).
  app.use('/api', publicCalendarRouter);
  app.use('/api', resolveTenant, authRouter, supportAuthRouter, ssoAuthRouter, passkeyAuthRouter, publicJobsRouter, publicSignupRouter);
  app.use('/api', api);

  app.use(errorHandler);
  return app;
}

/** Headers for every answer: a JSON API is never framed, sniffed or cached, and HTTPS only once deployed. */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Frame-Options', 'DENY');
  if (!res.getHeader('Content-Security-Policy')) res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

/** Known errors as JSON with their code; anything else is logged and answered without detail. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ code: err.code, message: err.message, details: err.details });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ code: 'VALIDATION', message: 'Invalid request', details: err.issues });
    return;
  }
  logError(`${req.method} ${req.path}`, err);
  res.status(500).json({ code: 'INTERNAL', message: 'Something went wrong' });
}
