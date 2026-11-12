/**
 * The Express app for organizations' sites and the Dev console: order matters below (request ids,
 * security headers, body limits per route, public routes before sign-in, then the signed-in API),
 * and errorHandler turns every thrown error into one JSON shape.
 */
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { stripeWebhookRouter } from './routes/billing.js';
import { publicSignupRouter } from './routes/signup.js';
import express, { type NextFunction, type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { HttpError } from './lib/errors.js';
import { authRouter } from './routes/auth.js';
import { supportAuthRouter } from './routes/support.js';
import { ssoAuthRouter } from './routes/sso.js';
import { publicJobsRouter } from './routes/jobs.js';
import { publicApplicationsRouter } from './routes/applications.js';
import { resolveTenant } from './routes/context.js';
import { api } from './routes/features.js';
import { platformRouter } from './routes/platform/index.js';
import { marketingRouter } from './routes/marketing.js';
import { emailPrefsRouter } from './routes/emailPrefs.js';
import { passkeyAuthRouter } from './routes/passkeys.js';
import { mfaCodeRouter } from './routes/mfaCodes.js';
import { publicLogoRouter } from './routes/publicLogo.js';
import { publicCalendarRouter } from './routes/calendar.js';
import { kioskRouter } from './routes/kiosk.js';
import { captureError } from './lib/errorReporter.js';
import { metricsMiddleware, routePattern, startProcessMetrics } from './lib/metrics.js';
import { installLogContext, requestIdMiddleware } from './lib/requestContext.js';
import { ipRateLimit } from './lib/ipRateLimit.js';
import { clientErrorsRouter, opsRouter } from './routes/observability.js';
import { publicApiRouter } from './routes/publicApi.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind the AWS load balancer
  installLogContext();
  startProcessMetrics();
  // First: every request gets an id (X-Request-Id, in every log line and error body) and is counted.
  app.use(requestIdMiddleware, metricsMiddleware);
  app.use(securityHeaders);
  // Per-address token bucket (lib/ipRateLimit.ts); AWS WAF does the fleet-wide limit in front.
  app.use(ipRateLimit());
  // gzip/brotli for answers over 1 KB. The live notification stream (text/event-stream) is left
  // alone: compressing it would buffer events instead of sending them as they happen.
  app.use(compression({ filter: (req, res) => !String(res.getHeader('Content-Type') ?? '').includes('text/event-stream') && compression.filter(req, res) }));
  // /healthz, /readyz, /metrics (routes/observability.ts).
  app.use(opsRouter);
  // The public API for a city's own systems: its own API keys, not a person's session or subdomain.
  app.use('/api/v1', publicApiRouter);
  // The marketing site's enquiry form (no organization, its own CORS).
  app.use('/api', marketingRouter);
  // Unsubscribing from FH commercial email (no organization, no sign-in; signed link).
  app.use('/api', emailPrefsRouter);
  // Before the 100 kB body limit: the Dev console uploads logos and spreadsheets.
  app.use('/api/platform', platformRouter);
  // Stripe signs the raw body, so this comes before JSON parsing.
  app.use('/api', stripeWebhookRouter);
  // Small bodies everywhere, except document uploads (up to 10 MB, sent as base64) and signed agreements (a drawn signature).
  const smallJson = express.json({ limit: '100kb' });
  const uploadJson = express.json({ limit: '14mb' });
  const signatureJson = express.json({ limit: '400kb' });
  app.use((req, res, next) =>
    (req.method === 'POST' && (/^\/api\/(me|users\/[0-9a-f-]{36})\/documents$/.test(req.path) || /^\/api\/messages\/conversations\/[0-9a-f-]{36}\/messages$/.test(req.path)) ? uploadJson : req.method === 'POST' && req.path === '/api/me/consent' ? signatureJson : smallJson)(req, res, next),
  );
  app.use(cookieParser());

  // Browsers' error reports, from any page (an organization's or the Dev console).
  app.use('/api', clientErrorsRouter);
  app.use('/api', publicLogoRouter);
  // Calendar apps fetch a person's private shift feed by its link (routes/calendar.ts).
  app.use('/api', publicCalendarRouter);
  // Facility kiosks (shared tablets) sign requests with their own secret, not a person's session.
  app.use('/api', kioskRouter);
  app.use('/api', resolveTenant, authRouter, supportAuthRouter, ssoAuthRouter, passkeyAuthRouter, mfaCodeRouter, publicJobsRouter, publicApplicationsRouter, publicSignupRouter);
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
  // Nothing the API answers belongs in search results or AI training (docs/ARCHITECTURE.md, Crawlers and AI bots).
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai');
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

/**
 * Known errors as JSON with their code; anything else is reported (lib/errorReporter.ts) and
 * answered without detail. Every error body carries the request id, so support can find it.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = req.id;
  if (err instanceof HttpError) {
    if (err.status >= 500) report(err, req);
    res.status(err.status).json({ code: err.code, message: err.message, details: err.details, requestId });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ code: 'VALIDATION', message: 'Invalid request', details: err.issues, requestId });
    return;
  }
  // express.json(): a body that isn't JSON or is too large is the client's mistake, not ours.
  const status = (err as { status?: unknown; type?: unknown }).status;
  if (typeof status === 'number' && status >= 400 && status < 500 && typeof (err as { type?: unknown }).type === 'string') {
    res.status(status).json({ code: status === 413 ? 'TOO_LARGE' : 'BAD_REQUEST', message: status === 413 ? 'Request too large' : 'Invalid request body', requestId });
    return;
  }
  report(err, req);
  // The database is out of free connections or unreachable (a traffic spike, a failover): say so,
  // so phones retry their reads after a moment instead of showing a failure.
  if (isOverload(err)) {
    res.setHeader('Retry-After', '2');
    res.status(503).json({ code: 'BUSY', message: 'The service is busy. Try again in a moment.', requestId });
    return;
  }
  res.status(500).json({ code: 'INTERNAL', message: 'Something went wrong', requestId });
}

/**
 * Errors that mean "too much at once" or "database briefly away", not a bug:
 * P2024 no free connection in the pool within DB_POOL_TIMEOUT_S; P2028 when a transaction couldn't
 * start in time; P1001/P1002/P1017 the database unreachable or the connection closed (a failover).
 */
export function isOverload(err: unknown): boolean {
  // Can't connect at all: busy only when the server isn't reachable. A wrong password or a TLS
  // problem is a configuration error that retrying won't fix, so it stays a 500.
  if (err instanceof Prisma.PrismaClientInitializationError) return ['P1001', 'P1002'].includes(err.errorCode ?? '') || /can't reach database server|timed out/i.test(err.message);
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (['P2024', 'P1001', 'P1002', 'P1017'].includes(err.code)) return true;
  return err.code === 'P2028' && /unable to start a transaction in the given time/i.test(err.message);
}

function report(err: unknown, req: Request) {
  captureError(err, { source: 'request', requestId: req.id, method: req.method, route: routePattern(req), tenantId: req.auth?.tenantId ?? req.tenantId, userId: req.auth?.userId });
}
