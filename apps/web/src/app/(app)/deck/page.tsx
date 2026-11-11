'use client';

import { Armchair, ArrowRight, Coffee, RotateCw, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatElapsed } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { useAction, useQuery } from '@/lib/useQuery';

interface Plan {
  facility: { id: string; name: string; rotationMinutes: number; maxOnChairMinutes: number };
  stations: Array<{ id: string; name: string; current: { userId: string; name: string; startedAt: string; dueAt: string; overdue: boolean } | null }>;
  onDuty: Array<{ userId: string; name: string; stationId: string | null; chainMinutes: number; needsBreak: boolean; restedSince: string | null }>;
  suggestion: { assignments: Array<{ stationId: string; userId: string | null; name: string | null }>; toBreak: string[]; stillNeedBreak: string[]; unstaffed: string[] };
}

const mins = (ms: number) => Math.round(ms / 60_000);

/** The live chair plan: who is where, when they move, who needs a break, and one tap to rotate. */
export default function DeckPage() {
  const { t, i18n } = useTranslation();
  // Past 12 hours a chair is simply overdue: the deck was left open, a count of hours helps nobody.
  const overdue = (ms: number) => (ms > 12 * 3_600_000 ? t('deck.overdueLong') : t('deck.overdue', { time: formatElapsed(mins(ms), i18n.language) }));
  const facilities = useQuery<Array<{ id: string; name: string }>>('/api/facilities');
  const [facilityId, setFacilityId] = useState<string | null>(null);
  useEffect(() => {
    if (!facilityId && facilities.data?.[0]) setFacilityId(facilities.data[0].id);
  }, [facilities.data, facilityId]);
  const plan = useQuery<Plan>(facilityId ? `/api/deck/plan?facilityId=${facilityId}` : null);
  const { run, busy } = useAction();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 15_000);
    const r = setInterval(() => void plan.reload(), 60_000);
    return () => {
      clearInterval(i);
      clearInterval(r);
    };
  }, [plan]);
  const p = plan.data;
  const name = (id: string | null) => p?.onDuty.find((o) => o.userId === id)?.name ?? '—';

  async function rotate() {
    if (!p) return;
    await run('rot', () => api('/api/deck/rotate', { method: 'POST', body: { facilityId: p.facility.id, assignments: p.suggestion.assignments.map((a) => ({ stationId: a.stationId, userId: a.userId })) } }), t('deck.rotated'));
    await plan.reload();
  }
  async function assign(stationId: string, userId: string) {
    if (!p) return;
    const assignments = p.stations.map((s) => ({ stationId: s.id, userId: s.id === stationId ? userId || null : s.current?.userId === userId ? null : s.current?.userId ?? null }));
    await run('set', () => api('/api/deck/rotate', { method: 'POST', body: { facilityId: p.facility.id, assignments } }), t('deck.updated'));
    await plan.reload();
  }
  async function close() {
    if (!p) return;
    await run('close', () => api('/api/deck/close', { method: 'POST', body: { facilityId: p.facility.id } }), t('deck.closed'));
    await plan.reload();
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t('deck.title')}
        description={t('deck.description')}
        actions={
          facilities.data && facilities.data.length > 1 ? (
            <Field label={t('timeclock.facility')}>
              {(f) => (
                <Select {...f} value={facilityId ?? ''} onChange={(e) => setFacilityId(e.target.value)}>
                  {facilities.data!.map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </Select>
              )}
            </Field>
          ) : undefined
        }
      />
      {plan.error ? (
        <ErrorNotice onRetry={plan.reload} />
      ) : !p ? (
        <Skeleton className="h-72" />
      ) : !p.stations.length ? (
        <EmptyState icon={Armchair} title={t('deck.noStations')}>{t('deck.noStationsHelp')}</EmptyState>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {p.stations.map((s) => {
              const c = s.current;
              const left = c ? new Date(c.dueAt).getTime() - now : 0;
              const pct = c ? Math.min(100, Math.max(0, 100 - (left / (p.facility.rotationMinutes * 60_000)) * 100)) : 0;
              return (
                <Card key={s.id} className={c?.overdue || (c && left < 0) ? 'border-danger/50' : ''}>
                  <CardBody className="grid gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex min-w-0 items-center gap-2 text-body-strong"><Armchair className="h-5 w-5 shrink-0 text-brand-text" aria-hidden="true" /><span className="min-w-0">{s.name}</span></p>
                      {c ? <StatusPill className="shrink-0 whitespace-nowrap" tone={left < 0 ? 'danger' : left < 5 * 60_000 ? 'warn' : 'ok'}>{left < 0 ? overdue(-left) : t('deck.moveIn', { m: mins(left) })}</StatusPill> : <StatusPill className="shrink-0 whitespace-nowrap" tone="warn">{t('deck.empty')}</StatusPill>}
                    </div>
                    {c ? (
                      <div className="h-2 overflow-hidden rounded-full bg-surface" aria-hidden="true">
                        <div className={`fh-bar h-full rounded-full ${left < 0 ? 'bg-danger' : 'bg-brand'}`} style={{ width: `${pct}%` }} />
                      </div>
                    ) : null}
                    <Field label={t('deck.onStation')}>
                      {(f) => (
                        <Select {...f} value={c?.userId ?? ''} disabled={busy === 'set'} onChange={(e) => void assign(s.id, e.target.value)}>
                          <option value="">{t('deck.nobody')}</option>
                          {p.onDuty.map((o) => (
                            <option key={o.userId} value={o.userId}>{o.name}</option>
                          ))}
                        </Select>
                      )}
                    </Field>
                  </CardBody>
                </Card>
              );
            })}
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
            <Card>
              <CardHeader title={t('deck.next')} description={t('deck.nextHelp', { m: p.facility.rotationMinutes })} />
              <CardBody className="grid gap-3 pt-3">
                <ul className="grid gap-2 text-small">
                  {p.suggestion.assignments.map((a) => (
                    <li key={a.stationId} className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{p.stations.find((s) => s.id === a.stationId)?.name}</span>
                      <ArrowRight className="h-4 w-4 text-muted" aria-hidden="true" />
                      <span>{a.name ?? t('deck.nobody')}</span>
                    </li>
                  ))}
                  {p.suggestion.toBreak.map((u) => (
                    <li key={u} className="flex items-center gap-2 text-muted"><Coffee className="h-4 w-4" aria-hidden="true" />{t('deck.toBreak', { name: name(u) })}</li>
                  ))}
                </ul>
                {p.suggestion.stillNeedBreak.length ? <p className="rounded-xl bg-warn-bg px-3 py-2 text-small text-warn">{t('deck.noRelief', { names: p.suggestion.stillNeedBreak.map(name).join(', ') })}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Button icon={<RotateCw className="h-4 w-4" aria-hidden="true" />} loading={busy === 'rot'} onClick={() => void rotate()}>{t('deck.rotateNow')}</Button>
                  <Button variant="ghost" icon={<Square className="h-4 w-4" aria-hidden="true" />} loading={busy === 'close'} onClick={() => void close()}>{t('deck.close')}</Button>
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t('deck.onDuty')} description={t('deck.onDutyHelp', { m: p.facility.maxOnChairMinutes })} />
              <CardBody className="pt-3">
                {!p.onDuty.length ? (
                  <p className="text-small text-muted">{t('deck.nobodyOnDuty')}</p>
                ) : (
                  <ul className="divide-y divide-line text-small">
                    {p.onDuty.map((o) => (
                      <li key={o.userId} className="flex items-center justify-between gap-2 py-2">
                        <span>{o.name}</span>
                        {o.stationId ? (
                          <StatusPill tone={o.needsBreak ? 'danger' : o.chainMinutes > p.facility.maxOnChairMinutes * 0.75 ? 'warn' : 'neutral'}>{t('deck.onChairFor', { time: formatElapsed(o.chainMinutes, i18n.language) })}</StatusPill>
                        ) : (
                          <StatusPill tone="ok">{o.restedSince ? t('deck.restedFor', { time: formatElapsed(mins(now - new Date(o.restedSince).getTime()), i18n.language) }) : t('deck.available')}</StatusPill>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
