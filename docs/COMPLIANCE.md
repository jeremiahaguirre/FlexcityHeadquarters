# Compliance notes

See also the [security and legal audit](SECURITY-LEGAL-AUDIT.md) and the [operations runbook](SECURITY-OPERATIONS.md).

> **Not legal advice.** The rule values in `apps/api/src/services/compliance/provincialRules.ts` reflect a reading of each statute and ship with `verified: false`. Every payroll result and eligibility check carries a warning until Canadian employment counsel has reviewed them. Do not run production payroll on unreviewed rules.

## Employment standards

- Rules follow the **province where the work is done** (the facility), not the employer's head office.
- Values are effective-dated. When a law changes, add a new rule set with a new `effectiveFrom`; past periods keep recalculating with the old rules.
- Collective agreements are applied as `RuleOverride` rows (e.g. OT after 7.5 h/day) with a cited source.
- Items deliberately left unautomated (surfaced as warnings): statutory holiday pay formulas outside BC, ON, QC and SK; averaging agreements; banked time; "day" definitions that start at shift start rather than midnight.

### Review checklist for counsel

1. Daily/weekly OT thresholds and the stacked vs. greater-of method per province.
2. Rest rules, including BC split shifts (12-hour span) and Ontario's 13-hour exception.
3. Whether stat-holiday hours count toward weekly OT in each province (currently: they do).
4. Young-worker limits per province and how school days and hours should be sourced.
5. Vacation pay tiers and the wage base (whether OT and stat pay are included).
6. Holiday pay eligibility formulas.

## Privacy law by customer type

| Customer | Governing law (employee data) |
| --- | --- |
| BC municipality | FOIPPA (BC) |
| Ontario municipality | MFIPPA |
| Quebec municipality | Act respecting access to documents held by public bodies (as amended by Law 25) |
| Alberta municipality | Access to Information Act / Protection of Privacy Act (formerly FOIP) |
| BC / Alberta private employer | PIPA (BC) / PIPA (AB) |
| Quebec private employer | Act respecting the protection of personal information in the private sector (Law 25) |
| Other provinces, private employer | Limited statutory coverage for employee data; follow PIPEDA principles contractually |

PIPEDA generally does **not** apply to employee information of provincially regulated employers.

### Built-in safeguards

- **Retention:** payroll records are kept for `Tenant.payrollRetentionYears` (default 7) after the tax year; erasure is deferred until then, with processing restricted immediately.
- **Automated decisions (Law 25 s.12.1):** the reliability score is advisory, never an input to scheduling or discipline, and fully explainable to the employee.
- **Minimization:** SINs only for payroll, sealed with the city's key and unsealed only into filing files; date of birth only for young-worker rules; location only at punch time and during a working-alone session the person chooses to share.
- **Notice and consent:** each person reads the information and consent agreement at first sign-in (EN/FR, versioned), chooses notifications and location separately, and signs; the API holds everything else back until they do, and a new version is signed again. Records can't be changed by the application; FH keeps them as evidence (Dev console, Signed agreements). **The text is a draft for counsel to review.**
- **Access logging:** incident report reads require a stated purpose and are logged.

## Data residency

- Primary data and backups: AWS `ca-central-1`. The API refuses to start in production with a non-Canadian region.
- **Subprocessors carry personal data too.** The list and the checks are in [SUBPROCESSORS.md](SUBPROCESSORS.md); the email provider is still to be chosen.

## Procurement requirements to plan for

- **SSO** (SAML / Entra ID) — built; expected by most cities.
- **Accessibility:** WCAG 2.1 AA (AODA in Ontario). Current UI uses labelled inputs, visible focus, skip link, live regions, contrast-corrected tenant colours, and never colour alone for status.
- **French:** Quebec's Charter of the French Language (Bill 96) requires French to be at least equivalent, including notifications and documents. A test enforces EN/FR key parity.

## Payroll filing and remittances

- FH prepares the files; the city files and pays: T4 XML (CRA Internet File Transfer), RL-1 XML (Revenu Québec's transmission service), ROE Web XML, and the remittance totals for CRA and Revenu Québec.
- **Revenu Québec** certifies RL-1 software each year: FH needs that year's authorization number, and each city enters its preparer number and slip range before the RL-1 file can be made.
- **Workforce skills (Quebec, 1% rule):** employers over the payroll threshold log eligible training spending; what's left of the 1% is shown as owed with the RLZ-1.S. Keep receipts and the training plan.
- **Court and CRA orders** are taken as entered; check each order's exemption limit (it varies by province and order).
- **Payroll providers:** when a city keeps ADP, Dayforce or Wagepoint, the approved hours go to the provider; filing and remittances are then the provider's job.

## Aquatic operations

- Chemical thresholds and bather-to-lifeguard ratios come from each facility's permit and provincial pool regulation. The seed's values are placeholders.
- Incident reports may need to go to WorkSafeBC / WSIB / the health authority; envelope encryption (rather than user-held keys) keeps that possible.
