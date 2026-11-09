# Security operations runbook

What whoever hosts FlexcityHeadquarters does every day, week, quarter and year to keep it safe. The app's built-in controls are listed in [SECURITY-LEGAL-AUDIT.md](SECURITY-LEGAL-AUDIT.md); this covers what happens around it. Fill in names and tools when production is set up.

## Targets

| | Target |
| --- | --- |
| Critical vulnerability patched | 48 hours |
| High | 7 days |
| Medium | 30 days |
| Recovery point (RPO) | 15 minutes |
| Recovery time (RTO) | 4 hours |
| Detect a critical incident (MTTD) | under 1 hour |
| Contain it (MTTR) | under 4 hours |
| Notify the affected city | within 24 hours of confirming an incident |

## Daily

1. **Alerts reviewed** (on-call): the API, load balancer and database alarms. Alert on:
   - sign-in failures over 50 in 5 minutes from one IP;
   - more than 3 account lockouts in an hour;
   - any Dev console sign-in from a new IP;
   - 5xx rate over 2%;
   - database CPU over 80% for 10 minutes;
   - more than 3 records exports in a day for one city;
   - any change to the audit log grants.
2. **Backups confirmed:** last night's automated snapshot completed; point-in-time recovery window intact.
3. **Threat feeds skimmed:** GitHub security advisories for this repository, Dependabot pull requests, CCCS alerts, AWS security bulletins, Node.js and Next.js releases, PostgreSQL security releases.

## Weekly

- Merge Dependabot patch and minor updates after CI passes; schedule majors.
- Full backup copied to a separate AWS account in `ca-west-1` with S3 Object Lock (compliance mode, 35 days). Confirm the copy landed.
- Review CI dependency-audit output and the WAF block log.

## Monthly

- **Restore test:** restore last week's full backup to an isolated environment. Run the API test suite against it and check row counts. Record the time taken and the result.
- Review Dev console audit (`PlatformAudit`): every city change and every access-override change was expected.
- Review AWS Security Hub / Config findings (CIS benchmark): no public resources, no wide-open security groups, no unused IAM keys.

## Quarterly

- **Access review:**
  - list every Dev console admin and every IAM user and role, and remove anyone who has left;
  - confirm passkeys or MFA on each;
  - ask each city to review its HR and supervisor accounts.
- Re-run [SECURITY-LEGAL-AUDIT.md](SECURITY-LEGAL-AUDIT.md) section 3 and update statuses.
- Tabletop exercise (below), rotating scenarios.

## Yearly

- Independent penetration test (application and infrastructure); fix findings by severity target.
- Review policies: acceptable use, remote work, data retention, incident response, this runbook.
- Review subprocessors and their SOC 2 reports; update the published list.
- Accessibility re-test (WCAG 2.1 AA) and update the conformance report.

## De-provisioning

- **City staff:** HR sets the person to Terminated. Their sessions end on their next action, and refresh tokens are revoked.
- **Dev console admin:**
  - delete or disable the `PlatformAdmin` row, which ends their server-side sessions immediately;
  - remove their IAM access and VPN account the same day.

## Incident response playbook

1. **Detect and triage.** Who is on call, what's affected, is it ongoing? Open an incident channel and a timeline.
2. **Contain.** Revoke sessions (set the account inactive, or rotate `JWT_SECRET` to end every session), block IPs at the WAF, isolate affected instances. Preserve logs first.
3. **Assess.** Which cities and which records? The audit log, incident-access log and records-export log show who read what.
4. **Notify.** Tell each affected city within 24 hours of confirming, with what happened, what data, what we're doing, and a contact. Each city decides its own notices to its privacy commissioner and staff (PIPEDA, Alberta PIPA, Law 25, provincial public-sector laws; see the audit, section 5.6). Keep our own breach record for 24 months.
5. **Recover.** Restore from the last clean backup if needed; rotate secrets and KMS keys if exposure is suspected.
6. **Learn.** A blameless review within 5 business days; update this runbook and the audit's findings.

### Ransomware tabletop (run yearly)

> 6:40 a.m. on a Saturday in July. The database is encrypted and a ransom note is in the logs. Pools open at 7.

Walk through:

- **Ownership:** who decides, and do we ever pay? (Policy: no.)
- **Restore:** how fast is the immutable copy in `ca-west-1` restored (RTO 4 hours)?
- **Pools in the meantime:** each city runs on paper. Keep printable headcount, chemistry and sign-in forms in every facility's emergency binder, and send cities this week's schedule as a PDF every Friday.
- **Communications:** who tells the cities, and when?
- **Notices:** which privacy commissioners must hear from whom?

## Business continuity

- Multi-AZ database in `ca-central-1`; API across at least two availability zones behind the load balancer.
- Cross-region backups in `ca-west-1` (Canadian residency kept).
- Status page and a phone and email contact for cities during outages.
- Swim-lesson attendance works offline and syncs later; other deck tasks fall back to paper forms (keep them in each facility's emergency binder).
