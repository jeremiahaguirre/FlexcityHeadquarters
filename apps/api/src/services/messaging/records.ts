/**
 * Messages in privacy work: retention, erasure and a person's records export.
 *
 * - Retention: a conversation with no message for the organization's period (default 2 years,
 *   services/privacy/retention.ts messagesDays) is deleted with its messages, files, members and
 *   investigation openings. One with an open report to HR is kept until the report is closed.
 * - Erasure (anonymization): the person's messages are wiped (their sealed text and files deleted,
 *   shown as "message removed") and they leave every conversation. Messages under an open report
 *   are kept until it's closed, like any record needed for an investigation.
 * - Records export: the conversations the person is in, and the text of every message they wrote.
 *   Messages others wrote are listed by count only (third parties' information; HR can open a
 *   conversation for review if a request needs it).
 */
import type { Tx } from '../../lib/db.js';
import { messageAad, openWith, withConversationKey } from './crypto.js';

const ago = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

/** Runs in one organization's context (applyRetention). Returns conversations removed. */
export async function applyMessageRetention(tx: Tx, days: number, now = new Date()): Promise<number> {
  const cut = ago(now, days);
  const held = new Set((await tx.messageReport.findMany({ where: { status: 'OPEN' }, select: { conversationId: true } })).map((r) => r.conversationId));
  const stale = await tx.conversation.findMany({ where: { OR: [{ lastMessageAt: { lt: cut } }, { lastMessageAt: null, createdAt: { lt: cut } }] }, select: { id: true }, take: 1000 });
  const ids = stale.map((c) => c.id).filter((id) => !held.has(id));
  if (!ids.length) return 0;
  await tx.messageReport.deleteMany({ where: { conversationId: { in: ids } } });
  await tx.conversationAccess.deleteMany({ where: { conversationId: { in: ids } } });
  // Members, messages and files go with the conversation (ON DELETE CASCADE).
  const r = await tx.conversation.deleteMany({ where: { id: { in: ids } } });
  // Closed reports past the period, for conversations still in use.
  await tx.messageReport.deleteMany({ where: { status: 'CLOSED', closedAt: { lt: cut } } });
  return r.count;
}

/** Anonymization: wipe what the person wrote and take them out of every conversation. */
export async function forgetMessages(tx: Tx, userId: string): Promise<void> {
  const heldMessages = new Set((await tx.messageReport.findMany({ where: { status: 'OPEN' }, select: { messageId: true } })).map((r) => r.messageId));
  const theirs = (await tx.message.findMany({ where: { authorId: userId }, select: { id: true } })).map((m) => m.id).filter((id) => !heldMessages.has(id));
  if (theirs.length) {
    await tx.messageAttachment.deleteMany({ where: { messageId: { in: theirs } } });
    await tx.message.updateMany({ where: { id: { in: theirs } }, data: { ciphertext: null, iv: null, authTag: null, originalCiphertext: null, originalIv: null, originalAuthTag: null, deletedAt: new Date() } });
  }
  await tx.conversationMember.deleteMany({ where: { userId } });
}

/** For the person's records export. */
export async function messageRecords(tx: Tx, tenantId: string, userId: string) {
  const member = await tx.conversationMember.findMany({ where: { userId }, include: { conversation: { select: { id: true, kind: true, title: true, createdAt: true, wrappedKey: true, kekId: true } } } });
  const written = await tx.message.findMany({ where: { authorId: userId }, orderBy: { createdAt: 'asc' }, include: { attachment: { select: { fileName: true, size: true } }, conversation: { select: { id: true, wrappedKey: true, kekId: true } } } });
  const byConv = new Map<string, typeof written>();
  for (const m of written) byConv.set(m.conversationId, [...(byConv.get(m.conversationId) ?? []), m]);
  const messages: Array<{ conversationId: string; sentAt: Date; editedAt: Date | null; removedAt: Date | null; text: string | null; file: string | null }> = [];
  for (const [conversationId, list] of byConv) {
    await withConversationKey(list[0]!.conversation, (key) => {
      for (const m of list) {
        let text: string | null = null;
        try {
          if (m.ciphertext && m.iv && m.authTag) text = openWith(key, { ciphertext: m.ciphertext, iv: m.iv, authTag: m.authTag }, messageAad(tenantId, conversationId, m.id, 'text')).toString('utf8');
        } catch {
          text = '[could not be opened]';
        }
        messages.push({ conversationId, sentAt: m.createdAt, editedAt: m.editedAt, removedAt: m.deletedAt, text, file: m.attachment ? `${m.attachment.fileName} (${m.attachment.size} bytes)` : null });
      }
    });
  }
  const counts = await tx.message.groupBy({ by: ['conversationId'], where: { conversationId: { in: member.map((m) => m.conversationId) } }, _count: { _all: true } });
  return {
    conversations: member.map((m) => ({ id: m.conversation.id, kind: m.conversation.kind, title: m.conversation.title, joinedAt: m.joinedAt, lastReadAt: m.lastReadAt, muted: m.muted, messagesInConversation: counts.find((c) => c.conversationId === m.conversationId)?._count._all ?? 0 })),
    messagesWritten: messages,
    reportsMade: await tx.messageReport.findMany({ where: { reporterId: userId }, select: { id: true, reason: true, status: true, createdAt: true, closedAt: true } }),
  };
}
