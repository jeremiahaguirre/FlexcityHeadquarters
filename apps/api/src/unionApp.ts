/**
 * The Union Hub as its own service. It answers /api/union/* only, and is the only process given
 * the union database role (UNION_DATABASE_URL): the main API, deployed with UNION_HUB_MODE=separate,
 * holds no way into union data at all, so a flaw or a stolen credential there can't reach it.
 *
 * The reverse holds too (review of #75): the hub holds neither the main database's app role nor the
 * access-token signing secret. Each request's sign-in (a genuine, current token, an active person,
 * an open organization, consent, the union feature) is checked by the main API at its private
 * address, by the same code as every API route (lib/unionAccess.ts). FH support visits are refused
 * there as in the main app.
 */
import { ipRateLimit } from './lib/ipRateLimit.js';
import express from 'express';
import { errorHandler, securityHeaders } from './app.js';
import { config } from './config.js';
import { type UnionAccessOptions, unionAccessViaApi } from './lib/unionAccess.js';
import { unionHubRoutes } from './routes/union.js';
import { installLogContext, requestIdMiddleware } from './lib/requestContext.js';
import { jsonBody } from './lib/bodyParsers.js';

export function createUnionApp(access: Partial<UnionAccessOptions> = {}) {
  const apiUrl = access.apiUrl ?? config().API_URL;
  if (!apiUrl) throw new Error('The Union Hub service needs API_URL: the main API checks its sign-ins.');
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  installLogContext();
  app.use(requestIdMiddleware);
  app.use(securityHeaders);
  app.use(ipRateLimit());
  app.use(jsonBody({ limit: '100kb' }));
  app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'union-hub' }));
  // Nothing but the hub: any other path is not here.
  app.use('/api/union', unionAccessViaApi({ ...access, apiUrl, internalToken: access.internalToken ?? process.env.INTERNAL_API_TOKEN }), (req, _res, next) => {
    // Paths below are relative to /api: the router expects /union/…
    req.url = `/union${req.url === '/' ? '' : req.url}`;
    next();
  }, unionHubRoutes);
  app.use((_req, res) => res.status(404).json({ code: 'NOT_FOUND', message: 'The Union Hub service only answers /api/union.' }));
  app.use(errorHandler);
  return app;
}
