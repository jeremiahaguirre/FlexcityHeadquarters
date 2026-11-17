#!/usr/bin/env bash
# The deploy workflow's first job (.github/workflows/deploy.yml): decides whether this run may
# deploy, and writes ready=true|false and sha=<commit> to $GITHUB_OUTPUT. Never fails the run:
# when something is missing it says what, as a notice, and the other jobs are skipped.
#
#   SHA, REPO, EVENT (workflow_run | workflow_dispatch), GH_TOKEN, and the repository variables.
#
# It checks that:
#   - every repository variable the pipeline needs is set (docs/DEPLOYING.md);
#   - a manual run deploys only a commit whose CI run on main succeeded (a workflow_run run only
#     starts after a successful one);
#   - the GitHub environments protect what the AWS roles trust: both "staging" and "production"
#     accept deployments from the main branch only, and "production" has required reviewers. The
#     AWS roles trust any job in those environments (ops/terraform/deploy.tf), so these settings
#     are the gate; GitHub creates a missing environment with no protection at all.
set -uo pipefail
: "${SHA:?}" "${REPO:?}" "${EVENT:?}"
echo "sha=$SHA" >> "$GITHUB_OUTPUT"
problems=()

for v in STAGING_AWS_ROLE_ARN STAGING_TF_BACKEND STAGING_TFVARS STAGING_URL STAGING_ECR_REGISTRY PRODUCTION_AWS_ROLE_ARN PRODUCTION_TF_BACKEND PRODUCTION_TFVARS PRODUCTION_URL; do
  [ -n "${!v:-}" ] || problems+=("repository variable $v is not set")
done

if [ ${#problems[@]} -eq 0 ]; then
  if [ "$EVENT" = "workflow_dispatch" ]; then
    ok=$(gh api "repos/$REPO/actions/workflows/ci.yml/runs?head_sha=$SHA&event=push&status=success" --jq '.total_count' 2>/dev/null || echo error)
    [ "$ok" != "error" ] && [ "${ok:-0}" -gt 0 ] || problems+=("CI has not succeeded for $SHA on main")
  fi
  for env in staging production; do
    if ! info=$(gh api "repos/$REPO/environments/$env" 2>/dev/null); then
      problems+=("the GitHub environment \"$env\" does not exist or can't be read")
      continue
    fi
    custom=$(jq -r '.deployment_branch_policy.custom_branch_policies // false' <<<"$info")
    names=$(gh api "repos/$REPO/environments/$env/deployment-branch-policies" --jq '[.branch_policies[].name] | sort | join(",")' 2>/dev/null || echo error)
    [ "$custom" = "true" ] && [ "$names" = "main" ] || problems+=("the \"$env\" environment must allow deployments from the main branch only")
    if [ "$env" = "production" ]; then
      reviewers=$(jq -r '[.protection_rules[]? | select(.type == "required_reviewers")] | length' <<<"$info")
      [ "${reviewers:-0}" -gt 0 ] || problems+=("the \"production\" environment has no required reviewers")
    fi
  done
fi

if [ ${#problems[@]} -gt 0 ]; then
  for p in "${problems[@]}"; do echo "::notice::Not deploying: $p (docs/DEPLOYING.md)."; done
  echo "ready=false" >> "$GITHUB_OUTPUT"
else
  echo "ready=true" >> "$GITHUB_OUTPUT"
fi
