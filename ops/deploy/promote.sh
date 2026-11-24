#!/usr/bin/env bash
# Copies the three images staging built and tested for $SHA into production's registry, unchanged
# (same digests). Run by .github/workflows/deploy.yml with production's AWS credentials; staging's
# repositories let the production account pull (ops/terraform: ecr_pull_account_ids).
#
#   SHA               the commit
#   STAGING_REGISTRY  <staging account>.dkr.ecr.<region>.amazonaws.com
set -euo pipefail
: "${SHA:?}" "${STAGING_REGISTRY:?}"
region="${AWS_REGION:-ca-central-1}"
prod_registry="$(aws sts get-caller-identity --query Account --output text).dkr.ecr.$region.amazonaws.com"

# One token works for both registries: ECR checks the repository policy on each pull and push.
aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "$STAGING_REGISTRY"
aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "$prod_registry"

for target in api migrate web; do
  dest="$prod_registry/fh-production-$target:$SHA"
  if aws ecr describe-images --repository-name "fh-production-$target" --image-ids imageTag="$SHA" >/dev/null 2>&1; then
    echo "$dest already there (tags are immutable)"
    continue
  fi
  src="$STAGING_REGISTRY/fh-staging-$target:$SHA"
  docker pull "$src"
  docker tag "$src" "$dest"
  docker push "$dest"
  # Same image: the digest production runs is the one staging tested.
  echo "$target: $(docker inspect --format '{{index .RepoDigests 0}}' "$src")"
done
