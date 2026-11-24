'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { type Profile, type Vocabulary, roleLabel } from '@/lib/vocabulary';
import { useAction, useQuery } from '@/lib/useQuery';

const ROLES = ['STAFF', 'HEAD_LIFEGUARD', 'AQUATIC_SUPERVISOR', 'FRONT_DESK', 'EMPLOYEE', 'HR_ADMIN', 'UNION_STEWARD'] as const;
type Draft = Record<string, { en: string; fr: string }>;

/** Settings: the organization's own names for the built-in roles, in English and French. Empty: the default words. */
export function RoleLabelsCard() {
  const { t } = useTranslation();
  const { reload: reloadMe } = useSession();
  const q = useQuery<Vocabulary>('/api/settings/role-labels');
  const { run, busy } = useAction();
  const [draft, setDraft] = useState<Draft>({});
  const [chosen, setChosen] = useState<Profile | ''>('');
  useEffect(() => {
    if (q.data) setChosen(q.data.chosen ?? '');
    if (q.data) setDraft(Object.fromEntries(ROLES.map((r) => [r, { en: q.data!.roleLabels[r]?.en ?? '', fr: q.data!.roleLabels[r]?.fr ?? '' }])));
  }, [q.data]);
  if (q.error || !q.data) return null;
  // The default words (without the organization's own names), shown as placeholders.
  const plain = { profile: chosen || q.data.profile, roleLabels: {} };
  const set = (r: string, k: 'en' | 'fr', v: string) => setDraft((d) => ({ ...d, [r]: { ...d[r]!, [k]: v } }));

  async function save(e: FormEvent) {
    e.preventDefault();
    const body = Object.fromEntries(ROLES.map((r) => [r, draft[r]?.en.trim() && draft[r]?.fr.trim() ? { en: draft[r]!.en.trim(), fr: draft[r]!.fr.trim() } : null]));
    const r = await run('save', () => api('/api/settings/role-labels', { method: 'PUT', body: { profile: chosen || null, roleLabels: body } }), t('roleLabels.saved'));
    if (r !== undefined) {
      await q.reload();
      await reloadMe();
    }
  }
  return (
    <Card>
      <CardHeader title={t('roleLabels.title')} description={t('roleLabels.help', { profile: t(`roleLabels.profiles.${q.data.profile}`) })} />
      <CardBody className="pt-2">
        <form className="grid gap-4" onSubmit={(e) => void save(e)}>
          <Field label={t('roleLabels.profile')} hint={t('roleLabels.profileHint')}>
            {(p) => (
              <Select {...p} value={chosen} onChange={(e) => setChosen(e.target.value as Profile | '')}>
                <option value="">{t('roleLabels.profileAuto')}</option>
                {(['AQUATIC', 'MUNICIPAL', 'PRIVATE'] as const).map((x) => (
                  <option key={x} value={x}>
                    {t(`roleLabels.profileNames.${x}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {ROLES.map((r) => {
            const half = !!draft[r]?.en.trim() !== !!draft[r]?.fr.trim();
            return (
              <fieldset key={r} className="grid gap-3 rounded-xl bg-surface p-3 sm:grid-cols-2">
                <legend className="mb-1 text-small font-semibold text-ink">{roleLabel(t, 'en-CA', plain, r)}</legend>
                <Field label={t('roleLabels.en')} error={half ? t('roleLabels.both') : undefined}>
                  {(p) => <Input {...p} maxLength={60} placeholder={roleLabel(t, 'en-CA', plain, r)} value={draft[r]?.en ?? ''} onChange={(e) => set(r, 'en', e.target.value)} />}
                </Field>
                <Field label={t('roleLabels.fr')}>{(p) => <Input {...p} lang="fr" maxLength={60} value={draft[r]?.fr ?? ''} onChange={(e) => set(r, 'fr', e.target.value)} />}</Field>
              </fieldset>
            );
          })}
          <p className="text-caption text-muted">{t('roleLabels.wordsOnly')}</p>
          <Button type="submit" className="justify-self-start" loading={busy === 'save'} disabled={ROLES.some((r) => !!draft[r]?.en.trim() !== !!draft[r]?.fr.trim())}>
            {t('common.save')}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
