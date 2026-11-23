# Working in this repository

Monorepo: `apps/api` (Express 5, Prisma 7, PostgreSQL with row-level security), `apps/web` (Next.js, English and French, plus a static GitHub Pages demo), `apps/site` (marketing site), `ops/terraform` (AWS, Canada only). Start with [README.md](README.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## How changes reach main

**Never push to `main` yourself, even when you can.** Branch protection is not enforced yet, and anything that lands on `main` is deployed: the GitHub Pages demo rebuilds on every push that touches `apps/web` or `package-lock.json`. Every change, hotfixes included, goes through a pull request:

1. **Branch** from the latest `main` (`<area>/<topic>`), one theme per pull request.
2. **Green checks.** The `CI` and `Security` workflows must pass on the pull request's last commit. CI has no Terraform job yet: for a change under `ops/terraform`, the Terraform commands below are the check, and their output goes in the pull request's test evidence.
3. **Independent review.** A senior code review is run in a separate session that reads only the pull request's diff, not the author's notes or reasoning.
4. **Fix what it finds** on the same branch and let the checks go green again. Run the review again if the fixes are more than trivial.
5. **Merge** once the checks are green and the review has no open blockers, then delete the branch. If the pull request is squashed, the squash message keeps the `Claude-Session:` trailer last.

## Conventions

- **English and French for everything a person sees**: web locales (`apps/web/src/locales/en-CA.json` and `fr-CA.json`; `locales.test.ts` fails when their keys differ), emails, texts, push and bell notifications, and API error codes (an `errors.<CODE>` key in both files).
- **No personal details** in code, docs, tests, fixtures or commit messages: no real names, emails or phone numbers. Use placeholders such as `hr@example.ca`.
- **Commit trailer.** Every commit message ends with the session link, `Claude-Session: <link>`, and nothing after it.
- **Small pull requests**, one theme each (about one to five findings), each with a description that lists what changed, the test evidence and any change in behaviour.
- **Tests are never weakened.** No test is deleted, skipped or loosened to make a change pass. A behaviour change comes with a test that fails before it and passes after.
- **Migrations are additive**: expand first, contract a release later, so the running version keeps working during a deployment.
- **The demo keeps working**: a new endpoint or screen gets a handler in `apps/web/src/lib/demoApi.ts` or recorded sample data, and `npm run build:demo` still builds.
- **Never invent company facts** (prices, certifications, customers, legal claims).

## Security contract

[SECURITY.md](SECURITY.md) is the security decision ledger (OWASP ASVS v5.0.0). Its sections 1 to 4 bind every change:

- **Update the ledger row in the same pull request** when a change adds or changes an input structure, business limit, upload, sign-in pathway, session type, permission or field rule, key or algorithm, external connection, sensitive field or security event. Cite the code (`path:line`); anything not built is "planned" or "gap", never described as done.
- **Answer the section 4 gate** in the pull request description (`.github/pull_request_template.md`).
- **Owner decisions are not guessed.** An open decision (D-nn in SECURITY.md section 3.2) stays open until the owner decides; its recommendation is not a decision.
- `apps/api/test/unit/securityLedger.test.ts` fails when the ledger cites a path that doesn't exist, or leaves out a route file or a Terraform log group.

## Checks before a commit

`.github/workflows/ci.yml` is the source of truth; these are the same steps, run from the repository root (each line in its own subshell, so they can be pasted together):

```bash
# API. Integration tests need DATABASE_URL (owner/superuser), APP_DATABASE_URL (flexcity_app) and
# JWT_SECRET (32+ characters); README.md has the full command.
(cd apps/api && npx prisma generate && npx prisma validate && npx tsc --noEmit && npm test)
(cd apps/api && SHADOW_DATABASE_URL=<an empty database> npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code)
(cd apps/api && npm run test:integration)
# Web: the API's Prisma client first (web tests import the API's permission matrix), types and
# unit tests, the static demo build, its fonts check, then the phone tests against it.
# The first time on a machine: (cd apps/web && npx playwright install chromium)
(cd apps/api && npx prisma generate) && (cd apps/web && npx tsc --noEmit && npm test && npm run build:demo && npx vitest run src/lib/selfHostedFonts.test.ts && npx playwright test --trace off)
# Marketing site, when it changed
(cd apps/site && npx tsc --noEmit && npm test && npm run build && npx vitest run src/lib/selfHostedFonts.test.ts)
# Terraform, when ops/terraform changed (not in CI yet)
(cd ops/terraform && terraform fmt -check -recursive && terraform init -backend=false && terraform validate && terraform test)
```
