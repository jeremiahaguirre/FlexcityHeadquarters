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
import { type CustomFieldType, type FieldAccess, type FieldChoice, FIELD_TYPES } from '@/lib/customFields';
import { useAction, useQuery } from '@/lib/useQuery';

interface Definition {
  id: string;
  key: string;
  label: string;
  labelFr: string;
  type: CustomFieldType;
  choices: FieldChoice[];
  required: boolean;
  viewAccess: FieldAccess;
  editAccess: FieldAccess;
  sortOrder: number;
  archivedAt: string | null;
}
type Draft = Omit<Definition, 'id' | 'archivedAt'> & { archived: boolean };
const EMPTY: Draft = { key: '', label: '', labelFr: '', type: 'TEXT', choices: [], required: false, viewAccess: 'HR', editAccess: 'HR', sortOrder: 0, archived: false };
/** "Badge number" → "badge_number". */
const keyFrom = (label: string) => label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 40);

/** Settings: the organization's own fields on people, and who may see and change each. */
export function CustomFieldsSettings() {
  const { t, i18n } = useTranslation();
  const fr = i18n.language.startsWith('fr');
  const q = useQuery<{ fields: Definition[]; max: number }>('/api/settings/custom-fields');
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  if (q.error || !q.data) return null;
  const set = (patch: Partial<Draft>) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));
  const setChoice = (i: number, patch: Partial<FieldChoice>) => set({ choices: editing!.draft.choices.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const { key, type, archived, ...rest } = editing.draft;
    const body = editing.id ? { ...rest, archived } : { ...rest, key, type };
    const r = await run('save', () => (editing.id ? api(`/api/settings/custom-fields/${editing.id}`, { method: 'PATCH', body }) : api('/api/settings/custom-fields', { method: 'POST', body })), t('customFields.saved'));
    if (r !== undefined) {
      setEditing(null);
      await q.reload();
    }
  }

  const accessLabel = (d: Pick<Definition, 'viewAccess' | 'editAccess'>) => t(`customFields.access.${d.viewAccess}_${d.editAccess}`);
  return (
    <Card>
      <CardHeader
        title={t('customFields.title')}
        description={t('customFields.help')}
        action={
          q.data.fields.length < q.data.max ? (
            <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing({ id: null, draft: { ...EMPTY, sortOrder: q.data!.fields.length + 1 } })}>
              {t('customFields.add')}
            </Button>
          ) : null
        }
      />
      <CardBody className="pt-2">
        {q.data.fields.length ? (
          <ul className="divide-y divide-line">
            {q.data.fields.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-small">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">
                    {fr ? d.labelFr : d.label}
                    {d.required ? <StatusPill tone="neutral" className="ml-2">{t('customFields.required')}</StatusPill> : null}
                    {d.viewAccess === 'HR' ? <StatusPill tone="warn" className="ml-2">{t('customFields.hrOnly')}</StatusPill> : null}
                    {d.archivedAt ? <StatusPill tone="inactive" className="ml-2">{t('customFields.archived')}</StatusPill> : null}
                  </p>
                  <p className="text-caption text-muted">
                    {t(`customFields.types.${d.type}`)} · {accessLabel(d)} · <code>{d.key}</code>
                  </p>
                </div>
                <Button variant="ghost" size="sm" aria-label={t('customFields.edit', { name: d.label })} icon={<Pencil className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing({ id: d.id, draft: { key: d.key, label: d.label, labelFr: d.labelFr, type: d.type, choices: d.choices, required: d.required, viewAccess: d.viewAccess, editAccess: d.editAccess, sortOrder: d.sortOrder, archived: !!d.archivedAt } })} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-small text-muted">{t('customFields.empty')}</p>
        )}
      </CardBody>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? t('customFields.editTitle') : t('customFields.addTitle')} closeLabel={t('common.close')} wide>
        {editing ? (
          <form className="grid gap-4" onSubmit={(e) => void save(e)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('customFields.label')}>
                {(p) => <Input {...p} required minLength={2} maxLength={80} value={editing.draft.label} onChange={(e) => set({ label: e.target.value, ...(editing.id ? {} : { key: keyFrom(e.target.value) }) })} />}
              </Field>
              <Field label={t('customFields.labelFr')}>{(p) => <Input {...p} lang="fr" required minLength={2} maxLength={80} value={editing.draft.labelFr} onChange={(e) => set({ labelFr: e.target.value })} />}</Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('customFields.key')} hint={editing.id ? t('customFields.keyFixed') : t('customFields.keyHint')}>
                {(p) => <Input {...p} required pattern="[a-z][a-z0-9_]{1,39}" disabled={!!editing.id} value={editing.draft.key} onChange={(e) => set({ key: e.target.value })} />}
              </Field>
              <Field label={t('customFields.type')} hint={editing.id ? t('customFields.typeFixed') : undefined}>
                {(p) => (
                  <Select {...p} disabled={!!editing.id} value={editing.draft.type} onChange={(e) => set({ type: e.target.value as CustomFieldType, choices: e.target.value === 'CHOICE' && !editing.draft.choices.length ? [{ value: '', label: '', labelFr: '' }, { value: '', label: '', labelFr: '' }] : editing.draft.choices })}>
                    {FIELD_TYPES.map((x) => (
                      <option key={x} value={x}>
                        {t(`customFields.types.${x}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            {editing.draft.type === 'CHOICE' ? (
              <fieldset className="grid gap-2">
                <legend className="mb-1.5 text-small font-semibold text-ink">{t('customFields.choices')}</legend>
                {editing.draft.choices.map((c, i) => (
                  <div key={i} className="grid gap-2 rounded-xl bg-surface p-3 sm:grid-cols-[8rem_1fr_1fr_auto] sm:items-end">
                    <Field label={t('customFields.choiceValue')}>{(p) => <Input {...p} required maxLength={60} value={c.value} onChange={(e) => setChoice(i, { value: e.target.value })} />}</Field>
                    <Field label={t('customFields.label')}>{(p) => <Input {...p} required maxLength={80} value={c.label} onChange={(e) => setChoice(i, { label: e.target.value, ...(c.value ? {} : { value: keyFrom(e.target.value).toUpperCase() }) })} />}</Field>
                    <Field label={t('customFields.labelFr')}>{(p) => <Input {...p} lang="fr" required maxLength={80} value={c.labelFr} onChange={(e) => setChoice(i, { labelFr: e.target.value })} />}</Field>
                    <Button variant="ghost" size="sm" aria-label={t('settings.remove')} icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={() => set({ choices: editing.draft.choices.filter((_, j) => j !== i) })} />
                  </div>
                ))}
                <Button variant="secondary" size="sm" className="justify-self-start" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => set({ choices: [...editing.draft.choices, { value: '', label: '', labelFr: '' }] })}>
                  {t('customFields.addChoice')}
                </Button>
              </fieldset>
            ) : null}
            <Field label={t('customFields.accessLabel')} hint={t('customFields.accessHint')}>
              {(p) => (
                <Select {...p} value={`${editing.draft.viewAccess}_${editing.draft.editAccess}`} onChange={(e) => { const [viewAccess, editAccess] = e.target.value.split('_') as [FieldAccess, FieldAccess]; set({ viewAccess, editAccess }); }}>
                  {(['HR_HR', 'MANAGER_HR', 'MANAGER_MANAGER'] as const).map((x) => (
                    <option key={x} value={x}>
                      {t(`customFields.access.${x}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <label className="flex min-h-11 items-center gap-3 text-small text-ink">
              <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--brand))]" checked={editing.draft.required} onChange={(e) => set({ required: e.target.checked })} />
              {t('customFields.requiredLabel')}
            </label>
            {editing.id ? (
              <label className="flex min-h-11 items-center gap-3 text-small text-ink">
                <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--brand))]" checked={editing.draft.archived} onChange={(e) => set({ archived: e.target.checked })} />
                {t('customFields.archiveLabel')}
              </label>
            ) : null}
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
