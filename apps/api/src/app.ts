import cookieParser from 'cookie-parser';
import { stripeWebhookRouter } from './routes/billing.js';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from './lib/errors.js';
import { authRouter } from './routes/auth.js';
import { publicJobsRouter } from './routes/jobs.js';
import { resolveTenant } from './routes/context.js';
import { api } from './routes/features.js';
import { platformRouter } from './routes/platform/index.js';
import { marketingRouter } from './routes/marketing.js';
import { passkeyAuthRouter } from './routes/passkeys.js';
import { publicLogoRouter } from './routes/publicLogo.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind the AWS load balancer
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    // JSON API: never framed, never rendered as a page, HTTPS only once deployed.
    res.setHeader('X-Frame-Options', 'DENY');
    if (!res.getHeader('Content-Security-Policy')) res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  // The marketing site's enquiry form (no organization, its own CORS).
  app.use('/api', marketingRouter);
  // Before the 100 kB body limit: the Dev console uploads logos and spreadsheets.
  app.use('/api/platform', platformRouter);
  // Stripe signs the raw body, so this comes before JSON parsing.
  app.use('/api', stripeWebhookRouter);
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.use('/api', publicLogoRouter);
  app.use('/api', resolveTenant, authRouter, passkeyAuthRouter, publicJobsRouter);
  app.use('/api', api);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ code: err.code, message: err.message, details: err.details });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ code: 'VALIDATION', message: 'Invalid request', details: err.issues });
      return;
    }
    console.error(err);
    res.status(500).json({ code: 'INTERNAL', message: 'Something went wrong' });
  });
  return app;
}
