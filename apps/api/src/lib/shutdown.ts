/**
 * Graceful stop on SIGTERM, which ECS sends when it replaces a task (a deployment, scaling in) after
 * the load balancer has stopped sending it new requests (deregistration_delay). Without a handler,
 * Node running as the container's first process ignores SIGTERM, so every task was killed outright
 * at the stop timeout, mid-request (found by the production rehearsal).
 *
 * The server stops accepting connections, idle keep-alive connections close, live notification
 * streams are ended (the browser reconnects to another task within seconds), requests in flight
 * finish, and the process exits; whatever is still open after `graceMs` is cut.
 */
import type { Server, ServerResponse } from 'node:http';

export interface GracefulServer {
  /** Remember a long-lived response (the event stream) to end when stopping. */
  track(res: ServerResponse): void;
  /** Starts stopping; resolves once every connection is closed (or the grace period ran out). */
  stop(): Promise<void>;
  readonly stopping: boolean;
}

export function gracefulServer(server: Server, graceMs = 20_000): GracefulServer {
  const streams = new Set<ServerResponse>();
  let stopping: Promise<void> | null = null;
  return {
    track(res) {
      streams.add(res);
      res.on('close', () => streams.delete(res));
    },
    get stopping() {
      return stopping !== null;
    },
    stop() {
      stopping ??= new Promise<void>((resolve) => {
        // A keep-alive connection becomes idle when its last request is answered: close it then.
        const idle = setInterval(() => server.closeIdleConnections(), 100);
        const timer = setTimeout(() => {
          server.closeAllConnections();
          clearInterval(idle);
          resolve();
        }, graceMs);
        timer.unref();
        server.close(() => {
          clearTimeout(timer);
          clearInterval(idle);
          resolve();
        });
        server.closeIdleConnections();
        for (const res of streams) res.end();
      });
      return stopping;
    },
  };
}

let current: GracefulServer | null = null;
/** The running server's handle, for the event stream route (null in tests and before listen). */
export const liveServer = () => current;
export function setLiveServer(g: GracefulServer | null) {
  current = g;
}
