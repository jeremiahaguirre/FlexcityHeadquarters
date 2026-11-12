# Releases, What's new and maintenance — owner guide

FH is one shared deployment for every organization: a deploy reaches everyone at once (ECS rolling update, the
circuit breaker rolls back tasks that don't become healthy). This page covers what people see when a new build
goes out, how to tell them about changes, how to turn features on organization by organization, and how to
announce maintenance. Code: `apps/api/src/lib/version.ts`, `apps/web/src/lib/appUpdate.ts`,
`apps/api/src/services/platform/{releaseNotes,releases,maintenance}.ts`, Dev console **Updates**.

## 1. "A new version is ready"

- **Version ids.** A web build's id is `<UTC build time YYYYMMDDHHmm>.<release>` (release = `NEXT_PUBLIC_RELEASE`,
  the image tag; `dev` locally). It is baked into the bundle and served at `/version.json` (never cached).
  The API names its release in `X-FH-Version` on every answer and at `GET /api/version`
  (`{ version, minWebVersion }`). The web app sends `X-FH-Client: web/<version id>`.
  Build the web image with `--build-arg NEXT_PUBLIC_RELEASE=<git commit>` (the same tag as the API's `RELEASE`).
- **Noticing a new build, without tight polling:** when an API answer names a different release (then the tab
  asks `/version.json`, because during a rolling deploy the API can be new before the web tasks are; the same
  mismatch is looked at again only every 10 minutes), when the app comes back to the foreground (at most every
  5 minutes), after the live stream reconnects (a deploy drops it), and every 30 minutes on screens left open.
- **Never interrupting.** The prompt ("A new version is ready · Refresh", EN/FR) is shown, and the app refreshes by
  itself, only while nothing is in progress: no punch being sent, no dialog open, no unsaved typing (tracked for the
  whole app: text typed anywhere but the header's search, or choices inside a form, until the form is submitted or
  the screen changes), no punches or class attendance waiting on the phone, and the kiosk not mid-entry.
  It refreshes by itself once the app has been hidden for 3 minutes or untouched for 15. "Later" hides the prompt
  for that build. The kiosk shows no prompt: it refreshes between punches. The service worker is asked to update
  too (it activates at once). The static GitHub Pages demo has no API and does none of this.
- **Minimum supported web version.** Set `MIN_WEB_VERSION` on the API (a version id, or just its build time, e.g.
  `202611121530` or `20261112`) when an API change can't work with older open tabs. Older builds then get
  `426 CLIENT_OUTDATED` (no work done) and refresh as soon as nothing is in progress; a punch that hit it stays
  queued on the phone and the new build sends it. A tab never refreshes for this twice within five minutes (no
  loop while the web tier is still rolling out); it shows "This version is out of date · Refresh" instead.
  Clients without the header (scripts, the public API) and `dev` builds are never refused.
  **Owner decision:** whether to set it on every deploy that changes an API contract (CI could derive it from the
  previous build's time); it is unset by default.

## 2. What's new notes

Dev console → **Updates → What's new** (console permission `releases.manage`; every existing console admin was
given it). Write the title and text in English and French (plain text; lines starting `- ` are a list, `1. ` a
numbered list; nothing is ever shown as HTML), choose roles (none = everyone), organizations (all, some, or
release rings — rings are resolved into organizations when you save), and when it shows. Publishing, changing a
published note and withdrawing one ask for your passkey; each is in the console's audit log.

Each person sees a note once, in a calm sheet after an update or at their next sign-in (it waits for any other
dialog, a punch or unsaved typing); closing it marks it read for them. Notes stay in **What's new** in the account
menu for a year. People who joined after a note, and notes older than 60 days, aren't shown as new. A note
published for now appears on open screens at once; one published for later, at its time (worker).
Notes are FH's own table (not tenant data): written only by the console, and inside an organization's session
Postgres shows only notes for it or for everyone. Read marks are each organization's data (RLS), kept as long as
its notifications (2 years by default).

## 3. Staged rollouts (release rings)

**Updates → Releases.** Create rings (e.g. Pilot, Early, General) and tick their organizations (one ring each).
A release is a set of feature switches to turn on or off plus a short EN/FR summary of what changes.
Schedule it ring by ring: a ring can be scheduled only after every earlier ring, and not before them. The dialog
first shows, for each organization, what will change and **conflicts**: a switch set on purpose for that
organization (by the Dev console's feature toggles, or by the organization itself, e.g. seniority) is never
changed by a release — the explicit choice wins. Such switches show "Chosen here" on the city's Features tab.
(Switches set in the console before rings existed were taken from its audit log.)

HR admins get notice in-app and by email (EN/FR, with the summary and the date in the organization's time zone)
`notice days` before (7 by default; at once when sooner), and see what's coming — and what stays as they chose —
in What's new. At the time, the worker applies it (every minute; each organization's part is claimed once, so a
second worker or a retry never repeats it). "Apply now" does it at once. Scheduling, applying and undoing ask
for your passkey and are audited in the console and in each organization's own audit trail.

**Undo** a ring or the whole release: each switch it set goes back to what that organization had, unless someone
changed it since (that one is left and reported). Not-yet-applied rings are cancelled. A release can be edited
only while none of it is scheduled or applied.

## 4. Maintenance notices

**Updates → Maintenance.** Start, end (at most 72 hours), a message in English and French, all or some
organizations. Informational only: nothing is switched off and `/readyz` is unaffected. HR admins are told
in-app and by email when it's scheduled (unless it's within a day: then just once) and again a day before.
Everyone sees a short heads-up banner in the day before (they can close it) and a banner while it lasts, in the
app and on the sign-in page; banners appear and go live, without a reload. Moving a window tells HR admins again;
cancelling removes the banner.

## Owner decisions

- `MIN_WEB_VERSION`: when to set it (above).
- What's new, releases and maintenance are FH-wide, not per-organization feature switches; staff can't turn the
  sheet off (it shows each note once). Say if organizations should be able to opt out of notes.
- There is no console button to clear a "chosen here" switch so releases may change it again; today that means
  editing the organization's `featureChoices` in the database. Say if you want one.
- Release notices go to HR admins only (role `HR_ADMIN`); maintenance notices too.
