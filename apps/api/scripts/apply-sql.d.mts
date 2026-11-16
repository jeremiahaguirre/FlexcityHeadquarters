// Types for apply-sql.mjs (a plain JavaScript script, run by the migration task).
import type pg from 'pg';

export interface ApplyOptions {
  force?: boolean;
  lockTimeoutMs?: number;
  retries?: number;
  pauseMs?: number;
  log?: (message: string) => void;
}
export interface ApplyResult {
  file: string;
  status: 'applied' | 'unchanged';
  attempts: number;
}
export function sqlState(client: pg.Client, text: string): Promise<string>;
export function applySqlFiles(client: pg.Client, files: string[], opts?: ApplyOptions): Promise<ApplyResult[]>;
