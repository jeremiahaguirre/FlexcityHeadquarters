'use client';

import { Archive, Plus, Waves } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { StatusPill } from '@/components/ui/StatusPill';
import { useAction } from '@/lib/useQuery';

export const POOL_KINDS = ['POOL', 'LEISURE_POOL', 'HOT_TUB', 'WADING_POOL', 'WAVE_POOL', 'SPLASH_PAD'] as const;

export interface PoolDetailsRow {
  id: string;
  name: string;
  kind: string;
  facility?: { id: string; name: string };
  facilityId?: string;
  maxCapacity: number | null;
  bathersPerLifeguard: number | null;
  depthMinM: string | null;
  depthMaxM: string | null;
  volumeLitres: number | null;
  notes: string | null;
  archived: boolean;
  limitsSet?: boolean;
}

/** The pools in each aquatic centre: capacity, depth, volume. Used by supervisors and the FH Dev console. */
export function PoolsEditor({
  pools,
  facilities,
  save,
  reload,
  extra,
}: {
  pools: PoolDetailsRow[];
  facilities: Array<{ id: string; name: string }>;
  save: (body: Record<string, unknown>, id?: string) => Promise<unknown>;
  reload: () => Promise<void>;
  /** e.g. the permit-limits button in Settings. */
  extra?: (pool: PoolDetailsRow) => ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<PoolDetailsRow | 'new' | null>(null);
  const current = editing === 'new' ? null : editing;
  const facilityOf = (p: PoolDetailsRow) => p.facility?.id ?? p.facilityId ?? '';
  const facilityName = (p: PoolDetailsRow) => p.facility?.name ?? facilities.find((f) => f.id === p.facilityId)?.name ?? '';
  const nf = new Intl.NumberFormat(i18n.language);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim() || null;
    const n = (k: string) => (s(k) === null ? null : Number(s(k)));
    const body = {
      facilityId: s('facility'),
      name: s('name'),
      kind: s('kind'),
      maxCapacity: n('capacity'),
      bathersPerLifeguard: n('ratio'),
      depthMinM: s('depthMin')?.replace(',', '.') ?? null,
      depthMaxM: s('depthMax')?.replace(',', '.') ?? null,
      volumeLitres: n('volume'),
      notes: s('notes'),
      ...(current ? { archived: f.get('archived') === 'on' } : {}),
    };
    const r = await run('pool', () => save(body, current?.id), t('pools.saved'));
    if (r !== undefined) {
      setEditing(null);
      await reload();
    }
  }

  const active = pools.filter((p) => !p.archived);
  const retired = pools.filter((p) => p.archived);
  const row = (p: PoolDetailsRow) => (
    <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
      <button type="button" onClick={() => setEditing(p)} className="min-w-0 flex-1 rounded-lg text-left hover:bg-surface/60">
        <span className="block text-body-strong">{p.name}</span>
        <span className="text-small text-muted">
          {[
            facilityName(p),
            t(`pools.kinds.${p.kind}`),
            p.maxCapacity ? t('pools.capacityShort', { count: p.maxCapacity }) : t('pools.noCapacity'),
            p.depthMinM && p.depthMaxM ? `${p.depthMinM}–${p.depthMaxM} m` : null,
            p.volumeLitres ? `${nf.format(p.volumeLitres)} L` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </button>
      <span className="flex flex-wrap items-center gap-2">
        {p.limitsSet === false ? <StatusPill tone="warn">{t('settings.notConfigured')}</StatusPill> : null}
        {p.archived ? <StatusPill tone="neutral" icon={<Archive className="h-3.5 w-3.5" aria-hidden="true" />}>{t('pools.retired')}</StatusPill> : null}
        {extra?.(p)}
      </span>
    </li>
  );

  return (
    <Card>
      <CardHeader
        title={t('pools.title')}
        description={t('pools.help')}
        action={<Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing('new')} disabled={!facilities.length}>{t('pools.add')}</Button>}
      />
      <CardBody className="pt-3">
        {!pools.length ? (
          <EmptyState icon={Waves} title={t('pools.none')}>{t('pools.noneHelp')}</EmptyState>
        ) : (
          <>
            <ul className="divide-y divide-line">{active.map(row)}</ul>
            {retired.length ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-small font-semibold text-muted">{t('pools.retiredList', { count: retired.length })}</summary>
                <ul className="divide-y divide-line">{retired.map(row)}</ul>
              </details>
            ) : null}
          </>
        )}
      </CardBody>
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={current ? current.name : t('pools.add')} description={t('pools.formHelp')} closeLabel={t('common.close')}>
        <form key={current?.id ?? 'new'} onSubmit={(e) => void submit(e)} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('pools.name')}>{(p) => <Input {...p} name="name" required minLength={2} maxLength={60} defaultValue={current?.name ?? ''} placeholder="Main Tank" />}</Field>
            <Field label={t('pools.kind')}>
              {(p) => (
                <Select {...p} name="kind" defaultValue={current?.kind ?? 'POOL'}>
                  {POOL_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`pools.kinds.${k}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label={t('pools.facility')}>
            {(p) => (
              <Select {...p} name="facility" required defaultValue={current ? facilityOf(current) : (facilities[0]?.id ?? '')}>
                {facilities.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('pools.capacity')} hint={t('pools.capacityHint')}>{(p) => <Input {...p} name="capacity" type="number" min={1} max={10000} defaultValue={current?.maxCapacity ?? ''} />}</Field>
            <Field label={t('settings.ratio')} hint={t('pools.ratioHint')}>{(p) => <Input {...p} name="ratio" type="number" min={1} max={500} defaultValue={current?.bathersPerLifeguard ?? ''} />}</Field>
            <Field label={t('pools.depthMin')}>{(p) => <Input {...p} name="depthMin" inputMode="decimal" defaultValue={current?.depthMinM ?? ''} placeholder="1.10" />}</Field>
            <Field label={t('pools.depthMax')}>{(p) => <Input {...p} name="depthMax" inputMode="decimal" defaultValue={current?.depthMaxM ?? ''} placeholder="3.80" />}</Field>
            <Field label={t('pools.volume')}>{(p) => <Input {...p} name="volume" type="number" min={100} defaultValue={current?.volumeLitres ?? ''} />}</Field>
          </div>
          <Field label={t('pools.notes')} hint={t('common.optional')}>{(p) => <Textarea {...p} name="notes" maxLength={500} defaultValue={current?.notes ?? ''} placeholder={t('pools.notesPlaceholder')} />}</Field>
          {current ? (
            <label className="flex items-center gap-2 text-small font-semibold">
              <input type="checkbox" name="archived" defaultChecked={current.archived} className="h-5 w-5 accent-[rgb(var(--brand))]" />
              {t('pools.retire')}
            </label>
          ) : null}
          <Button type="submit" loading={busy === 'pool'}>
            {t('common.save')}
          </Button>
        </form>
      </Dialog>
    </Card>
  );
}
