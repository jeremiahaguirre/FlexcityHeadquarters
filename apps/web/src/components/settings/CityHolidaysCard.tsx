'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select } from '@/components/ui/Field';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { dateFormat } from '@/lib/format';
import { PROVINCES } from '@/lib/regions';
import { useAction, useQuery } from '@/lib/useQuery';

type Kind = 'PAID' | 'CLOSURE';
type Recurrence = 'NONE' | 'YEARLY_DATE' | 'YEARLY_NTH_WEEKDAY' | 'YEARLY_LAST_WEEKDAY' | 'EASTER_OFFSET';
const RECURRENCES: Recurrence[] = ['NONE', 'YEARLY_DATE', 'YEARLY_NTH_WEEKDAY', 'YEARLY_LAST_WEEKDAY', 'EASTER_OFFSET'];
export interface CityHoliday {
  id: string;
  name: string;
  nameFr: string;
  kind: Kind;
  date: string;
  recurrence: Recurrence;
  untilYear: number | null;
  province: string | null;
  /** Its days in the coming year. */
  next: string[];
}
type Draft = Omit<CityHoliday, 'id' | 'next'>;
const EMPTY: Draft = { name: '', nameFr: '', kind: 'PAID', date: '', recurrence: 'NONE', untilYear: null, province: null };

/**
 * The organization's own holidays and closure days, on top of each province's statutory holidays.
 * Payroll pays a paid one like a statutory holiday; a closure day is a day off without holiday pay.
 */
export function CityHolidaysCard() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const q = useQuery<{ holidays: CityHoliday[] }>('/api/settings/city-holidays');
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const fmt = (d: string) => dateFormat(lng, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  if (q.error || !q.data) return null;
  const set = (patch: Partial<Draft>) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const body = editing.draft;
    const r = await run('save', () => (editing.id ? api(`/api/settings/city-holidays/${editing.id}`, { method: 'PATCH', body }) : api('/api/settings/city-holidays', { method: 'POST', body })), t('cityHolidays.saved'));
    if (r !== undefined) {
      setEditing(null);
      await q.reload();
    }
  }
  async function remove(h: CityHoliday) {
    const r = await run(`del-${h.id}`, () => api(`/api/settings/city-holidays/${h.id}`, { method: 'DELETE' }), t('cityHolidays.removed'));
    if (r !== undefined) await q.reload();
  }

  return (
    <Card>
      <CardHeader
        title={t('cityHolidays.title')}
        description={t('cityHolidays.help')}
        action={
          <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing({ id: null, draft: EMPTY })}>
            {t('cityHolidays.add')}
          </Button>
        }
      />
      <CardBody className="pt-2">
        {q.data.holidays.length ? (
          <ul className="divide-y divide-line">
            {q.data.holidays.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-small">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">
                    {lng.startsWith('fr') ? h.nameFr : h.name}
                    <StatusPill tone={h.kind === 'PAID' ? 'ok' : 'neutral'} className="ml-2">
                      {t(`cityHolidays.kind.${h.kind}`)}
                    </StatusPill>
                  </p>
                  <p className="text-caption text-muted">
                    {t(`cityHolidays.recurrence.${h.recurrence}`)}
                    {h.province ? ` · ${h.province}` : ''}
                    {h.untilYear ? ` · ${t('cityHolidays.until', { year: h.untilYear })}` : ''}
                  </p>
                  <p className="text-caption text-ink">{h.next.length ? t('cityHolidays.nextOn', { date: fmt(h.next[0]!) }) : t('cityHolidays.noneComing')}</p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" aria-label={t('cityHolidays.edit', { name: h.name })} icon={<Pencil className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing({ id: h.id, draft: { name: h.name, nameFr: h.nameFr, kind: h.kind, date: h.date, recurrence: h.recurrence, untilYear: h.untilYear, province: h.province } })} />
                  <Button variant="ghost" size="sm" aria-label={t('cityHolidays.remove', { name: h.name })} loading={busy === `del-${h.id}`} icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={() => void remove(h)} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-small text-muted">{t('cityHolidays.empty')}</p>
        )}
      </CardBody>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? t('cityHolidays.editTitle') : t('cityHolidays.addTitle')} closeLabel={t('common.close')}>
        {editing ? (
          <form className="grid gap-4" onSubmit={(e) => void save(e)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('cityHolidays.name')}>{(p) => <Input {...p} required minLength={2} maxLength={80} value={editing.draft.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
              <Field label={t('cityHolidays.nameFr')}>{(p) => <Input {...p} lang="fr" required minLength={2} maxLength={80} value={editing.draft.nameFr} onChange={(e) => set({ nameFr: e.target.value })} />}</Field>
            </div>
            <Field label={t('cityHolidays.kindLabel')} hint={t(`cityHolidays.kindHint.${editing.draft.kind}`)}>
              {(p) => (
                <Select {...p} value={editing.draft.kind} onChange={(e) => set({ kind: e.target.value as Kind })}>
                  <option value="PAID">{t('cityHolidays.kind.PAID')}</option>
                  <option value="CLOSURE">{t('cityHolidays.kind.CLOSURE')}</option>
                </Select>
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('cityHolidays.date')} hint={editing.draft.recurrence === 'NONE' ? undefined : t('cityHolidays.dateFirst')}>
                {(p) => <Input {...p} type="date" required value={editing.draft.date} onChange={(e) => set({ date: e.target.value })} />}
              </Field>
              <Field label={t('cityHolidays.recurrenceLabel')}>
                {(p) => (
                  <Select {...p} value={editing.draft.recurrence} onChange={(e) => set({ recurrence: e.target.value as Recurrence })}>
                    {RECURRENCES.map((r) => (
                      <option key={r} value={r}>
                        {t(`cityHolidays.recurrence.${r}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {editing.draft.recurrence !== 'NONE' ? (
                <Field label={t('cityHolidays.untilYear')} hint={t('cityHolidays.untilYearHint')}>
                  {(p) => <Input {...p} type="number" min={2000} max={2200} value={editing.draft.untilYear ?? ''} onChange={(e) => set({ untilYear: e.target.value ? Number(e.target.value) : null })} />}
                </Field>
              ) : null}
              <Field label={t('cityHolidays.province')}>
                {(p) => (
                  <Select {...p} value={editing.draft.province ?? ''} onChange={(e) => set({ province: e.target.value || null })}>
                    <option value="">{t('cityHolidays.allProvinces')}</option>
                    {PROVINCES.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy === 'save'}>
                {t('common.save')}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </Card>
  );
}
