'use client';

import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { useAction } from '@/lib/useQuery';

export interface RateRow { id: string; position: string; hourlyRate: string; effectiveFrom: string; effectiveTo: string | null }

/**
 * Correct a pay rate entered wrong (the amount or its start date), or remove one entered by
 * mistake. A raise is a new rate instead. Rates an approved or paid pay run already used are
 * refused by the server (corrected with a one-time item on the next run).
 */
export function PayRateEditDialog({ userId, rate, onClose, onSaved }: { userId: string; rate: RateRow; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [removing, setRemoving] = useState(false);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const reason = String(f.get('reason') ?? '').trim();
    const ok = removing
      ? await run('rateRemove', () => api(`/api/users/${userId}/pay-rates/${rate.id}/remove`, { method: 'POST', body: { reason } }), t('staff.rateRemoved'))
      : await run(
          'rateFix',
          () => {
            const hourlyRate = String(f.get('rate') ?? '').trim();
            const effectiveFrom = String(f.get('from') ?? '');
            return api(`/api/users/${userId}/pay-rates/${rate.id}`, {
              method: 'PATCH',
              body: { ...(hourlyRate !== rate.hourlyRate ? { hourlyRate } : {}), ...(effectiveFrom !== rate.effectiveFrom ? { effectiveFrom } : {}), reason },
            });
          },
          t('staff.rateCorrected'),
        );
    if (ok !== undefined) await onSaved();
  }

  return (
    <Dialog open onClose={onClose} title={t('staff.correctRate', { position: rate.position })} description={t('staff.correctRateHelp')} closeLabel={t('common.close')}>
      <form onSubmit={(e) => void save(e)} className="grid gap-4">
        {removing ? (
          <p className="rounded-xl bg-warn-bg px-3 py-2 text-small">{t('staff.removeRateHelp')}</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('staff.hourlyRate')}>{(p) => <Input {...p} name="rate" inputMode="decimal" required pattern="\d{1,3}(\.\d{1,2})?" defaultValue={Number(rate.hourlyRate).toFixed(2)} />}</Field>
            <Field label={t('availability.effectiveFrom')}>{(p) => <Input {...p} name="from" type="date" required max={rate.effectiveTo ?? undefined} defaultValue={rate.effectiveFrom} />}</Field>
          </div>
        )}
        <Field label={t('approvals.reason')} hint={t('staff.rateReasonHint')}>{(p) => <Textarea {...p} name="reason" required minLength={3} maxLength={500} rows={2} />}</Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" className="mr-auto" onClick={() => setRemoving((x) => !x)}>
            {removing ? t('staff.correctInstead') : t('staff.removeRate')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant={removing ? 'danger' : 'primary'} loading={busy === 'rateFix' || busy === 'rateRemove'}>
            {removing ? t('staff.removeRate') : t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
