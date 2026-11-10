'use client';

import { History, Plus, Truck, Wrench } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { STATUS_TONE, type Vehicle } from '@/lib/fleet';
import { useAction, useQuery } from '@/lib/useQuery';

interface Inspection { id: string; at: string; result: 'PASS' | 'MINOR' | 'MAJOR'; driver: string; odometerKm: number | null; items: Array<{ item: string; ok: boolean; severity: string | null; note: string | null }>; notes: string | null; repairNote: string | null }

/** Vehicles, their pre-trip status, defects and repairs. */
export default function FleetPage() {
  const { t, i18n } = useTranslation();
  const q = useQuery<{ vehicles: Vehicle[] }>('/api/vehicles');
  const certs = useQuery<Array<{ id: string; name: string; nameFr: string | null }>>('/api/certifications');
  const facilities = useQuery<Array<{ id: string; name: string }>>('/api/facilities');
  const { run, busy } = useAction();
  const [adding, setAdding] = useState(false);
  const [repairing, setRepairing] = useState<Vehicle | null>(null);
  const [history, setHistory] = useState<Vehicle | null>(null);
  const hist = useQuery<Inspection[]>(history ? `/api/vehicles/${history.id}/inspections` : null);
  const when = (iso: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  const certName = (id: string | null) => certs.data?.find((c) => c.id === id)?.name ?? '';

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const body = { unit: s('unit'), description: s('description'), plate: s('plate') || null, certificationId: s('cert') || null, facilityId: s('facility') || null };
    if ((await run('add', () => api('/api/vehicles', { method: 'POST', body }), t('fleet.added'))) !== undefined) {
      setAdding(false);
      await q.reload();
    }
  }
  async function repair(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const note = String(new FormData(e.currentTarget).get('note'));
    if ((await run('repair', () => api(`/api/vehicles/${repairing!.id}/return`, { method: 'POST', body: { note } }), t('fleet.returned'))) !== undefined) {
      setRepairing(null);
      await q.reload();
    }
  }

  return (
    <div className="grid gap-6">
      <PageHeader title={t('fleet.title')} description={t('fleet.description')} actions={<Button icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setAdding(true)}>{t('fleet.add')}</Button>} />
      <Card>
        <CardBody>
          {!q.data ? <Skeleton className="h-32" /> : !q.data.vehicles.length ? <EmptyState icon={Truck} title={t('fleet.none')}>{t('fleet.noneHelp')}</EmptyState> : (
            <ul className="divide-y divide-line text-small">
              {q.data.vehicles.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2"><span className="font-semibold">{v.unit}</span><StatusPill tone={STATUS_TONE[v.status]}>{t(`pretrip.status.${v.status}`)}</StatusPill></p>
                    <p className="text-caption text-muted">{v.description}{v.plate ? ` · ${v.plate}` : ''}{v.certificationId ? ` · ${t('fleet.needs', { licence: certName(v.certificationId) })}` : ''}{v.lastInspection ? ` · ${t('pretrip.last', { when: when(v.lastInspection.at) })}` : ''}</p>
                    {v.outOfService ? <p className="text-caption font-semibold text-danger">{v.outOfServiceReason}</p> : null}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" icon={<History className="h-4 w-4" aria-hidden="true" />} onClick={() => setHistory(v)}>{t('fleet.history')}</Button>
                    {v.outOfService ? <Button size="sm" icon={<Wrench className="h-4 w-4" aria-hidden="true" />} onClick={() => setRepairing(v)}>{t('fleet.return')}</Button> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <p className="text-caption text-muted">{t('fleet.foot')}</p>
      <Dialog open={adding} onClose={() => setAdding(false)} title={t('fleet.add')} closeLabel={t('common.cancel')}>
        <form className="grid gap-4" onSubmit={(e) => void add(e)}>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('fleet.unit')}>{(p) => <Input {...p} name="unit" required maxLength={30} placeholder="P-12" />}</Field>
            <Field label={t('fleet.plate')} hint={t('common.optional')}>{(p) => <Input {...p} name="plate" maxLength={15} />}</Field>
          </div>
          <Field label={t('fleet.descriptionLabel')}>{(p) => <Input {...p} name="description" required minLength={2} maxLength={120} placeholder={t('fleet.descriptionPlaceholder')} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('fleet.licence')} hint={t('fleet.licenceHint')}>{(p) => <Select {...p} name="cert" defaultValue=""><option value="">{t('fleet.noLicence')}</option>{certs.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
            <Field label={t('fleet.yard')} hint={t('common.optional')}>{(p) => <Select {...p} name="facility" defaultValue=""><option value="">—</option>{facilities.data?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>}</Field>
          </div>
          <Button type="submit" loading={busy === 'add'} className="justify-self-start">{t('fleet.add')}</Button>
        </form>
      </Dialog>
      <Dialog open={!!repairing} onClose={() => setRepairing(null)} title={t('fleet.returnTitle', { unit: repairing?.unit ?? '' })} description={repairing?.outOfServiceReason ?? ''} closeLabel={t('common.cancel')}>
        <form className="grid gap-4" onSubmit={(e) => void repair(e)}>
          <Field label={t('fleet.repairNote')} hint={t('fleet.repairHint')}>{(p) => <Input {...p} name="note" required minLength={3} maxLength={500} />}</Field>
          <Button type="submit" loading={busy === 'repair'} className="justify-self-start">{t('fleet.return')}</Button>
        </form>
      </Dialog>
      <Dialog open={!!history} onClose={() => setHistory(null)} title={t('fleet.historyTitle', { unit: history?.unit ?? '' })} closeLabel={t('common.close')}>
        {!hist.data ? <Skeleton className="h-24" /> : !hist.data.length ? <p className="text-small text-muted">{t('fleet.noHistory')}</p> : (
          <ul className="divide-y divide-line text-small">
            {hist.data.map((h) => (
              <li key={h.id} className="py-2">
                <p className="flex flex-wrap items-center gap-2"><span className="font-semibold">{when(h.at)}</span><StatusPill tone={h.result === 'PASS' ? 'ok' : h.result === 'MINOR' ? 'warn' : 'danger'}>{t(`fleet.result.${h.result}`)}</StatusPill><span className="text-caption text-muted">{h.driver}{h.odometerKm != null ? ` · ${h.odometerKm.toLocaleString(i18n.language)} km` : ''}</span></p>
                {h.items.filter((i) => !i.ok).map((i) => <p key={i.item} className="text-caption">{t(`pretrip.items.${i.item}`)}: {t(`pretrip.severity.${i.severity ?? 'MINOR'}`)}{i.note ? ` · ${i.note}` : ''}</p>)}
                {h.repairNote ? <p className="text-caption text-ok">{t('fleet.repaired', { note: h.repairNote })}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </div>
  );
}
