import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// A start-up check that refuses (production settings, database role) throws at the top level. The
// process must end with a failure code, so ECS and `restart: on-failure` treat it as one.
describe('process handlers', () => {
  it('an uncaught error ends the process with exit code 1, even with nothing else running', () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', '-e', "const m = await import('./src/lib/errorReporter.ts'); m.installProcessHandlers(); throw new Error('refused at start-up');"], {
      cwd: new URL('../..', import.meta.url).pathname,
      env: { ...process.env, APP_DATABASE_URL: 'postgresql://u:p@localhost/db', JWT_SECRET: 'x'.repeat(40), NODE_ENV: 'test' },
      encoding: 'utf8',
      timeout: 20_000,
    });
    expect(r.stderr + r.stdout).toContain('refused at start-up');
    expect(r.status).toBe(1);
  });
});
