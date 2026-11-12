import cookieParser from 'cookie-parser';
import { Router } from 'express';
import { requirePlatform, requirePlatformHeader } from '../../auth/platform.js';
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
// Trust evidence files go up to 10 MB (sent as base64); everything else stays at 2 MB.
const json = jsonBody({ limit: '2mb' });
const evidenceJson = jsonBody({ limit: '14mb' });
platformRouter.use((req, res, next) => (req.method === 'POST' && req.path === '/trust/evidence' ? evidenceJson : json)(req, res, next), cookieParser(), requirePlatformHeader);
platformRouter.use(platformAuthRouter, platformPasskeyRouter);
platformRouter.use(requirePlatform, citiesRouter, lifecycleRouter, billingRouter, booksRouter, leadsRouter, payrollTaxRouter, consentsRouter, platformPayrollRouter, platformIntegrationsRouter, trustRouter, updatesRouter);
