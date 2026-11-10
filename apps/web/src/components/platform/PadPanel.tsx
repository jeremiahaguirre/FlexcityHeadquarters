'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PadAgreementForm, type PadInput, PadSummary } from '@/components/billing/PadAgreementForm';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/apiError';
import type { PadAgreement } from '@/lib/books';
import { papi, usePlatformQuery } from '@/lib/platform';

/** The city's pre-authorized debit: what's on file, entering a signed form, cancelling. */
export function PadPanel({ id, payor }: { id: string; payor: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const data = usePlatformQuery<{ active: PadAgreement | null; history: PadAgreement[]; terms: string[] }>(`/billing/pad/${id}`);
  const [mode, setMode] = useState<'view' | 'new' | 'cancel'>('view');
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast(ok, 'ok');
      setMode('view');
      await data.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('common.error'), 'warn');
    } finally {
      setBusy(false);
    }
  }
  const d = data.data;
  return (
    <Card>
      <CardHeader
        title={t('pad.consoleTitle')}
        description={t('pad.consoleHelp')}
        action={mode === 'view' ? <Button size="sm" variant="secondary" onClick={() => setMode('new')}>{d?.active ? t('pad.replace') : t('pad.enter')}</Button> : undefined}
      />
      <CardBody className="grid gap-4 pt-2">
        {!d ? (
          <Skeleton className="h-24" />
        ) : mode === 'new' ? (
          <>
            <PadAgreementForm terms={d.terms} defaultPayor={payor} devConsole busy={busy} onSubmit={(b: PadInput) => void run(() => papi(`/billing/pad/${id}`, { method: 'POST', body: b }), t('pad.recorded'))} />
            <div><Button variant="ghost" size="sm" onClick={() => setMode('view')}>{t('common.cancel')}</Button></div>
          </>
        ) : (
          <>
            {d.active ? <PadSummary a={d.active} /> : <p className="text-muted">{t('pad.none')}</p>}
            {d.active && mode === 'cancel' ? (
              <form
                className="grid gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const reason = String(new FormData(e.currentTarget).get('reason'));
                  void run(() => papi(`/billing/pad/agreements/${d.active!.id}/cancel`, { method: 'POST', body: { reason } }), t('pad.cancelled'));
                }}
              >
                <Field label={t('pad.cancelReason')}>{(p) => <Input {...p} name="reason" required minLength={3} maxLength={200} />}</Field>
                <div className="flex gap-2"><Button type="submit" size="sm" variant="danger" loading={busy}>{t('pad.cancel')}</Button><Button size="sm" variant="ghost" onClick={() => setMode('view')}>{t('common.cancel')}</Button></div>
              </form>
            ) : d.active ? (
              <div><Button size="sm" variant="ghost" onClick={() => setMode('cancel')}>{t('pad.cancel')}</Button></div>
            ) : null}
            {d.history.length ? (
              <details className="text-small">
                <summary className="cursor-pointer font-semibold">{t('pad.history', { count: d.history.length })}</summary>
                <div className="mt-3 grid gap-3">{d.history.map((a) => <PadSummary key={a.id} a={a} />)}</div>
              </details>
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}
