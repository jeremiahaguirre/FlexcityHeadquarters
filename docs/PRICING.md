# Pricing

One source of truth: `apps/api/src/services/billing/catalog.ts`. The website (`apps/site/src/content/pricing.ts`, checked
against the catalogue by `content.test.ts`), the Dev console's Billing tab and each organization's Billing page all
follow it. Prices are monthly, in Canadian dollars, before GST/HST and PST.

## Public sector: four plans, per facility

| | Small | Business | Multi-complex | Enterprise |
| --- | --- | --- | --- | --- |
| Price per standard facility | $1,900 | $2,800 | from $3,600 (quoted) | from $4,500 (quoted) |
| Active staff included per facility | 40 | 75 | 150 (or quoted) | Unlimited |
| Each extra active person | $8 | $7 | $6 | — |
| Core (below) | ✓ | ✓ | ✓ | ✓ |
| Operations: water chemistry and closures, incidents, front-desk board, deck rotation | | ✓ | ✓ | ✓ |
| Programs and registration: campaigns, online sign-up, member services | | ✓ | ✓ | ✓ |
| Fleet and winter: pre-trip inspections, licences, hours of service, call-outs, patrols | | ✓ | ✓ | ✓ |
| HR Compliance: onboarding checks, people review, discipline, accommodation | | | ✓ | ✓ |
| HR Suite: leave balances, reviews, training, grievances, offboarding | | | ✓ | ✓ |
| Benchmarks | | | ✓ | ✓ |
| Single sign-on (Entra ID, SAML) | | | ✓ | ✓ |
| Bank connection (SFTP) for payroll | | | ✓ | ✓ |
| Union hub | +$150 | +$150 | +$150 | ✓ |
| Support | Email and phone | Email and phone | Priority | Priority, success manager, 99.9% uptime commitment, test organization, multi-year price lock |

- **Facility size** (`Facility.billingTier`) scales the price and the staff allowance: seasonal or outdoor ×0.4,
  standard ×1, major complex ×2. A facility's own contract rate (`billingMonthlyCents`) overrides its price.
- **Staff allowance** is pooled across the organization's billed facilities. **Active** = had a published shift or a
  punch in the month, so off-season staff cost nothing.
- **Staff places added to the plan** (`extraStaffSeats`, Dev console → Billing → Staff this month): a number of extra
  places billed to the organization every month at the plan's per-person rate (private: the per-user rate), used or not,
  which raise the allowance. Active people beyond allowance + places are billed as overage at the same rate. Both show on
  the organization's invoice and on its Billing page (active this month against the plan); staff are never billed.
- **Quoted plans:** Multi-complex and Enterprise show a list price; the Dev console records the quoted rate per standard
  facility (`quotedRateCents`) and, for Multi-complex, a quoted staff allowance (`includedStaff`). Leaving them empty
  bills the list values. Small and Business always bill the list price.

### Revenue compared with the previous model

The previous model was $1,000 / $2,500 / $5,000 per facility by size, plus HR Compliance +20% and Operations +15%.

| Standard facility | Before | Now |
| --- | --- | --- |
| Base only | $2,500 | Small $1,900 (new entry point) or Business $2,800 (includes Operations, programs, fleet and winter) |
| Base + Operations | $2,875 | Business $2,800 |
| Base + HR + Operations | $3,375 | Multi-complex $3,600 (adds single sign-on, bank connection, benchmarks, priority support) |
| Everything + union hub | $3,375 + $100–$250 | Enterprise $4,500 |

Extra-staff charges are new revenue for large or seasonal-heavy organizations: a Business city with 2 standard
facilities and 210 active people in July pays 60 × $7 = $420 that month. Existing accounts were moved to the plan matching
what they had (HR Compliance → Multi-complex, otherwise Business).

## Private sector: core plus modules

- Core: $99 / month including 20 active people, then $5 per active person (the per-person rate can be changed per account).
- Modules, each its own monthly price: Operations $79, Programs and registration $99, Fleet and winter $39,
  HR Compliance $89, HR Suite $69, Benchmarks $29, Single sign-on $49, Bank connection $39, Union hub $150.

## Never behind a paywall

Safety and legal duties (working alone, injury reports, the provincial rules engine: overtime, rest periods, young-worker
limits), payroll itself, security (passkeys, multi-factor sign-in) and privacy rights (audit log, records export,
retention settings, the in-app privacy notice) are core in every plan. Selling legal compliance as an upsell creates
liability when a customer doesn't buy it.

## What sits behind which module

- Feature switches: `MODULES` in `catalog.ts` maps each module to the features it unlocks. Locked features are switched
  off; HR sees them in the menu with a lock and the module that unlocks them, linking to Billing.
- Settings that aren't feature switches are refused with `403 PLAN_REQUIRED`: saving single sign-on (`sso`) and saving
  or testing the bank connection (`bankConnection`). An existing connection keeps working after a downgrade so nobody is
  locked out mid-pay-run.
- No billing account, or a trial (Dev console, Billing tab): every feature is on.

## Implementation fee (one-time)

| Customer | Fee |
| --- | --- |
| Private employer, single site | $1,500–$3,000 |
| Public sector, 1–2 facilities | $5,000–$8,000 |
| Public sector, 3+ facilities or custom payroll mapping | $8,000–$15,000 |

Includes subdomain and branding, pay-code and cost-centre mapping with a parallel-run payroll check, import of staff and
certification history, collective-agreement rule overrides, facility limits from permits, and supervisor training.

**Procurement:** a city with several facilities will often pass trade-agreement tendering thresholds, so expect a formal
RFP for multi-facility or multi-year contracts. Confirm current thresholds per province before quoting.

## Unpaid invoices

- **Overdue:** HR sees a warning with the date access becomes read-only (due date plus the grace period, 30 days by default).
- **Read-only:** every change is refused except safety records (incidents, water chemistry, headcounts, pool closures,
  working alone), clocking in and out, signing in, and paying. The Dev console can hold off suspension until a date.
- **Paying:** cards and pre-authorized debit through Stripe Checkout when `STRIPE_SECRET_KEY` is set, or EFT or cheque.
  Online payments are recorded from Stripe's webhook, and access is restored as soon as the balance is paid.
