# Legal operations: copyright notices (Canada)

Internal procedure for notices of claimed copyright infringement about content stored in
FlexcityHeadquarters (documents, policies, logos, photos, applicants' résumés). FH provides the
digital memory (hosting) for its customers, so Canada's **notice-and-notice** regime applies:
*Copyright Act*, R.S.C. 1985, c. C-42, **ss. 41.25 to 41.27** (in force January 2, 2015; the content
limits in s. 41.25(3) were added in December 2018). The public page is
`apps/site` → `/en/copyright/` and `/fr/copyright/` (`apps/site/src/content/legal.ts`, `copyright`).

This procedure covers Canadian law only. It is not legal advice; **counsel to review before launch**
(see the last section).

## 1. Intake

- Mailbox: the copyright contact set in the website config
  (`NEXT_PUBLIC_COPYRIGHT_CONTACT_NAME`, `NEXT_PUBLIC_COPYRIGHT_CONTACT_ADDRESS`,
  `NEXT_PUBLIC_COPYRIGHT_CONTACT_EMAIL`). **To be completed by the owner**; until then the page shows
  "to be completed" placeholders.
- Notices can also arrive by post at the mailing address, or through the contact form. Whoever receives
  one forwards it to the mailbox the same business day.

## 2. Log it

Record every notice in the Trust area (Dev console › Trust › evidence or risk register), or, until a
dedicated register exists, in a restricted spreadsheet kept with the Trust evidence. One row per notice:

| Field | Notes |
| --- | --- |
| Received (date and time) | Starts the retention clock |
| Claimant name and address | As written in the notice |
| Work and right claimed | |
| Location data | URL or description of the file; the organization (tenant) it belongs to |
| Claimed infringement, date and time | |
| Valid? | Section 3 below; reasons if not |
| Forwarded to (customer admin), date | Or why it could not be forwarded |
| Claimant told, date | Forwarded, or the reason it could not be |
| Proceedings notice received? date | Extends retention to one year |
| Records kept until | 6 months from receipt, or 1 year (section 5) |
| Action on content | None / removed or disabled under the customer agreement / court order |

## 3. Validity check (s. 41.25(2) and (3))

A notice must be **in writing** and state:

1. the claimant's name and address;
2. the work or other subject-matter, and the claimant's interest or right in it;
3. the location data (e.g. URL, file name, organization);
4. the infringement claimed;
5. the date and time of the alleged infringement;
6. any other information prescribed by regulation (none was prescribed when this was written: **verify**).

It is **not valid** (s. 41.25(3)) if it contains: an offer to settle; a request or demand, made in
relation to the claimed infringement, for payment or for personal information; a reference (including
by hyperlink) to such an offer, request or demand; or other information prescribed by regulation.
Invalid notices are not forwarded; tell the claimant why (section 6).

## 4. Forward it (s. 41.26(1)(a))

As soon as feasible, send the notice **electronically** to the person to whom the location data
belongs: the customer organization's administrator(s) (the tenant's owner or HR admin; Dev console ›
organization). Then tell the claimant it was forwarded. Do not tell the claimant who the customer is.

Template (English):

> Subject: Notice of claimed copyright infringement received for your FlexcityHeadquarters account
>
> Hello,
>
> We received the attached notice of claimed copyright infringement under section 41.25 of the
> Copyright Act about content stored in your organization's FlexcityHeadquarters account
> ([location]). We are forwarding it as the Act requires. Forwarding a notice is not a finding that
> anything infringes, and we have not shared your organization's identity with the claimant.
>
> Please review the content. Under your subscription agreement your organization is responsible for
> what it uploads; if you decide to remove it, you can do so in the app. Questions: [copyright contact].

Modèle (français) :

> Objet : Avis de prétendue violation du droit d'auteur reçu pour votre compte FlexcityHeadquarters
>
> Bonjour,
>
> Nous avons reçu l'avis de prétendue violation du droit d'auteur ci-joint, en vertu de l'article
> 41.25 de la Loi sur le droit d'auteur, au sujet d'un contenu hébergé dans le compte
> FlexcityHeadquarters de votre organisation ([emplacement]). Nous vous le transmettons comme la Loi
> l'exige. La transmission d'un avis ne constitue pas une conclusion de violation, et nous n'avons pas
> communiqué l'identité de votre organisation au demandeur.
>
> Veuillez examiner le contenu. Selon votre entente d'abonnement, votre organisation est responsable
> de ce qu'elle téléverse; si vous décidez de le retirer, vous pouvez le faire dans l'application.
> Questions : [contact droit d'auteur].

## 5. Keep the records (s. 41.26(1)(b))

Retain records that allow the identification of the person to whom the location data belongs
(the tenant id, the uploader's user id, upload time, file fingerprint) for **six months** from the day
the notice was received, or **one year** if, before the six months end, the claimant commences
proceedings about the claimed infringement and notifies FH. Put the "keep until" date in the log and
put a hold on the file and its audit-log rows (do not let the customer's retention job or an offboarding
purge delete them before that date: tell operations).

No fee is charged: none is fixed by regulation (s. 41.26(2): **verify** before launch).

## 6. When forwarding is impossible, or the notice is invalid

Reply to the claimant in writing with the reason (e.g. the location data does not identify content in
the service; the notice is missing required elements; the notice contains a settlement or payment
demand, s. 41.25(3)). Log the reply.

## 7. Court orders and identity

Never disclose the customer's or a user's identity to a claimant without a court order. On a court
order (e.g. a Norwich order, or an order to remove content), send it to counsel the same day, comply
with its terms and timing, tell the customer unless the order forbids it, and log everything.

## 8. Removing or disabling content (customer agreement)

The notice-and-notice regime does not require FH to remove content. FH may remove or disable access
only where the customer agreement allows it, e.g. content that is clearly unlawful, or a court order.
Before acting (except on a court order or an emergency), contact the customer's administrator; record
what was done and why. Customers remain responsible for what they upload (terms, "Intellectual
property").

## 9. Counsel review (before launch)

- [ ] Confirm the regime applies to FH as a hosting provider (s. 31.1(4)) and that the website text and
      this procedure meet ss. 41.25–41.27 and any regulations then in force.
- [ ] Confirm the forwarding and claimant-notice wording, and "as soon as feasible" timing targets.
- [ ] Confirm records retention and the hold mechanism against the retention and offboarding purge.
- [ ] Confirm the customer agreement gives FH the removal/disable rights described in section 8.
- [ ] Confirm whether a repeat-infringer or acceptable-use clause is wanted in the customer agreement.
