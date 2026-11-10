'use client';

import { CheckCircle2, ChevronLeft, Truck, XCircle } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { STATUS_TONE, type Vehicle } from '@/lib/fleet';
import { useAction, useQuery } from '@/lib/useQuery';
import { dateFormat } from '@/lib/format';

type Mark = { ok: boolean; severity?: 'MINOR' | 'MAJOR'; note?: string };

/** The driver's walk-around before taking a vehicle out. */
export default function PretripPage() {
  const { t, i18n } = useTranslation();
  const q = useQuery<{ vehicles: Vehicle[]; checklist: string[] }>('/api/vehicles');
  const { run, busy } = useAction();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [result, setResult] = useState<string | null>(null);
  const when = (iso: string) => dateFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  const set = (item: string, m: Partial<Mark>) => setMarks((x) => ({ ...x, [item]: { ...(x[item] ?? { ok: true }), ...m } }));

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const items = q.data!.checklist.map((item) => ({ item, ok: marks[item]?.ok ?? true, severity: marks[item]?.ok === false ? marks[item]?.severity ?? 'MINOR' : null, note: marks[item]?.note || null }));
    const odo = String(f.get('odo') ?? '').trim();
    const r = await run('send', () => api<{ result: string }>(`/api/vehicles/${vehicle!.id}/inspections`, { method: 'POST', body: { items, odometerKm: odo ? Number(odo) : null, notes: String(f.get('notes') || '') || null } }));
    if (r) {
      setResult(r.result);
      await q.reload();
    }
  }

  if (!q.data) return <Skeleton className="h-96" />;
  if (result && vehicle) {
    const major = result === 'MAJOR';
    return (
      <Card className="mx-auto max-w-lg">
        <CardBody className="grid gap-3 text-center">
          {major ? <XCircle className="mx-auto h-12 w-12 text-danger" aria-hidden="true" /> : <CheckCircle2 className="mx-auto h-12 w-12 text-ok" aria-hidden="true" />}
          <h1 className="text-title">{t(`pretrip.result.${result}`, { unit: vehicle.unit })}</h1>
          <p className="text-small text-muted">{t(`pretrip.resultHelp.${result}`)}</p>
          <Button variant="secondary" className="justify-self-center" onClick={() => { setResult(null); setVehicle(null); setMarks({}); }}>{t('pretrip.done')}</Button>
        </CardBody>
      </Card>
    );
  }
  if (vehicle) {
    return (
      <div className="grid gap-6">
        <button type="button" onClick={() => setVehicle(null)} className="inline-flex items-center gap-1 justify-self-start text-small font-semibold text-brand-text hover:underline"><ChevronLeft className="h-4 w-4" aria-hidden="true" />{t('pretrip.vehicles')}</button>
        <PageHeader title={t('pretrip.inspect', { unit: vehicle.unit })} description={vehicle.description} />
        <form className="grid gap-4" onSubmit={(e) => void submit(e)}>
          <Card>
            <CardBody className="grid gap-3">
              {q.data.checklist.map((item) => {
                const m = marks[item] ?? { ok: true };
                return (
                  <div key={item} className="grid gap-2 border-b border-line pb-3 last:border-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-body-strong">{t(`pretrip.items.${item}`)}</span>
                      <div className="flex gap-2" role="radiogroup" aria-label={t(`pretrip.items.${item}`)}>
                        <button type="button" role="radio" aria-checked={m.ok} onClick={() => set(item, { ok: true })} className={`h-10 rounded-xl border px-4 text-small font-semibold ${m.ok ? 'border-ok bg-ok-bg text-ok' : 'border-line text-muted'}`}>{t('pretrip.ok')}</button>
                        <button type="button" role="radio" aria-checked={!m.ok} onClick={() => set(item, { ok: false })} className={`h-10 rounded-xl border px-4 text-small font-semibold ${!m.ok ? 'border-warn bg-warn-bg text-warn' : 'border-line text-muted'}`}>{t('pretrip.defect')}</button>
                      </div>
                    </div>
                    {!m.ok ? (
                      <div className="grid gap-2 rounded-xl bg-surface p-3 sm:grid-cols-[auto_1fr] sm:items-center">
                        <div className="flex gap-2">
                          {(['MINOR', 'MAJOR'] as const).map((s) => <button key={s} type="button" aria-pressed={(m.severity ?? 'MINOR') === s} onClick={() => set(item, { severity: s })} className={`h-9 rounded-lg border px-3 text-caption font-semibold ${(m.severity ?? 'MINOR') === s ? (s === 'MAJOR' ? 'border-danger bg-danger-bg text-danger' : 'border-warn bg-warn-bg text-warn') : 'border-line text-muted'}`}>{t(`pretrip.severity.${s}`)}</button>)}
                        </div>
                        <Input aria-label={t('pretrip.whatsWrong')} placeholder={t('pretrip.whatsWrong')} maxLength={300} value={m.note ?? ''} onChange={(e) => set(item, { note: e.target.value })} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </CardBody>
          </Card>
          <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
            <Field label={t('pretrip.odometer')}>{(p) => <Input {...p} name="odo" inputMode="numeric" />}</Field>
            <Field label={t('pretrip.notes')} hint={t('common.optional')}>{(p) => <Textarea {...p} name="notes" rows={2} maxLength={1000} />}</Field>
          </div>
          <p className="text-caption text-muted">{t('pretrip.majorWarning')}</p>
          <Button type="submit" size="lg" loading={busy === 'send'} className="justify-self-start">{t('pretrip.submit')}</Button>
        </form>
      </div>
    );
  }
  return (
    <div className="grid gap-6">
      <PageHeader title={t('pretrip.title')} description={t('pretrip.description')} />
      {!q.data.vehicles.length ? <EmptyState icon={Truck} title={t('pretrip.none')}>{t('pretrip.noneHelp')}</EmptyState> : (
        <div className="grid gap-3 sm:grid-cols-2">
          {q.data.vehicles.map((v) => (
            <Card key={v.id}>
              <CardBody className="grid gap-2">
                <div className="flex items-start justify-between gap-2">
                  <span><span className="text-body-strong">{v.unit}</span><span className="block text-small text-muted">{v.description}</span></span>
                  <StatusPill tone={STATUS_TONE[v.status]}>{t(`pretrip.status.${v.status}`)}</StatusPill>
                </div>
                {v.outOfService ? <p className="text-small text-danger">{v.outOfServiceReason}</p> : v.lastInspection ? <p className="text-caption text-muted">{t('pretrip.last', { when: when(v.lastInspection.at) })}</p> : null}
                <Button size="sm" className="justify-self-end" disabled={v.outOfService} onClick={() => setVehicle(v)}>{t('pretrip.start')}</Button>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
