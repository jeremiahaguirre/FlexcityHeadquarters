'use client';

import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { api } from '@/lib/api';

/** Ask for a password reset link. The answer is the same whether or not the address exists, so it can't be used to find accounts. */
export default function ForgotPage() {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    await api('/api/auth/forgot', { method: 'POST', body: { email: String(new FormData(e.currentTarget).get('email')) } }, false).catch(() => undefined);
    setBusy(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="text-center">
        <span className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-ok-bg text-ok">
          <MailCheck className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="text-title">{t('forgot.sentTitle')}</h1>
        <p className="mt-3 text-body text-muted">{t('forgot.sentBody')}</p>
        <Link href="/login" className="mt-8 inline-block rounded-lg text-small font-semibold text-brand-text hover:underline">
          {t('forgot.back')}
        </Link>
      </div>
    );
  }
  return (
    <>
      <h1 className="text-title">{t('forgot.title')}</h1>
      <p className="mt-2 text-body text-muted">{t('forgot.subtitle')}</p>
      <form onSubmit={onSubmit} className="mt-8 grid gap-5">
        <Field label={t('login.email')}>{(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}</Field>
        <Button type="submit" size="lg" block loading={busy}>
          {t('forgot.submit')}
        </Button>
        <Link href="/login" className="justify-self-center rounded-lg text-small font-semibold text-brand-text hover:underline">
          {t('forgot.back')}
        </Link>
      </form>
    </>
  );
}
