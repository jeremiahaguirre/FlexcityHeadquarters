# Compliance notes

See also the [security and legal audit](SECURITY-LEGAL-AUDIT.md) and the [operations runbook](SECURITY-OPERATIONS.md).

> **Not legal advice.** The rule values in `apps/api/src/services/compliance/provincialRules.ts` reflect a reading of each statute and ship with `verified: false`. Every payroll result and eligibility check carries a warning until Canadian employment counsel has reviewed them. Do not run production payroll on unreviewed rules.

## Employment standards

- Rules follow the **province where the work is done** (the facility), not the employer's head office.
- Values are effective-dated. When a law changes, add a new rule set with a new `effectiveFrom`; past periods keep recalculating with the old rules.
- Collective agreements are applied as `RuleOverride` rows (e.g. OT after 7.5 h/day) with a cited source.
- Items deliberately left unautomated (surfaced as warnings): statutory holiday pay formulas outside BC, ON, QC and SK; averaging agreements; unpaid meal breaks (an 8.5-hour shift with a 30-minute unpaid lunch is counted as 8.5 hours worked, so it can show daily overtime in BC/AB; modelling breaks needs a schema change).
- **The "day" for daily overtime and daily hour limits** (`services/compliance/workDay.ts`, used by payroll's daily overtime in `payCalc.ts` and by scheduling's projections and limits): a calendar day, except in **BC and Alberta**, where a shift that continues past midnight starts a 24-hour day at its start (BC ESA s. 1 "day" (b); Alberta ESC "work day"). So BC 16:00–08:00 is one 16-hour day: 8 regular, 4 at 1.5, 4 at 2.0; 22:00–08:00 has 2 hours of daily overtime. Windows never overlap: the rolling day cuts the calendar day it starts in, and the rest of the calendar day after it is a day of its own. **Counsel to verify** (checklist item 9).
- **Daily rest (Ontario, 11 consecutive hours each day, ESA s. 18(1))**: measured in every 24 hours that start at the start of a shift, with rest allowed to cross midnight. Ordinary day shifts (07–15, 08–16, 09–17, 07–19) and 12-hour nights pass; 07–15 then 23–03 (8 h and 4 h off) is refused. A strict midnight-to-midnight reading would refuse almost every day shift, which isn't how the Ministry applies it. **Counsel to verify** (item 10).
- **Weekly rest**: the longest consecutive time off inside each pay week must reach the province's hours (BC 32, Quebec 32, Ontario 24 or 48 in each fixed pair of consecutive weeks, Alberta and the others 24); `rolling7` is supported for a province that counts any 7 days. The organization's "most days in a row" can't exceed 12 (a day off each pay week). Refused only when the new shift causes or worsens the shortfall. **Counsel to verify** the pay-week reading and Ontario's pairing (item 11).
- **Federally regulated** organizations or departments (Fill settings, `overtimePolicy.solver.federallyRegulated`) are scheduled under the Canada Labour Code set (8 h/day and 40 h/week overtime, 8 h between shifts, 24 h off each week, minimum age 17 for most work, 96 hours' schedule notice warned on publish). **Payroll still follows the facility's province**: a federal pay calculation is not built.
- **Seniority is optional per organization** (Settings, or the Dev console's Features). On, the default for cities, seniority dates and hours break ties in the overtime order, call-outs and the scheduling assistant. Off, ties go by fewest hours then name, seniority isn't shown on people's records or the overtime order, and the assistant fills shifts evenly. Private-sector companies created in the Dev console start with it off. Where a collective agreement sets seniority rules, keep it on.

### Time in lieu (banked overtime)

Modelled on Ontario's ESA s. 22(7) and common municipal collective agreements (`services/payroll/lieu.ts`):

- Off until the city turns it on in payroll settings, with a cap (default 80 hours) and how long banked time may be kept (default 12 months).
- Each person chooses to bank overtime on their pay screen; the choice is time-stamped and audited, and applies from the next pay run. They can withdraw it the same way.
- Overtime banks at its premium: an hour at time and a half banks 1.5 hours, at double time 2 hours. What passes the cap is paid.
- Time off from the bank is paid at the regular rate in the run that covers it; payouts are a one-time item (bonus method), never more than the balance.
- Pay runs flag time older than the city's limit (Ontario: take it within 3 months, or 12 with the employee's agreement) and balances owed to someone leaving, to be paid on the final pay. The payout is added by payroll; it isn't automatic.
- Vacation pay is paid on overtime when it's worked, banked or not, and not again when banked time is taken or paid out.
- **For counsel:** whether the in-app choice is the written agreement each province asks for, and each province's own banked-time rules (they differ outside Ontario).

### Statutory holidays on a weekend or a day off

Code: `services/payroll/statHolidays.ts` (dates, and the moves the law fixes) and `services/payroll/holidayRules.ts` (what someone gets when a holiday is their day off), with each section cited in comments. Two things are kept apart:

- **Calendar moves fixed by law**, the same for everyone, stored on the holiday row (`observedOn`, `kind`): Canada Day on a Sunday is **July 2** (Holidays Act, R.S.C. 1985, c. H-5, s. 2; Quebec LNT s. 60 4°; the other provinces and territories don't set a date of their own and observed July 2 in 2018), except **Nova Scotia** (the Labour Standards Code defines Canada Day as July 1) and **Newfoundland and Labrador** (July 1 is also Memorial Day). Quebec's **Fête nationale** on a Sunday is **June 25** for people who don't usually work Sundays (CQLR c. F-1.1, s. 2); those who do keep June 24. Nothing else moves by law. The next one: both on a Sunday in 2029.
- **The person's own schedule**: whether a holiday is someone's day off follows their pattern of work, not the calendar weekend: the weekday they worked in at least 5 of the 9 weeks before (the test Alberta's Code uses, s. 27, applied everywhere as the default). Worked out per person in each pay run.

What someone gets when the holiday falls on their day off:

| Jurisdiction | Default | Employer may choose | Source |
| --- | --- | --- | --- |
| Federal (Canada Labour Code) | Another day with pay: for the six fixed-date holidays on a non-working Saturday or Sunday, the working day before or after; otherwise at another time or added to vacation | Substitute only | CLC ss. 193, 195 (verify subsections); Holidays Act s. 2 |
| British Columbia | Average day's pay (whether or not it's their day off) | Pay, or a substitute day by written agreement | ESA ss. 44, 45, 48 |
| Alberta | Nothing, when it isn't a normal work day and they don't work it | Pay or substitute (more generous) | ESC ss. 27–28 (verify) |
| Saskatchewan | Public holiday pay (5% of the 4 weeks) for every holiday | Pay or substitute | SEA s. 2-32 |
| Manitoba | Next working day off with general holiday pay, or a day agreed | Substitute only | ESC, general holidays (verify section) |
| Ontario | Substitute day off with public holiday pay (within 3 months, 12 by agreement) | Pay alone, with the employee's written agreement | ESA s. 27(1)–(2) |
| Quebec | Holiday indemnity (1/20 of the 4 weeks) | Indemnity or a compensatory day | LNT ss. 60, 62, 64–65; Fête nationale Act ss. 2–4 |
| New Brunswick | Another day off with regular pay | Day's regular pay instead | ESA s. 18 (verify) |
| Nova Scotia | Day off with pay, next working day or a day agreed; **Remembrance Day: nothing** | Substitute only | LSC s. 38 (verify); Remembrance Day Act |
| Prince Edward Island | Another day off with pay, usually the next working day | Substitute only | ESA, paid holiday on a non-working day (verify) |
| Newfoundland and Labrador | Another day off with the same pay | Substitute only | LSA ss. 14–17 (verify) |
| Yukon | Holiday with pay on the next working day | Substitute only | ESA, general holidays (verify) |
| Northwest Territories | Holiday pay, or another day off with pay | Pay or substitute | ESA, general holidays (verify) |
| Nunavut | Holiday with pay on the next working day | Substitute only | LSA, general holidays (verify) |

How the app uses it:

- **Payroll settings › When a holiday falls on a weekend** (EN/FR): close on the statutory day (default) or the **next weekday** that isn't already a holiday, as most municipal collective agreements do (Christmas 2027 on a Saturday → Monday the 27th, Boxing Day on the Sunday → Tuesday the 28th); and, where the province allows a choice, a substitute day or pay. A choice the province doesn't allow is ignored there. Changes are audited.
- **Pay runs**: hours worked on the person's statutory day are paid at the holiday rate, and where the organization observes the next weekday, hours on that weekday too (an agreement adds to the statute; it doesn't move the statutory premium away). Holiday pay is paid once per holiday. When it falls on their day off: the rule above; a substitute day owed is flagged on the run (unless the organization's observed weekday was a day off they'd usually work), and the holiday pay is on the run with the holiday.
- **Forecast**: the holiday's effect applies on its own date, on the day the law moves it to and on the organization's observed weekday, marked "observed". The shift-pay preview uses the same days.
- **Time off and HR leave** list the coming holidays with their own date and the day off for each.
- **Partly built:** a "federally regulated" switch (Fill settings) schedules under the Canada Labour Code rules, but pay runs still follow the facility's province. Leave charges still count weekdays without skipping holidays.

### Review checklist for counsel

1. Daily/weekly OT thresholds and the stacked vs. greater-of method per province.
2. Rest rules, including BC split shifts (12-hour span) and Ontario's 13-hour exception.
3. Whether stat-holiday hours count toward weekly OT in each province (currently: they do).
4. Young-worker limits per province and how school days and hours should be sourced.
5. Vacation pay tiers and the wage base (whether OT and stat pay are included).
6. Holiday pay eligibility formulas.
7. Time in lieu: the agreement, the take-within period and payout on leaving, per province.
8. Holidays on a weekend or a day off: the table above, the sections marked "verify", the 5-of-9-weeks test outside Alberta, Canada Day on July 2 in provinces that don't set a date, and paying holiday pay with the holiday when a substitute day is owed later.
9. The BC/Alberta "day" for shifts past midnight (24 hours from the shift's start) in daily overtime and daily hour limits, how a rolling day meets the calendar day around it, and whether Alberta applies it to every shift or only those past midnight.
10. Ontario's 11-hour daily rest measured in the 24 hours from each shift start (rest may cross midnight).
11. Weekly rest per pay week (longest time off in a row), Ontario's 48 hours over two weeks counted in fixed pairs, the 12-day cap on days in a row, and the federal rule set (CLC ss. 169, 173, 173.01, 173.1, 174, 179) used for scheduling only.

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
- **Automated decisions (Law 25 s.12.1):** the reliability score is advisory, never an input to scheduling or discipline, and fully explainable to the employee: every deduction, fading deduction, recovery credit and yearly restart is listed on their file, and the same computation feeds the case file, People review flags, the HR overview, the nightly stored score and the reliability report.
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
- **T4A** for people paid who aren't employees (contract instructors, council and committee honoraria): box 048 fees for services, 028 other income (honoraria), 020 self-employed commissions, 022 income tax withheld. A slip is made when a payee's boxes total more than $500 in the year, or tax was withheld. The XML has the T619 transmittal, slips and summary; it needs a passkey (it contains full SINs) and lists what's missing first. Run the first file through CRA's validation before filing. Payments are entered by payroll; they don't come from pay runs.
- **Expenses and mileage** are paid on the next pay run as reimbursements: not taxed, not insurable or pensionable, and not on the T4. A reasonable per-kilometre allowance and repayment of actual costs with receipts aren't income (Income Tax Act s. 6(1)(b)(vii.1)). The city sets a two-tier rate like CRA's (FH ships 72¢ for the first 5,000 km and 66¢ after, CRA's 2025 rates); check CRA's rates each January. Receipts are required above the city's amount (default $25). Nobody approves their own claim, and a claim is marked paid when its run is approved, so it can't be paid twice.
- **Court and CRA orders** are taken as entered; check each order's exemption limit (it varies by province and order).
- **Payroll providers:** when a city keeps ADP, Dayforce or Wagepoint, the approved hours go to the provider; filing and remittances are then the provider's job.

## Aquatic operations

- Chemical thresholds and bather-to-lifeguard ratios come from each facility's permit and provincial pool regulation. The seed's values are placeholders.
- Incident reports may need to go to WorkSafeBC / WSIB / the health authority; envelope encryption (rather than user-held keys) keeps that possible.
