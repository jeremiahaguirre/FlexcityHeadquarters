/**
 * The Union Hub as its own service. It answers /api/union/* only, and is the only process given
 * the union database role (UNION_DATABASE_URL): the main API, deployed with UNION_HUB_MODE=separate,
 * holds no way into union data at all, so a flaw or a stolen credential there can't reach it.
 *
 * Sign-ins are the same as the main app's (the same signed access tokens, the same checks that the
 * person is still active and the organization open), read through the main database's app role,
 * which in turn can't read the union schema. FH support visits are refused here as in the main app.
 */
import express from 'express';
import { errorHandler, securityHeaders } from './app.js';
import { requireAuth } from './auth/middleware.js';
import { resolveTenant } from './routes/context.js';
import { requireConsent } from './routes/consent.js';
import { unionRouter } from './routes/union.js';
import { installLogContext, requestIdMiddleware } from './lib/requestContext.js';

export function createUnionApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  installLogContext();
  app.use(requestIdMiddleware);
  app.use(securityHeaders);
  app.use(express.json({ limit: '100kb' }));
  app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'union-hub' }));
  // Nothing but the hub: any other path is not here.
  app.use('/api/union', resolveTenant, requireAuth, (req, _res, next) => {
    // Paths below are relative to /api: the router expects /union/…
    req.url = `/union${req.url === '/' ? '' : req.url}`;
    next();
  }, requireConsent, unionRouter);
  app.use((_req, res) => res.status(404).json({ code: 'NOT_FOUND', message: 'The Union Hub service only answers /api/union.' }));
  app.use(errorHandler);
  return app;
}
