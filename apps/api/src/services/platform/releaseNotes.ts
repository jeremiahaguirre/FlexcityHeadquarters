/**
 * "What's new": FH's release notes, written in the Dev console in English and French, for some
 * roles, some or all organizations, from a publish date. Each person sees a note once (a sheet
 * after an update or at their next sign-in; dismissing it counts as read), and every note they
 * may see stays in the What's new list.
 *
 * Notes are FH's content, not an organization's: the table is written only with no organization
 * chosen, and inside an organization's session Postgres shows only the notes for that
 * organization or for all (db/rls.sql, fh_published). Read marks are the organization's data (RLS).
 */
import type { AccessRole, PrismaClient, ReleaseNote } from '../../generated/prisma/client.js';
import { z } from 'zod';
import { type Tx, db, tenantIds as allTenantIds } from '../../lib/db.js';
import { announceChange } from '../../lib/changes.js';

export const ROLES = ['HR_ADMIN', 'AQUATIC_SUPERVISOR', 'HEAD_LIFEGUARD', 'STAFF', 'FRONT_DESK', 'UNION_STEWARD', 'EMPLOYEE'] as const satisfies readonly AccessRole[];
/** Notes older than this aren't offered to someone who hasn't seen them (the list still has them for a year). */
export const UNSEEN_WINDOW_DAYS = 60;
export const LIST_DAYS = 365;
const DAY = 86_400_000;

/** Plain text only: control characters out (tabs and new lines stay), Windows line ends folded, trailing spaces trimmed. */
export function cleanText(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
const title = z.string().transform(cleanText).pipe(z.string().min(2).max(120)).refine((s) => !s.includes('\n'), 'One line');
const body = z.string().transform(cleanText).pipe(z.string().min(2).max(4000));

export const noteBody = z.object({
  titleEn: title,
  titleFr: title,
  bodyEn: body,
  bodyFr: body,
  roles: z.array(z.enum(ROLES)).max(ROLES.length).default([]),
  tenantIds: z.array(z.string().uuid()).max(500).default([]),
  ringIds: z.array(z.string().uuid()).max(20).default([]),
  publishAt: z.coerce.date(),
});
export type NoteInput = z.infer<typeof noteBody>;

export type NoteStatus = 'draft' | 'scheduled' | 'published' | 'withdrawn';
export function noteStatus(n: Pick<ReleaseNote, 'publishedAt' | 'withdrawnAt' | 'publishAt'>, now = new Date()): NoteStatus {
  if (n.withdrawnAt) return 'withdrawn';
  if (!n.publishedAt) return 'draft';
  return n.publishAt > now ? 'scheduled' : 'published';
}

/** Organizations in the chosen rings, added to the chosen organizations (rings are resolved when saved). */
export async function resolveAudience(prisma: PrismaClient, input: { tenantIds: string[]; ringIds: string[] }): Promise<string[]> {
  const fromRings = input.ringIds.length ? await ringTenants(prisma, input.ringIds) : [];
  return [...new Set([...input.tenantIds, ...fromRings])];
}
/** Set by services/platform/releases.ts once release rings exist (no dependency cycle). */
let ringTenants: (prisma: PrismaClient, ringIds: string[]) => Promise<string[]> = async () => [];
export function setRingResolver(fn: typeof ringTenants) {
  ringTenants = fn;
}

export function consoleView(n: ReleaseNote, now = new Date()) {
  return { ...n, status: noteStatus(n, now) };
}

/** Sends the live "new note" signal to the organizations it's for (all of them when it's for everyone). */
export async function announceNote(prisma: PrismaClient, n: Pick<ReleaseNote, 'id' | 'tenantIds'>): Promise<number> {
  const targets = n.tenantIds.length ? n.tenantIds : await allTenantIds(prisma);
  await prisma.$transaction(async (tx) => {
    for (const t of targets) await announceChange(tx as Tx, t, 'updates');
  });
  await prisma.releaseNote.update({ where: { id: n.id }, data: { announcedAt: new Date() } });
  return targets.length;
}

/** Worker: notes published for later whose time has come get their live signal. */
export async function announceDueNotes(prisma: PrismaClient = db(), now = new Date()): Promise<number> {
  const due = await prisma.releaseNote.findMany({ where: { publishedAt: { not: null }, withdrawnAt: null, announcedAt: null, publishAt: { lte: now } }, select: { id: true, tenantIds: true } });
  for (const n of due) await announceNote(prisma, n);
  return due.length;
}

export interface StaffNote { id: string; title: { en: string; fr: string }; body: { en: string; fr: string }; publishAt: string; readAt: string | null }

/** What one person may see, newest first: published, due, not withdrawn, for their organization and one of their roles. */
export async function notesFor(tx: Tx, tenantId: string, user: { id: string; roles: AccessRole[]; createdAt: Date }, now = new Date()): Promise<{ notes: StaffNote[]; unseen: string[] }> {
  const rows = await tx.releaseNote.findMany({
    where: {
      publishedAt: { not: null },
      withdrawnAt: null,
      publishAt: { lte: now, gte: new Date(now.getTime() - LIST_DAYS * DAY) },
      OR: [{ tenantIds: { isEmpty: true } }, { tenantIds: { has: tenantId } }],
    },
    orderBy: { publishAt: 'desc' },
    take: 100,
  });
  const mine = rows.filter((n) => n.roles.length === 0 || n.roles.some((r) => user.roles.includes(r)));
  const reads = new Map((await tx.releaseNoteRead.findMany({ where: { userId: user.id, noteId: { in: mine.map((n) => n.id) } }, select: { noteId: true, readAt: true } })).map((r) => [r.noteId, r.readAt]));
  // Someone who joined last week isn't greeted with a year of notes; nor is anyone with notes older than two months.
  const since = Math.max(user.createdAt.getTime(), now.getTime() - UNSEEN_WINDOW_DAYS * DAY);
  const notes = mine.map((n) => ({ id: n.id, title: { en: n.titleEn, fr: n.titleFr }, body: { en: n.bodyEn, fr: n.bodyFr }, publishAt: n.publishAt.toISOString(), readAt: reads.get(n.id)?.toISOString() ?? null }));
  return { notes, unseen: mine.filter((n) => !reads.has(n.id) && n.publishAt.getTime() >= since).map((n) => n.id) };
}

/** Dismissed or opened: read, once, for this person. Only notes they may see count. */
export async function markRead(tx: Tx, tenantId: string, user: { id: string; roles: AccessRole[]; createdAt: Date }, ids: string[]): Promise<number> {
  const { notes } = await notesFor(tx, tenantId, user);
  const ok = new Set(notes.map((n) => n.id));
  const data = [...new Set(ids)].filter((id) => ok.has(id)).map((noteId) => ({ tenantId, userId: user.id, noteId }));
  if (!data.length) return 0;
  return (await tx.releaseNoteRead.createMany({ data, skipDuplicates: true })).count;
}
