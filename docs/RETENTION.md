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
| Texts and calls (number, kind of alert; contents only until sent) | Same period as the email log (*set by the city*) | Deleted | Hourly job; contents dropped as soon as a text or call is sent, or after 5 failed tries |
| Mobile number for text alerts | Until the person removes it from their profile | Removed | On request (also cancels texts not yet sent); removed when the person is anonymized |
| Emergency contacts (other people's names and numbers) | While the person keeps them | Deleted | Replaced whenever the person or HR edits the list; deleted as soon as erasure is requested, without waiting for payroll retention |
| Calendar feed link (a hash of its secret) | Until the person makes a new link or turns it off | Removed | On request; removed as soon as erasure is requested |
| Kiosk PIN (a hash only) | While the account exists | — | Replaced when the person sets a new one; cleared when the person is anonymized, and refused at the kiosk once they aren't active |
| Expense and mileage claims, receipts | With payroll records | Anonymized with the person | Receipts are encrypted employee documents and follow the employee file |
| Time in lieu bank and corrections | With payroll records | Anonymized with the person | Same job as payroll |
| T4A payees (name or business, SIN sealed, address) and payments | With payroll records | Deleted with the organization | SIN sealed with the city's key; only the last 3 digits are shown |
| Job applications (contact details, message, certifications, résumé, notes) | 1 year after the application's last change | Deleted; for people hired, the résumé and message are wiped | Hourly job; résumés encrypted with the city's key |
| Signed policies (typed name, time, fingerprint of the text) | For the life of the account: evidence the person read the policy | Deleted with the organization | The app can't change them; in the person's records export |
| Facility logbook entries | For the life of the account | Deleted with the organization | The app can't change them; a correction is a new entry |
| Announcements and who read them | For the life of the account | Deleted with the organization | — |
| Saved reports | Until the owner deletes them | Deleted | Emailing stops when the owner loses access to the report |
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

- **Database:** rows are deleted or overwritten in place, not flagged. Sealed values (SINs, T4A payees' included, bank
  accounts, incident narratives, documents and receipts, applicants' résumés) are encrypted with a per-record key wrapped by the
  city's own key in AWS KMS (`alias/flexcity-tenant-<id>`). After a purge, operations schedule that
  key for deletion (the purge script prints the command), which makes any remaining copy, backups
  included, unreadable (crypto-shredding).
- **Backups:** encrypted, kept 35 days, then expire; a deletion reaches every backup within 35 days.
- **Devices:** the app keeps only the class rosters, and for the timeclock the person's own clocked-in
  state, today's shifts and the facility list, on the device for offline use; punches made without
  signal wait on the phone (per person) until sent. It clears them and the sign-in at sign-out
  (after warning about any punch not sent yet). Downloaded files (exports, T4 and ROE files) are the city's to
  protect; the app reminds people that they contain SINs.
- **Logs:** application logs never contain personal information (masked emails, error codes only).
