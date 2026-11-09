# Pricing

Two models, because municipalities and private clubs buy differently.

## Municipal: monthly per-facility licence, unlimited staff

Priced per facility per month, scaled from the major complex at $5,000/month. The smaller tiers keep the same proportions as before (1 : 2.5 : 5).

| Tier | Facility | Monthly | Annual equivalent |
| --- | --- | --- | --- |
| 1 | Minor / seasonal (wading pool, splash pad, outdoor 25 m) | $1,000 | $12,000 |
| 2 | Standard recreation centre (indoor 25 m, leisure pool, hot tub) | $2,500 | $30,000 |
| 3 | Major complex (50 m, wave pool, slides, multi-zone) | $5,000 | $60,000 |

Unlimited users keep budgets predictable through summer hiring surges and put every employee into the system. Billed monthly; cities that prefer one invoice can prepay the year.

**Procurement:** at these prices a city with several facilities will often pass trade-agreement tendering thresholds, so expect a formal RFP for multi-facility or multi-year contracts. Confirm current thresholds per province before quoting.

## Private clubs: per active user

- $4–$7 per **active user** per month.
- **Active** = had at least one shift or punch in the billing month. Inactive profiles (e.g. students away at school) keep their data and certifications and are not billed.
- Base platform fee $99/month including the first 20 active users.

## Plans

| | Base | HR Compliance (+20%) | Operations (+15%) | Union & Labour Relations |
| --- | --- | --- | --- | --- |
| Scheduling assistant, Shift Board, geofenced timeclock, certification tracking | ✓ | | | |
| **Provincial overtime and rest-period guards, young-worker limits** | ✓ | | | |
| Payroll export (CSV) | ✓ | | | |
| VSC tracking, disciplinary records, audit-log access, privacy tooling | | ✓ | | |
| Chemical logs with closure workflow, incident reports, front-desk board | | | ✓ | |
| Union Hub, CBA documents, steward access | | | | Sold to the union local |

**Changes from the original model:**

- **Overtime guards moved into Base.** They were listed in both Base and the HR add-on. Selling legal compliance as an upsell creates liability when a customer doesn't buy it.
- **T4 generation removed.** The payroll provider issues slips.
- **The Union add-on is sold to (or co-funded with) the union local**, not only the employer. A union is unlikely to trust a channel the employer pays for and administers. Price per local: $100–$250/month.

## Implementation fee (one-time)

| Customer | Fee |
| --- | --- |
| Private club, single site | $1,500–$3,000 |
| Municipality, 1–2 facilities | $5,000–$8,000 |
| Municipality, 3+ facilities or custom payroll mapping | $8,000–$15,000 |

Includes subdomain and branding, pay-code and cost-centre mapping with a parallel-run payroll check, import of staff and certification history, collective-agreement rule overrides, pool threshold setup from permits, and supervisor training.

## In the app: what each plan unlocks, and unpaid invoices

- **Base** is everything not listed under an add-on. **HR Compliance** unlocks onboarding checks, people review, discipline records and accommodation cases. **Operations** unlocks water chemistry, incident reports and the front-desk board. **Union hub** unlocks the union local's hub. The mapping lives in `apps/api/src/services/billing/entitlements.ts`.
- Features an organization hasn't bought are switched off. HR sees them in the menu with a lock, linking to the Billing page.
- Organizations with no billing account, or in a trial (Dev console, Billing tab), have every feature.
- **Overdue invoice:** HR sees a warning with the date access becomes read-only (due date plus the grace period, 30 days by default).
- **Read-only:** every change is refused except safety records (incidents, water chemistry, headcounts, pool closures, working alone), clocking in and out, signing in, and paying. The Dev console can hold off suspension until a date.
- **Paying:** the Billing page lists invoices. Cities pay by card or pre-authorized debit through Stripe Checkout when `STRIPE_SECRET_KEY` is set, or by EFT or cheque (the remittance text). Online payments are recorded automatically from Stripe's webhook, and access is restored as soon as the balance is paid.
