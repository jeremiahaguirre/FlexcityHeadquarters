/**
 * Request ids. Every request gets one (an incoming X-Request-Id is kept when it's well formed, so a
 * load balancer's id follows the request through), it's sent back in the X-Request-Id header and in
 * error bodies, and every line logged while the request is being handled starts with it, so support
 * can find what happened from the id a person reads off the screen.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { format } from 'node:util';
import type { NextFunction, Request, Response } from 'express';

export interface RequestContext {
  requestId: string;
}

const store = new AsyncLocalStorage<RequestContext>();

/** Letters, digits and - _ . : only, 8 to 128 characters: nothing that could break a log line or a header. */
export const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function newRequestId(): string {
  return randomUUID();
}

export function currentRequestId(): string | undefined {
  return store.getStore()?.requestId;
}

/** Runs `fn` with a request id in context (background jobs use this too). */
export function withRequestId<T>(requestId: string, fn: () => T): T {
  return store.run({ requestId }, fn);
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  const id = incoming && REQUEST_ID.test(incoming) ? incoming : newRequestId();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  store.run({ requestId: id }, next);
}

let installed = false;

/**
 * Prefixes console output with the current request id ("[req 1b2c…] …"). Installed once per process;
 * lines logged outside a request are left as they are.
 */
export function installLogContext(): void {
  if (installed) return;
  installed = true;
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const id = currentRequestId();
      if (!id) return original(...args);
      original(`[req ${id}] ${format(...args)}`);
    };
  }
}
