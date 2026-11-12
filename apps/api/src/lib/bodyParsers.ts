/**
 * Request body parsers. Express 5's (body-parser 2) leave req.body undefined when a request has no
 * body, or one of another type; Express 4's always set {}. Routes here were written for {} (a POST
 * with no body that every field is optional for, the public API's idempotency hash of an empty
 * body), so these keep that: same parsers and limits, and {} when nothing was parsed.
 */
import express, { type RequestHandler } from 'express';

function withEmptyBody(parse: RequestHandler): RequestHandler {
  return (req, res, next) =>
    parse(req, res, (err?: unknown) => {
      if (!err && req.body === undefined) req.body = {};
      next(err);
    });
}

/** express.json(), with {} for a request that has no JSON body. */
export const jsonBody = (opts: Parameters<typeof express.json>[0]) => withEmptyBody(express.json(opts));

/** express.urlencoded(), with {} for a request that has no form body. */
export const formBody = (opts: Parameters<typeof express.urlencoded>[0]) => withEmptyBody(express.urlencoded(opts));
