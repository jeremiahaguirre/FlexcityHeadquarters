/**
 * Live notification fan-out across API instances: one LISTEN connection per
 * process relays pg_notify payloads to in-process subscribers (SSE streams).
 */
import { ident } from '../../lib/sqlIdent.js';
import { EventEmitter } from 'node:events';
import pg from 'pg';
import { NOTIFY_CHANNEL } from './notifier.js';
import { logError } from '../../lib/log.js';

export interface LiveSignal {
  tenantId: string;
  userId: string;
  id: string;
}

const local = new EventEmitter();
local.setMaxListeners(0);
let client: pg.Client | null = null;

export async function startLiveHub(connectionString: string): Promise<() => Promise<void>> {
  if (client) return stopLiveHub;
  const c = new pg.Client({ connectionString });
  await c.connect();
  c.on('notification', (msg) => {
    if (msg.channel !== NOTIFY_CHANNEL || !msg.payload) return;
    try {
      const s = JSON.parse(msg.payload) as LiveSignal;
      local.emit(`user:${s.userId}`, s);
    } catch {
      /* ignore malformed payloads */
    }
  });
  c.on('error', (err) => {
    logError('live hub connection error', err);
    client = null;
    setTimeout(() => void startLiveHub(connectionString).catch(() => undefined), 5000);
  });
  await c.query(`LISTEN ${ident(NOTIFY_CHANNEL)}`);
  client = c;
  return stopLiveHub;
}

export async function stopLiveHub(): Promise<void> {
  const c = client;
  client = null;
  if (c) await c.end().catch(() => undefined);
}

export function onUserSignal(userId: string, fn: (s: LiveSignal) => void): () => void {
  const key = `user:${userId}`;
  local.on(key, fn);
  return () => local.off(key, fn);
}
