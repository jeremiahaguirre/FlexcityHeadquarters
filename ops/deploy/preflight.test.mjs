// node --test ops/deploy/   (no dependencies; needs bash and jq, as the deploy job does)
// preflight.sh against a stand-in for gh: it deploys only when every setting the AWS roles rely on
// is in place, and otherwise says which one is missing.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const script = new URL('./preflight.sh', import.meta.url).pathname;

// Answers each API path from $ANSWERS (a JSON object: path -> body), applying --jq like gh does.
const GH = `#!/usr/bin/env bash
path=$2
expr=""
[ "$3" = "--jq" ] && expr=$4
body=$(jq -c --arg p "$path" '.[$p] // empty' <<<"$ANSWERS")
[ -n "$body" ] || exit 1
if [ -n "$expr" ]; then jq -r "$expr" <<<"$body"; else printf '%s\\n' "$body"; fi
`;

const REPO = 'example-org/example-repo';
const good = {
  [`repos/${REPO}/actions/oidc/customization/sub`]: { use_default: false, include_claim_keys: ['repo', 'context', 'job_workflow_ref'] },
  [`repos/${REPO}/environments/staging`]: { deployment_branch_policy: { custom_branch_policies: true }, protection_rules: [] },
  [`repos/${REPO}/environments/production`]: { deployment_branch_policy: { custom_branch_policies: true }, protection_rules: [{ type: 'required_reviewers' }] },
  [`repos/${REPO}/environments/staging/deployment-branch-policies`]: { branch_policies: [{ name: 'main' }] },
  [`repos/${REPO}/environments/production/deployment-branch-policies`]: { branch_policies: [{ name: 'main' }] },
};
const vars = Object.fromEntries(['STAGING_AWS_ROLE_ARN', 'STAGING_TF_BACKEND', 'STAGING_TFVARS', 'STAGING_URL', 'STAGING_ECR_REGISTRY', 'PRODUCTION_AWS_ROLE_ARN', 'PRODUCTION_TF_BACKEND', 'PRODUCTION_TFVARS', 'PRODUCTION_URL'].map((v) => [v, 'x']));

function run(answers) {
  const dir = mkdtempSync(join(tmpdir(), 'fh-preflight-'));
  writeFileSync(join(dir, 'gh'), GH);
  chmodSync(join(dir, 'gh'), 0o755);
  const output = join(dir, 'output');
  writeFileSync(output, '');
  const r = spawnSync('bash', [script], {
    env: { PATH: `${dir}:${process.env.PATH}`, GITHUB_OUTPUT: output, SHA: 'new123', REPO, EVENT: 'workflow_run', ANSWERS: JSON.stringify(answers), ...vars },
    encoding: 'utf8',
  });
  return { status: r.status, ready: /ready=true/.test(readFileSync(output, 'utf8')), out: r.stdout + r.stderr };
}

test('every setting in place: ready', () => {
  const r = run(good);
  assert.equal(r.status, 0, r.out);
  assert.equal(r.ready, true, r.out);
});

test('the default OIDC subject (no workflow or ref in it): not ready, and says why (review of #58)', () => {
  const r = run({ ...good, [`repos/${REPO}/actions/oidc/customization/sub`]: { use_default: true } });
  assert.equal(r.ready, false);
  assert.match(r.out, /OIDC subject must be customized to include repo, context and job_workflow_ref \(it is: default\)/);
});

test('a subject that leaves out the workflow, or one that can’t be read: not ready', () => {
  assert.equal(run({ ...good, [`repos/${REPO}/actions/oidc/customization/sub`]: { use_default: false, include_claim_keys: ['repo', 'context'] } }).ready, false);
  const { [`repos/${REPO}/actions/oidc/customization/sub`]: _, ...unreadable } = good;
  assert.match(run(unreadable).out, /\(it is: error\)/);
});

test('production without required reviewers, or staging open to other branches: not ready', () => {
  assert.equal(run({ ...good, [`repos/${REPO}/environments/production`]: { deployment_branch_policy: { custom_branch_policies: true }, protection_rules: [] } }).ready, false);
  assert.equal(run({ ...good, [`repos/${REPO}/environments/staging/deployment-branch-policies`]: { branch_policies: [{ name: 'main' }, { name: 'dev' }] } }).ready, false);
});
