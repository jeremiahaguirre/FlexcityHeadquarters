'use client';

import { Archive, ArchiveRestore, History, Pencil, Plus, Truck, Wrench } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { STATUS_TONE, type Vehicle, vehicleBody } from '@/lib/fleet';
import { useAction, useQuery } from '@/lib/useQuery';
import { formatMoment } from '@/lib/format';

interface Inspection { id: string; at: string; result: 'PASS' | 'MINOR' | 'MAJOR'; driver: string; odometerKm: number | null; items: Array<{ item: string; ok: boolean; severity: string | null; note: string | null }>; notes: string | null; repairNote: string | null }

/** Vehicles, their pre-trip status, defects and repairs; correct a vehicle's details, or retire it so drivers no longer see it. */
export default function FleetPage() {
  const { t, i18n } = useTranslation();
  const q = useQuery<{ vehicles: Vehicle[] }>('/api/vehicles');
  const certs = useQuery<Array<{ id: string; name: string; nameFr: string | null }>>('/api/certifications');
  const facilities = useQuery<Array<{ id: string; name: string }>>('/api/facilities');
  const { run, busy } = useAction();
  /** The vehicle being edited, or 'new' to add one. */
  const [editing, setEditing] = useState<Vehicle | 'new' | null>(null);
  const [repairing, setRepairing] = useState<Vehicle | null>(null);
  const [retiring, setRetiring] = useState<Vehicle | null>(null);
  const [history, setHistory] = useState<Vehicle | null>(null);
  const hist = useQuery<Inspection[]>(history ? `/api/vehicles/${history.id}/inspections` : null);
  const when = (iso: string) => formatMoment(iso, i18n.language);
  const certName = (id: string | null) => certs.data?.find((c) => c.id === id)?.name ?? '';
  const current = editing && editing !== 'new' ? editing : null;

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = vehicleBody(new FormData(e.currentTarget));
    const done = current
      ? await run('save', () => api(`/api/vehicles/${current.id}`, { method: 'PATCH', body }), t('fleet.saved'))
      : await run('save', () => api('/api/vehicles', { method: 'POST', body }), t('fleet.added'));
    if (done !== undefined) {
      setEditing(null);
      await q.reload();
    }
  }
  async function setActive(v: Vehicle, active: boolean) {
    if ((await run(`active-${v.id}`, () => api(`/api/vehicles/${v.id}`, { method: 'PATCH', body: { active } }), t(active ? 'fleet.reactivated' : 'fleet.retired'))) !== undefined) {
      setRetiring(null);
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
      <PageHeader title={t('fleet.title')} description={t('fleet.description')} actions={<Button icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing('new')}>{t('fleet.add')}</Button>} />
      <Card>
        <CardBody>
          {!q.data ? <Skeleton className="h-32" /> : !q.data.vehicles.length ? <EmptyState icon={Truck} title={t('fleet.none')}>{t('fleet.noneHelp')}</EmptyState> : (
            <ul className="divide-y divide-line text-small">
              {q.data.vehicles.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className={v.active ? 'font-semibold' : 'font-semibold text-muted'}>{v.unit}</span>
                      {v.active ? <StatusPill tone={STATUS_TONE[v.status]}>{t(`pretrip.status.${v.status}`)}</StatusPill> : <StatusPill tone="neutral">{t('fleet.inactive')}</StatusPill>}
                    </p>
                    <p className="text-caption text-muted">{v.description}{v.plate ? ` · ${v.plate}` : ''}{v.certificationId ? ` · ${t('fleet.needs', { licence: certName(v.certificationId) })}` : ''}{v.lastInspection ? ` · ${t('pretrip.last', { when: when(v.lastInspection.at) })}` : ''}</p>
                    {v.outOfService && v.active ? <p className="text-caption font-semibold text-danger">{v.outOfServiceReason}</p> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" icon={<History className="h-4 w-4" aria-hidden="true" />} onClick={() => setHistory(v)}>{t('fleet.history')}</Button>
                    <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing(v)} aria-label={t('fleet.editOne', { unit: v.unit })}>{t('common.edit')}</Button>
                    {v.active ? (
                      <Button size="sm" variant="ghost" icon={<Archive className="h-4 w-4" aria-hidden="true" />} onClick={() => setRetiring(v)} aria-label={t('fleet.retireOne', { unit: v.unit })}>{t('fleet.retire')}</Button>
                    ) : (
                      <Button size="sm" variant="ghost" icon={<ArchiveRestore className="h-4 w-4" aria-hidden="true" />} loading={busy === `active-${v.id}`} onClick={() => void setActive(v, true)} aria-label={t('fleet.reactivateOne', { unit: v.unit })}>{t('fleet.reactivate')}</Button>
                    )}
                    {v.outOfService && v.active ? <Button size="sm" icon={<Wrench className="h-4 w-4" aria-hidden="true" />} onClick={() => setRepairing(v)}>{t('fleet.return')}</Button> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <p className="text-caption text-muted">{t('fleet.foot')}</p>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={current ? t('fleet.editTitle', { unit: current.unit }) : t('fleet.add')} closeLabel={t('common.cancel')}>
        <form key={current?.id ?? 'new'} className="grid gap-4" onSubmit={(e) => void save(e)}>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('fleet.unit')}>{(p) => <Input {...p} name="unit" required maxLength={30} placeholder="P-12" autoCapitalize="characters" autoCorrect="off" spellCheck={false} defaultValue={current?.unit} />}</Field>
            <Field label={t('fleet.plate')} hint={t('common.optional')}>{(p) => <Input {...p} name="plate" maxLength={15} autoCapitalize="characters" autoCorrect="off" spellCheck={false} defaultValue={current?.plate ?? ''} />}</Field>
          </div>
          <Field label={t('fleet.descriptionLabel')}>{(p) => <Input {...p} name="description" required minLength={2} maxLength={120} placeholder={t('fleet.descriptionPlaceholder')} defaultValue={current?.description} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('fleet.licence')} hint={t('fleet.licenceHint')}>{(p) => <Select {...p} name="cert" defaultValue={current?.certificationId ?? ''}><option value="">{t('fleet.noLicence')}</option>{certs.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
            <Field label={t('fleet.yard')} hint={t('common.optional')}>{(p) => <Select {...p} name="facility" defaultValue={current?.facilityId ?? ''}><option value="">—</option>{facilities.data?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>}</Field>
          </div>
          <Button type="submit" loading={busy === 'save'} className="justify-self-start">{current ? t('common.save') : t('fleet.add')}</Button>
        </form>
      </Dialog>
      <Dialog open={!!retiring} onClose={() => setRetiring(null)} title={t('fleet.retireTitle', { unit: retiring?.unit ?? '' })} description={t('fleet.retireHelp')} closeLabel={t('common.cancel')}>
        <div className="flex flex-wrap gap-2">
          <Button variant="danger" loading={busy === `active-${retiring?.id}`} onClick={() => retiring && void setActive(retiring, false)}>{t('fleet.retire')}</Button>
          <Button variant="secondary" onClick={() => setRetiring(null)}>{t('common.cancel')}</Button>
        </div>
      </Dialog>
      <Dialog open={!!repairing} onClose={() => setRepairing(null)} title={t('fleet.returnTitle', { unit: repairing?.unit ?? '' })} description={repairing?.outOfServiceReason ?? ''} closeLabel={t('common.cancel')}>
        <form className="grid gap-4" onSubmit={(e) => void repair(e)}>
          <Field label={t('fleet.repairNote')} hint={t('fleet.repairHint')}>{(p) => <Input {...p} name="note" required minLength={3} maxLength={500} />}</Field>
          <Button type="submit" loading={busy === 'repair'} className="justify-self-start">{t('fleet.return')}</Button>
        </form>
      </Dialog>
      <Dialog open={!!history} onClose={() => setHistory(null)} title={t('fleet.historyTitle', { unit: history?.unit ?? '' })} closeLabel={t('common.close')}>
        {hist.error ? <p className="text-small text-muted">{t('common.error')}</p> : !hist.data ? <Skeleton className="h-24" /> : !hist.data.length ? <p className="text-small text-muted">{t('fleet.noHistory')}</p> : (
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
