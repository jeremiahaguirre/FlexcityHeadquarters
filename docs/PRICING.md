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
| API and webhooks (read-only API keys, signed webhooks) | | | ✓ | ✓ |
| Union hub | +$150 | +$150 | +$150 | ✓ |
| Anything else not included | each option at its own price (below) | | | |
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
| Base + HR + Operations | $3,375 | Multi-complex $3,600 (adds single sign-on, bank connection, API and webhooks, benchmarks, priority support) |
| Everything + union hub | $3,375 + $100–$250 | Enterprise $4,500 |

Extra-staff charges are new revenue for large or seasonal-heavy organizations: a Business city with 2 standard
facilities and 210 active people in July pays 60 × $7 = $420 that month. Existing accounts were moved to the plan matching
what they had (HR Compliance → Multi-complex, otherwise Business).

## Options, one by one

Everything beyond the core is a single option with its own standard price. Each public plan switches on its standard
options (table above). In the Dev console (city → Billing → Options) any option can be switched on or off for one
organization, and every option has a price box filled in with the standard price, which can be changed for that
organization:

- **Public sector:** switching on an option the plan doesn't include adds its price each month; switching off one of the
  plan's standard options credits its price (a negative line on the invoice).
- **Private sector:** core is $99 / month including 20 active people, then $5 per active person; each option switched on
  bills its price each month.
- Stored as `BillingAccount.items`: only what differs from the plan (an option switched away from its standard, or a
  price of its own). Access changes as soon as the account is saved.

| Option | Group | Private / month | Added to a public plan / month |
| --- | --- | --- | --- |
| Water chemistry and closures | Operations | $39 | $300 |
| Incident reports | Operations | $29 | $250 |
| Front-desk status board | Operations | $19 | $150 |
| Deck rotation | Operations | $19 | $150 |
| Programs and registration | Programs | $99 | $600 |
| Fleet: inspections, licences, hours of service | Fleet and winter | $29 | $250 |
| Winter call-outs and patrols | Fleet and winter | $19 | $200 |
| Onboarding checks | HR | $39 | $300 |
| People review | HR | $29 | $250 |
| Discipline records | HR | $29 | $250 |
| Accommodation cases | HR | $19 | $200 |
| HR Suite: leave, reviews, training, grievances, offboarding | HR | $69 | $500 |
| Benchmarks | HR | $29 | $100 |
| Single sign-on | Integration | $49 | $300 |
| Bank connection | Integration | $39 | $300 |
| API and webhooks | Integration | $49 | $300 |
| Union hub | Union | $150 | $150 |

## Billing terms: monthly, yearly or a set term

Set per organization in the Dev console (city → Billing → Billing terms); logic in `apps/api/src/services/billing/terms.ts`.

- **Invoice:** monthly; yearly in advance (twelve months of fixed charges on the anniversary month); or the whole term up
  front (e.g. five years on one invoice).
- **Term:** month to month, or a committed length (1–5 years offered, any number of months up to 120). Prices are held for
  the term; afterwards billing continues month to month at the same rates, without the discount, until renewed.
- **Discount** on fixed charges (plans, facilities, options, staff places), standard by term and editable per organization:

| Term | Standard discount | Whole term up front |
| --- | --- | --- |
| Month to month | 0% | — |
| 1 year (or yearly billing) | 4% | 6% |
| 2 years | 6% | 8% |
| 3 years | 8% | 10% |
| 4 years | 10% | 12% |
| 5 years | 12% | 14% |

- **Usage** (active staff beyond the allowance) is never prepaid or discounted: it's invoiced each month for that month.
  Between prepaid invoices, a month with no usage has nothing to bill.
- The estimate shows each invoice, the monthly equivalent, the yearly amount and the contract total; the organization's
  Billing page shows its terms and the next invoice in advance. The website's plans page has a monthly / yearly switch.

## Never behind a paywall

Safety and legal duties (working alone, injury reports, the provincial rules engine: overtime, rest periods, young-worker
limits), payroll itself, security (passkeys, multi-factor sign-in) and privacy rights (audit log, records export,
retention settings, the in-app privacy notice) are core in every plan. Selling legal compliance as an upsell creates
liability when a customer doesn't buy it.

## What sits behind which module

- Feature switches: `ITEMS` in `catalog.ts` maps each option to the features it unlocks. Locked features are switched
  off; HR sees them in the menu with a lock and the option that unlocks them, linking to Billing.
- Settings that aren't feature switches are refused with `403 PLAN_REQUIRED`: saving single sign-on (`sso`) and saving
  or testing the bank connection (`bankConnection`). An existing connection keeps working after a downgrade so nobody is
  locked out mid-pay-run.
- API keys and webhooks (`publicApi`, standard in Multi-complex and Enterprise): without it, keys and webhooks can't be added,
  existing keys answer `403 PLAN_REQUIRED` and no new webhook events are queued (nothing in the city's own work depends on them).
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
