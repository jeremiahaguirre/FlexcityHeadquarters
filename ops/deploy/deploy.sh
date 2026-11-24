#!/usr/bin/env bash
# Deploys one commit to one environment. Run by .github/workflows/deploy.yml (docs/DEPLOYING.md),
# with AWS credentials for that environment already in place.
#
#   SHA         the commit; its images are already in this environment's registry
#   ENV_NAME    staging | production
#   APP_URL     the environment's public address (https://<an organization>.<root_domain>)
#   TF_BACKEND  the contents of the environment's .s3.tfbackend file
#   TFVARS      the contents of the environment's .tfvars file (image_tag comes from SHA)
#   WATCH_MS    after deploying, keep checking this long (0: until /readyz?strict=1 passes once)
#
# Order: run the migrations with the new image first (they are additive: docs/MIGRATIONS.md and the
# CI lint, PR #51), then
# deploy the services, then check. If anything after the migrations fails (the apply, the services
# becoming stable, a check, an alarm during the watch), the previous image tag is deployed again
# (the schema stays: the previous release runs on it) and the job fails. Every wait has a deadline,
# so a stuck wait ends in a rollback rather than in the job's timeout.
set -euo pipefail
: "${SHA:?}" "${ENV_NAME:?}" "${APP_URL:?}" "${TF_BACKEND:?}" "${TFVARS:?}"
WATCH_MS="${WATCH_MS:-0}"
POLL_S="${POLL_S:-15}" # seconds between status checks (the tests make it short)
tmp="${RUNNER_TEMP:-$(mktemp -d)}"
here=$(cd "$(dirname "$0")" && pwd)
cd "$here/../terraform"

printf '%s\n' "$TF_BACKEND" > "$tmp/env.s3.tfbackend"
printf '%s\n' "$TFVARS" > "$tmp/env.tfvars"
lock=()
[ -f .terraform.lock.hcl ] && lock=(-lockfile=readonly) # the committed provider checksums
terraform init -input=false "${lock[@]}" -backend-config="$tmp/env.s3.tfbackend"

apply() {
  local tag=$1
  shift
  terraform apply -input=false -auto-approve -var-file="$tmp/env.tfvars" -var "image_tag=$tag" "$@"
}
out() { terraform output -raw "$1"; }

prev=$(out image_tag 2>/dev/null || true)
echo "Deploying $SHA to $ENV_NAME (running now: ${prev:-nothing})"

# Waits until a task stops (at most $2 seconds), then succeeds only if its container exited 0.
# Any AWS error, a missing task or the deadline is a failure.
wait_task() {
  local arn=$1 deadline=$(($(date +%s) + $2)) status code
  while :; do
    status=$(aws ecs describe-tasks --cluster "$cluster" --tasks "$arn" --query 'tasks[0].lastStatus' --output text) || return 1
    [ "$status" = "STOPPED" ] && break
    [ "$status" = "None" ] && { echo "::error::task $arn not found"; return 1; }
    [ "$(date +%s)" -ge "$deadline" ] && { echo "::error::task $arn still $status at its deadline"; aws ecs stop-task --cluster "$cluster" --task "$arn" >/dev/null || true; return 1; }
    sleep "$POLL_S"
  done
  aws ecs describe-tasks --cluster "$cluster" --tasks "$arn" --query 'tasks[0].[stoppedReason,containers[0].reason]' --output text || true
  code=$(aws ecs describe-tasks --cluster "$cluster" --tasks "$arn" --query 'tasks[0].containers[0].exitCode' --output text) || return 1
  [ "$code" = "0" ]
}

# Starts a one-off Fargate task and prints its ARN; fails unless ECS really started one.
# start_task <task definition> <security group> [overrides JSON]
start_task() {
  local arn
  arn=$(aws ecs run-task --cluster "$cluster" --launch-type FARGATE --task-definition "$1" \
    --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$2],assignPublicIp=DISABLED}" \
    --overrides "${3:-{\}}" --query 'tasks[0].taskArn' --output text) || return 1
  case "$arn" in
    arn:aws:ecs:*) echo "$arn" ;;
    *) echo "::error::ECS started no task (run-task answered '$arn')" >&2; return 1 ;;
  esac
}

# Waits (at most $1 seconds) until every service has one deployment, fully running, completed,
# and on the task definition the last apply registered (Terraform output). A service ECS rolled
# back (its circuit breaker, or an alarm) also ends with one completed deployment, but on the
# previous task definition: that is a failure at once, not a success.
wait_stable() {
  local deadline=$(($(date +%s) + $1)) want state verdict
  want=$(terraform output -json service_task_definitions) || return 1
  while :; do
    state=$(aws ecs describe-services --cluster "$cluster" --services api web worker --output json \
      --query 'services[].{name: serviceName, deployments: length(deployments), rollout: deployments[0].rolloutState, td: deployments[0].taskDefinition, running: runningCount, desired: desiredCount}') || return 1
    verdict=$(jq -r --argjson want "$want" '
      if length != 3 then "waiting"
      elif any(.[]; .deployments == 1 and (.rollout == "FAILED" or (.rollout == "COMPLETED" and .td != $want[.name]))) then "rolled-back"
      elif all(.[]; .deployments == 1 and .rollout == "COMPLETED" and .td == $want[.name] and .running == .desired) then "stable"
      else "waiting" end' <<<"$state") || return 1
    case "$verdict" in
      stable) return 0 ;;
      rolled-back)
        echo "::error::ECS rolled back: $(jq -r --argjson want "$want" '[.[] | select(.td != $want[.name] or .rollout == "FAILED") | "\(.name) runs \(.td) (\(.rollout)), expected \($want[.name])"] | join("; ")' <<<"$state")"
        return 1 ;;
    esac
    [ "$(date +%s)" -ge "$deadline" ] && { echo "::error::services not stable after $1 s"; return 1; }
    sleep "$POLL_S"
  done
}

# 1. Migrations, with the new migrate image. A failure here deploys nothing.
apply "$SHA" -target=aws_ecs_task_definition.migrate
cluster=$(out cluster)
subnets=$(terraform output -json private_subnets | jq -r 'join(",")')
jobs_sg=$(out jobs_security_group 2>/dev/null || out app_security_group)
migrate_task=$(start_task "$(out migrate_task_definition)" "$jobs_sg") && wait_task "$migrate_task" 1800 ||
  { echo "::error::Migrations failed; nothing was deployed."; exit 1; }

# The deployment's alarms (alarms.tf): ECS watches them only while its deployment runs; the watch
# below keeps watching them after the services are stable.
alarms=$(terraform output -json deployment_alarm_names 2>/dev/null | jq -r '.[]' || true)
alarm_firing() {
  [ -n "$alarms" ] || return 1
  local firing
  # shellcheck disable=SC2086 # one argument per alarm name
  firing=$(aws cloudwatch describe-alarms --alarm-names $alarms --state-value ALARM --query 'MetricAlarms[].AlarmName' --output text) || return 0
  [ -n "$firing" ] && [ "$firing" != "None" ] && { echo "::error::alarm firing: $firing"; return 0; }
  return 1
}

# 2 and 3, under one rollback: the services, then the checks.
deploy_and_check() {
  apply "$SHA" || return 1
  wait_stable 1200 || return 1
  # The public address answers with the new release.
  local seen web_td web_sg script overrides watch
  seen=$(curl -fsS -o /dev/null -D - --retry 5 --retry-delay 10 --retry-all-errors "$APP_URL/api/version" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-fh-version"{print $2}') || true
  [ "$seen" = "$SHA" ] || { echo "::error::$APP_URL/api/version reports '$seen', expected $SHA"; return 1; }
  # From inside the VPC (the load balancer never serves /readyz): /readyz?strict=1, from a one-off
  # task of the web task definition, which has API_URL and may reach the API.
  web_td=$(aws ecs describe-services --cluster "$cluster" --services web --query 'services[0].taskDefinition' --output text) || return 1
  web_sg=$(aws ecs describe-services --cluster "$cluster" --services web --query 'services[0].networkConfiguration.awsvpcConfiguration.securityGroups[0]' --output text) || return 1
  script=$(cat "$here/readyz-watch.js")
  overrides=$(jq -n --arg s "$script" --arg w "$WATCH_MS" '{containerOverrides: [{name: "web", command: ["node", "-e", $s], environment: [{name: "WATCH_MS", value: $w}]}]}')
  watch=$(start_task "$web_td" "$web_sg" "$overrides") || return 1
  # While the watch runs, the deployment alarms (server-error ratio, unhealthy tasks) count too.
  local deadline=$(($(date +%s) + WATCH_MS / 1000 + 900)) status
  while :; do
    if alarm_firing; then aws ecs stop-task --cluster "$cluster" --task "$watch" >/dev/null || true; return 1; fi
    status=$(aws ecs describe-tasks --cluster "$cluster" --tasks "$watch" --query 'tasks[0].lastStatus' --output text) || return 1
    [ "$status" = "STOPPED" ] && break
    [ "$(date +%s)" -ge "$deadline" ] && { echo "::error::the readiness watch did not finish"; aws ecs stop-task --cluster "$cluster" --task "$watch" >/dev/null || true; return 1; }
    sleep "$((POLL_S * 2))"
  done
  wait_task "$watch" 60 || return 1
  ! alarm_firing
}

if deploy_and_check; then
  echo "$ENV_NAME runs $SHA"
  exit 0
fi

echo "::error::$ENV_NAME failed after deploying $SHA"
if [ -n "$prev" ] && [ "$prev" != "$SHA" ]; then
  echo "Rolling back to $prev"
  apply "$prev"
  wait_stable 1200 || echo "::error::services not yet stable after the rollback; check ECS"
  echo "::warning::$ENV_NAME rolled back to $prev"
fi
exit 1
