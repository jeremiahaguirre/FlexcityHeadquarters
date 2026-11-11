'use client';

import { AlertTriangle, Check, CloudOff, GraduationCap, RefreshCw, UserX, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatTimeRange, formatClock } from '@/lib/format';
import { type Session, type Status, cacheSessions, cachedSessions, enqueue, queued, syncQueue } from '@/lib/offlineAttendance';
import { plusDays, todayIso } from '@/lib/useQuery';

const CHOICES: Array<{ s: Status; Icon: typeof Check; tone: string }> = [
  { s: 'PRESENT', Icon: Check, tone: 'bg-ok-bg text-ok border-ok/40' },
  { s: 'ABSENT', Icon: X, tone: 'bg-warn-bg text-warn border-warn/40' },
  { s: 'EXCUSED', Icon: UserX, tone: 'bg-surface text-ink border-muted/40' },
];

/** Lesson attendance on the pool deck. Taps are saved on the phone first (lib/offlineAttendance.ts) and uploaded when there is signal, because decks often have none. */
export default function LessonsPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [offlineSince, setOfflineSince] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [, force] = useState(0);

  const load = useCallback(async () => {
    const from = plusDays(todayIso(), -1);
    try {
      const s = await api<Session[]>(`/api/me/lessons?from=${from}&to=${plusDays(from, 8)}`);
      cacheSessions(s);
      setSessions(s);
      setOfflineSince(null);
    } catch {
      const c = cachedSessions();
      setSessions(c?.sessions ?? []);
      setOfflineSince(c?.savedAt ?? new Date().toISOString());
    }
    setWaiting(await syncQueue());
  }, []);

  useEffect(() => {
    void load();
    const online = () => void syncQueue().then(setWaiting);
    window.addEventListener('online', online);
    const id = setInterval(online, 30_000);
    return () => {
      window.removeEventListener('online', online);
      clearInterval(id);
    };
  }, [load]);

  const mark = async (sessionDate: string, enrollmentId: string, status: Status) => {
    enqueue({ enrollmentId, sessionDate, status });
    force((n) => n + 1);
    setWaiting(queued().length);
    setWaiting(await syncQueue());
  };

  const statusFor = (s: Session, enrollmentId: string, server: Status | null) =>
    queued().find((q) => q.enrollmentId === enrollmentId && q.sessionDate === s.sessionDate)?.status ?? server;

  return (
    <>
      <PageHeader
        title={t('lessons.title')}
        description={t('lessons.description')}
        actions={
          waiting ? (
            <StatusPill tone="warn" icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}>
              {t('lessons.waiting', { count: waiting })}
            </StatusPill>
          ) : (
            <StatusPill tone="ok">{t('lessons.allSaved')}</StatusPill>
          )
        }
      />
      {offlineSince ? (
        <p role="status" className="mb-4 flex items-center gap-2 rounded-xl bg-warn-bg px-4 py-3 text-small text-ink">
          <CloudOff className="h-5 w-5 shrink-0 text-warn" aria-hidden="true" />
          {t('lessons.offline', { time: formatClock(offlineSince, lng) })}
        </p>
      ) : null}
      {sessions === null ? (
        <ListSkeleton />
      ) : !sessions.length ? (
        <EmptyState icon={GraduationCap} title={t('lessons.emptyTitle')}>
          {t('lessons.emptyBody')}
        </EmptyState>
      ) : (
        <div className="grid gap-5">
          {sessions.map((s) => {
            const marked = s.roster.filter((r) => statusFor(s, r.enrollmentId, r.status)).length;
            return (
              <Card key={`${s.classId}-${s.sessionDate}`} className="overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-surface/60 px-5 py-4">
                  <div>
                    <h2 className="text-subheading">{s.name}</h2>
                    <p className="text-small text-muted">
                      {formatDate(s.localStartsAt, lng, 'long')} · <span className="tabular-nums">{formatTimeRange(s.localStartsAt, s.localEndsAt, lng)}</span> · {s.facility.name}
                    </p>
                  </div>
                  <StatusPill tone={marked === s.roster.length ? 'ok' : 'neutral'}>{t('lessons.marked', { marked, total: s.roster.length })}</StatusPill>
                </div>
                <ul className="divide-y divide-line">
                  {s.roster.map((r) => {
                    const current = statusFor(s, r.enrollmentId, r.status);
                    return (
                      <li key={r.enrollmentId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                        <div className="min-w-0">
                          <p className="text-body-strong">{r.swimmerName}</p>
                          {r.safetyNote ? (
                            <p className="mt-0.5 flex items-center gap-1.5 text-small text-warn">
                              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                              {r.safetyNote}
                            </p>
                          ) : null}
                        </div>
                        <div role="radiogroup" aria-label={t('lessons.attendanceFor', { name: r.swimmerName })} className="flex gap-2">
                          {CHOICES.map(({ s: st, Icon, tone }) => (
                            <button
                              key={st}
                              type="button"
                              role="radio"
                              aria-checked={current === st}
                              onClick={() => void mark(s.sessionDate, r.enrollmentId, st)}
                              className={cn(
                                'flex h-11 min-w-[2.75rem] items-center justify-center gap-1.5 rounded-xl border px-3 text-small font-semibold transition-colors',
                                current === st ? tone : 'border-line bg-panel text-muted hover:bg-surface',
                              )}
                            >
                              <Icon className="h-4 w-4" aria-hidden="true" />
                              <span className="hidden sm:inline">{t(`lessons.status.${st}`)}</span>
                              <span className="sr-only sm:hidden">{t(`lessons.status.${st}`)}</span>
                            </button>
                          ))}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
