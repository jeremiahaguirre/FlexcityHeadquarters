# Working in this repository

Monorepo: `apps/api` (Express 5, Prisma 7, PostgreSQL with row-level security), `apps/web` (Next.js, English and French, plus a static GitHub Pages demo), `apps/site` (marketing site), `ops/terraform` (AWS, Canada only). Start with [README.md](README.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## How changes reach main

Nothing is pushed to `main` directly. Every change, hotfixes included, goes through a pull request:

1. **Branch** from the latest `main` (`<area>/<topic>`), one theme per pull request.
2. **Green checks.** The `CI` and `Security` workflows must pass on the pull request's last commit.
3. **Independent review.** A senior code review is run in a separate session that reads only the pull request's diff, not the author's notes or reasoning.
4. **Fix what it finds** on the same branch, and let the checks go green again.
5. **Merge**, then close the pull request and delete the branch.

Only commits on `main` that went through this path are deployed.

## Conventions

- **English and French for everything a person sees**: web locales, emails, texts, push and bell notifications, and API error codes (an `errors.<CODE>` key in both `en-CA` and `fr-CA`).
- **No personal details** in code, docs, tests, fixtures or commit messages: no real names, emails or phone numbers. Use placeholders such as `hr@example.ca`.
- **Commit trailer.** Every commit message ends with the session link, `Claude-Session: <link>`, and nothing after it.
- **Small pull requests**, one theme each (about one to five findings), each with a description that lists what changed, the test evidence and any change in behaviour.
- **Tests are never weakened.** No test is deleted, skipped or loosened to make a change pass. A behaviour change comes with a test that fails before it and passes after.
- **Migrations are additive**: expand first, contract a release later, so the running version keeps working during a deployment.
- **The demo keeps working**: a new endpoint or screen gets a handler in `apps/web/src/lib/demoApi.ts` or recorded sample data.
- **Never invent company facts** (prices, certifications, customers, legal claims).

## Checks before a commit

```bash
cd apps/api && npx tsc --noEmit && npm test && npm run test:integration   # integration needs DATABASE_URL and APP_DATABASE_URL
cd apps/web && npx tsc --noEmit && npm test                               # plus `npx next build` when web changed
cd apps/site && npx tsc --noEmit && npm test                              # when the site changed
cd ops/terraform && terraform fmt -check -recursive && terraform init -backend=false && terraform validate && terraform test
```
