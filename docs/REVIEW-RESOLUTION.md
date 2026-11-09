# How the spec review was resolved

Each issue from the original specification review, and where it was addressed.

## Critical

| Issue | Resolution | Where |
| --- | --- | --- |
| PIPEDA cited for municipal employees | Compliance doc lists the applicable public- and private-sector acts per employer type | `docs/COMPLIANCE.md`, `services/privacy/erasure.ts` |
| Cascade deletes destroyed payroll history | Every payroll-bearing relation is `onDelete: Restrict`; the app role has no `DELETE` on those tables | `prisma/schema.prisma`, `db/rls.sql` |
| "Right to be forgotten" vs retention | Erasure restricts processing immediately and anonymizes once records leave the CRA retention period | `services/privacy/erasure.ts` |
| SIN stored as last 4 but full SIN needed; weak PDF password | SIN not stored at all; T4 generation dropped (payroll provider issues slips) | `services/payroll/export.ts` |
| In-house payroll engine (CPP/EI/tax) | Dropped. Flexcity calculates gross wages and exports to the payroll system | `services/payroll/*` |
| T4 XML bugs | Moot — T4 generation removed | — |
| Union "structural separation" not real | Separate schema and DB role the API can't use; per-local encryption keys; documented limits (not legal privilege) | `db/union_hub.sql`, `services/union/unionHub.ts` |
| Reliability score and Law 25 / protected leave | Protected-leave events excluded automatically; advisory only; not used by the scheduler; employees can see their own breakdown | `services/reliability/score.ts` |
| Minors not handled | Young-worker rules per province (age, daily/weekly hours, school hours, latest end time, parental consent flag) | `services/compliance/provincialRules.ts`, `eligibility.ts` |

## Code bugs

| Bug | Fix | Test |
| --- | --- | --- |
| `certifications: { every }` passed users with no certs | One `some` clause per required cert, plus prerequisites | `eligibility.test.ts` |
| Overlap check missed identical/containing shifts | `a.start < b.end && a.end > b.start` | `eligibility.test.ts` |
| PTO compared by date equality | Interval overlap | `eligibility.test.ts` |
| Rest periods and availability never checked | Between-shift rest (with BC split-shift and ON 13-hour exceptions), ON daily 11-hour rest, availability | `eligibility.test.ts` |
| Daily OT per punch (split shifts missed) | Group by local work day first | `payCalc.test.ts` |
| No weekly OT | Weekly OT per pay week, stacked or greater-of | `payCalc.test.ts` |
| Float money / Decimal type errors | decimal.js throughout, cents rounding per line | `payCalc.test.ts` |
| Punches crossing the period boundary dropped | Clipped at the boundary; periods must be whole pay weeks | `payCalc.test.ts` |
| One rate per user | Effective-dated `PayRate` per user and position | `payrollRun.ts` |
| No `@updatedAt` / version on Shift; Prisma doesn't check versions | `version` column + compare-and-set `updateMany` | `shiftboard.test.ts` |
| One user claiming two shifts concurrently bypasses OT | Per-claimant advisory lock | `shiftboard.test.ts` |

## Schema gaps

Added: `TimeOffRequest`, `Availability`, `Position` + `PositionCertRequirement`, `CertificationPrerequisite`, `ShiftOffer`, `PoolBody`, `ChemicalReading`, `PoolClosure`, `IncidentReport` + access log, `DisciplinaryRecord`, `AuditLog`, `PayCodeMapping`, `PayRate`, `RuleOverride`, `StatutoryHoliday`, `RefreshToken`, `TimePunchEdit`, `ReliabilityEvent`. Union tables live outside Prisma by design.

Also: `tenantId` on every tenant table; `@@unique([tenantId, email])`; `timestamptz` everywhere; province on `Facility`; `ShiftStatus` limited to lifecycle (claim state on `ShiftOffer`); nullable `TimePunch.shiftId`; nullable cert expiry; `seniorityDate` / `seniorityHours`; employer employee number and cost centre for exports.

## Facts corrected

- Ontario: 11 consecutive hours off **per day** plus 8 hours between shifts (with the 13-hour exception) — not "11 hours between shifts".
- Alberta: OT after 8/day or 44/week, whichever is greater.
- Quebec: OT after 40/week; vacation 6% after 3 years.
- Vacation pay tiers per province; accrue-or-pay configurable.
- MAHC (US) thresholds removed; each pool is configured from its permit.
- Pool closure is recommended by software and confirmed by a person.
- Labour rules are data with effective dates and tenant overrides, not hardcoded branches.

## Architecture and scope

- Greedy waterfall → scheduling assistant that never auto-schedules overtime and explains unfilled shifts. CP-SAT solver is on the roadmap behind the same interface.
- GPS treated as a review signal, not proof.
- Phased scope: payroll engine and T4 removed; see `docs/ROADMAP.md`.

## Pricing

See `docs/PRICING.md`: overtime prevention moved into the base plan, onboarding repriced, "active user" defined, union add-on sold to the local.
