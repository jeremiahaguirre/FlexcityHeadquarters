# Retention and disposal

How long FlexcityHeadquarters keeps each kind of personal information, and how it's disposed of.
Periods marked *set by the city* are in Settings, "How long records are kept"; cities align them
with their records retention by-law.

| Information | Kept | Then | How |
| --- | --- | --- | --- |
| Payroll records (pay runs, statements, T4/RL-1/ROE figures) | The city's payroll retention, at least 6 years after the tax year (CRA); default 7 | The person is anonymized | Automatic (`anonymizeDue`): name, contact, SIN, bank and address removed; amounts kept for the employer's tax records |
| Employee file (profile, HR records, documents) | While employed, then the city's retention period | Anonymized | Same job; uploaded documents' contents are wiped when deleted |
| Time punches | With payroll records | Anonymized with the person | Clock-in never stores coordinates or IP |
| In-app notifications | 2 years (*set by the city*) | Deleted | Hourly job |
| Email log (address, kind of email; never contents) | 90 days (*set by the city*) | Deleted | Hourly job; contents cleared as soon as an email is sent |
| Families and children (program registrations) | Until 3 years without a registration or purchase (*set by the city*) | Personal details removed | Names, birth dates, contacts, safety notes removed; payment records kept as "Former family" |
| Facility booking requests | 2 years after the booking (*set by the city*) | Contact details removed | Hourly job |
| Working-alone check-in locations | Deleted when the person turns sharing off; otherwise 30 days after the session | Deleted | On request; hourly job |
| Device push subscriptions | Until the person signs out on that device or turns notifications off; dropped when the push service reports the device gone, or after 10 failed sends | Deleted | Immediately / each send |
| Sign-in sessions and one-time links | 30 days after they end or are used | Deleted | Hourly job |
| Audit log | For the life of the account | Deleted with the organization | Append-only while the account exists |
| Signed information and consent agreements (name, signature, choices, time, device address and browser) | For the life of the account: evidence of what each person was told | Deleted with the organization | The app can't change or delete them; FH can download a certificate per record |
| Payroll provider sends (period, file fingerprint, status, provider's reference) | With payroll records | Deleted with the organization | The file itself isn't kept, only its SHA-256 |
| Salaries, one-time pay items, court and CRA orders | With payroll records | Anonymized with the person | Same job as payroll |
| Incident reports | The city's retention (OHS and insurance) | Deleted with the organization, or on request | Narratives sealed with the city's key |
| Everything, after offboarding | Until the deletion date in the agreement (90 days by default); the city can download a full export until then | Deleted | `npm run tenant:purge`; FH's own invoices are kept 6 years (CRA) |

## Secure disposal

- **Database:** rows are deleted or overwritten in place, not flagged. Sealed values (SINs, bank
  accounts, incident narratives, documents) are encrypted with a per-record key wrapped by the
  city's own key in AWS KMS (`alias/flexcity-tenant-<id>`). After a purge, operations schedule that
  key for deletion (the purge script prints the command), which makes any remaining copy, backups
  included, unreadable (crypto-shredding).
- **Backups:** encrypted, kept 35 days, then expire; a deletion reaches every backup within 35 days.
- **Devices:** the app keeps only the class rosters on the device for offline use, and clears them
  and the sign-in at sign-out. Downloaded files (exports, T4 and ROE files) are the city's to
  protect; the app reminds people that they contain SINs.
- **Logs:** application logs never contain personal information (masked emails, error codes only).
