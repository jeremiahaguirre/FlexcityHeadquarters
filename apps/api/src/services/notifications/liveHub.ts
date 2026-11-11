/**
 * Live notification fan-out across API processes and instances: the process's one LISTEN
 * connection (lib/listen.ts) relays pg_notify payloads ({ tenantId, userId, id }: ids only) to the
 * SSE streams open on this process. The stream then tells the browser to refetch, under its tenant.
 * If the LISTEN connection drops, every open stream is told to refetch once it is back, since
 * signals sent in between are lost.
 */
import { EventEmitter } from 'node:events';
import { sharedListener, stopListener } from '../../lib/listen.js';
import { CHANGE_CHANNEL, CHANGE_TOPICS, type ChangeTopic } from '../../lib/changes.js';
import { NOTIFY_CHANNEL } from './notifier.js';

export interface LiveSignal {
  tenantId: string;
  userId: string;
  id: string;
  /** The LISTEN connection came back: refetch, something may have been missed. */
  resync?: true;
}

const local = new EventEmitter();
local.setMaxListeners(0);
let detach: (() => void) | null = null;

export async function startLiveHub(connectionString: string): Promise<() => Promise<void>> {
  const l = sharedListener(connectionString);
  if (!detach) {
    const off = l.on(NOTIFY_CHANNEL, (payload) => {
      try {
        const s = JSON.parse(payload) as LiveSignal;
        if (typeof s.userId === 'string') local.emit(`user:${s.userId}`, s);
      } catch {
        /* ignore malformed payloads */
      }
    });
    // Shared-state changes (lib/changes.ts): an organization and a topic, nothing else.
    const offChange = l.on(CHANGE_CHANNEL, (payload) => {
      try {
        const c = JSON.parse(payload) as { tenantId?: unknown; topic?: unknown; userIds?: unknown };
        if (typeof c.tenantId !== 'string' || !(CHANGE_TOPICS as readonly unknown[]).includes(c.topic)) return;
        // Some people only (lib/changes.ts announceChangeTo): each one's own streams, under their organization.
        if (Array.isArray(c.userIds)) for (const u of c.userIds) typeof u === 'string' && local.emit(`userchange:${u}`, c.tenantId, c.topic as ChangeTopic);
        else local.emit(`tenant:${c.tenantId}`, c.topic as ChangeTopic);
      } catch {
        /* ignore malformed payloads */
      }
    });
    const offRe = l.onReconnect(() => local.emit('resync'));
    detach = () => (off(), offChange(), offRe());
  }
  await l.start();
  return stopLiveHub;
}

export async function stopLiveHub(): Promise<void> {
  detach?.();
  detach = null;
  await stopListener();
}

export function onUserSignal(userId: string, fn: (s: LiveSignal) => void): () => void {
  const key = `user:${userId}`;
  const resync = () => fn({ tenantId: '', userId, id: '', resync: true });
  local.on(key, fn);
  local.on('resync', resync);
  return () => {
    local.off(key, fn);
    local.off('resync', resync);
  };
}

/** Changes sent to one person (lib/changes.ts announceChangeTo), with the organization they belong to. Null after a reconnect. */
export function onUserChange(userId: string, fn: (tenantId: string | null, topic: ChangeTopic | null) => void): () => void {
  const key = `userchange:${userId}`;
  const resync = () => fn(null, null);
  local.on(key, fn);
  local.on('resync', resync);
  return () => {
    local.off(key, fn);
    local.off('resync', resync);
  };
}

/**
 * An organization's shared-state changes (topics), for one live stream. After the LISTEN connection
 * comes back, `null` means "anything may have changed: refetch everything you show".
 */
export function onTenantChange(tenantId: string, fn: (topic: ChangeTopic | null) => void): () => void {
  const key = `tenant:${tenantId}`;
  const resync = () => fn(null);
  local.on(key, fn);
  local.on('resync', resync);
  return () => {
    local.off(key, fn);
    local.off('resync', resync);
  };
}
