import cookieParser from 'cookie-parser';
import { type RequestHandler, Router } from 'express';
import { PLATFORM_HEADER, isLivePlatformSession, requirePlatform, requirePlatformHeader } from '../../auth/platform.js';
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
// Trust evidence files go up to 10 MB (sent as base64); everything else stays at 2 MB. Only for a
// live console session (the header plus a session cookie that names an open session, checked in
// the database): otherwise, and while signing in (which needs no more than 100 kB), every body is
// limited to 100 kB, so an anonymous sender, made-up cookie or not, can't make the process parse
// megabytes first (SECURITY-AUDIT SEC-47).
const SESSION_COOKIE = /(?:^|;\s*)fh_platform=([^;]+)/;
const SMALL_BYTES = 100 * 1024;
const anonymousJson = jsonBody({ limit: SMALL_BYTES });
const cookieValue = (v: string) => {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};
const consoleOnly = (large: RequestHandler): RequestHandler => (req, res, next) => {
  const raw = req.header(PLATFORM_HEADER) === '1' ? SESSION_COOKIE.exec(req.headers.cookie ?? '')?.[1] : undefined;
  // A declared length within 100 kB (every GET, most requests) needs no lookup.
  const declared = req.headers['content-length'];
  if (!raw || (declared !== undefined && Number(declared) <= SMALL_BYTES)) return anonymousJson(req, res, next);
  isLivePlatformSession(cookieValue(raw)).then((live) => (live ? large : anonymousJson)(req, res, next), next);
};
const json = consoleOnly(jsonBody({ limit: '2mb' }));
const evidenceJson = consoleOnly(jsonBody({ limit: '14mb' }));
platformRouter.use((req, res, next) => (req.method === 'POST' && req.path === '/trust/evidence' ? evidenceJson : json)(req, res, next), cookieParser(), requirePlatformHeader);
platformRouter.use(platformAuthRouter, platformPasskeyRouter);
platformRouter.use(requirePlatform, citiesRouter, lifecycleRouter, billingRouter, booksRouter, leadsRouter, payrollTaxRouter, consentsRouter, platformPayrollRouter, platformIntegrationsRouter, trustRouter, updatesRouter);
