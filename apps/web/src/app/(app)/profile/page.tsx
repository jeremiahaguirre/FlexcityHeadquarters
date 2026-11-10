'use client';

import { BadgeCheck, Clock3, FileSignature, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SignaturePad } from '@/components/SignaturePad';
import { MyFile } from '@/components/people/MyFile';
import { MyOnboarding } from '@/components/people/MyOnboarding';
import { MyRestrictions } from '@/components/people/AccommodationPanel';
import { MyReviews } from '@/components/hr/Reviews';
import { MyTraining } from '@/components/hr/Training';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select } from '@/components/ui/Field';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { LOCALE_COOKIE } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';
import { PasskeysCard } from '@/components/auth/PasskeysCard';
import { addPasskey } from '@/lib/passkeys';

interface Record { id: string; summary: string; issuedAt: string; acknowledgedAt: string | null; stewardPresent: boolean }

export default function ProfilePage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const { me, reload } = useSession();
  const { run, busy } = useAction();
  const catalog = useQuery<Array<{ id: string; name: string; nameFr: string | null; issuingBody: string }>>('/api/certifications');
  const records = useQuery<Record[]>('/api/me/discipline');
  const [adding, setAdding] = useState(false);
  const [signing, setSigning] = useState<Record | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);
  if (!me) return null;
  const name = `${me.firstName} ${me.lastName}`;
  const certName = (c: { name: string; nameFr: string | null }) => (lng === 'fr-CA' && c.nameFr ? c.nameFr : c.name);
  const unsigned = records.data?.filter((r) => !r.acknowledgedAt) ?? [];

  async function saveContact(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const locale = String(f.get('locale')) as 'en-CA' | 'fr-CA';
    const ok = await run('contact', () => api('/api/me', { method: 'PATCH', body: { phone: String(f.get('phone') || '') || null, locale } }), t('profile.saved'));
    if (ok !== undefined && locale !== lng) {
      document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.lang = locale;
      void i18n.changeLanguage(locale);
    }
    await reload();
  }

  async function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    if (f.get('newPassword') !== f.get('confirm')) return setPwError(t('reset.mismatch'));
    setPwError(null);
    const ok = await run('pw', () => api('/api/me/password', { method: 'POST', body: { currentPassword: f.get('currentPassword'), newPassword: f.get('newPassword') } }), t('profile.passwordChanged'));
    if (ok !== undefined) form.reset();
  }

  async function addCert(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const ok = await run('cert', () => api('/api/me/certifications', { method: 'POST', body: { certificationId: f.get('cert'), issueDate: f.get('issue'), expiryDate: f.get('expiry') || null } }), t('profile.certAdded'));
    if (ok !== undefined) {
      setAdding(false);
      await reload();
    }
  }

  async function acknowledge() {
    if (!signing || !signature) return;
    const ok = await run('sign', () => api(`/api/me/discipline/${signing.id}/acknowledge`, { method: 'POST', body: { signature } }), t('profile.signed'));
    if (ok !== undefined) {
      setSigning(null);
      setSignature(null);
      await records.reload();
    }
  }


  return (
    <div className="grid gap-6">
      <header className="flex items-center gap-4">
        <Avatar name={name} size="lg" />
        <div>
          <h1 className="text-title">{name}</h1>
          <p className="text-body text-muted">
            {me.roles.map((r) => t(`roles.${r}`)).join(' · ')} · {me.email}
          </p>
        </div>
      </header>

      {unsigned.length ? (
        <Card className="border-warn/40">
          <CardHeader title={t('profile.toSign')} description={t('profile.toSignHelp')} />
          <CardBody className="grid gap-3 pt-3">
            {unsigned.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-warn-bg px-4 py-3">
                <p className="text-small">{t('profile.recordFrom', { date: formatDate(r.issuedAt.slice(0, 10) + 'T12:00:00', lng, 'dated') })}</p>
                <Button size="sm" icon={<FileSignature className="h-4 w-4" aria-hidden="true" />} onClick={() => setSigning(r)}>
                  {t('profile.readAndSign')}
                </Button>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <PasskeysCard
          list={() => api('/api/me/passkeys')}
          add={addPasskey}
          remove={(id) => api(`/api/me/passkeys/${id}`, { method: 'DELETE' })}
        />
        <Card>
          <CardHeader title={t('profile.certifications')} action={<Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setAdding(true)}>{t('profile.addCert')}</Button>} />
          <CardBody className="pt-3">
            {!me.certifications.length ? (
              <p className="text-small text-muted">{t('profile.noCerts')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {me.certifications.map((c) => {
                  const expired = c.expiryDate && c.expiryDate < new Date().toISOString().slice(0, 10);
                  return (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                      <div className="min-w-0">
                        <p className="text-small font-semibold">{certName(c.certification)}</p>
                        <p className="text-caption text-muted">{c.expiryDate ? t('profile.expires', { date: formatDate(`${c.expiryDate}T12:00:00`, lng, 'dated') }) : t('profile.noExpiry')}</p>
                      </div>
                      {expired ? (
                        <StatusPill tone="danger">{t('profile.expired')}</StatusPill>
                      ) : c.verified ? (
                        <StatusPill tone="ok" icon={<BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />}>{t('profile.verified')}</StatusPill>
                      ) : (
                        <StatusPill tone="neutral" icon={<Clock3 className="h-3.5 w-3.5" aria-hidden="true" />}>{t('profile.awaiting')}</StatusPill>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <MyOnboarding />
        <MyRestrictions />
        <MyFile />
        <MyReviews />
        <MyTraining />

        <Card>
          <CardHeader title={t('profile.contact')} />
          <CardBody className="pt-3">
            <form onSubmit={(e) => void saveContact(e)} className="grid gap-4">
              <Field label={t('profile.phone')}>{(p) => <Input {...p} name="phone" type="tel" autoComplete="tel" defaultValue={me.phone ?? ''} />}</Field>
              <Field label={t('profile.language')} hint={t('profile.languageHint')}>
                {(p) => (
                  <Select {...p} name="locale" defaultValue={me.locale}>
                    <option value="en-CA">English</option>
                    <option value="fr-CA">Français</option>
                  </Select>
                )}
              </Field>
              <Button type="submit" className="justify-self-start" loading={busy === 'contact'}>
                {t('common.save')}
              </Button>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('profile.password')} />
          <CardBody className="pt-3">
            <form onSubmit={(e) => void changePassword(e)} className="grid gap-4">
              <Field label={t('profile.currentPassword')}>{(p) => <Input {...p} name="currentPassword" type="password" autoComplete="current-password" required />}</Field>
              <Field label={t('reset.password')} hint={t('reset.rule')}>{(p) => <Input {...p} name="newPassword" type="password" autoComplete="new-password" minLength={10} required />}</Field>
              <Field label={t('reset.confirm')} error={pwError ?? undefined}>{(p) => <Input {...p} name="confirm" type="password" autoComplete="new-password" required />}</Field>
              <Button type="submit" className="justify-self-start" loading={busy === 'pw'}>
                {t('profile.changePassword')}
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>

      <Dialog open={adding} onClose={() => setAdding(false)} title={t('profile.addCert')} description={t('profile.addCertHelp')} closeLabel={t('common.close')}>
        <form onSubmit={(e) => void addCert(e)} className="grid gap-4">
          <Field label={t('profile.certification')}>
            {(p) => (
              <Select {...p} name="cert" required>
                <option value="">{t('common.choose')}</option>
                {catalog.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {certName(c)} · {c.issuingBody}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('profile.issued')}>{(p) => <Input {...p} name="issue" type="date" required />}</Field>
            <Field label={t('profile.expiry')} hint={t('profile.expiryHint')}>{(p) => <Input {...p} name="expiry" type="date" />}</Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAdding(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={busy === 'cert'}>
              {t('profile.addCert')}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={signing !== null}
        onClose={() => setSigning(null)}
        title={t('profile.recordTitle')}
        description={signing ? t('profile.recordFrom', { date: formatDate(signing.issuedAt.slice(0, 10) + 'T12:00:00', lng, 'dated') }) : ''}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSigning(null)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={!signature} loading={busy === 'sign'} onClick={() => void acknowledge()}>
              {t('profile.confirmReceipt')}
            </Button>
          </>
        }
      >
        {signing ? (
          <div className="grid gap-4">
            <p className="whitespace-pre-wrap rounded-xl bg-surface px-4 py-3 text-small">{signing.summary}</p>
            <p className="text-small text-muted">{t('profile.signMeaning')}</p>
            <SignaturePad onChange={setSignature} />
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
