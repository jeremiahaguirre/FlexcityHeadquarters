#!/usr/bin/env bash
# Deploys one commit to one environment. Run by .github/workflows/deploy.yml (docs/DEPLOYING.md),
# with AWS credentials for that environment already in place.
#
#   SHA         the commit; its images are already in this environment's registry
#   ENV_NAME    staging | production
#   APP_URL     the environment's public address (https://<an organization>.<root_domain>)
#   TF_BACKEND  the contents of the environment's .s3.tfbackend file
#   TFVARS      the contents of the environment's .tfvars file (image_tag comes from SHA)
#   WATCH_MS    after deploying, keep checking /readyz?strict=1 this long (0: until it passes once)
#
# Order: run the migrations with the new image first (they are additive: docs/MIGRATIONS.md), then
# deploy the services, then check. If the checks fail, the previous image tag is deployed again
# (the schema stays: the previous release runs on it) and the job fails.
set -euo pipefail
: "${SHA:?}" "${ENV_NAME:?}" "${APP_URL:?}" "${TF_BACKEND:?}" "${TFVARS:?}"
WATCH_MS="${WATCH_MS:-0}"
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

# Runs a one-off Fargate task to completion; fails unless its container exits 0.
# run_task <task definition> <security group> [overrides JSON]
run_task() {
  local td=$1 sg=$2 overrides=${3:-'{}'} arn code
  arn=$(aws ecs run-task --cluster "$cluster" --launch-type FARGATE --task-definition "$td" \
    --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$sg],assignPublicIp=DISABLED}" \
    --overrides "$overrides" --query 'tasks[0].taskArn' --output text)
  echo "task $arn"
  # The CLI waiter gives up after 10 minutes; a long migration or the 10-minute watch can take longer.
  until aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$arn" 2>/dev/null; do echo "still running…"; done
  code=$(aws ecs describe-tasks --cluster "$cluster" --tasks "$arn" --query 'tasks[0].containers[0].exitCode' --output text)
  aws ecs describe-tasks --cluster "$cluster" --tasks "$arn" --query 'tasks[0].[stoppedReason,containers[0].reason]' --output text
  [ "$code" = "0" ]
}

# 1. Migrations, with the new migrate image.
apply "$SHA" -target=aws_ecs_task_definition.migrate
cluster=$(out cluster)
subnets=$(terraform output -json private_subnets | jq -r 'join(",")')
jobs_sg=$(out jobs_security_group 2>/dev/null || out app_security_group)
run_task "$(out migrate_task_definition)" "$jobs_sg" || { echo "::error::Migrations failed; nothing was deployed."; exit 1; }

# 2. The services.
apply "$SHA"
aws ecs wait services-stable --cluster "$cluster" --services api web worker

# 3. Checks: the public address answers with the new release, and, from inside the VPC (the load
#    balancer never serves /readyz), /readyz?strict=1 passes: database, outbox and worker heartbeat.
check() {
  local seen web_td web_sg script overrides
  seen=$(curl -fsS -o /dev/null -D - --retry 5 --retry-delay 10 --retry-all-errors "$APP_URL/api/version" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-fh-version"{print $2}')
  [ "$seen" = "$SHA" ] || { echo "::error::$APP_URL/api/version reports '$seen', expected $SHA"; return 1; }
  # A one-off task from the web task definition: it has API_URL and may reach the API.
  web_td=$(aws ecs describe-services --cluster "$cluster" --services web --query 'services[0].taskDefinition' --output text)
  web_sg=$(aws ecs describe-services --cluster "$cluster" --services web --query 'services[0].networkConfiguration.awsvpcConfiguration.securityGroups[0]' --output text)
  script=$(cat "$here/readyz-watch.js")
  overrides=$(jq -n --arg s "$script" --arg w "$WATCH_MS" '{containerOverrides: [{name: "web", command: ["node", "-e", $s], environment: [{name: "WATCH_MS", value: $w}]}]}')
  run_task "$web_td" "$web_sg" "$overrides"
}

if check; then
  echo "$ENV_NAME runs $SHA"
  exit 0
fi

echo "::error::$ENV_NAME failed its checks after deploying $SHA"
if [ -n "$prev" ] && [ "$prev" != "$SHA" ]; then
  echo "Rolling back to $prev"
  apply "$prev"
  aws ecs wait services-stable --cluster "$cluster" --services api web worker
  echo "::warning::$ENV_NAME rolled back to $prev"
fi
exit 1
