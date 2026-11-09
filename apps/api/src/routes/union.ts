import { Router } from 'express';
import { z } from 'zod';
import { authOf } from '../auth/middleware.js';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { UnionHub } from '../services/union/unionHub.js';
import { h, keys } from './context.js';

/**
 * Union Hub. Access is decided by membership of the union local (stewards manage
 * it), not by employer roles: an HR administrator with no membership is refused.
 * Mounted only when UNION_DATABASE_URL is configured.
 */
export const unionRouter = Router();
const uuid = z.string().uuid();
let hub: UnionHub | undefined;
const getHub = () => {
  const url = config().UNION_DATABASE_URL;
  if (!url) throw new HttpError(404, 'NOT_ENABLED', 'The Union Hub is not enabled for this organization.');
  hub ??= UnionHub.fromUrl(url, keys());
  return hub;
};

unionRouter.get(
  '/union/locals',
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await getHub().listLocals(a.tenantId, a.userId));
  }),
);

unionRouter.get(
  '/union/locals/:local/threads',
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await getHub().listThreads(a.tenantId, uuid.parse(req.params.local), a.userId));
  }),
);

unionRouter.post(
  '/union/locals/:local/threads',
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ title: z.string().trim().min(3).max(140), body: z.string().trim().min(1).max(8000) }).parse(req.body);
    const id = await getHub().createThread(a.tenantId, uuid.parse(req.params.local), a.userId, body.title, body.body);
    res.status(201).json({ id });
  }),
);

unionRouter.get(
  '/union/locals/:local/threads/:thread',
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await getHub().readThread(uuid.parse(req.params.local), a.userId, uuid.parse(req.params.thread), a.tenantId));
  }),
);

unionRouter.post(
  '/union/locals/:local/threads/:thread/messages',
  h(async (req, res) => {
    const a = authOf(req);
    const { body } = z.object({ body: z.string().trim().min(1).max(8000) }).parse(req.body);
    const id = await getHub().postMessage(uuid.parse(req.params.local), a.userId, uuid.parse(req.params.thread), body, a.tenantId);
    res.status(201).json({ id });
  }),
);

unionRouter.get(
  '/union/locals/:local/seniority',
  h(async (req, res) => {
    const a = authOf(req);
    res.json(await getHub().seniorityRoster(uuid.parse(req.params.local), a.userId, a.tenantId));
  }),
);

unionRouter.post(
  '/union/locals/:local/members',
  h(async (req, res) => {
    const a = authOf(req);
    const body = z.object({ userId: uuid, isSteward: z.boolean().default(false) }).parse(req.body);
    await getHub().addMember(a.tenantId, uuid.parse(req.params.local), a.userId, body.userId, body.isSteward);
    res.status(204).end();
  }),
);

export async function closeUnionHub(): Promise<void> {
  await hub?.close();
  hub = undefined;
}
