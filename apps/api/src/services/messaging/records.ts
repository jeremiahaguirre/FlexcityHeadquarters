/**
 * Messages in privacy work: retention, erasure and a person's records export.
 *
 * - Retention: a conversation with no message for the organization's period (default 2 years,
 *   services/privacy/retention.ts messagesDays) is deleted with its messages, files, members and
 *   investigation openings. One with an open report to HR is kept until the report is closed (held
 *   conversations are left out before the batch is taken, so they never hold up the rest).
 *   In conversations still in use, a removed message's sealed text and file go when the period has
 *   passed since it was removed, and an edited message's first version when it has passed since the
 *   edit (unless under an open report). The same run seals file names stored before names were
 *   sealed, and strips message previews left in notifications from before previews stopped being stored.
 * - Erasure (anonymization): the person's messages are wiped (their sealed text and files deleted,
 *   shown as "message removed") and they leave every conversation. Messages under an open report
 *   are kept until it's closed, like any record needed for an investigation. The "new message"
 *   notifications pointing at their messages (which carry their name) are deleted.
 * - Records export: the conversations the person is in, and the text of every message they wrote,
 *   with the first version of any they edited.
 *   Messages others wrote are listed by count only (third parties' information; HR can open a
 *   conversation for review if a request needs it).
 */
import type { Tx } from '../../lib/db.js';
import { attachmentName, forgetMessageNotifications } from './conversations.js';
import { messageAad, openWith, sealWith, withConversationKey } from './crypto.js';

const ago = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

/** Runs in one organization's context (applyRetention). Returns conversations removed. */
export async function applyMessageRetention(tx: Tx, days: number, now = new Date()): Promise<number> {
  const cut = ago(now, days);
  const openReports = await tx.messageReport.findMany({ where: { status: 'OPEN' }, select: { conversationId: true, messageId: true } });
  const held = [...new Set(openReports.map((r) => r.conversationId))];
  const heldMessages = [...new Set(openReports.map((r) => r.messageId))];
  // Oldest first; held conversations are excluded in the query itself, so they can't fill the batch.
  const stale = await tx.conversation.findMany({ orderBy: { lastMessageAt: { sort: 'asc', nulls: 'first' } }, where: { id: { notIn: held }, OR: [{ lastMessageAt: { lt: cut } }, { lastMessageAt: null, createdAt: { lt: cut } }] }, select: { id: true }, take: 1000 });
  const ids = stale.map((c) => c.id);
  let removed = 0;
  if (ids.length) {
    await tx.messageReport.deleteMany({ where: { conversationId: { in: ids } } });
    await tx.conversationAccess.deleteMany({ where: { conversationId: { in: ids } } });
    await tx.notification.deleteMany({ where: { type: 'message_new', OR: ids.map((id) => ({ params: { path: ['conversationId'], equals: id } })) } });
    // Members, messages and files go with the conversation (ON DELETE CASCADE).
    removed = (await tx.conversation.deleteMany({ where: { id: { in: ids } } })).count;
  }
  // In conversations still in use: removed messages and first versions, each from its own date.
  const gone = (await tx.message.findMany({ where: { deletedAt: { lt: cut }, id: { notIn: heldMessages }, OR: [{ ciphertext: { not: null } }, { originalCiphertext: { not: null } }, { attachment: { isNot: null } }] }, select: { id: true }, take: 5000 })).map((m) => m.id);
  if (gone.length) {
    await tx.messageAttachment.deleteMany({ where: { messageId: { in: gone } } });
    await tx.message.updateMany({ where: { id: { in: gone } }, data: { ciphertext: null, iv: null, authTag: null, originalCiphertext: null, originalIv: null, originalAuthTag: null } });
  }
  await tx.message.updateMany({ where: { editedAt: { lt: cut }, originalCiphertext: { not: null }, id: { notIn: heldMessages } }, data: { originalCiphertext: null, originalIv: null, originalAuthTag: null } });
  // Closed reports past the period, for conversations still in use.
  await tx.messageReport.deleteMany({ where: { status: 'CLOSED', closedAt: { lt: cut } } });
  await sealLegacyNames(tx);
  // Notifications from before previews stopped being stored: the preview goes.
  await tx.$executeRaw`UPDATE "Notification" SET params = params - 'preview' WHERE type = 'message_new' AND params ? 'preview'`;
  return removed;
}

/** File names stored before names were sealed: sealed now with the conversation's key, the plain name cleared. */
export async function sealLegacyNames(tx: Tx, batch = 500): Promise<number> {
  const rows = await tx.messageAttachment.findMany({ where: { fileName: { not: null } }, select: { id: true, tenantId: true, messageId: true, fileName: true, message: { select: { conversationId: true, conversation: { select: { wrappedKey: true, kekId: true } } } } }, take: batch });
  const byConv = new Map<string, typeof rows>();
  for (const r of rows) byConv.set(r.message.conversationId, [...(byConv.get(r.message.conversationId) ?? []), r]);
  for (const [conversationId, list] of byConv) {
    await withConversationKey(list[0]!.message.conversation, async (key) => {
      for (const r of list) {
        const n = sealWith(key, r.fileName!, messageAad(r.tenantId, conversationId, r.messageId, 'name'));
        await tx.messageAttachment.update({ where: { id: r.id }, data: { fileName: null, nameCiphertext: n.ciphertext, nameIv: n.iv, nameAuthTag: n.authTag } });
      }
    });
  }
  return rows.length;
}

/** Anonymization: wipe what the person wrote and take them out of every conversation. */
export async function forgetMessages(tx: Tx, userId: string): Promise<void> {
  const heldMessages = new Set((await tx.messageReport.findMany({ where: { status: 'OPEN' }, select: { messageId: true } })).map((r) => r.messageId));
  const theirs = (await tx.message.findMany({ where: { authorId: userId }, select: { id: true } })).map((m) => m.id).filter((id) => !heldMessages.has(id));
  if (theirs.length) {
    await tx.messageAttachment.deleteMany({ where: { messageId: { in: theirs } } });
    await tx.message.updateMany({ where: { id: { in: theirs } }, data: { ciphertext: null, iv: null, authTag: null, originalCiphertext: null, originalIv: null, originalAuthTag: null, deletedAt: new Date() } });
  }
  // Others' "new message" notifications pointing at what they wrote carry their name: deleted
  // (every one of their messages, held or not; the notification isn't needed for an investigation).
  // Older notifications, from before they named the message, go for every conversation the person was in.
  const all = (await tx.message.findMany({ where: { authorId: userId }, select: { id: true } })).map((m) => m.id);
  for (let i = 0; i < all.length; i += 500) await forgetMessageNotifications(tx, all.slice(i, i + 500));
  const convs = (await tx.conversationMember.findMany({ where: { userId }, select: { conversationId: true } })).map((m) => m.conversationId);
  for (const c of convs) await tx.$executeRaw`DELETE FROM "Notification" WHERE type = 'message_new' AND params->>'conversationId' = ${c} AND NOT (params ? 'messageId')`;
  await tx.conversationMember.deleteMany({ where: { userId } });
}

/** For the person's records export. */
export async function messageRecords(tx: Tx, tenantId: string, userId: string) {
  const member = await tx.conversationMember.findMany({ where: { userId }, include: { conversation: { select: { id: true, kind: true, title: true, createdAt: true, wrappedKey: true, kekId: true } } } });
  const written = await tx.message.findMany({ where: { authorId: userId }, orderBy: { createdAt: 'asc' }, include: { attachment: { select: { fileName: true, nameCiphertext: true, nameIv: true, nameAuthTag: true, size: true } }, conversation: { select: { id: true, wrappedKey: true, kekId: true } } } });
  const byConv = new Map<string, typeof written>();
  for (const m of written) byConv.set(m.conversationId, [...(byConv.get(m.conversationId) ?? []), m]);
  const messages: Array<{ conversationId: string; sentAt: Date; editedAt: Date | null; removedAt: Date | null; text: string | null; originalText?: string | null; file: string | null }> = [];
  for (const [conversationId, list] of byConv) {
    await withConversationKey(list[0]!.conversation, (key) => {
      for (const m of list) {
        const opened = (part: 'text' | 'original', c: Uint8Array | null, iv: Uint8Array | null, tag: Uint8Array | null) => {
          if (!c || !iv || !tag) return null;
          try {
            return openWith(key, { ciphertext: c, iv, authTag: tag }, messageAad(tenantId, conversationId, m.id, part)).toString('utf8');
          } catch {
            return '[could not be opened]';
          }
        };
        const text = opened('text', m.ciphertext, m.iv, m.authTag);
        // Their own first version of a message they edited is theirs too.
        const originalText = opened('original', m.originalCiphertext, m.originalIv, m.originalAuthTag);
        let file: string | null = null;
        if (m.attachment) {
          try {
            file = `${attachmentName(key, tenantId, conversationId, m.id, m.attachment)} (${m.attachment.size} bytes)`;
          } catch {
            file = `[file] (${m.attachment.size} bytes)`;
          }
        }
        messages.push({ conversationId, sentAt: m.createdAt, editedAt: m.editedAt, removedAt: m.deletedAt, text, ...(originalText !== null ? { originalText } : {}), file });
      }
    });
  }
  // Counted from when they could see it (someone added later sees only what came after).
  const counts = await Promise.all(member.map((m) => tx.message.count({ where: { conversationId: m.conversationId, ...(m.historyFrom ? { createdAt: { gte: m.historyFrom } } : {}) } })));
  return {
    conversations: member.map((m, i) => ({ id: m.conversation.id, kind: m.conversation.kind, title: m.conversation.title, joinedAt: m.joinedAt, lastReadAt: m.lastReadAt, muted: m.muted, messagesInConversation: counts[i] ?? 0 })),
    messagesWritten: messages,
    reportsMade: await tx.messageReport.findMany({ where: { reporterId: userId }, select: { id: true, reason: true, status: true, createdAt: true, closedAt: true } }),
  };
}
