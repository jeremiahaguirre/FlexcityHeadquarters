# Subprocessors and vendor vetting

Vendors that store or process personal information for FlexcityHeadquarters' customers. A vendor is
added only after the checks below; each city is told 30 days before a new one is used.

| Vendor | What for | Personal information | Location | Status |
| --- | --- | --- | --- | --- |
| Amazon Web Services | Hosting, database, backups, key management (KMS) | All application data | Canada (Central), `ca-central-1` only: the API refuses another region | To confirm before launch: DPA, SOC 2 Type II and ISO 27001 reports on file |
| Email delivery (to be chosen) | Sign-in links, notifications | Recipient address, message (the app keeps no copy of contents) | Canada preferred | Choose: Canadian region, DPA, SOC 2 |
| Stripe (optional, per city) | Card and pre-authorized debit payments for FH invoices | Billing contact, payment method (held by Stripe, not FH) | Canada / US | Only when a city pays by card; PCI DSS Level 1 |
| Browser push services (Google FCM, Apple Push, Mozilla, Microsoft WNS) | Delivering notifications to devices where the person turned them on | An encrypted message (end to end, RFC 8291: the push service can't read it) and the device's push address; lock-screen text is a short heading, never sensitive details | Global (operated by the person's browser maker) | Chosen by the person's browser, not FH; optional per person and per device; no readable personal information reaches them |
| Vercel | Hosts the marketing website, and Vercel Web Analytics counts its visits | Website visitors only: pages viewed, referring site, country, browser and device type; no cookies, visitors told apart by a hash that changes daily. No application data | Global edge network (US company) | Website only; the application doesn't use it |
| Twilio (optional, per city) | Urgent texts and phone calls when a city turns on text alerts | The confirmed mobile number and the alert's words (a name and a location for working-alone alerts) | US | Only where a city switches text alerts on and people confirm a number; contents dropped from FH once sent. Before launch: DPA, and consider a Canadian provider |
| The city's own bank | Payroll deposit files, sent by the city's own SFTP connection | Employees' names, deposit amounts, account numbers | Canada | The city's contract, not FH's subprocessor |
| The city's identity provider (Entra ID, SAML) | Single sign-on | Work email, sign-in assertion | The city's tenant | The city's contract |
| The city's payroll provider, if it keeps one (ADP, Ceridian Dayforce, Wagepoint) | Receiving each period's approved hours over the provider's API | Employee numbers, hours, pay codes, rates and amounts | The provider's region | The city's contract with its provider; credentials are the city's, sealed with its key. Not used when the city runs payroll in the app |
| Revenu Québec, CRA, Service Canada | Filing files (T4, RL-1, ROE) the city uploads itself | Slip and ROE contents | Canada | Government agencies, not subprocessors; FH prepares the files, the city files them |

## Checks before a vendor is used

1. **Data processing agreement:** purpose limited to providing the service, confidentiality, breach
   notice within 24 hours, deletion or return at the end, no further subprocessing without notice.
2. **Certifications:** SOC 2 Type II (current), ISO 27001, or equivalent; read the report's exceptions.
3. **Location:** data stays in Canada, or the city's privacy impact assessment covers the transfer
   (Quebec: assessment required before information leaves the province, Law 25 s. 17).
4. **Security:** encryption in transit and at rest, MFA for the vendor's own staff, access logging.
5. **Exit:** we can export and delete our data.

Review each vendor yearly and when it changes ownership or region.
