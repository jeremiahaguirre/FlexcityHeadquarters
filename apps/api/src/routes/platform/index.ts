import cookieParser from 'cookie-parser';
import { type Request, Router } from 'express';
import { PLATFORM_HEADER, requirePlatform, requirePlatformHeader } from '../../auth/platform.js';
import { platformAuthRouter } from './auth.js';
import { billingRouter } from './billing.js';
import { booksRouter } from './books.js';
import { citiesRouter } from './cities.js';
import { leadsRouter } from './leads.js';
import { lifecycleRouter } from './lifecycle.js';
import { platformPasskeyRouter } from './passkeys.js';
import { payrollTaxRouter } from './payrollTax.js';
import { consentsRouter } from './consents.js';
import { platformPayrollRouter } from './payroll.js';
import { platformIntegrationsRouter } from './integrations.js';
import { trustRouter } from './trust.js';
import { updatesRouter } from './updates.js';
import { jsonBody } from '../../lib/bodyParsers.js';

/** FH Dev console API: no organization subdomain, its own sessions, larger bodies (logos, CSV). */
export const platformRouter = Router();
// Trust evidence files go up to 10 MB (sent as base64); everything else stays at 2 MB. Only with
// the console's header and a console session cookie: without them (signing in needs no more than
// 100 kB) the limit is 100 kB, so an anonymous sender can't make the process parse megabytes
// first (SECURITY-AUDIT SEC-47). The header check itself stays after the cookie parser, where it
// also guards against cross-site requests (a browser can't send it cross-origin without CORS).
const json = jsonBody({ limit: '2mb' });
const evidenceJson = jsonBody({ limit: '14mb' });
const anonymousJson = jsonBody({ limit: '100kb' });
const SESSION_COOKIE = /(?:^|;\s*)fh_platform=/;
const consoleRequest = (req: Request) => req.header(PLATFORM_HEADER) === '1' && SESSION_COOKIE.test(req.headers.cookie ?? '');
platformRouter.use(
  (req, res, next) => (!consoleRequest(req) ? anonymousJson : req.method === 'POST' && req.path === '/trust/evidence' ? evidenceJson : json)(req, res, next),
  cookieParser(),
  requirePlatformHeader,
);
platformRouter.use(platformAuthRouter, platformPasskeyRouter);
platformRouter.use(requirePlatform, citiesRouter, lifecycleRouter, billingRouter, booksRouter, leadsRouter, payrollTaxRouter, consentsRouter, platformPayrollRouter, platformIntegrationsRouter, trustRouter, updatesRouter);
