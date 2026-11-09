import cookieParser from 'cookie-parser';
import express, { Router } from 'express';
import { requirePlatform, requirePlatformHeader } from '../../auth/platform.js';
import { platformAuthRouter } from './auth.js';
import { citiesRouter } from './cities.js';

/** FH Dev console API: no organization subdomain, its own sessions, larger bodies (logos, CSV). */
export const platformRouter = Router();
platformRouter.use(express.json({ limit: '2mb' }), cookieParser(), requirePlatformHeader);
platformRouter.use(platformAuthRouter);
platformRouter.use(requirePlatform, citiesRouter);
