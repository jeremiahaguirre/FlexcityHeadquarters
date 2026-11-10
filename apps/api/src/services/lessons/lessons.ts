/**
 * Swim lessons: weekly classes, rosters and on-deck attendance.
 *
 * - An instructor sees a session when one of their published shifts (in the
 *   class's instructor position, at that facility) covers it.
 * - Attendance arrives in batches from phones that may have been offline.
 *   Each record has a client id: a retried upload is a no-op, and when the same
 *   swimmer/session was recorded twice, the latest tap wins.
 */
import type { AttendanceStatus, LessonClass } from '@prisma/client';
import type { Tx } from '../../lib/db.js';
import { addDays, dayOfWeek, localIso, startOfLocalDay } from '../../lib/time.js';
import type { Scope } from '../people/customRoles.js';
import { placeWhere, shiftInScope } from '../people/scope.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The dates a class meets in [from, to]: its days of the week (one, several, or
 * Monday to Friday), minus the campaign's skipped dates (holidays, closures).
 */
export function sessionDates(cls: Pick<LessonClass, 'dayOfWeek' | 'startsOn' | 'endsOn'> & { daysOfWeek?: number[] }, from: string, to: string, skip: string[] = []): string[] {
  const out: string[] = [];
  const days = cls.daysOfWeek?.length ? cls.daysOfWeek : [cls.dayOfWeek];
  const start = from > iso(cls.startsOn) ? from : iso(cls.startsOn);
  const end = to < iso(cls.endsOn) ? to : iso(cls.endsOn);
  for (let d = start; d <= end; d = addDays(d, 1)) if (days.includes(dayOfWeek(d)) && !skip.includes(d)) out.push(d);
  return out;
}

export function sessionWindow(cls: Pick<LessonClass, 'startMinute' | 'endMinute'>, date: string, tz: string) {
  const day = startOfLocalDay(date, tz).getTime();
  return { start: new Date(day + cls.startMinute * 60_000), end: new Date(day + cls.endMinute * 60_000) };
}

export interface SessionView {
  classId: string;
  sessionDate: string;
  name: string;
  level: string | null;
  facility: { id: string; name: string };
  localStartsAt: string;
  localEndsAt: string;
  roster: Array<{ enrollmentId: string; swimmerName: string; safetyNote: string | null; status: AttendanceStatus | null }>;
}

/** Sessions in [from, to] (facility-local dates), optionally only those `userId` is teaching. */
export async function listSessions(tx: Tx, from: string, to: string, userId?: string, scope: Scope = null): Promise<SessionView[]> {
  const classes = await tx.lessonClass.findMany({
    where: { startsOn: { lte: new Date(to) }, endsOn: { gte: new Date(from) }, published: true, ...placeWhere(scope) },
    include: { enrollments: { where: { active: true }, orderBy: { swimmerName: 'asc' } } },
  });
  if (!classes.length) return [];
  const campaigns = await tx.lessonCampaign.findMany({ where: { id: { in: classes.map((c) => c.campaignId).filter((x): x is string => !!x) } }, select: { id: true, skipDates: true } });
  const skipOf = (c: { campaignId: string | null }) => (campaigns.find((x) => x.id === c.campaignId)?.skipDates ?? []).map(iso);
  const facilities = await tx.facility.findMany({ where: { id: { in: [...new Set(classes.map((c) => c.facilityId))] } } });
  const shifts = userId
    ? await tx.shift.findMany({
        where: { userId, status: 'PUBLISHED', startsAt: { lt: new Date(`${addDays(to, 1)}T12:00:00Z`) }, endsAt: { gt: new Date(`${addDays(from, -1)}T00:00:00Z`) } },
      })
    : [];
  const attendance = await tx.lessonAttendance.findMany({
    where: { classId: { in: classes.map((c) => c.id) }, sessionDate: { gte: new Date(from), lte: new Date(to) } },
  });

  const out: SessionView[] = [];
  for (const c of classes) {
    const f = facilities.find((x) => x.id === c.facilityId)!;
    for (const date of sessionDates(c, from, to, skipOf(c))) {
      const w = sessionWindow(c, date, f.timezone);
      if (userId && !shifts.some((s) => s.facilityId === c.facilityId && s.positionId === c.positionId && s.startsAt <= w.start && s.endsAt >= w.end)) continue;
      out.push({
        classId: c.id,
        sessionDate: date,
        name: c.name,
        level: c.level,
        facility: { id: f.id, name: f.name },
        localStartsAt: localIso(w.start, f.timezone),
        localEndsAt: localIso(w.end, f.timezone),
        roster: c.enrollments.map((e) => ({
          enrollmentId: e.id,
          swimmerName: e.swimmerName,
          safetyNote: e.safetyNote,
          status: attendance.find((a) => a.enrollmentId === e.id && iso(a.sessionDate) === date)?.status ?? null,
        })),
      });
    }
  }
  return out.sort((a, b) => a.localStartsAt.localeCompare(b.localStartsAt));
}

export interface AttendanceInput {
  clientId: string;
  enrollmentId: string;
  sessionDate: string;
  status: AttendanceStatus;
  recordedAt: Date;
}

export type AttendanceOutcome = 'saved' | 'duplicate' | 'superseded' | 'not_your_session' | 'invalid';

export async function recordAttendance(
  tx: Tx,
  actor: { userId: string; tenantId: string; canManage: boolean; scope?: Scope },
  records: AttendanceInput[],
): Promise<Array<{ clientId: string; outcome: AttendanceOutcome }>> {
  const results: Array<{ clientId: string; outcome: AttendanceOutcome }> = [];
  const dates = records.map((r) => r.sessionDate).sort();
  const mine = actor.canManage ? null : await listSessions(tx, dates[0]!, dates[dates.length - 1]!, actor.userId);

  for (const r of records) {
    if (await tx.lessonAttendance.findUnique({ where: { clientId: r.clientId } })) {
      results.push({ clientId: r.clientId, outcome: 'duplicate' });
      continue;
    }
    const enrollment = await tx.lessonEnrollment.findUnique({ where: { id: r.enrollmentId }, include: { lessonClass: true } });
    if (!enrollment || !sessionDates(enrollment.lessonClass, r.sessionDate, r.sessionDate).length || r.recordedAt.getTime() > Date.now() + 5 * 60_000) {
      results.push({ clientId: r.clientId, outcome: 'invalid' });
      continue;
    }
    if ((mine && !mine.some((s) => s.classId === enrollment.classId && s.sessionDate === r.sessionDate)) || (!mine && !shiftInScope(actor.scope ?? null, enrollment.lessonClass))) {
      results.push({ clientId: r.clientId, outcome: 'not_your_session' });
      continue;
    }
    const existing = await tx.lessonAttendance.findUnique({ where: { enrollmentId_sessionDate: { enrollmentId: r.enrollmentId, sessionDate: new Date(r.sessionDate) } } });
    if (existing && existing.recordedAt >= r.recordedAt) {
      results.push({ clientId: r.clientId, outcome: 'superseded' });
      continue;
    }
    if (existing) {
      await tx.lessonAttendance.update({ where: { id: existing.id }, data: { status: r.status, recordedAt: r.recordedAt, recordedById: actor.userId, clientId: r.clientId } });
    } else {
      await tx.lessonAttendance.create({
        data: {
          tenantId: actor.tenantId,
          classId: enrollment.classId,
          enrollmentId: r.enrollmentId,
          sessionDate: new Date(r.sessionDate),
          status: r.status,
          recordedAt: r.recordedAt,
          recordedById: actor.userId,
          clientId: r.clientId,
        },
      });
    }
    results.push({ clientId: r.clientId, outcome: 'saved' });
  }
  return results;
}
