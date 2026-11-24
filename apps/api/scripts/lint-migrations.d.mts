// Types for lint-migrations.mjs (a plain JavaScript script, run in CI).
export const GRANDFATHERED: Record<string, string>;
export const MARKER: RegExp;
export const LARGE_TABLES: Set<string>;
export interface Statement {
  text: string;
  line: number;
}
export interface Problem {
  level: 'error' | 'allowed';
  rule: string;
  message: string;
}
export function splitStatements(sql: string): Statement[];
export function checkStatement(text: string, newTables?: Set<string>): Problem[];
export function createdTables(statements: Statement[]): Set<string>;
export function sha256(text: string): string;
export function createdRoutines(statements: Statement[]): Set<string>;
export function checkRoutineCall(text: string, created: Set<string>): Problem[];
export function lintMigrations(dir: string, grandfathered?: Record<string, string>): { errors: string[]; checked: number; grandfathered: number; failing: Record<string, string> };
