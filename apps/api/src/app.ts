import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from './lib/errors.js';
import { authRouter } from './routes/auth.js';
import { resolveTenant } from './routes/context.js';
import { api } from './routes/features.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind the AWS load balancer
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.use('/api', resolveTenant, authRouter);
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
