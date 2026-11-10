# Electronic monitoring: what FlexcityHeadquarters collects

For employers' written electronic monitoring policies (Ontario *Employment Standards Act*, Part XI.1,
for employers with 25 or more employees) and privacy notices elsewhere. Each city adapts this to its
own policy; FlexcityHeadquarters is the tool, the city decides how it's used.

| What | When | What is kept | Who sees it | For what |
| --- | --- | --- | --- | --- |
| Clock-in location check | Each clock-in, if the person allows location | Whether they were at the facility, and how far away (metres). **Not** the location itself, not the device's IP address. | Their supervisor, payroll, HR | Confirming punches; flagging punches made away from the facility for review |
| Kiosk punches | Each punch on a facility's shared tablet | The time, the kiosk and facility; it counts as on site because the tablet is at the facility. **No** location, IP address, photo or badge scan | Their supervisor, payroll, HR | Pay, for staff without the app on a phone |
| Clock-in and clock-out times | Each punch | Times, facility, position, any corrections with the reason | Supervisor, payroll, HR, the person | Pay |
| Working-alone check-ins | Only while a working-alone session the person started is open | Check-in times. Location only if the person turns sharing on for that session: the last position, updated at most every 30 seconds while the app is open on screen, and with each check-in or help request (only the latest is kept, not a trail) | The people who monitor lone workers, HR when escalated | Safety of people working alone; turning sharing off deletes the position at once, otherwise it's removed 30 days after the session |
| Text and phone alerts | Only where the city turns them on and the person confirms a mobile number | The number, and each text or call (kind, when sent); the words are dropped once sent | Nobody but the system; the text provider delivers them | Urgent safety alerts, call-outs, last-minute shifts; the person can stop them from their profile |
| Calendar feed | Only if the person makes a link | A hash of the link and when it was made | Nobody | The person's own shifts in their calendar |
| Push notifications | Only on devices where the person turned them on | Which devices (browser push address and keys, a label such as "iPhone · Safari"), when the last one was sent | Nobody but the system | Delivering the person's own notifications; removed when they sign out on that device, turn them off, or the browser drops it |
| Policies read and signed, announcements read | When the person signs a policy or taps 'Got it' | The typed name, time and a fingerprint of the policy; that an announcement was read | HR (policies); people who post announcements see how many have read each one, not who | Proof staff were told (OHS programs, harassment policies) |
| Activity in the app | Changes to records | Who changed what, when (audit log) | HR (audit log permission) | Accountability; privacy and access-to-information requests |
| Sign-in | Each sign-in | Time, method (password, passkey, single sign-on), failed attempts | HR (audit log), security monitoring | Protecting accounts |
| The information and consent agreement | Once at first sign-in, and again when its text changes | The version and language shown, the typed name and signature, the notification and location choices, the time, the device's internet address and browser | FH (Dev console) as evidence for the organization | Showing each person was told what's collected and chose the optional permissions themselves |

**Not collected:** location outside a working-alone session the person started and chose to share, location while the app is in the background (browsers don't allow it), browsing, keystrokes, screenshots, camera or microphone, messages
outside the app. Attendance and reliability figures are advisory; no decision about a person is made by
the software alone (Quebec Law 25, s. 12.1).

**Retention:** notifications 2 years and the email log 90 days by default (each city sets these in
Settings); punch and pay records follow payroll retention; working-alone locations 30 days; texts and calls follow the email log.
