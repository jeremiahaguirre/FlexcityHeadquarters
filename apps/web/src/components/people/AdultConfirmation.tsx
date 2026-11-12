'use client';

import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { formatInstant } from '@/lib/format';
import { useAction } from '@/lib/useQuery';

export interface AdultConfirmationValue { at: string; by: string | null; note: string }

/**
 * HR only, beside the birth date: someone with no birth date on file is treated by messaging as
 * possibly a minor; HR can confirm they are of the age of majority (and say how), or remove it.
 * A birth date on file always wins. Sits inside the HR record's form, so it never submits it.
 */
export function AdultConfirmation({ userId, name, hasBirthDate, value, onChanged }: { userId: string; name: string; hasBirthDate: boolean; value: AdultConfirmationValue | null | undefined; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  if (value === undefined || (hasBirthDate && !value)) return null;
  const save = async () => {
    if (note.trim().length < 3) return;
    const r = await run('adult', () => api(`/api/users/${userId}/adult-confirmation`, { method: 'PUT', body: { note: note.trim() } }), t('staff.adult.saved'));
    if (r !== undefined) {
      setOpen(false);
      setNote('');
      onChanged();
    }
  };
  const remove = async () => {
    const r = await run('adult-remove', () => api(`/api/users/${userId}/adult-confirmation`, { method: 'DELETE' }), t('staff.adult.removed'));
    if (r !== undefined) onChanged();
  };
  return (
    <div className="grid gap-2 rounded-xl border border-line bg-surface/60 p-3 sm:col-span-2">
      <p className="flex items-start gap-2 text-small font-semibold text-ink">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-text" aria-hidden="true" />
        <span className="min-w-0 flex-1">{t('staff.adult.title')}</span>
        {value ? <StatusPill tone="ok">{t('staff.adult.confirmed')}</StatusPill> : null}
      </p>
      {value ? (
        <p className="text-small text-muted [overflow-wrap:anywhere]">{t(value.by ? 'staff.adult.by' : 'staff.adult.on', { by: value.by, date: formatInstant(value.at, i18n.language as 'en-CA'), note: value.note })}</p>
      ) : (
        <p className="text-small text-muted">{t('staff.adult.noDob', { name })}</p>
      )}
      {value && hasBirthDate ? <p className="text-caption text-muted">{t('staff.adult.dobWins')}</p> : null}
      {open ? (
        <div className="grid gap-2">
          <Field label={t('staff.adult.note')} hint={t('staff.adult.noteHint')}>
            {(p) => (
              <Input
                {...p}
                value={note}
                maxLength={200}
                autoComplete="off"
                autoFocus
                onChange={(e) => setNote(e.target.value)}
                // Enter confirms here; it must not submit the HR record around it.
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void save();
                  }
                }}
              />
            )}
          </Field>
          <div className="flex gap-2">
            <Button size="sm" loading={busy === 'adult'} disabled={note.trim().length < 3} onClick={() => void save()}>{t('staff.adult.save')}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setNote(''); }}>{t('common.cancel')}</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {value ? (
            <Button size="sm" variant="ghost" loading={busy === 'adult-remove'} onClick={() => void remove()}>{t('staff.adult.remove')}</Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{t('staff.adult.confirm')}</Button>
          )}
          <span className="text-caption text-muted">{t('staff.adult.private')}</span>
        </div>
      )}
    </div>
  );
}
