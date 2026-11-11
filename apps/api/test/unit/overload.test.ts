import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler, isOverload } from '../../src/app.js';

const known = (code: string, message = 'x') => new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: '5.22.0' });

function answer(err: unknown) {
  const headers: Record<string, string> = {};
  let status = 0;
  let body: Record<string, unknown> = {};
  const res = {
    setHeader: (k: string, v: string) => (headers[k] = v),
    status(s: number) {
      status = s;
      return this;
    },
    json(b: Record<string, unknown>) {
      body = b;
      return this;
    },
  } as unknown as Response;
  const req = { id: 'req-1', method: 'GET', originalUrl: '/api/me' } as unknown as Request;
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  errorHandler(err, req, res, () => {});
  spy.mockRestore();
  return { status, body, headers };
}

describe('overload answers', () => {
  it('pool timeouts, transactions that could not start and an unreachable database are 503 BUSY with Retry-After', () => {
    for (const err of [known('P2024'), known('P2028', 'Transaction API error: Unable to start a transaction in the given time.'), known('P1001'), known('P1017'), new Prisma.PrismaClientInitializationError('down', '5.22.0')]) {
      expect(isOverload(err)).toBe(true);
      const a = answer(err);
      expect(a.status).toBe(503);
      expect(a.body.code).toBe('BUSY');
      expect(a.headers['Retry-After']).toBe('2');
      expect(a.body.requestId).toBe('req-1');
    }
  });

  it('other database errors and bugs stay 500 INTERNAL', () => {
    for (const err of [known('P2002'), known('P2028', 'Transaction already closed'), new Error('bug')]) {
      expect(isOverload(err)).toBe(false);
      const a = answer(err);
      expect(a.status).toBe(500);
      expect(a.body.code).toBe('INTERNAL');
      expect(a.headers['Retry-After']).toBeUndefined();
    }
  });
});
