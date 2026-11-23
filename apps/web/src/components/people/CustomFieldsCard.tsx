'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { type PersonField, formValue } from '@/lib/customFields';
import { useAction, useQuery } from '@/lib/useQuery';

/**
 * The organization's own fields on a person's file: the ones the viewer may see (HR-only fields
 * only for HR), editable where they may change them.
 */
export function CustomFieldsCard({ userId }: { userId: string }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const fr = lng.startsWith('fr');
  const q = useQuery<{ fields: PersonField[] }>(`/api/users/${userId}/custom-fields`);
  const { run, busy } = useAction();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data) setDraft(Object.fromEntries(q.data.fields.map((f) => [f.key, formValue(f)])));
  }, [q.data]);
  if (q.error || !q.data?.fields.length) return null;
  const fields = q.data.fields;
  const label = (f: PersonField) => (fr ? f.labelFr : f.label);
  const shown = (f: PersonField) => {
    if (f.value === null) return t('customFields.empty_value');
    if (f.type === 'BOOLEAN') return f.value ? t('customFields.yes') : t('customFields.no');
    if (f.type === 'DATE') return formatDate(`${String(f.value)}T12:00:00`, lng, 'dated');
    if (f.type === 'CHOICE') {
      const c = f.choices.find((x) => x.value === f.value);
      return c ? (fr ? c.labelFr : c.label) : String(f.value);
    }
    return String(f.value);
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    const values = Object.fromEntries(fields.filter((f) => f.editable && draft[f.key] !== formValue(f)).map((f) => [f.key, draft[f.key] === '' ? null : draft[f.key]!]));
    if (!Object.keys(values).length) return setEditing(false);
    const r = await run('save', () => api(`/api/users/${userId}/custom-fields`, { method: 'PUT', body: { values } }), t('customFields.valuesSaved'));
    if (r !== undefined) {
      setEditing(false);
      await q.reload();
    }
  }

  return (
    <Card>
      <CardHeader
        title={t('customFields.cardTitle')}
        description={t('customFields.cardHelp')}
        action={
          fields.some((f) => f.editable) && !editing ? (
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              {t('common.edit')}
            </Button>
          ) : null
        }
      />
      <CardBody className="pt-2">
        {editing ? (
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => void save(e)}>
            {fields.map((f) => (
              <Field key={f.key} label={label(f)} hint={f.viewAccess === 'HR' ? t('customFields.hrOnly') : undefined}>
                {(p) =>
                  !f.editable ? (
                    <Input {...p} disabled value={shown(f)} readOnly />
                  ) : f.type === 'CHOICE' || f.type === 'BOOLEAN' ? (
                    <Select {...p} required={f.required} value={draft[f.key] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}>
                      <option value="">{t('customFields.none')}</option>
                      {f.type === 'BOOLEAN' ? (
                        <>
                          <option value="true">{t('customFields.yes')}</option>
                          <option value="false">{t('customFields.no')}</option>
                        </>
                      ) : (
                        f.choices.map((c) => (
                          <option key={c.value} value={c.value}>
                            {fr ? c.labelFr : c.label}
                          </option>
                        ))
                      )}
                    </Select>
                  ) : (
                    <Input {...p} type={f.type === 'DATE' ? 'date' : f.type === 'NUMBER' ? 'number' : 'text'} step={f.type === 'NUMBER' ? 'any' : undefined} maxLength={f.type === 'TEXT' ? 500 : undefined} required={f.required} value={draft[f.key] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} />
                  )
                }
              </Field>
            ))}
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" loading={busy === 'save'}>
                {t('common.save')}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        ) : (
          <dl className="grid gap-x-6 gap-y-3 text-small sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.key}>
                <dt className="text-caption text-muted">
                  {label(f)}
                  {f.viewAccess === 'HR' ? <span className="ml-1.5">· {t('customFields.hrOnly')}</span> : null}
                </dt>
                <dd className="text-ink">
                  {shown(f)}
                  {f.missing ? <StatusPill tone="warn" className="ml-2">{t('customFields.missing')}</StatusPill> : null}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </CardBody>
    </Card>
  );
}
