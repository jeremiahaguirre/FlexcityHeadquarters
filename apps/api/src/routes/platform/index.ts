import cookieParser from 'cookie-parser';
import express, { Router } from 'express';
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

/** FH Dev console API: no organization subdomain, its own sessions, larger bodies (logos, CSV). */
export const platformRouter = Router();
platformRouter.use(express.json({ limit: '2mb' }), cookieParser(), requirePlatformHeader);
platformRouter.use(platformAuthRouter, platformPasskeyRouter);
platformRouter.use(requirePlatform, citiesRouter, lifecycleRouter, billingRouter, booksRouter, leadsRouter, payrollTaxRouter, consentsRouter);
