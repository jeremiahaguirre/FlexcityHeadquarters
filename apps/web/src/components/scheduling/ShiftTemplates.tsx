'use client';

import { CalendarPlus, Copy, LayoutTemplate, Plus, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatHours } from '@/lib/format';
import { type ApplyResult, type ShiftTemplate, type TemplateSlot, type TemplatesView, WEEK, daysLabel, endAfter, fromHHMM, minutesRange, toHHMM, weekTotals, weekdayNames } from '@/lib/shiftTemplates';
import { useLiveChange } from '@/lib/useLiveChange';
import { plusDays, todayIso, useAction, useQuery } from '@/lib/useQuery';

interface Named { id: string; name: string; nameFr: string | null }
type Draft = Omit<ShiftTemplate, 'id' | 'updatedAt'>;

/** Next Monday (templates usually start a week). */
const nextMonday = () => {
  const t = todayIso();
  const dow = new Date(`${t}T12:00:00Z`).getUTCDay();
  return plusDays(t, ((8 - dow) % 7) || 7);
};

/** Seven day toggles, Monday first: 44 px tall, readable names for screen readers. */
export function DayToggles({ value, onChange, label }: { value: number[]; onChange: (days: number[]) => void; label: string }) {
  const { i18n } = useTranslation();
  const short = weekdayNames(i18n.language);
  const long = weekdayNames(i18n.language, 'long');
  return (
    <div role="group" aria-label={label} className="grid grid-cols-7 gap-1">
      {WEEK.map((d) => {
        const on = value.includes(d);
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            aria-label={long[d]}
            onClick={() => onChange(on ? value.filter((x) => x !== d) : [...value, d])}
            className={cn('h-11 min-w-0 rounded-xl border text-caption font-semibold transition-colors', on ? 'border-brand bg-brand text-brand-contrast' : 'border-line bg-panel text-muted hover:border-brand/50')}
          >
            {short[d]!.replace('.', '').slice(0, 3)}
          </button>
        );
      })}
    </div>
  );
}

function SlotEditor({ slot, index, positions, facilities, onChange, onRemove, canRemove }: { slot: TemplateSlot; index: number; positions: Named[]; facilities: Named[]; onChange: (s: TemplateSlot) => void; onRemove: () => void; canRemove: boolean }) {
  const { t, i18n } = useTranslation();
  const label = (x: Named) => (i18n.language === 'fr-CA' && x.nameFr ? x.nameFr : x.name);
  return (
    <fieldset className="grid gap-3 rounded-2xl border border-line p-3">
      <legend className="px-1 text-small font-semibold">{t('shiftTemplates.line', { n: index + 1 })}</legend>
      <DayToggles value={slot.daysOfWeek} onChange={(daysOfWeek) => onChange({ ...slot, daysOfWeek })} label={t('shiftTemplates.days')} />
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('shiftTemplates.start')}>{(p) => <Input {...p} type="time" value={toHHMM(slot.startMinute)} onChange={(e) => { const m = fromHHMM(e.target.value); if (m !== null) onChange({ ...slot, startMinute: m, endMinute: endAfter(m, slot.endMinute % 1440) }); }} />}</Field>
        <Field label={t('shiftTemplates.end')}>{(p) => <Input {...p} type="time" value={toHHMM(slot.endMinute)} onChange={(e) => { const m = fromHHMM(e.target.value); if (m !== null) onChange({ ...slot, endMinute: endAfter(slot.startMinute, m) }); }} />}</Field>
        <Field label={t('shiftTemplates.headcount')}>{(p) => <Input {...p} type="number" inputMode="numeric" min={1} max={50} value={slot.headcount} onChange={(e) => onChange({ ...slot, headcount: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} />}</Field>
        <Field label={t('shiftTemplates.break')}>{(p) => <Input {...p} type="number" inputMode="numeric" min={0} max={240} step={5} value={slot.unpaidBreakMinutes ?? ''} onChange={(e) => onChange({ ...slot, unpaidBreakMinutes: e.target.value === '' ? null : Math.max(0, Math.min(240, Number(e.target.value) || 0)) })} />}</Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={t('shiftTemplates.position')}>{(p) => <Select {...p} value={slot.positionId} onChange={(e) => onChange({ ...slot, positionId: e.target.value })}>{positions.map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}</Select>}</Field>
        <Field label={t('shiftTemplates.facility')}>{(p) => <Select {...p} value={slot.facilityId} onChange={(e) => onChange({ ...slot, facilityId: e.target.value })}>{facilities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
      </div>
      {slot.endMinute > 1440 ? <p className="text-caption text-muted">{t('shiftTemplates.overnight')}</p> : null}
      <Button variant="ghost" size="sm" className="justify-self-start" disabled={!canRemove} icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={onRemove}>{t('shiftTemplates.removeLine')}</Button>
    </fieldset>
  );
}

function Editor({ open, initial, positions, facilities, onClose, onSaved }: { open: boolean; initial: ShiftTemplate | null; positions: Named[]; facilities: Named[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const blankSlot = (): TemplateSlot => ({ daysOfWeek: [1, 2, 3, 4, 5], startMinute: 7 * 60, endMinute: 15 * 60, facilityId: facilities[0]?.id ?? '', positionId: positions[0]?.id ?? '', headcount: 1, unpaidBreakMinutes: 30 });
  const blank = (): Draft => ({ name: '', departmentId: null, validFrom: null, validTo: null, active: true, autoWeeksAhead: 0, slots: [blankSlot()] });
  const [v, setV] = useState<Draft>(initial ?? blank());
  useEffect(() => setV(initial ? { ...initial } : blank()), [initial, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const setSlot = (i: number, s: TemplateSlot) => setV({ ...v, slots: v.slots.map((x, k) => (k === i ? s : x)) });
  const valid = v.name.trim().length >= 2 && v.slots.length > 0 && v.slots.every((s) => s.daysOfWeek.length && s.positionId && s.facilityId) && (!v.validFrom || !v.validTo || v.validTo >= v.validFrom);
  const save = () =>
    void run('save', () => api(initial ? `/api/schedule/templates/${initial.id}` : '/api/schedule/templates', { method: initial ? 'PUT' : 'POST', body: { ...v, departmentId: null, slots: v.slots.map(({ id: _id, ...s }) => s) } }), t('shiftTemplates.saved')).then((r) => {
      if (r !== undefined) {
        onSaved();
        onClose();
      }
    });
  const totals = weekTotals(v.slots);
  const { i18n } = useTranslation();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initial ? t('shiftTemplates.edit') : t('shiftTemplates.new')}
      description={t('shiftTemplates.editorHelp')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={busy === 'save'} disabled={!valid} onClick={save}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label={t('shiftTemplates.name')} hint={t('shiftTemplates.nameHint')}>{(p) => <Input {...p} value={v.name} maxLength={80} autoComplete="off" onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('shiftTemplates.validFrom')}>{(p) => <Input {...p} type="date" value={v.validFrom ?? ''} onChange={(e) => setV({ ...v, validFrom: e.target.value || null })} />}</Field>
          <Field label={t('shiftTemplates.validTo')}>{(p) => <Input {...p} type="date" value={v.validTo ?? ''} min={v.validFrom ?? undefined} onChange={(e) => setV({ ...v, validTo: e.target.value || null })} />}</Field>
        </div>
        <p className="-mt-2 text-caption text-muted">{t('shiftTemplates.datesHelp')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('shiftTemplates.autoWeeks')} hint={t('shiftTemplates.autoWeeksHint')}>
            {(p) => (
              <Select {...p} value={v.autoWeeksAhead} onChange={(e) => setV({ ...v, autoWeeksAhead: Number(e.target.value) })}>
                {[0, 1, 2, 3, 4, 6, 8].map((n) => <option key={n} value={n}>{n ? t('shiftTemplates.weeksAhead', { count: n }) : t('shiftTemplates.never')}</option>)}
              </Select>
            )}
          </Field>
          <label className="flex min-h-11 items-center gap-3 self-end text-small">
            <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--brand))]" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />
            {t('shiftTemplates.active')}
          </label>
        </div>
        <div className="grid gap-3">
          <p className="text-small font-semibold">{t('shiftTemplates.lines')}</p>
          {v.slots.map((s, i) => (
            <SlotEditor key={i} slot={s} index={i} positions={positions} facilities={facilities} onChange={(x) => setSlot(i, x)} onRemove={() => setV({ ...v, slots: v.slots.filter((_, k) => k !== i) })} canRemove={v.slots.length > 1} />
          ))}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setV({ ...v, slots: [...v.slots, blankSlot()] })}>{t('shiftTemplates.addLine')}</Button>
            {v.slots.length ? <Button size="sm" variant="ghost" icon={<Copy className="h-4 w-4" aria-hidden="true" />} onClick={() => setV({ ...v, slots: [...v.slots, { ...v.slots.at(-1)!, id: undefined }] })}>{t('shiftTemplates.copyLine')}</Button> : null}
          </div>
          <p className="text-caption text-muted" role="status">{t('shiftTemplates.weekTotals', { count: totals.shifts, hours: formatHours(totals.hours, i18n.language) })}</p>
        </div>
      </div>
    </Dialog>
  );
}

const CODE_TONE: Record<string, 'warn' | 'neutral' | 'pending'> = { HOLIDAY_CLOSED: 'neutral', FACILITY_CLOSED: 'neutral', OUTSIDE_HOURS: 'warn', STAT_HOLIDAY: 'pending' };

/** Apply to a range: preview (nothing written), then create the drafts; undo straight away if it wasn't right. */
function ApplyPanel({ template, onDone }: { template: ShiftTemplate; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const { run, busy } = useAction();
  const [from, setFrom] = useState(template.validFrom && template.validFrom > todayIso() ? template.validFrom : nextMonday());
  const [weeks, setWeeks] = useState(1);
  const to = plusDays(from, weeks * 7);
  const [preview, setPreview] = useState<ApplyResult | null>(null);
  const [done, setDone] = useState<ApplyResult | null>(null);
  useEffect(() => {
    setPreview(null);
    setDone(null);
  }, [from, weeks]);
  const notable = (preview ?? done)?.items.filter((x) => x.code) ?? [];
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('shiftTemplates.from')}>{(p) => <Input {...p} type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />}</Field>
        <Field label={t('shiftTemplates.weeks')}>
          {(p) => (
            <Select {...p} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
              {[1, 2, 3, 4, 6, 8, 13].map((n) => <option key={n} value={n}>{t('shiftTemplates.weekCount', { count: n })}</option>)}
            </Select>
          )}
        </Field>
      </div>
      <p className="text-caption text-muted">{t('shiftTemplates.rangeIs', { from: formatDate(from, lng), to: formatDate(plusDays(to, -1), lng) })}</p>
      {preview && !done ? (
        <div className="grid gap-1 rounded-2xl bg-surface p-3 text-small" role="status">
          <p className="font-semibold">{t('shiftTemplates.previewCreate', { count: preview.created })}</p>
          {preview.existing ? <p className="text-muted">{t('shiftTemplates.previewExisting', { count: preview.existing })}</p> : null}
          {preview.skipped ? <p className="text-muted">{t('shiftTemplates.previewSkipped', { count: preview.skipped })}</p> : null}
          {preview.outsideDates ? <p className="text-muted">{t('shiftTemplates.previewOutside', { count: preview.outsideDates })}</p> : null}
        </div>
      ) : null}
      {done ? (
        <div className="grid gap-1 rounded-2xl bg-ok-bg p-3 text-small" role="status">
          <p className="font-semibold">{t('shiftTemplates.doneCreated', { count: done.created })}</p>
          <p className="text-muted">{t('shiftTemplates.doneNext')}</p>
        </div>
      ) : null}
      {notable.length ? (
        <ul className="grid gap-1 text-small">
          {notable.slice(0, 8).map((x) => (
            <li key={`${x.slotId}${x.date}${x.status}`} className="flex flex-wrap items-center gap-2">
              <StatusPill tone={CODE_TONE[x.code!] ?? 'neutral'}>{t(`shiftTemplates.code.${x.code}`)}</StatusPill>
              <span>{formatDate(x.date, lng)}</span>
            </li>
          ))}
          {notable.length > 8 ? <li className="text-caption text-muted">{t('shiftTemplates.andMore', { count: notable.length - 8 })}</li> : null}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!done ? <Button variant="secondary" loading={busy === 'preview'} onClick={() => void run('preview', () => api<ApplyResult>(`/api/schedule/templates/${template.id}/apply`, { method: 'POST', body: { from, to, dryRun: true } })).then((r) => r && setPreview(r))}>{t('shiftTemplates.preview')}</Button> : null}
        {!done ? (
          <Button
            loading={busy === 'apply'}
            icon={<CalendarPlus className="h-4 w-4" aria-hidden="true" />}
            onClick={() =>
              void run('apply', () => api<ApplyResult>(`/api/schedule/templates/${template.id}/apply`, { method: 'POST', body: { from, to } })).then((r) => {
                if (r) {
                  setDone(r);
                  onDone();
                }
              })
            }
          >
            {t('shiftTemplates.apply')}
          </Button>
        ) : done.applicationId ? (
          <Button variant="secondary" loading={busy === 'undo'} icon={<Undo2 className="h-4 w-4" aria-hidden="true" />} onClick={() => void run('undo', () => api(`/api/schedule/templates/applications/${done.applicationId}/undo`, { method: 'POST' }), t('shiftTemplates.undone')).then((r) => { if (r) { setDone(null); onDone(); } })}>
            {t('shiftTemplates.undo')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Weekly shift templates: a department's standard week, applied to weeks as drafts (never published by themselves). */
export function ShiftTemplates() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const q = useQuery<TemplatesView>('/api/schedule/templates');
  const facilities = useQuery<Named[]>('/api/facilities');
  const positions = useQuery<Array<Named & { departmentId: string | null }>>('/api/positions');
  const departments = useQuery<{ departments: Named[] }>('/api/departments');
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<ShiftTemplate | 'new' | null>(null);
  const [applying, setApplying] = useState<ShiftTemplate | null>(null);
  const [deleting, setDeleting] = useState<ShiftTemplate | null>(null);
  useLiveChange('templates', () => void q.reload());
  const label = (x: { name: string; nameFr: string | null }) => (lng === 'fr-CA' && x.nameFr ? x.nameFr : x.name);
  const posById = useMemo(() => new Map((positions.data ?? []).map((p) => [p.id, p])), [positions.data]);
  const facById = useMemo(() => new Map((facilities.data ?? []).map((f) => [f.id, f])), [facilities.data]);
  if (!q.data || !facilities.data || !positions.data) return <Skeleton className="h-64" />;
  const v = q.data;
  const deptName = (id: string | null) => {
    const d = id ? departments.data?.departments.find((x) => x.id === id) : null;
    return d ? label(d) : t('shiftTemplates.anyDepartment');
  };
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <Button icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing('new')}>{t('shiftTemplates.new')}</Button>
      </div>
      {v.canConfigure ? (
        <Card>
          <CardBody>
            <label className="flex min-h-11 items-start gap-3">
              <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" checked={v.autoCreate} disabled={busy === 'auto'} onChange={(e) => void run('auto', () => api('/api/schedule/templates/settings', { method: 'PUT', body: { autoCreate: e.target.checked } }), e.target.checked ? t('shiftTemplates.autoOn') : t('shiftTemplates.autoOff')).then(() => q.reload())} />
              <span>
                <span className="block text-body-strong">{t('shiftTemplates.autoTitle')}</span>
                <span className="block text-small text-muted">{t('shiftTemplates.autoHelp')}</span>
              </span>
            </label>
          </CardBody>
        </Card>
      ) : null}
      {!v.templates.length ? (
        <EmptyState icon={LayoutTemplate} title={t('shiftTemplates.none')}>{t('shiftTemplates.noneHelp')}</EmptyState>
      ) : (
        v.templates.map((tpl) => {
          const totals = weekTotals(tpl.slots);
          const apps = v.applications.filter((x) => x.templateId === tpl.id).slice(0, 4);
          const dates = tpl.validFrom || tpl.validTo ? t('shiftTemplates.dates', { from: tpl.validFrom ? formatDate(tpl.validFrom, lng, 'dated') : '…', to: tpl.validTo ? formatDate(tpl.validTo, lng, 'dated') : '…' }) : t('shiftTemplates.anyDates');
          return (
            <Card key={tpl.id} className="max-w-3xl">
              <CardHeader
                title={tpl.name}
                description={`${deptName(tpl.departmentId)} · ${dates}`}
                action={
                  <div className="flex flex-wrap justify-end gap-1">
                    {!tpl.active ? <StatusPill tone="inactive">{t('shiftTemplates.inactive')}</StatusPill> : null}
                    {tpl.autoWeeksAhead && v.autoCreate ? <StatusPill tone="brand">{t('shiftTemplates.autoPill', { count: tpl.autoWeeksAhead })}</StatusPill> : null}
                  </div>
                }
              />
              <CardBody className="grid gap-3 pt-1">
                <ul className="grid gap-1.5">
                  {tpl.slots.map((s) => {
                    const pos = posById.get(s.positionId);
                    return (
                      <li key={s.id} className="grid gap-x-3 rounded-xl bg-surface px-3 py-2 text-small sm:grid-cols-[8rem_1fr_auto]">
                        <span className="font-semibold">{daysLabel(s.daysOfWeek, lng, t('shiftTemplates.everyDay'))}</span>
                        <span className="min-w-0">
                          {minutesRange(s.startMinute, s.endMinute, lng)} · {pos ? label(pos) : '—'} · <span className="text-muted">{facById.get(s.facilityId)?.name ?? '—'}</span>
                        </span>
                        <span className="tabular-nums text-muted">{t('shiftTemplates.people', { count: s.headcount })}</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-caption text-muted">{t('shiftTemplates.weekTotals', { count: totals.shifts, hours: formatHours(totals.hours, lng) })}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" icon={<CalendarPlus className="h-4 w-4" aria-hidden="true" />} disabled={!tpl.active} onClick={() => setApplying(tpl)}>{t('shiftTemplates.applyEllipsis')}</Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(tpl)}>{t('common.edit')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(tpl)}>{t('shiftTemplates.delete')}</Button>
                </div>
                {apps.length ? (
                  <div className="grid gap-1 border-t border-line pt-3">
                    <p className="text-caption font-semibold text-muted">{t('shiftTemplates.history')}</p>
                    <ul className="grid gap-1">
                      {apps.map((x) => (
                        <li key={x.id} className="flex min-h-11 flex-wrap items-center justify-between gap-2 text-small">
                          <span>
                            {formatDate(x.from, lng)} – {formatDate(plusDays(x.to, -1), lng)} · {t('shiftTemplates.drafts', { count: x.created })}
                            {x.automatic ? <span className="text-muted"> · {t('shiftTemplates.automatic')}</span> : null}
                          </span>
                          {x.undoneAt ? (
                            <StatusPill tone="neutral">{t('shiftTemplates.undoneOn', { date: formatDate(x.undoneAt.slice(0, 10), lng) })}</StatusPill>
                          ) : (
                            <Button size="sm" variant="ghost" loading={busy === x.id} icon={<Undo2 className="h-4 w-4" aria-hidden="true" />} onClick={() => void run(x.id, () => api<{ cancelled: number; kept: number }>(`/api/schedule/templates/applications/${x.id}/undo`, { method: 'POST' })).then((r) => r && q.reload())}>
                              {t('shiftTemplates.undo')}
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          );
        })
      )}
      <Editor open={editing !== null} initial={editing === 'new' ? null : editing} positions={positions.data} facilities={facilities.data} onClose={() => setEditing(null)} onSaved={() => void q.reload()} />
      <Dialog open={applying !== null} onClose={() => setApplying(null)} title={t('shiftTemplates.applyTitle', { name: applying?.name ?? '' })} description={t('shiftTemplates.applyHelp')} closeLabel={t('common.close')}>
        {applying ? <ApplyPanel template={applying} onDone={() => void q.reload()} /> : null}
      </Dialog>
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('shiftTemplates.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('shiftTemplates.deleteHelp')}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" loading={busy === 'delete'} onClick={() => void run('delete', () => api(`/api/schedule/templates/${deleting!.id}`, { method: 'DELETE' }), t('shiftTemplates.deleted')).then(() => { setDeleting(null); void q.reload(); })}>{t('shiftTemplates.delete')}</Button>
          </>
        }
      />
    </div>
  );
}
