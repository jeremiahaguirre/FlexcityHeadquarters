# Legal register

The federal and provincial laws that apply to FlexcityHeadquarters (FH) and its customers, what the
product does about each, and the open risks. Written November 2026 by the engineering team from the
code and docs as they stand; **it does not replace a lawyer's review**, and every "Counsel" item must be
confirmed before launch. Severity: **High** (could block launch or lead to a complaint or penalty),
**Medium**, **Low**.

## Privacy

| Law | What the product does | Open risk | Severity | Owner action |
| --- | --- | --- | --- | --- |
| PIPEDA (FH as organization for its website, marketing, billing; customers' private-sector data where it applies) | Privacy policy v2.3 (website), consent at collection, access/correction handling, safeguards (RLS, per-customer keys), breach process (`SECURITY-OPERATIONS.md`) | Privacy officer not named; policy is a draft | High | Name the privacy officer (config `NEXT_PUBLIC_PRIVACY_OFFICER_*`); counsel review of the policy |
| Quebec Law 25 (private-sector Act; public bodies' Access Act) | Person in charge placeholder; s. 8.1 analytics off until allowed; s. 12.1 no exclusively automated decisions (attendance score and scheduling assistant are advisory); s. 17 assessment before transfers outside Quebec; portability and de-indexing described | Transfer assessments (s. 17) for Vercel, payment processor, Twilio not written; confidentiality-incident register procedure for FH as organization | High | Write the s. 17 assessments; publish the person in charge's title and contact |
| Provincial public-sector laws (BC FIPPA incl. s. 33 disclosure outside Canada, ON MFIPPA, AB, others) | Canadian hosting design (`INFRASTRUCTURE.md`), PIA template (`PIA.md`), customer is the public body | Hosting is planned, not live; BC public bodies have strict out-of-Canada rules (CloudFront edge caching, Twilio, Stripe) | High | Confirm in writing per customer; allow turning off non-Canadian services |
| Alberta / BC PIPA (private employers) | Same safeguards; employee notice at first sign-in | — | Low | — |

## Marketing and messages

| Law | What the product does | Open risk | Severity | Owner action |
| --- | --- | --- | --- | --- |
| CASL (S.C. 2010, c. 23) and CRTC regulations | All outbox emails are transactional (classified in `mailer.ts`, test); commercial email only through `sendCommercialEmail` (consent ledger, sender ID, mailing address, one-click unsubscribe + List-Unsubscribe headers, immediate effect); refuses in production without `COMPANY_LEGAL_NAME`/`COMPANY_MAILING_ADDRESS`; contact form consent unticked and separate, wording and date recorded | No commercial email is sent today; when one is added it must use the gate. Suppression stored as Lead rows (no dedicated table). Consent request on the site names the company from config placeholders | Medium | Set the company name and address; add an `EmailSuppression` table when convenient (schema change) |
| US CAN-SPAM (for US recipients) | Same footer and unsubscribe satisfy it | — | Low | — |

## Copyright

| Law | What the product does | Open risk | Severity | Owner action |
| --- | --- | --- | --- | --- |
| Copyright Act, ss. 41.25–41.27 (notice and notice) | Website "Copyright notices" page EN/FR; internal procedure `LEGAL-OPS.md`; terms say customers are responsible for uploads | Copyright contact not set; retention hold for 6/12 months is a manual step | Medium | Fill `NEXT_PUBLIC_COPYRIGHT_CONTACT_*`; counsel review (`LEGAL-OPS.md` §9) |

## Advertising and pricing

| Law | What the product does | Open risk | Severity | Owner action |
| --- | --- | --- | --- | --- |
| Competition Act (misleading representations; drip pricing, s. 74.01(1.1)) | Website prices are per month before tax, with taxes stated; renewal terms and refund line beside every quote button; no testimonials, ratings, user counts or uptime figure; "compliant" claims reworded to "checked against your rules" | Setup fee mentioned on the plans page: make sure any mandatory fee is shown with the price wherever a price is shown | Medium | Owner to confirm there are no other mandatory fees beyond what the page lists |
| Provincial consumer protection (ON CPA 2002, QC CPA, etc.) | Customers are businesses and public bodies, so mostly not consumer contracts; still: automatic renewal disclosed beside buttons, 30-day reminder email, cancellation method and deadline stated | If a sole proprietor or very small club buys, consumer rules may apply | Low | Counsel: confirm B2B-only position and whether to refuse consumer sign-ups |

## Language

| Law | What the product does | Open risk | Severity | Owner action |
| --- | --- | --- | --- | --- |
| Charter of the French Language (Bill 96) | Website, legal pages, app UI, emails, PDFs in Canadian French; key-parity tests; terms say the French version prevails in Quebec | Contracts of adhesion in Quebec must be presented in French first; the English-choice clause needs counsel; order forms and the subscription agreement must exist in French | Medium | Counsel: language clause; produce French order form and agreement |

## Accessibility

| Law | What the product does | Open risk | Severity | Owner action |
| --- | --- | --- | --- | --- |
| AODA / IASR (Ontario), Accessible Canada Act context, procurement | WCAG 2.1 AA target; axe run on the website pages at 390/1280 px, light/dark: no violations; accessibility statement v2.1 | No independent audit; app-wide axe pass not repeated in this round | Medium | Commission an audit before general availability |

## Employment, safety, payroll

| Law | What the product does | Open risk | Severity | Owner action |
| --- | --- | --- | --- | --- |
| Provincial employment standards (hours, OT, rest, holidays, young workers) | Rule engine and counsel checklist in `COMPLIANCE.md`; terms say results must be reviewed by the customer | Calculation errors could cause under-payment claims against customers | High | Counsel and payroll review of the checklist items; keep the disclaimer |
| Young workers (minimum ages) | Careers form: "16 or older" or "14 or 15" with a named guardian's consent; under 14 not taken online; BC link | The table is deliberately uniform (16/14) and only BC's link is filled in | Medium | Counsel: verify per-province ages and add each province's link (`apps/api/src/services/legal/ages.ts`) |
| Age of majority (program sign-up) | Adult confirmation by province (19 in BC, NB, NL, NS, NT, NU, YT; 18 elsewhere); guardian consent for children; server-enforced, audited | — | Low | — |
| OHS / workers' compensation (working alone, injury reports) | Working-alone check-ins labelled as an aid in the app and the terms; 911 prompts | Reliance on the app as the only working-alone procedure | Medium | Customers must keep their own procedure (terms); consider adding to onboarding |
| Payroll and tax (ITA, CPP, EI, QPP, QPIP, CRA/RQ tables) | Payroll calculations and filing files; terms tell customers to review against current CRA/RQ tables | Table dates and RL-1 certification each year | High | Yearly table update and Revenu Québec certification (`COMPLIANCE.md`) |
| Ontario ESA electronic monitoring policy (25+ employees) | Docs in `ELECTRONIC-MONITORING.md`; website FAQ tells customers they need their own policy | Customers not told in the app | Low | Mention in customer onboarding |

## AI and automated decisions

| Law | What the product does | Open risk | Severity | Owner action |
| --- | --- | --- | --- | --- |
| Law 25 s. 12.1; federal AIDA not in force | No exclusively automated decisions; privacy policy explains the attendance score and scheduling assistant | If a feature ever acts without a person, notice and review rights are required | Low | Keep the "advisory" design; re-assess before any auto-approval |

## Company and contracts

| Item | Status | Severity | Owner action |
| --- | --- | --- | --- |
| Legal name, mailing address, contact email, privacy officer, copyright contact, governing province | Placeholders from config (site and API) | High | Fill in before launch |
| Subscription agreement, order form, SLA, DPA | Not in the repo; terms summarize and defer to them | High | Have counsel draft them |
| Refund policy | Reflects the code: no proration, changes from the next invoice, 60-day billing-error window (a business choice) | Medium | Owner to confirm the choices |
