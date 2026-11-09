'use client';

import { Armchair, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select } from '@/components/ui/Field';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { useAction, useQuery } from '@/lib/useQuery';

interface Station { id: string; name: string; poolBodyId: string | null; sortOrder: number; archivedAt: string | null }

/** Lifeguard stations per facility, in the order the rotation moves through them. */
export function DeckStations({ facilities, pools }: { facilities: Array<{ id: string; name: string }>; pools: Array<{ id: string; name: string }> }) {
  const { t } = useTranslation();
  const [facilityId, setFacilityId] = useState(facilities[0]!.id);
  const stations = useQuery<Station[]>(`/api/deck/stations?facilityId=${facilityId}&all=1`);
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<Station | 'new' | null>(null);
  const current = editing === 'new' ? null : editing;

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { name: String(f.get('name')), poolBodyId: String(f.get('pool') || '') || null, sortOrder: Number(f.get('order') || 0) };
    const r = await run('st', () => (current ? api(`/api/deck/stations/${current.id}`, { method: 'PATCH', body }) : api('/api/deck/stations', { method: 'POST', body: { ...body, facilityId } })), t('profile.saved'));
    if (r !== undefined) {
      setEditing(null);
      await stations.reload();
    }
  }
  async function toggle(s: Station) {
    await run('arch', () => api(`/api/deck/stations/${s.id}`, { method: 'PATCH', body: { archived: !s.archivedAt } }));
    await stations.reload();
  }

  return (
    <Card>
      <CardHeader
        title={t('deck.stations')}
        description={t('deck.stationsHelp')}
        action={<Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing('new')}>{t('deck.addStation')}</Button>}
      />
      <CardBody className="grid gap-4 pt-3">
        {facilities.length > 1 ? (
          <Field label={t('timeclock.facility')}>
            {(p) => (
              <Select {...p} value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
                {facilities.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        {!stations.data?.length ? (
          <EmptyState icon={Armchair} title={t('deck.noStations')}>{t('deck.noStationsHelp')}</EmptyState>
        ) : (
          <ol className="divide-y divide-line">
            {stations.data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <button type="button" className="text-left" onClick={() => setEditing(s)}>
                  <span className="block text-body-strong">{s.sortOrder + 1}. {s.name}</span>
                  <span className="text-small text-muted">{pools.find((p) => p.id === s.poolBodyId)?.name ?? t('deck.anyPool')}</span>
                </button>
                <div className="flex items-center gap-2">
                  {s.archivedAt ? <StatusPill tone="neutral">{t('deck.retired')}</StatusPill> : null}
                  <Button size="sm" variant="ghost" loading={busy === 'arch'} onClick={() => void toggle(s)}>{s.archivedAt ? t('deck.restore') : t('deck.retire')}</Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={current ? current.name : t('deck.addStation')} closeLabel={t('common.close')}>
        <form key={current?.id ?? 'new'} onSubmit={(e) => void save(e)} className="grid gap-4">
          <Field label={t('deck.stationName')} hint={t('deck.stationNameHint')}>{(p) => <Input {...p} name="name" required maxLength={60} defaultValue={current?.name ?? ''} />}</Field>
          <Field label={t('deck.pool')}>
            {(p) => (
              <Select {...p} name="pool" defaultValue={current?.poolBodyId ?? ''}>
                <option value="">{t('deck.anyPool')}</option>
                {pools.map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('deck.order')} hint={t('deck.orderHint')}>{(p) => <Input {...p} name="order" type="number" min={0} max={999} defaultValue={current?.sortOrder ?? stations.data?.length ?? 0} />}</Field>
          <Button type="submit" loading={busy === 'st'}>{t('common.save')}</Button>
        </form>
      </Dialog>
    </Card>
  );
}
