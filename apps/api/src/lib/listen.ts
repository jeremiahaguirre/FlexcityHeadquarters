/**
 * Postgres LISTEN, one connection per process.
 *
 * pg_notify is how API processes (several per machine with WEB_CONCURRENCY, several machines)
 * tell each other things: a new in-app notification for someone whose live stream is open on
 * another process, or a cache to drop. Postgres delivers a NOTIFY only when its transaction
 * commits, so a signal never announces something that was rolled back. Payloads carry ids only;
 * the receiving process loads what it needs under the tenant.
 *
 * LISTEN needs a session that stays put: use a direct connection (LISTEN_DATABASE_URL, which
 * defaults to APP_DATABASE_URL), never one through PgBouncer in transaction mode, which would hand
 * the session to someone else between statements and lose the subscription.
 *
 * NOTIFY is fire-and-forget: anything sent while this connection is down is lost. So the listener
 * reconnects with backoff and then calls its onReconnect callbacks, which let subscribers catch up
 * (the live stream tells each browser to refetch; caches are dropped).
 */
import { EventEmitter } from 'node:events';
import pg from 'pg';
import { logError } from './log.js';
import { ident } from './sqlIdent.js';

type Handler = (payload: string) => void;

export class PgListener {
  private client: pg.Client | null = null;
  private readonly channels = new EventEmitter();
  private readonly reconnects = new Set<() => void>();
  private stopped = true;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private delayMs = 1000;
  private connecting: Promise<void> | null = null;

  constructor(private readonly connectionString: string, private readonly applicationName = 'fh-listen') {
    this.channels.setMaxListeners(0);
  }

  get connected(): boolean {
    return !!this.client;
  }

  async start(): Promise<void> {
    if (!this.stopped) return this.connecting ?? undefined;
    this.stopped = false;
    this.connecting = this.connect(false);
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const c = this.client;
    this.client = null;
    if (c) await c.end().catch(() => undefined);
  }

  /** Subscribe to a channel. LISTENs straight away when connected, and again after each reconnect. */
  on(channel: string, fn: Handler): () => void {
    const first = this.channels.listenerCount(channel) === 0;
    this.channels.on(channel, fn);
    if (first && this.client) void this.client.query(`LISTEN ${ident(channel)}`).catch((err) => logError('LISTEN failed', err));
    return () => this.channels.off(channel, fn);
  }

  /** Called after the connection comes back: notifications sent while it was down were lost. */
  onReconnect(fn: () => void): () => void {
    this.reconnects.add(fn);
    return () => this.reconnects.delete(fn);
  }

  private async connect(isReconnect: boolean): Promise<void> {
    const c = new pg.Client({ connectionString: this.connectionString, application_name: this.applicationName });
    let lost = false;
    const onLost = (err?: Error) => {
      if (lost) return;
      lost = true;
      if (this.client === c) this.client = null;
      if (this.stopped) return;
      if (err) logError('LISTEN connection lost; reconnecting', err);
      this.schedule();
    };
    c.on('error', onLost);
    c.on('end', () => onLost());
    c.on('notification', (msg) => {
      if (msg.payload != null) this.channels.emit(msg.channel, msg.payload);
    });
    await c.connect();
    for (const ch of this.channels.eventNames()) await c.query(`LISTEN ${ident(String(ch))}`);
    if (this.stopped) {
      await c.end().catch(() => undefined);
      return;
    }
    this.client = c;
    this.delayMs = 1000;
    if (isReconnect) for (const fn of this.reconnects) fn();
  }

  private schedule() {
    if (this.retry || this.stopped) return;
    const wait = this.delayMs;
    this.delayMs = Math.min(this.delayMs * 2, 30_000);
    this.retry = setTimeout(() => {
      this.retry = null;
      this.connect(true).catch((err) => {
        logError('LISTEN reconnect failed', err);
        this.schedule();
      });
    }, wait);
    this.retry.unref?.();
  }
}

let shared: PgListener | null = null;

/** This process's listener, made on first use and not yet started: subscribe, then start(). */
export function sharedListener(connectionString: string): PgListener {
  if (!shared) shared = new PgListener(connectionString);
  return shared;
}

export async function stopListener(): Promise<void> {
  const l = shared;
  shared = null;
  await l?.stop();
}

/** The process's listener once made, else null (unit tests, scripts). */
export const listener = (): PgListener | null => shared;
