# Deploying

`.github/workflows/deploy.yml` ships every commit of `main` that passed CI:

1. **Build** the three images (`api`, `migrate`, `web`) once from the commit, tagged with it, into staging's registry. The web image is built with `NEXT_PUBLIC_RELEASE` set to the same tag.
2. **Staging**: run the migration task with the new `migrate` image, then `terraform apply` with the new `image_tag`, wait for the services to be stable, then **smoke-test**:
   - the public address answers `/api/version` with `X-FH-Version: <commit>`;
   - from inside the VPC (the load balancer never serves `/readyz`), `/readyz?strict=1` passes: database, outbox and worker heartbeat.
3. **Production**, after a reviewer approves the `production` environment in GitHub: copy staging's tested images (same digests) into production's registry, migrate, apply, then **watch `/readyz?strict=1` for 10 minutes**. Three failures in a row roll back.

If a check fails, `ops/deploy/deploy.sh` applies the previous `image_tag` again and the job fails. Migrations are additive ([MIGRATIONS.md](MIGRATIONS.md)), so the previous release runs on the new schema. While a deployment is running, ECS also rolls back on its own if the service's server-error or health alarms go off, and the circuit breaker rolls back tasks that never become healthy (`ops/terraform/README.md`, "Alarms").

There are no AWS keys anywhere. Each job gets short-lived credentials from GitHub's OpenID Connect provider for a role that only a job in that GitHub environment of this repository can assume (`ops/terraform/deploy.tf`). Until every repository variable below is set, the workflow's `config` job lists what is missing and nothing else runs.

## Set-up (once)

For each environment, in its own AWS account (`ops/terraform/README.md`):

1. **State.** In `ops/terraform/bootstrap`: `terraform init && terraform apply`, then `terraform output -raw backend_config > ../backend/<env>.s3.tfbackend` and replace `<env>` in the key. This creates the versioned, encrypted state bucket and the lock table.
2. **First apply, by hand**, from a workstation with administrator credentials for the account. Use `github_repository = "<owner>/<repo>"` in `<env>.tfvars`, and on staging `ecr_pull_account_ids = ["<production account id>"]`:
   ```bash
   cd ops/terraform
   terraform init -backend-config=backend/<env>.s3.tfbackend
   terraform apply -var-file=<env>.tfvars
   ```
   Then follow "First deployment of an environment" in `ops/terraform/README.md`: the certificates, the app secret, and the first images and migrations. After that, the workflow does the deployments.
3. **GitHub environments** (repository settings → Environments): create `staging` and `production`. On `production`, add **required reviewers** (the approval step) and limit deployments to the `main` branch.
4. **Repository variables** (settings → Secrets and variables → Actions → Variables). None of them are secret:

   | Variable | Value |
   | --- | --- |
   | `STAGING_AWS_ROLE_ARN`, `PRODUCTION_AWS_ROLE_ARN` | the `deploy_role_arn` output of each environment |
   | `STAGING_TF_BACKEND`, `PRODUCTION_TF_BACKEND` | the contents of `backend/<env>.s3.tfbackend` |
   | `STAGING_TFVARS`, `PRODUCTION_TFVARS` | the contents of `<env>.tfvars`, without `image_tag` (the workflow sets it) |
   | `STAGING_URL`, `PRODUCTION_URL` | an organization's address in that environment, e.g. `https://<org>.<root_domain>` |
   | `STAGING_ECR_REGISTRY` | `<staging account id>.dkr.ecr.ca-central-1.amazonaws.com` (production pulls the tested images from it) |
   | `AWS_REGION` | optional; `ca-central-1` when unset |
   | `SITE_URL` | optional; the marketing site's address, baked into the web image |

## Running it by hand

- **Redeploy the current `main`**: Actions → Deploy → Run workflow (on `main`).
- **Roll back** to an earlier commit: open a pull request that reverts the change. The usual path redeploys it. In an emergency, re-run the Deploy workflow of the earlier commit's CI run, or apply its tag by hand: `terraform apply -var-file=<env>.tfvars -var image_tag=<commit>`.
- The deploy role cannot delete the database, keys, buckets, secrets or registries, or create long-lived keys (`deploy_guardrails` in `deploy.tf`). A change that needs one of those is made by hand.

## Files

| File | What it does |
| --- | --- |
| `.github/workflows/deploy.yml` | The pipeline: config check, build, staging, production |
| `ops/deploy/deploy.sh` | Migrate, apply, wait, check, roll back on failure |
| `ops/deploy/promote.sh` | Copy staging's images to production's registry |
| `ops/deploy/readyz-watch.js` | The in-VPC `/readyz?strict=1` check (tested by `readyz-watch.test.mjs` in CI) |
| `ops/terraform/deploy.tf` | GitHub OIDC provider, deploy role and its guardrails, cross-account image pull |
| `ops/terraform/bootstrap/` | The Terraform state bucket and lock table |
