## What changed

<!-- The findings or features this addresses, and any change in behaviour. -->

## Test evidence

<!-- The tests that fail before this change and pass after, and the checks you ran. -->

## Security gate (SECURITY.md section 4)

- [ ] **Ledger.** If this adds or changes anything SECURITY.md section 2 lists, the row is updated here, citing the code; anything not built is marked planned or gap.
- [ ] **Input and output.** Inputs are validated by zod in the API and encoded at the sink; no `eval`, unsafe parsing or backtracking regex.
- [ ] **Sign-in, session and access.** Every new route checks sign-in, permission, the caller's city and department or facility scope, and returns only the fields the caller may see; guards read the value the handler acts on.
- [ ] **Secrets and cryptography.** No secret in code, logs or build output; only primitives already in the ledger; constant-time comparison for secrets.
- [ ] **Browser and privacy.** No new sensitive data in browser storage or URLs; CSP and `no-store` intact.
- [ ] **Concurrency, errors and logging.** Check-then-act is atomic; outside calls have timeouts; errors are generic to the caller; security events are recorded without personal data.
- [ ] **Tests.** Positive and abuse-case tests for every new endpoint, failing before the change and passing after.
- [ ] **English and French** for everything a person sees; the GitHub Pages demo still works.
