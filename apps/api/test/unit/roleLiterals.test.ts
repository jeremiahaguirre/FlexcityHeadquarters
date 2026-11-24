/**
 * Built-in role names ('HR_ADMIN', 'AQUATIC_SUPERVISOR', …) belong in src/auth/: who may do what,
 * and who hears about what, is decided by permission (auth/permissions.ts), so a custom role, a
 * Dev console override or a switched-off feature counts, and a library or a water utility with no
 * "aquatic supervisor" still gets its alerts (notifications/notifier.ts usersWithPermission).
 *
 * This fails when a file outside src/auth/ starts naming a role, or names roles more often than
 * the list below allows. The list is what is left: each entry says why it names roles. Lower a
 * count (or drop the entry) when a file stops naming them; never raise one to get a change through.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');
const ROLE = /'(HR_ADMIN|AQUATIC_SUPERVISOR|HEAD_LIFEGUARD|STAFF|FRONT_DESK|UNION_STEWARD|EMPLOYEE)'/g;

const ALLOWED: Record<string, { max: number; why: string }> = {
  'src/services/platform/staffImport.ts': { max: 30, why: 'the CSV role column: words people write, mapped to role names' },
  'src/services/platform/releaseNotes.ts': { max: 7, why: 'the list of roles a release note can be aimed at' },
  'src/routes/settings.ts': { max: 8, why: 'the Dev console role overrides and MFA roles: settings about roles themselves' },
  'src/routes/staff.ts': { max: 7, why: 'the roles a person can be given (request validation)' },
  'src/services/people/staffAdmin.ts': { max: 8, why: 'who may give or take the HR administrator role' },
  'src/routes/platform/cities.ts': { max: 6, why: 'the Dev console: a new organization’s first HR administrator' },
  'src/services/surveys/surveys.ts': { max: 6, why: 'survey audiences chosen by role' },
  'src/services/messaging/conversations.ts': { max: 5, why: 'messaging: HR’s place in conversations (to review)' },
  'src/routes/applications.ts': { max: 4, why: 'the roles a hire can be given (request validation)' },
  'src/services/people/customRoles.ts': { max: 4, why: 'how built-in roles combine with custom roles and their scope' },
  'src/services/people/onboarding.ts': { max: 4, why: 'onboarding item owner EMPLOYEE (another enum with the same word)' },
  'src/services/messaging/policy.ts': { max: 3, why: 'messaging policy by role (to review)' },
  'src/routes/hr.ts': { max: 2, why: 'performance reviews HR sees (to review)' },
  'src/routes/onboarding.ts': { max: 2, why: 'onboarding item owner EMPLOYEE (another enum with the same word)' },
  'src/services/people/departmentAdmin.ts': { max: 2, why: 'which built-in roles lead departments' },
  'src/routes/documents.ts': { max: 1, why: 'HR’s view of documents (to review)' },
  'src/routes/platform/lifecycle.ts': { max: 1, why: 'emails about closing the organization, to its HR administrators' },
  'src/routes/publicApiWrite.ts': { max: 1, why: 'a person hired through the API starts as a general employee' },
  'src/routes/scheduling.ts': { max: 1, why: 'union stewards read schedules (to review)' },
  'src/routes/sso.ts': { max: 1, why: 'emails about single sign-on changes, to HR administrators' },
  'src/routes/support.ts': { max: 1, why: 'an FH support visit at setup level acts as HR administrator' },
  'src/services/people/scope.ts': { max: 1, why: 'HR records (to review)' },
  'src/services/trust/monitors.ts': { max: 1, why: 'trust monitor: whether HR administrators need a second factor' },
};

function files(dir: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      // auth: where roles are defined; generated: Prisma's own client.
      if (name !== 'auth' && name !== 'generated') out = out.concat(files(p));
    } else if (/\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const counts = new Map<string, number>();
for (const p of files(join(ROOT, 'src'))) {
  const n = readFileSync(p, 'utf8').match(ROLE)?.length ?? 0;
  if (n) counts.set(relative(ROOT, p), n);
}

describe('role names stay in src/auth/', () => {
  it('no file outside src/auth/ names a built-in role, except the ones listed (and no more often)', () => {
    const over = [...counts].filter(([f, n]) => n > (ALLOWED[f]?.max ?? 0)).map(([f, n]) => `${f}: ${n} (allowed ${ALLOWED[f]?.max ?? 0})`);
    expect(over).toEqual([]);
  });

  it('alert routing names no role: notifications, daily jobs, pools, care, webhooks and platform notices', () => {
    for (const f of ['src/services/notifications/notifier.ts', 'src/services/jobs/daily.ts', 'src/services/ops/pools.ts', 'src/services/people/care.ts', 'src/routes/care.ts', 'src/services/integrations/webhooks.ts', 'src/services/platform/releases.ts', 'src/services/platform/maintenance.ts']) {
      expect([f, counts.get(f) ?? 0]).toEqual([f, 0]);
      expect(ALLOWED[f]).toBeUndefined();
    }
  });

  it('the list keeps up: every entry still names roles', () => {
    expect(Object.keys(ALLOWED).filter((f) => !counts.has(f))).toEqual([]);
  });
});
