# Compliance notes

See also the [security and legal audit](SECURITY-LEGAL-AUDIT.md) and the [operations runbook](SECURITY-OPERATIONS.md).

> **Not legal advice.** The rule values in `apps/api/src/services/compliance/provincialRules.ts` reflect a reading of each statute and ship with `verified: false`. Every payroll result and eligibility check carries a warning until Canadian employment counsel has reviewed them. Do not run production payroll on unreviewed rules.

## Employment standards

- Rules follow the **province where the work is done** (the facility), not the employer's head office.
- Values are effective-dated. When a law changes, add a new rule set with a new `effectiveFrom`; past periods keep recalculating with the old rules.
- Collective agreements are applied as `RuleOverride` rows (e.g. OT after 7.5 h/day) with a cited source.
- Items deliberately left unautomated (surfaced as warnings): statutory holiday pay formulas outside BC, ON, QC and SK; averaging agreements; unpaid meal breaks are now modelled (see "Work rules" below).
- **The "day" for daily overtime and daily hour limits** (`services/compliance/workDay.ts`, used by payroll's daily overtime in `payCalc.ts` and by scheduling's projections and limits): a calendar day, except in **BC and Alberta**, where a shift that continues past midnight starts a 24-hour day at its start (BC ESA s. 1 "day" (b); Alberta ESC "work day"). So BC 16:00–08:00 is one 16-hour day: 8 regular, 4 at 1.5, 4 at 2.0; 22:00–08:00 has 2 hours of daily overtime. Windows never overlap: the rolling day cuts the calendar day it starts in, and the rest of the calendar day after it is a day of its own. **Counsel to verify** (checklist item 9).
- **Daily rest (Ontario, 11 consecutive hours each day, ESA s. 18(1))**: measured in every 24 hours that start at the start of a shift, with rest allowed to cross midnight. Ordinary day shifts (07–15, 08–16, 09–17, 07–19) and 12-hour nights pass; 07–15 then 23–03 (8 h and 4 h off) is refused. A strict midnight-to-midnight reading would refuse almost every day shift, which isn't how the Ministry applies it. **Counsel to verify** (item 10).
- **Weekly rest**: the longest consecutive time off inside each pay week must reach the province's hours (BC 32, Quebec 32, Ontario 24 or 48 in each fixed pair of consecutive weeks, Alberta and the others 24); `rolling7` is supported for a province that counts any 7 days. The organization's "most days in a row" can't exceed 12 (a day off each pay week). Refused only when the new shift causes or worsens the shortfall. **Counsel to verify** the pay-week reading and Ontario's pairing (item 11).
- **Federally regulated** organizations or departments (Fill settings, `overtimePolicy.solver.federallyRegulated`) are scheduled under the Canada Labour Code set (8 h/day and 40 h/week overtime, 8 h between shifts, 24 h off each week, minimum age 17 for most work, 96 hours' schedule notice warned on publish). **Payroll still follows the facility's province**: a federal pay calculation is not built.
- **Seniority is optional per organization** (Settings, or the Dev console's Features). On, the default for cities, seniority dates and hours break ties in the overtime order, call-outs and the scheduling assistant. Off, ties go by fewest hours then name, seniority isn't shown on people's records or the overtime order, and the assistant fills shifts evenly. Private-sector companies created in the Dev console start with it off. Where a collective agreement sets seniority rules, keep it on.

### Work rules: meal breaks, call-in pay, notice, premiums, standby, working alone

Code: `services/scheduling/workRules.ts` (pure rules, shared by payroll and scheduling), `services/payroll/workRulePay.ts` (payroll), `services/compliance/provincialRules.ts` (`mealBreak`, `reportingPay`), `services/scheduling/changeNotice.ts`, `onCall.ts`, `rotations.ts`, `twoPerson.ts`. Settings in `Tenant.workRules`, organization-wide with per-department overrides (Work rules screen; pay rules need `tenant.configure`, a department's scheduler may set its meal-break placement and warnings).

**Statutory meal breaks and minimum call-in pay (our reading, PENDING COUNSEL REVIEW).**

| Jurisdiction | Meal break | Minimum call-in (reporting) pay | Sources |
| --- | --- | --- | --- |
| BC | 30 min so no one works > 5 h in a row | 2 h; 4 h when scheduled > 8 h | ESA ss. 32, 34 |
| AB | 30 min per 5 h of work (verify the 10-hour second break) | 3 h (verify) | ESC ss. 18, 21 |
| SK | 30 min per 5 h (verify the short-shift exception) | 3 h (verify) | SEA s. 2-23; Regulations |
| MB | 30 min after 5 h | 3 h (verify) | ESC ss. 50, 51 |
| ON | 30 min so no one works > 5 h in a row (two 15-min by agreement) | 3 h, "three-hour rule" for someone who regularly works > 3 h a day (verify the wage basis) | ESA s. 20; O. Reg. 285/01 s. 21.2 |
| QC | 30 min unpaid after 5 h | 3 h | LNT ss. 58, 79 |
| NB, NS, PE | 30 min after 5 h (verify) | 3 h (verify) | ESA (NB) s. 17.1; LSC (NS) s. 66A; ESA (PE) s. 16; minimum wage orders |
| NL | 1 h after 5 h (verify) | 3 h (verify) | LSA; Regulations |
| YT | 30 min after 5 h (verify) | not encoded | ESA s. 11 |
| NT, NU | not encoded | not encoded | — |
| Federal | 30 min in every 5 h | 3 h | CLC s. 169.1; CLSR s. 11.1 |

How the app applies them:

- **Unpaid meal breaks.** Each position has an unpaid break (applied to its shifts longer than 5 hours); a shift can set its own. Paid hours = shift length − unpaid break, everywhere: overtime projections, Fill (cost, targets, "avoid overtime"), planner hours, pay previews and payroll. Payroll takes the planned break out of a punch only when the person punched once for the shift and the punch covers the whole planned break window (someone who left before or during the break isn't docked; placed mid-shift, starting no later than the province's 5 hours or the organization's placement); two or more punches for a shift mean the break was punched and the punches are paid as recorded. Unscheduled punches are paid as recorded. A shift long enough to need a break with none (or too little) planned is a **warning** (planner, publish check), never a refusal: the break may be paid at the post.
- **Minimum call-in pay.** Someone who reports for a scheduled shift and works less than the minimum gets a `REPORTING_PAY` top-up at their rate. The minimum is the province's (above) or the organization's/department's if higher (never lower): the statutory minimum always applies, and switching off "Pay our own minimum" only drops the organization's higher one. Shifts shorter than the minimum are flagged in the planner and before publishing, and the forecast's minimum shift length defaults to it when the organization hasn't set one. Not automated (the app pays the top-up whenever a scheduled shift's punches come to less than the minimum, which can pay more than the statute asks, never less): Ontario's "regularly works more than 3 hours" condition and minimum-wage basis (the app tops up at the person's own rate), the statutes' exceptions (the person left by choice or was unfit to work, work stopped for reasons beyond the employer's control such as weather; payroll can remove the line with a pay adjustment), and a shift cancelled after the person arrived without a punch (add a pay adjustment).
- **Call-backs** (a call-back shift from the on-call roster, and winter call-outs) get the department's call-back minimum (default 3 h, else the call-in minimum, never below the statutory call-in minimum) as `CALLBACK_PAY`: one top-up per call-back shift, however many punches, the multiplier applying to the top-up hours only (hours worked are paid from the punches, with overtime as usual). A winter call-out is a call-back shift; there is no separate call-out minimum, so nothing is paid twice. Rest after a call-back: the shared rule check refuses a call-back that breaks the province's rest rules unless the supervisor confirms an emergency (audited), and a next shift inside the province's between-shift rest is flagged to the department's schedulers.
- **Schedule notice and late-change premiums** (collective agreements; no general statute except the federal 96 h, already warned). Every change a scheduler makes to a published shift (times, person added or removed, cancellation) is recorded with the notice given. When it's shorter than the department's `lateChangeHours`: a warning before saving, the person is notified, and a premium is recorded: the changed hours (new hours outside the old shift; a whole shift for someone added) at (multiplier − 1) × rate, or a flat amount per change. It is paid as `SCHEDULE_CHANGE_PREMIUM` in the period of the shift's date and can be waived (audited, only for shifts in the waiver's own scope). A shift changed again is measured against the person's times before the first late change still standing, and the new premium replaces the earlier ones (shown as replaced, audited): 09–17 → 09–19 → 09–20 pays 3 changed hours, back to 09–17 pays none, and taking the person off drops them. Flat premiums stay per change. A change the employee asked for is not detected: waive it. ADP exports the premium as an amount (other layouts carry the amount too). Trades and Shift Board claims are the person's choice and earn nothing. "Post N days ahead" asks for confirmation before publishing later.
- **Shift premiums** by rule (evening, night, weekend, statutory holiday; wall-clock windows past midnight and DST-correct; $/h or % of the rate; per department or position) are paid as `SHIFT_PREMIUM` lines on paid hours and costed by Fill. Every matching rule applies (they stack). A shift's own `premiumPerHour` still applies on top.
- **Standby pay**: per day on call and/or hours per day at a percent of the rate, as `STANDBY_PAY` (an amount; no hours on the statement or the ROE). Days are counted from the on-call period's own start, wall-clock (a week across a DST change is 7 days), and each day is paid in the pay period it starts in, so a week split across two pay periods is 7 days in all.
- **Two-person minimum (working alone).** Positions or shifts marked "never alone" need a second person qualified for the position at the same facility for the whole shift. Fill leaves such a shift open (`TWO_PERSON`) rather than put someone alone, the planner and publish check list violations, and publishing needs a confirmation. This complements, not replaces, the province's working-alone procedures (OHS regulations).
- **Regression**: shifts and punches with none of these rules pay exactly as before (tests).

- **Shift premiums and overtime.** Rule premiums (and a shift's own $/h) are paid on every paid hour, regular or overtime, at their face value: they are not multiplied by 1.5 or 2 on overtime hours, and overtime is 1.5 × the base rate, not the base rate plus premiums. A statutory-holiday premium rule is paid on top of the statutory holiday pay (the screen warns that a rule repeating the law's pays it twice).
- **Statement and ROE hours.** Shift-premium, change-premium, standby, vacation and holiday-pay lines add no hours (before this, shift-premium hours were added to statement hours, inflating ROE insurable hours; gross, deductions, T4/RL-1 amounts and exports were unaffected). ROEs read each statement's hours from its earnings lines, so statements made before the fix are read correctly. Call-in and call-back top-up hours are counted.

**For counsel:** every row marked "verify" above; whether deducting a planned unpaid break from a single punch is acceptable where the person was not relieved (the app relies on supervisors approving punches); Ontario's three-hour rule basis; whether call-back minimums and change premiums count for overtime and vacation pay (the app pays vacation pay on them and doesn't count them as hours worked for overtime). Also: (a) the overtime "regular rate" where shift premiums apply (ON ESA s. 22 and BC ESA s. 40 speak of the regular rate/wage: should overtime hours carry 1.5 × the premium too? the app doesn't); (b) whether call-in and call-back top-up hours are insurable hours for the ROE (the app counts them; Insurable Earnings and Collection of Premiums Regulations s. 9.1 speaks of hours actually worked and paid); (c) the citations: Ontario's three-hour rule (the app cites O. Reg. 285/01 s. 21.2; confirm the section and its exceptions), Alberta's three-hour minimum (cited as Code s. 21; it may be the Employment Standards Regulation), BC s. 34 (the 2 h/4 h split by "scheduled to work more than 8 hours": the app reads scheduled paid hours, so 08:00–16:30 with a 30-minute break is 8 h and the 2-hour minimum applies; also its "whether or not the employee starts work" and weather exceptions); (d) whether per-change flat late-change premiums should be paid for each of several changes to the same shift.

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
12. Work rules: the meal-break and call-in table above, the single-punch break deduction, the call-back and late-change premium treatment (see "Work rules").

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

## Legal risk review (November 2026)

What was checked and changed for six legal risks and the follow-up scope. Drafted by engineering from
the code; **this does not replace a lawyer's review**. Every judgment call is in the counsel list at
the end. Related: [LEGAL-REGISTER.md](LEGAL-REGISTER.md) (laws, open risks, owner actions),
[LEGAL-OPS.md](LEGAL-OPS.md) (copyright notices), [ASSET-LICENCES.md](ASSET-LICENCES.md).

### Age and consent

- **Staff accounts** are created by employers (invites); there is no self sign-up. No change.
- **Program sign-up portal:** the person filling the form confirms they are of the age of majority where
  the program or facility is (19 in BC, NB, NL, NS, NT, NU, YT; 18 elsewhere; unknown province → 19),
  and, for a child, that they are the parent or legal guardian and consent to the child's information
  being collected. Someone under the age of majority can't register themself (`MINOR_SELF`). The API
  refuses the form without these (`consents.adult`, `consents.guardian`); the household note and the
  audit log record them with the time and a fingerprint of the organization's terms as shown.
  Bookings require the adult confirmation too. Code: `apps/api/src/routes/signup.ts`,
  `services/legal/ages.ts`.
- **Careers page:** no date of birth. The applicant picks "16 or older" or "14 or 15"; 14–15 needs a
  parent's or guardian's name and consent; under 14 is not taken online. The province is the posting's
  facility (or the organization's first facility); BC's young-worker page is linked. The answer goes in
  the application's notes for HR and in the audit log with the notice version.
- **Website contact form:** for organizations, says not to include children's information; the
  marketing box is separate and unticked; the consent request names who is asking (CASL s. 10(1)).

### Fonts

Both apps self-host Plus Jakarta Sans with `next/font/local` (OFL), from the woff2 committed in
`src/fonts`: builds download nothing and pages request no font from another host. Emails use the
system font stack only (no web font named or linked); PDFs use PDFKit's built-in base-14 fonts
(nothing fetched). `font-src 'self'` everywhere: the app's middleware CSP and `next.config.mjs`
headers, the website's CSP header (`font-src 'self'; object-src 'none'; base-uri 'self'; form-action
'self'; frame-ancestors 'none'`), and a `<meta>` CSP in both apps for static hosts (the demo).
Tests: `apps/site/src/content/compliance.test.ts` (Google Fonts in sources), the two
`selfHostedFonts.test.ts` files (every `@font-face` in the build is the committed file from our own
origin, Tailwind stacks are the brand font then system fonts), `apps/api/test/unit/fonts.test.ts`
and `apps/web/e2e/fonts.e2e.ts` (pages render the brand font with every other host blocked). See
`docs/ASSET-LICENCES.md`.

### Session replay and error reports

No session replay or recording SDK (Sentry Replay, LogRocket, Hotjar, FullStory, PostHog, Clarity,
rrweb…) in any app. A test fails if one is added to a manifest, the lockfile or the code; adding one
needs opt-in consent, input masking on by default, a SUBPROCESSORS entry and a privacy-policy update in
the same change. The browser error reporter sends error name, message, stack, a path with ids removed
and the build only; the API scrubs it again (`lib/scrub.ts`). It never reads the DOM or form values.

### Cookies, storage and website analytics (decision)

- Inventory (code, then Playwright): the website sets **no cookies**; after the consent choice it keeps
  `fh-analytics` in localStorage. The app sets `fc_refresh` (HttpOnly, 14 days), `fh_platform` (Dev
  console, 8 h), `fc_sso` (10 min), `fh_kiosk` (HttpOnly, facility kiosks only, 400 days), `fh_support`
  (HttpOnly, an FH support visit), `fc_locale` (1 year) and the local/session storage keys listed on
  the website's Cookies page (a test checks the page lists every key the code defines). Playwright on
  the site (all pages, EN/FR, 390/1280, light/dark) and the app sign-in saw **no third-party requests
  and no iframes**.
- **Decision:** everything except website analytics is strictly necessary or functional and is
  disclosed (PIPEDA implied consent for necessary items). Vercel Web Analytics is cookieless and keeps no
  identifier past a day, so a banner may not be legally required; but Law 25 s. 8.1 asks that technology
  able to identify, locate or profile a person be off by default, so the website now keeps analytics
  **off until the visitor allows it** (small non-blocking consent bar; the script isn't even loaded
  before "Allow"), honours Global Privacy Control and Do Not Track, and has a footer switch. The app
  has no non-essential items, so it has no banner.

### CASL (commercial email)

- Every outbox template (`services/notifications/mailer.ts`) is transactional: account, security,
  safety, schedule, pay, billing (invoices, PAD, renewal reminder), registration and booking messages.
  Each now ends with a sender line; staff notices say where email choices are made (the organization's
  switch; texts and push in the profile). A unit test keeps every template classified.
- FH sends **no commercial email today** (no newsletter, no nurture, no Dev console bulk email). If one
  is added, it must go through `services/marketing/casl.ts` `sendCommercialEmail`, which:
  refuses in production until `COMPANY_LEGAL_NAME` and `COMPANY_MAILING_ADDRESS` are set; checks
  consent (express from the website box with its wording and date; implied for 6 months after an
  enquiry, s. 10(10)(b); withdrawn by any unsubscribe until the person opts in again); adds the legal
  name, mailing address, a contact and a one-click unsubscribe link (signed token, no sign-in, works
  indefinitely, effective immediately); and sets `List-Unsubscribe` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058). Landing page: `/unsubscribe` in the
  app. The Dev console's Enquiries page shows each address's CASL status.
- **No new table:** unsubscribes are Lead rows of kind `UNSUBSCRIBE`, hidden from the enquiries list and
  kept indefinitely (the retention job never clears them). A dedicated `EmailSuppression` table
  (email, source, created at) is cleaner: **schema change needed** when convenient.
- Website enquiries: personal details removed two years after the last exchange unless won (hourly
  job), matching the privacy policy.

### Renewal terms and refunds

- Billing behaviour (from `services/billing/terms.ts`): a term holds prices with a commitment discount;
  when it ends it continues month to month at the same rates without the discount; usage beyond the
  allowance is billed monthly; no proration (changes apply from the next invoice); credit notes are
  manual in the Dev console.
- The organization's Billing page shows, beside every pay, bank-debit and plan button: price before tax
  (GST/HST/QST), frequency, term and end date, automatic renewal and its price, how and by when to cancel,
  the 30-day reminder and the refund line. The Dev console previews it. Website: the same summary beside
  every "Get a quote" button, and Terms and Refund policy pages. Tests check each button has it.
- New **renewal reminder** email to the billing contact 30 days before a committed term ends
  (transactional; hourly job; once per term).

### Copyright notices

Website page (EN/FR) on Canada's notice-and-notice regime only (Copyright Act ss. 41.25–41.27):
required notice contents, where to send (config placeholder), forwarding, record retention (6 months /
1 year), no fee, no identity disclosure without a court order, invalid notices (s. 41.25(3)), hedged
takedown wording. Procedure: [LEGAL-OPS.md](LEGAL-OPS.md).

### Claims on the website

Before → after (EN and FR):
- "A customer success manager and a 99.9% uptime commitment" → "… a service level agreement (terms in
  your order form)"; plan table row "99.9% uptime commitment" → "Service level agreement (terms in your
  order form)"; same in the app's plan labels (`plans.service.sla`).
- "An operator in charge always scheduled, with gap alerts" → "A gap alert when no operator in charge is
  scheduled".
- "Schedules that follow the rules" / "Des horaires conformes" → "Schedules checked against your rules" /
  "Des horaires vérifiés selon vos règles".
- FR lead "… conforme au droit du travail canadien" (not in the English) → translated the English lead.
- FAQ "Is it legal under Canadian privacy and employment law?" / "Est-ce conforme…?" → "How does it
  handle Canadian privacy and employment law?" / "Comment tient-il compte…?".
- No testimonials, ratings, customer logos, user counts, savings statistics or certification claims were
  found. Screenshots use the fictional "City of Lakeview (demo)". `docs/PRICING.md` mentioned the
  99.9% figure as an internal plan note: now replaced with "service level agreement" (no published uptime figure).

### Data minimization (forms reviewed)

| Form | Field | Decision |
| --- | --- | --- |
| Website contact | name, work email, message | Kept: needed to reply |
| | organization, role, province, facilities | Kept, optional: sizing a quote |
| | marketing consent | Kept, optional, unticked |
| Careers apply | name, email, message, certifications, résumé | Kept (phone, message, certifications, résumé optional) |
| | age | Range only ("16 or older" / "14 or 15"); no date of birth |
| | guardian name and consent | Only for 14–15 |
| Program sign-up | guardian name, email, phone | Kept: confirmation and contact (phone needed by facilities for safety) |
| | address | Already optional |
| | emergency contact | Kept: child safety during programs |
| | participant date of birth | Kept: places the child in an age-based level (the API checks it) |
| | safety note, photo consent | Optional |
| Booking request | name, email, phone | Kept; organization and notes optional |
| App profile and payroll | home address, SIN, bank | Only when payroll runs in the app (existing design; see PIA) |
| — | gender | Not collected anywhere |

### Accessibility

axe-core 4.10 (WCAG 2.0/2.1 A and AA rules) on every website page, EN/FR, at 390 and 1280 px, light and
dark: **no violations**; no horizontal overflow (the contact form overflowed at 390 px because of long
placeholder text; fixed). New controls (consent bar, footer switch, age questions, unsubscribe page)
use labelled native inputs, 44 px targets and live regions. Not repeated this round: a full app-wide
axe pass (done earlier), an independent audit.

### Counsel review (legal judgment calls, November 2026)

1. Working-age table: uniform "16 alone / 14–15 with guardian consent / under 14 not online", and only
   BC's link; verify each province and add links (`services/legal/ages.ts`).
2. Age-of-majority confirmation and guardian-consent wording on the sign-up portal; whether an adult
   registering a child they are not the guardian of (e.g. a grandparent) should be allowed.
3. Law 25 s. 8.1 reading that leads to opt-in website analytics; whether the cookieless analytics needs
   it at all.
4. CASL: implied-consent window used (6 months after an enquiry); treating any later enquiry as not
   reviving consent after an unsubscribe; footer wording; classification of every template as
   transactional (s. 6(6)), including the renewal reminder.
5. Using Lead rows as the suppression list until a table exists.
6. Renewal disclosure and the 30-day reminder as a B2B courtesy vs. Ontario/Quebec consumer rules;
   whether consumer customers should be refused.
7. Refund policy choices taken from the code: no partial-period refunds, no proration, prepaid terms not
   refunded on early cancellation, 60-day window to report billing errors (**the 60 days is a business
   choice for the owner**).
8. Privacy policy v2: the two-role description, transfer wording (Vercel, CloudFront, Twilio, payment
   processor, push services), the "planned" hosting statement, rights (portability, de-indexing),
   incident wording, 30-day response time.
9. Terms v2: subscription summary deferring to the agreement, liability and indemnity summary, no
   uptime figure, suspension after the grace period, data export until the deletion date, governing
   province (**placeholder; owner to choose**; the old draft said British Columbia), dispute clause,
   language clause under the Charter of the French Language.
10. Copyright notice page and `LEGAL-OPS.md` §9.
11. Accessibility statement: AODA/ACA references and "no full conformance claimed".
12. Working-alone "aid, not a replacement" wording in the app and terms.
13. Claims rewrites listed above.
14. Competition Act drip pricing (ss. 52(1.3), 74.01(1.1)): the plans page shows monthly prices and,
    in a separate section, a mandatory one-time setup fee as a range. Whether the setup fee must be
    shown with each price (or stated as "plus a one-time setup fee") is for counsel.
15. Charter of the French Language s. 55 (as amended by Bill 96): the terms say the French version is
    "provided first and prevails" and that the parties may agree to be bound by the English version.
    Counsel to settle one clause that fits contracts of adhesion and negotiated agreements.
16. Law 25 s. 8.1 is now described as "tell people and how to turn the functions on, which we read as
    off by default" (the "off by default" reading is ours). Portability is cited as s. 27 and
    de-indexing as s. 28.1.
17. Accessibility statement: AODA's regulation (O. Reg. 191/11) references WCAG 2.0 AA; the statement
    now says WCAG 2.1 AA "includes" it and that WCAG 2.1 is the basis of the standard used under the
    Accessible Canada Act. Confirm the federal standard's current name and version.
18. Owner: set a reply time for accessibility feedback if one is wanted (the undocumented "two business
    days" promise was removed).
19. Owner: trials ending mid-month. Billing now skips only months wholly inside a trial; the month in
    which a trial ends is invoiced in full (no proration). Confirm, or say so in order forms.

### Verification pass (November 2026)

An independent check of the legal pages against the code. Fixed: taxes now name PST/RST/QST as
`billing/tax.ts` charges them (terms, refunds, renewal note, the app's Billing page); the cookies page
no longer says offline clock-in and attendance queues are wiped at sign-out (only class rosters and
cached pages are; unsent clock-ins prompt send-or-delete); the privacy policy lists facility booking
requests and the optional sign-up address and photo consent, says the email provider is not yet
chosen, says at-rest encryption is part of the planned hosting, and describes error reports as they
are (type, message, stack, scrubbed); the website FAQ no longer says FH staff "never" see employee
records (the Dev console shows signed information agreements with names, emails and device addresses,
each view audited, and setup imports); the copyright page adds regulation-excluded content and says
identity is disclosed only where the law requires; billing no longer drafts invoices for months wholly
inside a free trial; a valid unsubscribe link is never rate-limited (mail apps' one-click POSTs share
server addresses).

Checked in a browser on a scratch build (website, 11 pages × EN/FR × 390/1280 × light/dark): axe
(WCAG 2.0/2.1 A/AA) clean, no horizontal overflow, 104 internal links all 200, no cookies, no
third-party requests; `fh-analytics` is the only storage after the consent choice; the Vercel script is
requested only after "Allow"; with Global Privacy Control or Do Not Track no bar appears and nothing
loads. Unsubscribe end to end (landing page EN/FR, invalid link, confirm, reload, RFC 8058 one-click):
works, recorded as a Lead row of kind `UNSUBSCRIBE`. Sign-in and Dev console sign-in link to the four
website legal pages.

Not verifiable offline: what Vercel's production analytics script stores or sends (taken from Vercel's
documentation); whether any fee regulation exists under Copyright Act s. 41.26(2); current CRTC
guidance. Note: unsubscribe links are signed with `JWT_SECRET`; rotating it breaks links already sent
(CASL s. 11(2): they must work for 60 days after sending). Rotate only with a grace period, or move the
signing key to its own secret.
