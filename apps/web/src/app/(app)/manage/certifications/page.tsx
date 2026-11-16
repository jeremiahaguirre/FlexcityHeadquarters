'use client';

import { BadgeCheck, ShieldAlert, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Select, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAction, useQuery } from '@/lib/useQuery';

interface Cert { id: string; certification: { name: string; nameFr: string | null; issuingBody: string }; issueDate: string; expiryDate: string | null; user: { id: string; name: string }; expired?: boolean }

/** Certifications to verify and to renew. Expired or unverified cards never count toward shifts, so this is where supervisors clear the queue. */
export default function CertificationsPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [days, setDays] = useState(90);
  const unverified = useQuery<Cert[]>('/api/certifications/unverified');
  const expiring = useQuery<Cert[]>(`/api/certifications/expiring?days=${days}`);
  const { run, busy } = useAction();
  const name = (c: Cert['certification']) => (lng === 'fr-CA' && c.nameFr ? c.nameFr : c.name);
  const date = (d: string) => formatDate(`${d}T12:00:00`, lng, 'dated');
  const daysLeft = (d: string) => Math.round((Date.parse(`${d}T00:00:00`) - Date.now()) / 86_400_000);
  const [rejecting, setRejecting] = useState<Cert | null>(null);

  async function reject(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!rejecting) return;
    const reason = String(new FormData(e.currentTarget).get('reason') ?? '').trim();
    const ok = await run('reject', () => api(`/api/user-certifications/${rejecting.id}/reject`, { method: 'POST', body: { reason } }), t('certs.rejected', { name: rejecting.user.name }));
    if (ok !== undefined) {
      setRejecting(null);
      await unverified.reload();
    }
  }

  return (
    <>
      <PageHeader title={t('certs.title')} description={t('certs.description')} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('certs.toVerify')} description={t('certs.toVerifyHelp')} />
          <CardBody className="pt-3">
            {unverified.loading ? (
              <Skeleton className="h-32" />
            ) : !unverified.data?.length ? (
              <p className="flex items-center gap-2 text-small text-muted">
                <BadgeCheck className="h-5 w-5 text-ok" aria-hidden="true" />
                {t('certs.noneToVerify')}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {unverified.data.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-small font-semibold">{c.user.name}</p>
                      <p className="text-caption text-muted">
                        {name(c.certification)} · {c.certification.issuingBody} · {c.expiryDate ? t('profile.expires', { date: date(c.expiryDate) }) : t('profile.noExpiry')}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="ghost" icon={<X className="h-4 w-4" aria-hidden="true" />} onClick={() => setRejecting(c)}>
                        {t('certs.reject')}
                      </Button>
                      <Button size="sm" icon={<BadgeCheck className="h-4 w-4" aria-hidden="true" />} loading={busy === c.id} onClick={() => void run(c.id, () => api(`/api/user-certifications/${c.id}/verify`, { method: 'POST' }), t('certs.verified', { name: c.user.name })).then(() => unverified.reload())}>
                        {t('certs.verify')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t('certs.expiring')}
            action={
              <div className="w-40">
                <Field label={<span className="sr-only">{t('certs.window')}</span>}>
                  {(p) => (
                    <Select {...p} value={days} onChange={(e) => setDays(Number(e.target.value))}>
                      {[30, 60, 90, 180].map((d) => (
                        <option key={d} value={d}>
                          {t('certs.within', { count: d })}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
            }
          />
          <CardBody className="pt-3">
            {expiring.loading ? (
              <Skeleton className="h-32" />
            ) : !expiring.data?.length ? (
              <p className="text-small text-muted">{t('certs.noneExpiring')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {expiring.data.map((c) => {
                  const left = daysLeft(c.expiryDate!);
                  return (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="text-small font-semibold">{c.user.name}</p>
                        <p className="text-caption text-muted">
                          {name(c.certification)} · {date(c.expiryDate!)}
                        </p>
                      </div>
                      {c.expired ? (
                        <StatusPill tone="danger" icon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />}>
                          {t('certs.expiredBlocks')}
                        </StatusPill>
                      ) : (
                        <StatusPill tone={left <= 30 ? 'warn' : 'neutral'}>{t('certs.daysLeft', { count: left })}</StatusPill>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
      <Dialog open={rejecting !== null} onClose={() => setRejecting(null)} title={t('certs.rejectTitle')} description={rejecting ? `${rejecting.user.name} · ${name(rejecting.certification)}` : ''} closeLabel={t('common.close')}>
        <form key={rejecting?.id ?? 'none'} onSubmit={(e) => void reject(e)} className="grid gap-4">
          <Field label={t('certs.rejectReason')} hint={t('certs.rejectHint')}>{(p) => <Textarea {...p} name="reason" required minLength={2} maxLength={500} rows={3} />}</Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="danger" loading={busy === 'reject'}>
              {t('certs.reject')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
