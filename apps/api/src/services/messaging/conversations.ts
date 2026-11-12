/**
 * Team messaging: conversations, messages, read receipts, reports and investigations.
 *
 * - Bodies, files and file names are sealed with the conversation's key (./crypto.ts); nothing
 *   readable is stored, logged, sent in a live signal or put in an email. A push says "New message
 *   from X", with the first words only when the organization turns previews on. A notification
 *   stores only the conversation and message ids (and who it's from): the preview is made from the
 *   sealed message when the push is sent (messagePreviews), so it never sits in the notifications
 *   table; a removed or erased message's notifications are deleted.
 * - Who may talk to whom, and the safeguarding "rule of two", are in ./policy.ts and are checked
 *   when a conversation is made and again on every message sent.
 * - Removed and edited messages: members see "message removed" or the new text; the sealed
 *   original stays until the retention period ends, so a harassment investigation can read it.
 * - HR reads a conversation they're not in only after opening it for an investigation, with a
 *   reason; the opening and every reading are in the audit log. HR can't join a department or
 *   shift conversation they're not part of. Someone added after a conversation was made (a lead
 *   joining a shift's conversation, a new member of a group or department) sees only messages sent
 *   from then on (ConversationMember.historyFrom), and joining one you didn't make is audited.
 * - The reason a conversation is read-only is given only to HR; everyone else sees one generic
 *   "read-only", so a read-only group never hints that someone in it is a minor.
 * - Rate limits (per person): 30 messages a minute and 600 a day, 20 files an hour, 20 new
 *   conversations an hour, 10 reports an hour and one report per message.
 * - Live: members' screens are told "messages changed" (lib/changes.ts announceChangeTo) and refetch;
 *   a read receipt tells the other members only "receipts" (an open conversation's "seen by").
 */
import { randomUUID } from 'node:crypto';
import type { Conversation, ConversationKind } from '../../generated/prisma/client.js';
import type { AuthContext } from '../../auth/middleware.js';
import { announceChangeTo } from '../../lib/changes.js';
import { allow } from '../../auth/rateLimit.js';
import { localIso } from '../../lib/time.js';
import { type Tx, audit, withTenant } from '../../lib/db.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { sniff, storedName } from '../../lib/files.js';
import { notify, usersWithPermission } from '../notifications/notifier.js';
import { shiftInScope } from '../people/scope.js';
import { messageAad, newConversationKey, openWith, sealWith, withConversationKey } from './crypto.js';
import { type Context, EDIT_WINDOW_MS, INVESTIGATION_DAYS, MAX_TEXT, PREVIEW_CHARS, type Person, canAddToGroup, canReach, directSafe, groupSafe, isHr, loadContext, loadPeople, readMessagingSettings } from './policy.js';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const PAGE = 50;

export type ReadOnly = null | 'archived' | 'safeguarding' | 'inactive' | 'alone' | 'notAllowed';
/** What a member sees: HR gets the cause; everyone else one generic reason ("archived" is about time, never people). */
export type ShownReadOnly = ReadOnly | 'readOnly';
export const shownReadOnly = (ro: ReadOnly, hr: boolean): ShownReadOnly => (hr || !ro || ro === 'archived' ? ro : 'readOnly');

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Per-person limits (allow() in auth/rateLimit.ts): [key, how many, window]. */
export const LIMITS = {
  send: [30, MINUTE],
  sendDay: [600, 24 * HOUR],
  file: [20, HOUR],
  create: [20, HOUR],
  report: [10, HOUR],
} as const satisfies Record<string, readonly [number, number]>;
async function limit(what: keyof typeof LIMITS, userId: string, message: string) {
  const [n, ms] = LIMITS[what];
  if (!(await allow(`msg-${what}:${userId}`, n, ms))) throw new HttpError(429, 'TOO_MANY', message);
}
const SLOW_DOWN = 'You’re sending a lot of messages. Wait a moment and try again.';

/** Refused by the rule of two: the same words whoever asks, never an age. */
export class MinorRuleError extends HttpError {
  readonly what: string;
  readonly entityId: string | null;
  // One unconditional super() call: with parameter properties and a super() inside an if, tsc's
  // build assigns them before super() and every refusal crashed with a 500 in production only
  // (found by the production rehearsal; test/unit/buildSafety.test.ts).
  constructor(what: string, entityId: string | null, generic = false) {
    // Generic: refused like any read-only conversation, so the refusal says nothing about who is in it.
    super(
      generic ? 409 : 403,
      generic ? 'READ_ONLY' : 'MINOR_RULE',
      generic ? 'This conversation is read-only.' : 'One-to-one messages aren’t available with this person. A supervisor can start a group that includes you both.',
      generic ? { reason: 'readOnly' } : undefined,
    );
    this.what = what;
    this.entityId = entityId;
  }
}
async function minorRule(_tx: Tx, _a: AuthContext, what: string, entityId: string | null, generic = false): Promise<never> {
  throw new MinorRuleError(what, entityId, generic);
}

/**
 * Runs messaging work in the organization's transaction. A refusal under the rule of two rolls the
 * work back, so it is recorded in its own transaction afterwards: who tried what, never an age.
 */
export async function inMessaging<T>(a: AuthContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await withTenant(a.tenantId, fn);
  } catch (e) {
    if (e instanceof MinorRuleError) {
      await withTenant(a.tenantId, (tx) => audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'messages.blocked', entity: 'Conversation', entityId: e.entityId ?? a.userId, after: { rule: 'minor rule', what: e.what } }));
    }
    throw e;
  }
}

/** Why a conversation can't take new messages right now, or null. */
export function readOnlyReason(conv: Pick<Conversation, 'kind' | 'closesAt' | 'archivedAt'>, members: Person[], ctx: Context, now = new Date()): ReadOnly {
  if (conv.archivedAt || (conv.closesAt && conv.closesAt <= now)) return 'archived';
  const active = members.filter((m) => m.active);
  if (conv.kind === 'DIRECT') {
    if (active.length < 2) return 'inactive';
    if (!directSafe(active[0]!.age, active[1]!.age, ctx.settings)) return 'safeguarding';
    if (!canReach(active[0]!, active[1]!, ctx, ctx.settings)) return 'notAllowed';
    return null;
  }
  if (active.length < 2) return 'alone';
  if (!groupSafe(active.map((m) => m.age))) return 'safeguarding';
  return null;
}

async function membersOf(tx: Tx, ctx: Context, conversationId: string) {
  const rows = await tx.conversationMember.findMany({ where: { conversationId } });
  const people = await loadPeople(tx, ctx, rows.map((r) => r.userId));
  return { rows, people: rows.map((r) => people.get(r.userId)).filter((p): p is Person => !!p) };
}

async function signal(tx: Tx, tenantId: string, conversationId: string) {
  const ids = (await tx.conversationMember.findMany({ where: { conversationId }, select: { userId: true } })).map((m) => m.userId);
  await announceChangeTo(tx, tenantId, 'messages', ids);
}

async function create(tx: Tx, a: AuthContext, data: { kind: ConversationKind; title?: string | null; directKey?: string; shiftKey?: string; departmentId?: string; closesAt?: Date | null }, memberIds: string[], owners: string[] = []) {
  await limit('create', a.userId, 'You’ve started a lot of conversations. Try again in an hour.');
  const key = await newConversationKey(a.tenantId);
  const conv = await tx.conversation.create({ data: { tenantId: a.tenantId, createdById: a.userId, ...data, wrappedKey: key.wrappedKey, kekId: key.kekId } });
  await tx.conversationMember.createMany({ data: [...new Set(memberIds)].map((userId) => ({ tenantId: a.tenantId, conversationId: conv.id, userId, owner: owners.includes(userId) })), skipDuplicates: true });
  return conv;
}

// ------------------------------------------------------------------ Starting conversations

/** One to one: found or made, if the structure allows it and the rule of two does. */
export async function openDirect(tx: Tx, a: AuthContext, otherId: string) {
  const ctx = await loadContext(tx);
  const people = await loadPeople(tx, ctx, [a.userId, otherId]);
  const me = people.get(a.userId);
  const other = people.get(otherId);
  if (!me || !other || !other.active || otherId === a.userId) throw notFound('Person');
  if (!canReach(me, other, ctx, ctx.settings)) throw forbidden('You can’t message this person directly. Your organization’s settings decide who can message whom.');
  if (!directSafe(me.age, other.age, ctx.settings)) await minorRule(tx, a, 'direct', null);
  const directKey = [a.userId, otherId].sort().join(':');
  const found = await tx.conversation.findUnique({ where: { tenantId_directKey: { tenantId: a.tenantId, directKey } } });
  if (found) return found;
  const conv = await create(tx, a, { kind: 'DIRECT', directKey }, [a.userId, otherId]);
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'messages.direct', entity: 'Conversation', entityId: conv.id, after: { with: otherId } });
  return conv;
}

/** A group a lead or HR makes: everyone in it must be within their reach, and the rule of two must hold. */
export async function createGroup(tx: Tx, a: AuthContext, title: string, memberIds: string[]) {
  const ctx = await loadContext(tx);
  const ids = [...new Set([a.userId, ...memberIds])];
  if (ids.length < 3) throw badRequest('A group needs at least two other people. For one person, start a one-to-one conversation.');
  const people = await loadPeople(tx, ctx, ids);
  const me = people.get(a.userId)!;
  for (const id of ids.slice(1)) {
    const p = people.get(id);
    if (!p || !p.active) throw notFound('Person');
    if (!canAddToGroup(me, p, ctx)) throw forbidden('Someone you chose isn’t in your departments.');
  }
  if (!groupSafe(ids.map((id) => people.get(id)!.age))) await minorRule(tx, a, 'group', null);
  const conv = await create(tx, a, { kind: 'GROUP', title }, ids, [a.userId]);
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'messages.group_create', entity: 'Conversation', entityId: conv.id, after: { members: ids.length } });
  await signal(tx, a.tenantId, conv.id);
  return conv;
}

/** Group owners and HR members add people; the rule of two is checked on the new membership. */
export async function addMembers(tx: Tx, a: AuthContext, conversationId: string, userIds: string[]) {
  const ctx = await loadContext(tx);
  const conv = await tx.conversation.findUnique({ where: { id: conversationId } });
  if (!conv || conv.kind !== 'GROUP') throw notFound('Group');
  const { rows, people } = await membersOf(tx, ctx, conversationId);
  const mine = rows.find((r) => r.userId === a.userId);
  const me = people.find((p) => p.id === a.userId);
  if (!mine || !me || !(mine.owner || isHr(me))) throw forbidden('Only the group’s owner can add people.');
  const add = [...new Set(userIds)].filter((id) => !rows.some((r) => r.userId === id));
  const extra = await loadPeople(tx, ctx, add);
  for (const id of add) {
    const p = extra.get(id);
    if (!p || !p.active) throw notFound('Person');
    if (!canAddToGroup(me, p, ctx)) throw forbidden('Someone you chose isn’t in your departments.');
  }
  if (!groupSafe([...people.filter((p) => p.active), ...extra.values()].map((p) => p.age))) await minorRule(tx, a, 'group_add', conversationId);
  const now = new Date();
  await tx.conversationMember.createMany({ data: add.map((userId) => ({ tenantId: a.tenantId, conversationId, userId, historyFrom: now })), skipDuplicates: true });
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'messages.group_add', entity: 'Conversation', entityId: conversationId, after: { added: add } });
  await signal(tx, a.tenantId, conversationId);
}

/** Leave a group, or (owner, HR) take someone out. A group left without two adults beside a minor turns read-only. */
export async function removeMember(tx: Tx, a: AuthContext, conversationId: string, userId: string) {
  const conv = await tx.conversation.findUnique({ where: { id: conversationId } });
  if (!conv || conv.kind !== 'GROUP') throw notFound('Group');
  const rows = await tx.conversationMember.findMany({ where: { conversationId } });
  const mine = rows.find((r) => r.userId === a.userId);
  if (!mine) throw notFound('Group');
  if (userId !== a.userId && !mine.owner && !a.roles.includes('HR_ADMIN')) throw forbidden('Only the group’s owner can take people out.');
  if (!rows.some((r) => r.userId === userId)) throw notFound('Member');
  await signal(tx, a.tenantId, conversationId);
  await tx.conversationMember.deleteMany({ where: { conversationId, userId } });
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: userId === a.userId ? 'messages.group_leave' : 'messages.group_remove', entity: 'Conversation', entityId: conversationId, after: { userId } });
}

/** Everyone working shifts at the same facility that overlap this one. */
async function shiftCrew(tx: Tx, shift: { facilityId: string; startsAt: Date; endsAt: Date }) {
  const rows = await tx.shift.findMany({ where: { facilityId: shift.facilityId, status: 'PUBLISHED', userId: { not: null }, startsAt: { lt: shift.endsAt }, endsAt: { gt: shift.startsAt } }, select: { userId: true } });
  return [...new Set(rows.map((r) => r.userId!))];
}

/**
 * The shift's conversation: everyone on the shift (and on shifts overlapping it at the facility).
 * Opened by someone on it, or a lead whose department has it (HR who isn't on it opens it for an
 * investigation instead). People added to the shift later, and a lead joining, see only what's sent
 * from then on. Read-only some hours after the shift ends.
 */
export async function openShift(tx: Tx, a: AuthContext, shiftId: string) {
  const ctx = await loadContext(tx);
  const shift = await tx.shift.findUnique({ where: { id: shiftId }, select: { facilityId: true, positionId: true, startsAt: true, endsAt: true, status: true, userId: true } });
  if (!shift || shift.status !== 'PUBLISHED') throw notFound('Shift');
  const crew = await shiftCrew(tx, shift);
  const lead = a.permissions.has('messages.groups') && a.permissions.has('schedule.write') && shiftInScope(a.scope, shift);
  if (!crew.includes(a.userId) && !lead) throw forbidden('You’re not on this shift.');
  const shiftKey = `${shift.facilityId}|${shift.startsAt.toISOString()}|${shift.endsAt.toISOString()}`;
  const members = [...new Set([...crew, a.userId])];
  let conv = await tx.conversation.findUnique({ where: { tenantId_shiftKey: { tenantId: a.tenantId, shiftKey } } });
  if (!conv) {
    const closesAt = new Date(shift.endsAt.getTime() + ctx.settings.shiftArchiveHours * 3_600_000);
    if (closesAt <= new Date()) throw conflict('SHIFT_OVER', 'This shift ended; its conversation is closed.');
    conv = await create(tx, a, { kind: 'SHIFT', shiftKey, closesAt }, members);
    await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'messages.shift_create', entity: 'Conversation', entityId: conv.id, after: { shiftId, members: members.length } });
  } else {
    const had = new Set((await tx.conversationMember.findMany({ where: { conversationId: conv.id }, select: { userId: true } })).map((m) => m.userId));
    const add = members.filter((m) => !had.has(m));
    if (!add.length) return conv;
    await tx.conversationMember.createMany({ data: add.map((userId) => ({ tenantId: a.tenantId, conversationId: conv!.id, userId, historyFrom: new Date() })), skipDuplicates: true });
    if (add.includes(a.userId)) await auditJoin(tx, a, conv);
  }
  await signal(tx, a.tenantId, conv.id);
  return conv;
}

/** Joining a conversation someone else made is in the audit log. */
async function auditJoin(tx: Tx, a: AuthContext, conv: Conversation) {
  if (conv.createdById === a.userId) return;
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'messages.join', entity: 'Conversation', entityId: conv.id, after: { kind: conv.kind } });
}

/**
 * The department's conversation: its people and managers, nobody else (HR who isn't in the
 * department opens it for an investigation instead). Kept in step with the department each time
 * it's opened; people who join the department later see what's sent from then on.
 */
export async function openDepartment(tx: Tx, a: AuthContext, departmentId: string) {
  const dept = await tx.department.findUnique({ where: { id: departmentId }, select: { id: true, managers: { select: { userId: true } } } });
  if (!dept) throw notFound('Department');
  const staff = await tx.user.findMany({ where: { status: 'ACTIVE', anonymizedAt: null, processingRestrictedAt: null, positions: { some: { position: { departmentId } } } }, select: { id: true } });
  const target = new Set([...staff.map((s) => s.id), ...dept.managers.map((m) => m.userId)]);
  if (!target.has(a.userId)) throw forbidden('You’re not in this department.');
  let conv = await tx.conversation.findUnique({ where: { tenantId_departmentId: { tenantId: a.tenantId, departmentId } } });
  if (!conv) {
    conv = await create(tx, a, { kind: 'DEPARTMENT', departmentId }, [...target]);
    await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'messages.department_create', entity: 'Conversation', entityId: conv.id, after: { departmentId, members: target.size } });
    await signal(tx, a.tenantId, conv.id);
    return conv;
  }
  const rows = await tx.conversationMember.findMany({ where: { conversationId: conv.id } });
  // People who left the department leave its conversation (HR who joined before this rule too).
  const gone = rows.filter((r) => !target.has(r.userId)).map((r) => r.userId);
  const add = [...target].filter((id) => !rows.some((r) => r.userId === id));
  if (gone.length) await tx.conversationMember.deleteMany({ where: { conversationId: conv.id, userId: { in: gone } } });
  if (add.length) await tx.conversationMember.createMany({ data: add.map((userId) => ({ tenantId: a.tenantId, conversationId: conv!.id, userId, historyFrom: new Date() })), skipDuplicates: true });
  if (add.includes(a.userId)) await auditJoin(tx, a, conv);
  if (gone.length || add.length) await signal(tx, a.tenantId, conv.id);
  return conv;
}

// ------------------------------------------------------------------ Reading

/**
 * Who this person can start a one-to-one with, or add to a group (leads and HR). Ages never leave
 * the server, and nobody is marked as unavailable: someone you can't message one to one is simply
 * not offered for it (the screen says some one-to-ones aren't available).
 */
export async function directory(tx: Tx, a: AuthContext) {
  const ctx = await loadContext(tx);
  const people = await loadPeople(tx, ctx);
  const me = people.get(a.userId);
  if (!me) return { people: [], canGroup: false };
  const canGroup = a.permissions.has('messages.groups');
  const out = [];
  for (const p of people.values()) {
    if (p.id === me.id || !p.active) continue;
    const direct = canReach(me, p, ctx, ctx.settings) && directSafe(me.age, p.age, ctx.settings);
    const group = canGroup && canAddToGroup(me, p, ctx);
    if (!direct && !group) continue;
    out.push({ id: p.id, name: p.name, direct, group, hr: isHr(p) });
  }
  out.sort((x, y) => x.name.localeCompare(y.name));
  const departments = await tx.department.findMany({ where: a.roles.includes('HR_ADMIN') ? {} : { OR: [{ id: { in: me.departmentIds } }, { id: { in: me.managesDepartmentIds } }] }, select: { id: true, name: true, nameFr: true }, orderBy: { name: 'asc' } });
  return { people: out, canGroup, departments };
}

async function unreadByConversation(tx: Tx, userId: string): Promise<Map<string, number>> {
  const rows = await tx.$queryRaw<Array<{ id: string; n: bigint }>>`
    SELECT m."conversationId" AS id, count(*)::bigint AS n FROM "Message" m
      JOIN "ConversationMember" cm ON cm."conversationId" = m."conversationId" AND cm."userId" = ${userId}::uuid
     WHERE m."authorId" <> ${userId}::uuid AND m."deletedAt" IS NULL AND (cm."lastReadAt" IS NULL OR m."createdAt" > cm."lastReadAt")
       AND (cm."historyFrom" IS NULL OR m."createdAt" >= cm."historyFrom")
     GROUP BY m."conversationId"`;
  return new Map(rows.map((r) => [r.id, Number(r.n)]));
}

/** Unread messages for the menu badge (muted conversations don't count). */
export async function unreadTotal(tx: Tx, userId: string): Promise<number> {
  const [counts, muted] = await Promise.all([unreadByConversation(tx, userId), tx.conversationMember.findMany({ where: { userId, muted: true }, select: { conversationId: true } })]);
  const m = new Set(muted.map((x) => x.conversationId));
  let n = 0;
  for (const [id, c] of counts) if (!m.has(id)) n += c;
  return n;
}

/** How a conversation is named on screen: the other person, the department, the shift's facility and times, or the group's name. */
async function describe(tx: Tx, convs: Conversation[], me: string, names: Map<string, Person>) {
  const depts = await tx.department.findMany({ where: { id: { in: convs.map((c) => c.departmentId).filter((x): x is string => !!x) } }, select: { id: true, name: true, nameFr: true } });
  const facIds = convs.map((c) => c.shiftKey?.split('|')[0]).filter((x): x is string => !!x);
  const facs = await tx.facility.findMany({ where: { id: { in: facIds } }, select: { id: true, name: true, timezone: true } });
  return (c: Conversation, memberIds: string[]) => {
    if (c.kind === 'DIRECT') {
      const other = memberIds.find((id) => id !== me) ?? c.directKey?.split(':').find((id) => id !== me);
      return { title: (other && names.get(other)?.name) || null, otherId: other ?? null };
    }
    if (c.kind === 'DEPARTMENT') {
      const d = depts.find((x) => x.id === c.departmentId);
      return { title: d?.name ?? null, titleFr: d?.nameFr ?? null };
    }
    if (c.kind === 'SHIFT') {
      const [fid, s, e] = c.shiftKey!.split('|');
      const f = facs.find((x) => x.id === fid);
      const tz = f?.timezone ?? 'America/Toronto';
      return { title: f?.name ?? null, shift: { startsAt: localIso(new Date(s!), tz), endsAt: localIso(new Date(e!), tz), timezone: f?.timezone ?? null } };
    }
    return { title: c.title };
  };
}

export async function listConversations(tx: Tx, a: AuthContext) {
  const ctx = await loadContext(tx);
  const mine = await tx.conversationMember.findMany({ where: { userId: a.userId }, include: { conversation: { include: { members: { select: { userId: true } } } } } });
  const ids = [...new Set(mine.flatMap((m) => m.conversation.members.map((x) => x.userId)))];
  const people = await loadPeople(tx, ctx, ids);
  const unread = await unreadByConversation(tx, a.userId);
  const name = await describe(tx, mine.map((m) => m.conversation), a.userId, people);
  const hr = a.roles.includes('HR_ADMIN');
  return mine
    .map((m) => {
      const c = m.conversation;
      const members = c.members.map((x) => people.get(x.userId)).filter((p): p is Person => !!p);
      return { id: c.id, kind: c.kind, ...name(c, c.members.map((x) => x.userId)), memberCount: members.length, lastMessageAt: c.lastMessageAt, createdAt: c.createdAt, unread: unread.get(c.id) ?? 0, muted: m.muted, readOnly: shownReadOnly(readOnlyReason(c, members, ctx), hr) };
    })
    .sort((x, y) => (y.lastMessageAt ?? y.createdAt).getTime() - (x.lastMessageAt ?? x.createdAt).getTime());
}

async function investigating(tx: Tx, a: AuthContext, conversationId: string) {
  if (!a.permissions.has('messages.investigate')) return null;
  return tx.conversationAccess.findFirst({ where: { conversationId, userId: a.userId, expiresAt: { gt: new Date() } }, orderBy: { openedAt: 'desc' } });
}

/** A conversation and a page of its messages, for a member, or for HR who opened it for an investigation. */
export async function readConversation(tx: Tx, a: AuthContext, conversationId: string, before?: Date) {
  const ctx = await loadContext(tx);
  const conv = await tx.conversation.findUnique({ where: { id: conversationId } });
  if (!conv) throw notFound('Conversation');
  const { rows, people } = await membersOf(tx, ctx, conversationId);
  const mine = rows.find((r) => r.userId === a.userId);
  const access = mine ? null : await investigating(tx, a, conversationId);
  if (!mine && !access) throw notFound('Conversation');
  if (access) await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'messages.investigation_read', entity: 'Conversation', entityId: conversationId, after: { accessId: access.id } });
  // A member added later sees only what was sent from when they joined; an investigation sees it all.
  const from = mine?.historyFrom ?? null;
  const createdAt = { ...(before ? { lt: before } : {}), ...(from ? { gte: from } : {}) };
  const list = await tx.message.findMany({ where: { conversationId, ...(before || from ? { createdAt } : {}) }, orderBy: { createdAt: 'desc' }, take: PAGE + 1, include: { attachment: { select: { fileName: true, nameCiphertext: true, nameIv: true, nameAuthTag: true, contentType: true, size: true } } } });
  const more = list.length > PAGE;
  const page = list.slice(0, PAGE).reverse();
  const authors = await loadPeople(tx, ctx, [...new Set(page.map((m) => m.authorId).filter((id) => !people.some((p) => p.id === id)))]);
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? authors.get(id)?.name ?? null;
  const now = Date.now();
  const messages = await withConversationKey(conv, (key) =>
    page.map((m) => {
      const open = (part: 'text' | 'original', s: { ciphertext: Uint8Array | null; iv: Uint8Array | null; authTag: Uint8Array | null }) => (s.ciphertext && s.iv && s.authTag ? openWith(key, { ciphertext: s.ciphertext, iv: s.iv, authTag: s.authTag }, messageAad(a.tenantId, conversationId, m.id, part)).toString('utf8') : null);
      const removed = !!m.deletedAt;
      const text = removed && !access ? null : open('text', m);
      return {
        id: m.id,
        authorId: m.authorId,
        author: nameOf(m.authorId),
        mine: m.authorId === a.userId,
        text,
        removed,
        createdAt: m.createdAt,
        editedAt: m.editedAt,
        attachment: m.attachment && (!removed || access) ? { fileName: attachmentName(key, a.tenantId, conversationId, m.id, m.attachment), contentType: m.attachment.contentType, size: m.attachment.size } : null,
        canEdit: !access && m.authorId === a.userId && !removed && now - m.createdAt.getTime() < EDIT_WINDOW_MS,
        // An investigation sees the first version of an edited message.
        ...(access && m.originalCiphertext ? { original: open('original', { ciphertext: m.originalCiphertext, iv: m.originalIv, authTag: m.originalAuthTag }) } : {}),
      };
    }),
  );
  const name = await describe(tx, [conv], a.userId, new Map(people.map((p) => [p.id, p])));
  return {
    id: conv.id,
    kind: conv.kind,
    ...name(conv, rows.map((r) => r.userId)),
    closesAt: conv.closesAt,
    readOnly: shownReadOnly(readOnlyReason(conv, people, ctx), a.roles.includes('HR_ADMIN')),
    muted: mine?.muted ?? false,
    owner: mine?.owner ?? false,
    investigation: access ? { reason: access.reason, expiresAt: access.expiresAt } : null,
    members: rows.map((r) => ({ id: r.userId, name: nameOf(r.userId), lastReadAt: r.lastReadAt, owner: r.owner, active: people.find((p) => p.id === r.userId)?.active ?? false })),
    messages,
    more,
  };
}

// ------------------------------------------------------------------ Writing

export interface Attachment { fileName: string; data: string }

async function sendable(tx: Tx, a: AuthContext, conversationId: string) {
  const ctx = await loadContext(tx);
  const conv = await tx.conversation.findUnique({ where: { id: conversationId } });
  if (!conv) throw notFound('Conversation');
  const { rows, people } = await membersOf(tx, ctx, conversationId);
  if (!rows.some((r) => r.userId === a.userId)) throw notFound('Conversation');
  const ro = readOnlyReason(conv, people, ctx);
  const hr = a.roles.includes('HR_ADMIN');
  // Still recorded as a rule-of-two refusal; only HR is told that's why.
  if (ro === 'safeguarding') await minorRule(tx, a, 'send', conversationId, !hr);
  if (ro) throw new HttpError(409, 'READ_ONLY', 'This conversation is read-only.', { reason: shownReadOnly(ro, hr) });
  return { ctx, conv, rows, people };
}

/**
 * The per-person send limits, checked before the send's transaction opens (the route calls this
 * first). Under load, checking them inside it held the transaction's connection while each check
 * waited for a second one from the same pool (the shared limiter runs its own transaction), and
 * a busy pool then refused sends outright.
 */
export async function sendLimits(userId: string, withFile: boolean) {
  await limit('send', userId, SLOW_DOWN);
  await limit('sendDay', userId, 'You’ve reached today’s limit for messages. Try again tomorrow.');
  if (withFile) await limit('file', userId, 'You’ve sent a lot of files. Try again in an hour.');
}

export async function sendMessage(tx: Tx, a: AuthContext, conversationId: string, text: string, file?: Attachment) {
  const body = text.trim();
  if (!body && !file) throw badRequest('Write a message or attach a file.');
  if (body.length > MAX_TEXT) throw badRequest(`Messages can be up to ${MAX_TEXT} characters.`);
  const { conv, rows, people } = await sendable(tx, a, conversationId);
  let bytes: Buffer | null = null;
  let type: ReturnType<typeof sniff> = null;
  if (file) {
    bytes = Buffer.from(file.data.slice(file.data.indexOf(',') + 1), 'base64');
    if (!bytes.length) throw badRequest('The file is empty.');
    if (bytes.length > MAX_FILE_BYTES) throw new HttpError(413, 'TOO_LARGE', 'Files can be up to 10 MB.');
    type = sniff(bytes);
    if (!type) throw new HttpError(415, 'UNSUPPORTED_TYPE', 'Attach a PDF, PNG, JPEG or WebP file.');
  }
  const id = randomUUID();
  const now = new Date();
  await withConversationKey(conv, async (key) => {
    const s = sealWith(key, body, messageAad(a.tenantId, conversationId, id, 'text'));
    await tx.message.create({ data: { id, tenantId: a.tenantId, conversationId, authorId: a.userId, ciphertext: s.ciphertext, iv: s.iv, authTag: s.authTag, createdAt: now } });
    if (bytes && type) {
      const f = sealWith(key, bytes, messageAad(a.tenantId, conversationId, id, 'file'));
      // The name is sealed too (it can say what the file is about); no fingerprint is kept.
      const n = sealWith(key, storedName(file!.fileName, type), messageAad(a.tenantId, conversationId, id, 'name'));
      await tx.messageAttachment.create({ data: { tenantId: a.tenantId, messageId: id, nameCiphertext: n.ciphertext, nameIv: n.iv, nameAuthTag: n.authTag, contentType: type, size: bytes.length, ciphertext: f.ciphertext, iv: f.iv, authTag: f.authTag } });
    }
  });
  await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } });
  await tx.conversationMember.update({ where: { conversationId_userId: { conversationId, userId: a.userId } }, data: { lastReadAt: now } });
  // One notification per conversation until it's read: a busy group doesn't fill the bell.
  const others = rows.filter((r) => r.userId !== a.userId && !r.muted && people.find((p) => p.id === r.userId)?.active).map((r) => r.userId);
  const waiting = new Set(
    (await tx.notification.findMany({ where: { userId: { in: others }, type: 'message_new', readAt: null, params: { path: ['conversationId'], equals: conversationId } }, select: { userId: true } })).map((n) => n.userId),
  );
  const from = people.find((p) => p.id === a.userId)?.name ?? '';
  // Never the text: the push makes its preview from the sealed message when it's sent (messagePreviews).
  await notify(tx, a.tenantId, others.filter((u) => !waiting.has(u)).map((userId) => ({ userId, type: 'message_new', params: { conversationId, messageId: id, from }, link: `/messages?c=${conversationId}` })));
  await announceChangeTo(tx, a.tenantId, 'messages', rows.map((r) => r.userId));
  return { id, createdAt: now };
}

export async function editMessage(tx: Tx, a: AuthContext, messageId: string, text: string) {
  const body = text.trim();
  if (!body) throw badRequest('A message can’t be empty. Remove it instead.');
  if (body.length > MAX_TEXT) throw badRequest(`Messages can be up to ${MAX_TEXT} characters.`);
  const m = await tx.message.findUnique({ where: { id: messageId } });
  if (!m || m.authorId !== a.userId) throw notFound('Message');
  if (m.deletedAt) throw conflict('REMOVED', 'This message was removed.');
  if (Date.now() - m.createdAt.getTime() >= EDIT_WINDOW_MS) throw conflict('EDIT_WINDOW', 'Messages can be changed for 15 minutes after they’re sent.');
  const { conv, rows } = await sendable(tx, a, m.conversationId);
  await withConversationKey(conv, async (key) => {
    const s = sealWith(key, body, messageAad(a.tenantId, m.conversationId, m.id, 'text'));
    // The first version is kept (sealed) for an investigation; later edits replace the current text only.
    const keep = !m.originalCiphertext && m.ciphertext ? (() => {
      const first = openWith(key, { ciphertext: m.ciphertext!, iv: m.iv!, authTag: m.authTag! }, messageAad(a.tenantId, m.conversationId, m.id, 'text'));
      const o = sealWith(key, first, messageAad(a.tenantId, m.conversationId, m.id, 'original'));
      return { originalCiphertext: o.ciphertext, originalIv: o.iv, originalAuthTag: o.authTag };
    })() : {};
    await tx.message.update({ where: { id: m.id }, data: { ciphertext: s.ciphertext, iv: s.iv, authTag: s.authTag, editedAt: new Date(), ...keep } });
  });
  await announceChangeTo(tx, a.tenantId, 'messages', rows.map((r) => r.userId));
}

/** The author removes a message: members see "message removed". */
export async function removeMessage(tx: Tx, a: AuthContext, messageId: string) {
  const m = await tx.message.findUnique({ where: { id: messageId }, select: { id: true, authorId: true, conversationId: true, deletedAt: true } });
  if (!m || m.authorId !== a.userId) throw notFound('Message');
  if (m.deletedAt) return;
  await tx.message.update({ where: { id: m.id }, data: { deletedAt: new Date(), deletedById: a.userId } });
  await forgetMessageNotifications(tx, [m.id]);
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'messages.remove', entity: 'Message', entityId: m.id });
  await signal(tx, a.tenantId, m.conversationId);
}

/** Read receipt: everything up to now has been seen. Clears this conversation's notifications too. */
export async function markRead(tx: Tx, a: AuthContext, conversationId: string) {
  const r = await tx.conversationMember.updateMany({ where: { conversationId, userId: a.userId }, data: { lastReadAt: new Date() } });
  if (!r.count) throw notFound('Conversation');
  await tx.notification.updateMany({ where: { userId: a.userId, type: 'message_new', readAt: null, params: { path: ['conversationId'], equals: conversationId } }, data: { readAt: new Date() } });
  // The reader's own screens (badge, list) refresh; the other members only need the "seen by"
  // line of an open conversation ('receipts'), not their badge and list. Telling every member
  // 'messages' on every read made each message in a busy conversation cost members × readers refetches.
  const ids = (await tx.conversationMember.findMany({ where: { conversationId }, select: { userId: true } })).map((m) => m.userId);
  await announceChangeTo(tx, a.tenantId, 'messages', [a.userId]);
  await announceChangeTo(tx, a.tenantId, 'receipts', ids.filter((id) => id !== a.userId));
}

export async function setMuted(tx: Tx, a: AuthContext, conversationId: string, muted: boolean) {
  const r = await tx.conversationMember.updateMany({ where: { conversationId, userId: a.userId }, data: { muted } });
  if (!r.count) throw notFound('Conversation');
  await announceChangeTo(tx, a.tenantId, 'messages', [a.userId]);
}

/** A file sent with a message, for a member (unless removed) or an investigation. */
export async function readAttachment(tx: Tx, a: AuthContext, messageId: string) {
  const m = await tx.message.findUnique({ where: { id: messageId }, include: { attachment: true, conversation: true } });
  if (!m?.attachment) throw notFound('File');
  const member = await tx.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: m.conversationId, userId: a.userId } } });
  const access = member ? null : await investigating(tx, a, m.conversationId);
  const visible = !!member && !m.deletedAt && (!member.historyFrom || m.createdAt >= member.historyFrom);
  if (!visible && !access) throw notFound('File');
  if (access) await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'messages.investigation_file', entity: 'Message', entityId: m.id, after: { accessId: access.id } });
  const f = m.attachment;
  const { bytes, name } = await withConversationKey(m.conversation, (key) => ({ bytes: openWith(key, f, messageAad(a.tenantId, m.conversationId, m.id, 'file')), name: attachmentName(key, a.tenantId, m.conversationId, m.id, f) }));
  return { bytes, type: f.contentType as 'application/pdf', name };
}

// ------------------------------------------------------------------ Reports and investigations

/** A member reports a message to HR (workplace harassment policy). HR is told; the conversation isn't opened by this alone. */
export async function reportMessage(tx: Tx, a: AuthContext, messageId: string, reason: string) {
  const m = await tx.message.findUnique({ where: { id: messageId }, select: { id: true, conversationId: true } });
  if (!m) throw notFound('Message');
  if (!(await tx.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: m.conversationId, userId: a.userId } } }))) throw notFound('Message');
  // One report per message per person, open or closed (HR can reopen the matter with them).
  if (await tx.messageReport.findFirst({ where: { messageId, reporterId: a.userId } })) throw conflict('ALREADY_REPORTED', 'You’ve already reported this message. HR has it.');
  await limit('report', a.userId, 'You’ve sent a lot of reports. Try again in an hour, or talk to HR directly.');
  const r = await tx.messageReport.create({ data: { tenantId: a.tenantId, messageId, conversationId: m.conversationId, reporterId: a.userId, reason } });
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'messages.report', entity: 'MessageReport', entityId: r.id, after: { messageId } });
  const hr = await usersWithPermission(tx, a.tenantId, 'messages.investigate', [a.userId]);
  await notify(tx, a.tenantId, hr.map((userId) => ({ userId, type: 'message_reported', params: {}, link: '/manage/messages' })));
  return r;
}

export async function listReports(tx: Tx, a: AuthContext) {
  const ctx = await loadContext(tx);
  const rows = await tx.messageReport.findMany({ orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 200 });
  const convs = await tx.conversation.findMany({ where: { id: { in: rows.map((r) => r.conversationId) } }, select: { id: true, kind: true } });
  const msgs = await tx.message.findMany({ where: { id: { in: rows.map((r) => r.messageId) } }, select: { id: true, authorId: true } });
  const people = await loadPeople(tx, ctx, [...new Set([...rows.map((r) => r.reporterId), ...msgs.map((m) => m.authorId)])]);
  const access = await tx.conversationAccess.findMany({ where: { userId: a.userId, conversationId: { in: rows.map((r) => r.conversationId) }, expiresAt: { gt: new Date() } }, select: { conversationId: true } });
  return rows.map((r) => {
    const author = msgs.find((m) => m.id === r.messageId)?.authorId;
    return {
      id: r.id,
      status: r.status,
      reason: r.reason,
      createdAt: r.createdAt,
      closedAt: r.closedAt,
      closingNote: r.closingNote,
      reporter: people.get(r.reporterId)?.name ?? null,
      author: author ? (people.get(author)?.name ?? null) : null,
      conversationId: r.conversationId,
      messageId: r.messageId,
      kind: convs.find((c) => c.id === r.conversationId)?.kind ?? null,
      open: access.some((x) => x.conversationId === r.conversationId),
    };
  });
}

export async function closeReport(tx: Tx, a: AuthContext, id: string, note: string) {
  const r = await tx.messageReport.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date(), closedById: a.userId, closingNote: note } });
  if (!r.count) throw notFound('Report');
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'messages.report_close', entity: 'MessageReport', entityId: id });
}

/** HR opens a conversation they're not in, for an investigation: a reason is required, it lasts two weeks, and it's in the audit log. */
export async function openForInvestigation(tx: Tx, a: AuthContext, conversationId: string, reason: string, reportId?: string) {
  if (!(await tx.conversation.findUnique({ where: { id: conversationId }, select: { id: true } }))) throw notFound('Conversation');
  if (reportId && !(await tx.messageReport.findFirst({ where: { id: reportId, conversationId } }))) throw notFound('Report');
  const expiresAt = new Date(Date.now() + INVESTIGATION_DAYS * 86_400_000);
  const g = await tx.conversationAccess.create({ data: { tenantId: a.tenantId, conversationId, userId: a.userId, reason, reportId: reportId ?? null, expiresAt } });
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'messages.investigation_open', entity: 'Conversation', entityId: conversationId, after: { reason, reportId: reportId ?? null, expiresAt } });
  return g;
}

/** HR looks up the conversations someone is in (names and members only, no text), to open one for an investigation. Needs a reason; audited with it. */
export async function conversationsOf(tx: Tx, a: AuthContext, userId: string, reason: string) {
  const ctx = await loadContext(tx);
  const mine = await tx.conversationMember.findMany({ where: { userId }, include: { conversation: { include: { members: { select: { userId: true } }, _count: { select: { messages: true } } } } } });
  const people = await loadPeople(tx, ctx, [...new Set(mine.flatMap((m) => m.conversation.members.map((x) => x.userId)))]);
  const name = await describe(tx, mine.map((m) => m.conversation), userId, people);
  await audit(tx, { tenantId: a.tenantId, actorId: a.userId, action: 'messages.investigation_lookup', entity: 'User', entityId: userId, after: { reason } });
  return mine.map((m) => ({ id: m.conversation.id, kind: m.conversation.kind, ...name(m.conversation, m.conversation.members.map((x) => x.userId)), members: m.conversation.members.map((x) => people.get(x.userId)?.name ?? null), messages: m.conversation._count.messages, lastMessageAt: m.conversation.lastMessageAt }));
}

// ------------------------------------------------------------------ Sealed file names, notifications

type SealedName = { fileName: string | null; nameCiphertext: Uint8Array | null; nameIv: Uint8Array | null; nameAuthTag: Uint8Array | null };
/** A file's name: sealed (or, on rows from before names were sealed, as it was stored until the retention run seals it). */
export function attachmentName(key: Buffer, tenantId: string, conversationId: string, messageId: string, f: SealedName): string {
  if (f.nameCiphertext && f.nameIv && f.nameAuthTag) return openWith(key, { ciphertext: f.nameCiphertext, iv: f.nameIv, authTag: f.nameAuthTag }, messageAad(tenantId, conversationId, messageId, 'name')).toString('utf8');
  return f.fileName ?? 'file';
}

/** Deletes the "new message" notifications pointing at these messages (removed or erased). */
export async function forgetMessageNotifications(tx: Tx, messageIds: string[]) {
  if (!messageIds.length) return;
  await tx.notification.deleteMany({ where: { type: 'message_new', OR: messageIds.map((id) => ({ params: { path: ['messageId'], equals: id } })) } });
}

/**
 * The first words of each "new message" notification's message, for the push, made now from the
 * sealed message: only while the organization allows previews, the message is still there (not
 * removed or erased) and the person can still see it. Runs in the organization's transaction.
 */
export async function messagePreviews(tx: Tx, notifications: Array<{ id: string; tenantId: string; userId: string; type: string; params: unknown }>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = notifications.filter((n) => n.type === 'message_new' && typeof (n.params as { messageId?: unknown } | null)?.messageId === 'string');
  if (!wanted.length) return out;
  const t = await tx.tenant.findUnique({ where: { id: wanted[0]!.tenantId }, select: { id: true, messagingSettings: true } });
  if (!t || !readMessagingSettings(t.messagingSettings).pushPreview) return out;
  const ids = [...new Set(wanted.map((n) => (n.params as { messageId: string }).messageId))];
  const msgs = await tx.message.findMany({ where: { id: { in: ids }, tenantId: t.id, deletedAt: null, ciphertext: { not: null } }, include: { conversation: { select: { id: true, wrappedKey: true, kekId: true } } } });
  const members = await tx.conversationMember.findMany({ where: { conversationId: { in: [...new Set(msgs.map((m) => m.conversationId))] }, userId: { in: [...new Set(wanted.map((n) => n.userId))] } }, select: { conversationId: true, userId: true, historyFrom: true } });
  const byConv = new Map<string, typeof msgs>();
  for (const m of msgs) byConv.set(m.conversationId, [...(byConv.get(m.conversationId) ?? []), m]);
  const text = new Map<string, string>();
  for (const list of byConv.values()) {
    await withConversationKey(list[0]!.conversation, (key) => {
      for (const m of list) {
        try {
          const body = openWith(key, { ciphertext: m.ciphertext!, iv: m.iv!, authTag: m.authTag! }, messageAad(t.id, m.conversationId, m.id, 'text')).toString('utf8');
          if (body) text.set(m.id, body.length > PREVIEW_CHARS ? `${body.slice(0, PREVIEW_CHARS - 1)}…` : body);
        } catch {
          /* no preview */
        }
      }
    });
  }
  for (const n of wanted) {
    const mid = (n.params as { messageId: string }).messageId;
    const m = msgs.find((x) => x.id === mid);
    const mem = m && members.find((x) => x.conversationId === m.conversationId && x.userId === n.userId);
    if (m && mem && (!mem.historyFrom || m.createdAt >= mem.historyFrom) && text.has(mid)) out.set(n.id, text.get(mid)!);
  }
  return out;
}
