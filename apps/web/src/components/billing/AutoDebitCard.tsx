'use client';

import { Landmark } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PadAgreementForm, type PadInput, PadSummary } from '@/components/billing/PadAgreementForm';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { api } from '@/lib/api';
import type { PadAgreement } from '@/lib/books';
import { useAction } from '@/lib/useQuery';

/** The city pays each invoice automatically from its bank account: authorize, see what's on file, cancel. */
export function AutoDebitCard({ pad, payor, reload }: { pad: { agreement: PadAgreement | null; terms: string[] }; payor: string; reload: () => Promise<void> }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [mode, setMode] = useState<'view' | 'new' | 'cancel'>('view');
  async function authorize(b: PadInput) {
    const r = await run('pad', () => api('/api/billing/pad', { method: 'POST', body: b }), t('pad.authorized'));
    if (r !== undefined) {
      setMode('view');
      await reload();
    }
  }
  return (
    <Card>
      <CardHeader
        title={t('pad.cityTitle')}
        description={t('pad.cityHelp')}
        action={mode === 'view' && !pad.agreement ? <Button size="sm" icon={<Landmark className="h-4 w-4" aria-hidden="true" />} onClick={() => setMode('new')}>{t('pad.setUp')}</Button> : undefined}
      />
      <CardBody className="grid gap-4 pt-2">
        {mode === 'new' ? (
          <>
            <PadAgreementForm terms={pad.terms} defaultPayor={payor} busy={busy === 'pad'} onSubmit={(b) => void authorize(b)} />
            <div><Button size="sm" variant="ghost" onClick={() => setMode('view')}>{t('common.cancel')}</Button></div>
          </>
        ) : pad.agreement ? (
          <>
            <PadSummary a={pad.agreement} />
            {mode === 'cancel' ? (
              <form
                className="grid gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const reason = String(new FormData(e.currentTarget).get('reason'));
                  void run('cancel', () => api('/api/billing/pad/cancel', { method: 'POST', body: { reason } }), t('pad.cancelled')).then(async (r) => { if (r !== undefined) { setMode('view'); await reload(); } });
                }}
              >
                <p className="text-small text-muted">{t('pad.cancelHelp')}</p>
                <Field label={t('pad.cancelReason')}>{(p) => <Input {...p} name="reason" required minLength={3} maxLength={200} />}</Field>
                <div className="flex gap-2"><Button type="submit" size="sm" variant="danger" loading={busy === 'cancel'}>{t('pad.cancel')}</Button><Button size="sm" variant="ghost" onClick={() => setMode('view')}>{t('common.cancel')}</Button></div>
              </form>
            ) : (
              <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => setMode('new')}>{t('pad.changeAccount')}</Button><Button size="sm" variant="ghost" onClick={() => setMode('cancel')}>{t('pad.cancel')}</Button></div>
            )}
          </>
        ) : (
          <p className="text-small text-muted">{t('pad.cityNone')}</p>
        )}
      </CardBody>
    </Card>
  );
}
