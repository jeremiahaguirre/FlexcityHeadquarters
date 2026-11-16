// Types for lint-migrations.mjs (a plain JavaScript script, run in CI).
export const BASELINE: string;
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
export function checkStatement(text: string): Problem[];
export function lintMigrations(dir: string, baseline?: string): { errors: string[]; checked: number };
