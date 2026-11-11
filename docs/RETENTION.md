# Retention and disposal

How long FlexcityHeadquarters keeps each kind of personal information, and how it's disposed of.
Periods marked *set by the city* are in Settings, "How long records are kept"; cities align them
with their records retention by-law.

| Information | Kept | Then | How |
| --- | --- | --- | --- |
| Payroll records (pay runs, statements, T4/RL-1/ROE figures) | The city's payroll retention, at least 6 years after the tax year (CRA); default 7 | The person is anonymized | Automatic (`anonymizeDue`): name, contact, SIN, bank and address removed; amounts kept for the employer's tax records |
| Employee file (profile, HR records, documents) | While employed, then the city's retention period | Anonymized | Same job; uploaded documents' contents are wiped when deleted |
| Time punches | With payroll records | Anonymized with the person | Clock-in never stores coordinates or IP |
| Attendance events (late clock-ins, missed shifts, excuses) | With the employee file | Anonymized with the person | The attendance score only looks back 90 days (or to the yearly restart HR sets); older events stop counting but are never deleted for it |
| In-app notifications | 2 years (*set by the city*) | Deleted | Hourly job |
| Email log (address, kind of email; never contents) | 90 days (*set by the city*) | Deleted | Hourly job; contents cleared as soon as an email is sent |
| Texts and calls (number, kind of alert; contents only until sent) | Same period as the email log (*set by the city*) | Deleted | Hourly job; contents dropped as soon as a text or call is sent, or after 5 failed tries |
| Mobile number for text alerts and sign-in codes by text | Until the person removes it from their profile | Removed | On request (also cancels texts not yet sent); removed when the person is anonymized |
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
| Team messages (conversations, members and read receipts, messages and files sealed with the city's key, first versions of edited messages, removed messages' sealed text) | 2 years after a conversation's last message (*set by the city*, 180 days to 10 years) | Deleted | Hourly job; kept while a report about the conversation is open with HR. Anonymizing someone wipes what they wrote (except under an open report) and removes them from every conversation |
| Message reports and investigation openings (who opened a conversation, why, until when) | With the conversation; closed reports 2 years after closing | Deleted | Openings can't be changed by the app; every opening and reading is also in the audit log |
| Staff surveys: who was asked and whether they answered (no time); answers (anonymous: no person or time; exit surveys: named) | 2 years after the survey closes (*set by the city*, 180 days to 10 years) | Deleted | Hourly job; anonymizing someone deletes their invitations and named answers (anonymous answers were never linked to them) |
| Shift preferences (shifts a person would like or avoid, preferred weekly hours and days, a note) | While the person works here; seasonal staff away keep theirs | Deleted | Replaced whenever the person edits them; deleted when the person is anonymized, and by the hourly job 90 days after someone who left last changed them |
| Saved reports | Until the owner deletes them | Deleted | Emailing stops when the owner loses access to the report |
| Families and children (program registrations) | Until 3 years without a registration or purchase (*set by the city*) | Personal details removed | Names, birth dates, contacts, safety notes removed; payment records kept as "Former family" |
| Facility booking requests | 2 years after the booking (*set by the city*) | Contact details removed | Hourly job |
| Working-alone check-in locations | Deleted when the person turns sharing off; otherwise 30 days after the session | Deleted | On request; hourly job |
| Device push subscriptions | Until the person signs out on that device or turns notifications off; dropped when the push service reports the device gone, or after 10 failed sends | Deleted | Immediately / each send |
| Sign-in sessions and one-time links | 30 days after they end or are used | Deleted | Hourly job |
| Sign-in codes (second factor by email or text: channel, keyed HMAC of the code, tries, times; never the code) | 30 days after they expire (a code lasts 10 minutes) | Deleted | Hourly job; kept that long only so a wrong-try lockout can be looked into. The email or text carrying the code follows the email log, its contents cleared once sent |
| Sign-in rate-limit counters (keyed by the device's internet address or the account) | About a day | Deleted | Cleared as new attempts come in; nothing else about the device is kept at sign-in |
| Domain events (event outbox: kind of event, ids; names or messages only until delivered) | 7 days after delivery; 30 days if delivery gave up | Deleted | Contents cleared as soon as delivered; hourly job; events not yet delivered are kept until they are |
| Webhook delivery records (event type, status, tries, response code and the first 500 characters of the answer; ids only, never a secret) | 30 days once finished | Deleted | Hourly job |
| API keys (name, scopes, a SHA-256 of the key) and webhook endpoints (address, events, the signing secret sealed with the city's key) | Keys: for the life of the account (a revoked key stays listed, unusable). Webhooks: until an administrator removes them | Deleted with the organization; a removed webhook is deleted with its delivery history | No personal information beyond who made them; every API request is in the audit log |
| Public API Idempotency-Key records (the key, a SHA-256 of the request, the answer given) | 24 hours | Removed by the retention job; deleted with the organization | The stored answer is what the API returned (no SIN, bank, pay or health details, which the API never returns) |
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
