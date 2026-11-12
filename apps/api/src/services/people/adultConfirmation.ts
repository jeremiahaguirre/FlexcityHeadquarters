/**
 * HR's confirmation that someone is of the age of majority or older, for people with no birth date
 * on file (messaging's rule of two otherwise treats them as possibly a minor and blocks every
 * one-to-one conversation with an adult). HR only (users.write), with who, when and a short note of
 * how it was confirmed ("ID checked at hire"); audited; HR can remove it. A birth date on file
 * always wins: if it says minor, the person is a minor whatever this says, so HR can't confirm it
 * then. Never shown to anyone but HR.
 */
import type { AuthContext } from '../../auth/middleware.js';
import { announceChange } from '../../lib/changes.js';
import { audit, type Tx } from '../../lib/db.js';
import { conflict, notFound } from '../../lib/errors.js';
import { ageClass, loadContext } from '../messaging/policy.js';

export interface AdultConfirmation { at: string; by: string | null; note: string }

/** What HR's screen shows (null when there is none). */
export async function adultConfirmationView(tx: Tx, u: { adultConfirmedAt: Date | null; adultConfirmedById: string | null; adultConfirmedNote: string | null }): Promise<AdultConfirmation | null> {
  if (!u.adultConfirmedAt) return null;
  const by = u.adultConfirmedById ? await tx.user.findUnique({ where: { id: u.adultConfirmedById }, select: { firstName: true, lastName: true } }) : null;
  return { at: u.adultConfirmedAt.toISOString(), by: by ? `${by.firstName} ${by.lastName}` : null, note: u.adultConfirmedNote ?? '' };
}

export async function confirmAdult(tx: Tx, a: AuthContext, userId: string, note: string) {
  const u = await tx.user.findUnique({ where: { id: userId }, select: { id: true, dateOfBirth: true, anonymizedAt: true, adultConfirmedAt: true, adultConfirmedNote: true } });
  if (!u || u.anonymizedAt) throw notFound('Staff member');
  const ctx = await loadContext(tx);
  if (ageClass(u.dateOfBirth, ctx.majority, ctx.today) === 'minor') throw conflict('BIRTH_DATE_MINOR', 'The birth date on file says this person is under the age of majority. Correct the birth date first.');
  const now = new Date();
  await tx.user.update({ where: { id: userId }, data: { adultConfirmedAt: now, adultConfirmedById: a.userId, adultConfirmedNote: note } });
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'user.adult_confirmed', entity: 'User', entityId: userId, before: u.adultConfirmedAt ? { at: u.adultConfirmedAt, note: u.adultConfirmedNote } : null, after: { note } });
  // Who may message whom changed.
  await announceChange(tx, a.tenantId, 'messages');
  return { at: now.toISOString(), note };
}

export async function removeAdultConfirmation(tx: Tx, a: AuthContext, userId: string) {
  const u = await tx.user.findUnique({ where: { id: userId }, select: { id: true, anonymizedAt: true, adultConfirmedAt: true, adultConfirmedNote: true } });
  if (!u || u.anonymizedAt) throw notFound('Staff member');
  if (!u.adultConfirmedAt) return;
  await tx.user.update({ where: { id: userId }, data: { adultConfirmedAt: null, adultConfirmedById: null, adultConfirmedNote: null } });
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'user.adult_confirmation_removed', entity: 'User', entityId: userId, before: { at: u.adultConfirmedAt, note: u.adultConfirmedNote } });
  await announceChange(tx, a.tenantId, 'messages');
}
