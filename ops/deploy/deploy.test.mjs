// node --test ops/deploy/   (no dependencies; needs bash and jq, as the deploy job does)
// deploy.sh against stand-ins for terraform, aws and curl: every failure after the migrations
// rolls back to the previous image tag, and a failed migration deploys nothing.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const script = new URL('./deploy.sh', import.meta.url).pathname;

const TERRAFORM = `#!/usr/bin/env bash
echo "terraform $*" >> "$CALLS"
case "$1" in
  init) exit 0 ;;
  apply)
    tag=$(printf '%s\\n' "$@" | sed -n 's/^image_tag=//p')
    if [ -n "$FAIL_APPLY_TAG" ] && [ "$tag" = "$FAIL_APPLY_TAG" ] && ! printf '%s\\n' "$@" | grep -q -- '-target'; then exit 1; fi
    exit 0 ;;
  output)
    case "$*" in
      *image_tag*) echo -n "$PREV" ;;
      *cluster*) echo -n cluster ;;
      *private_subnets*) echo '["subnet-1"]' ;;
      *jobs_security_group*) echo -n sg-jobs ;;
      *migrate_task_definition*) echo -n td-migrate ;;
      *deployment_alarm_names*) echo '["fh-api-5xx-ratio"]' ;;
    esac ;;
esac
`;

const AWS = `#!/usr/bin/env bash
echo "aws $*" >> "$CALLS"
case "$*" in
  *"ecs run-task"*) echo "\${RUN_TASK_ANSWER:-arn:aws:ecs:ca-central-1:111122223333:task/cluster/abc}" ;;
  *"tasks[0].lastStatus"*) echo STOPPED ;;
  *"containers[0].exitCode"*) echo "\${EXIT_CODE:-0}" ;;
  *"stoppedReason"*) echo "Essential container exited" ;;
  *"length(services"*) echo 3 ;;
  *"taskDefinition"*) echo td-web ;;
  *"securityGroups[0]"*) echo sg-web ;;
  *"describe-alarms"*) echo "\${FIRING:-None}" ;;
  *) exit 0 ;;
esac
`;

const CURL = `#!/usr/bin/env bash
printf 'HTTP/2 200\\r\\nX-FH-Version: %s\\r\\n\\r\\n' "\${VERSION_SEEN:-$SHA}"
`;

function run(env) {
  const dir = mkdtempSync(join(tmpdir(), 'fh-deploy-'));
  const bin = join(dir, 'bin');
  spawnSync('mkdir', [bin]);
  for (const [name, body] of Object.entries({ terraform: TERRAFORM, aws: AWS, curl: CURL })) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  const calls = join(dir, 'calls');
  writeFileSync(calls, '');
  const r = spawnSync('bash', [script], {
    env: { PATH: `${bin}:${process.env.PATH}`, CALLS: calls, RUNNER_TEMP: dir, SHA: 'new123', PREV: 'old456', ENV_NAME: 'production', APP_URL: 'https://x.example.ca', TF_BACKEND: 'bucket = "b"', TFVARS: 'environment = "production"', WATCH_MS: '0', POLL_S: '0', ...env },
    encoding: 'utf8',
  });
  const log = readFileSync(calls, 'utf8');
  const applies = log.split('\n').filter((l) => l.startsWith('terraform apply')).map((l) => `${l.match(/image_tag=(\S+)/)[1]}${l.includes('-target') ? ' (migrate only)' : ''}`);
  return { status: r.status, applies, out: r.stdout + r.stderr };
}

test('a good release: migrate, deploy, checks pass, no rollback', () => {
  const r = run({});
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.applies, ['new123 (migrate only)', 'new123']);
});

test('ECS starts no migration task: nothing is deployed', () => {
  const r = run({ RUN_TASK_ANSWER: 'None' });
  assert.equal(r.status, 1);
  assert.deepEqual(r.applies, ['new123 (migrate only)']);
  assert.match(r.out, /ECS started no task/);
});

test('a migration that fails: nothing is deployed', () => {
  const r = run({ EXIT_CODE: '1' });
  assert.equal(r.status, 1);
  assert.deepEqual(r.applies, ['new123 (migrate only)']);
});

test('the apply fails after the migrations: the previous release is applied again', () => {
  const r = run({ FAIL_APPLY_TAG: 'new123' });
  assert.equal(r.status, 1);
  assert.deepEqual(r.applies, ['new123 (migrate only)', 'new123', 'old456']);
});

test('the public address reports another release: rollback', () => {
  const r = run({ VERSION_SEEN: 'something-else' });
  assert.equal(r.status, 1);
  assert.deepEqual(r.applies.at(-1), 'old456');
});

test('a deployment alarm fires during the watch: rollback', () => {
  const r = run({ FIRING: 'fh-api-5xx-ratio' });
  assert.equal(r.status, 1);
  assert.deepEqual(r.applies.at(-1), 'old456');
  assert.match(r.out, /alarm firing: fh-api-5xx-ratio/);
});

test('a first deployment has nothing to roll back to, and says so by failing', () => {
  const r = run({ PREV: '', FAIL_APPLY_TAG: 'new123' });
  assert.equal(r.status, 1);
  assert.deepEqual(r.applies, ['new123 (migrate only)', 'new123']);
});
