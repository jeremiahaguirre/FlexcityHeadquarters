'use client';

import { Landmark, ShieldCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatDate } from '@/lib/format';
import type { PadAgreement } from '@/lib/books';

export interface PadInput { payorName: string; signerName: string; signerTitle: string; institution: string; transit: string; account: string; waivedPreNotice: boolean; agree: true; formOnFile?: true }

/** The authorization form: who signs, the account, the terms. In the Dev console it records a signed paper form instead. */
export function PadAgreementForm({ terms, defaultPayor, devConsole, busy, onSubmit }: { terms: string[]; defaultPayor: string; devConsole?: boolean; busy: boolean; onSubmit: (b: PadInput) => void }) {
  const { t } = useTranslation();
  const [agree, setAgree] = useState(false);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    onSubmit({ payorName: s('payor'), signerName: s('signer'), signerTitle: s('title'), institution: s('institution'), transit: s('transit'), account: s('account').replace(/\s/g, ''), waivedPreNotice: f.get('waive') === 'on', agree: true, ...(devConsole ? { formOnFile: true as const } : {}) });
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label={t('pad.payor')} hint={t('pad.payorHint')}>{(p) => <Input {...p} name="payor" required minLength={2} maxLength={120} defaultValue={defaultPayor} />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('pad.signer')}>{(p) => <Input {...p} name="signer" required minLength={2} maxLength={120} autoComplete="name" />}</Field>
        <Field label={t('pad.signerTitle')}>{(p) => <Input {...p} name="title" required minLength={2} maxLength={120} placeholder={t('pad.titlePlaceholder')} />}</Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('pad.institution')} hint={t('pad.institutionHint')}>{(p) => <Input {...p} name="institution" required inputMode="numeric" pattern="\d{3}" maxLength={3} autoComplete="off" />}</Field>
        <Field label={t('pad.transit')} hint={t('pad.transitHint')}>{(p) => <Input {...p} name="transit" required inputMode="numeric" pattern="\d{5}" maxLength={5} autoComplete="off" />}</Field>
        <Field label={t('pad.account')}>{(p) => <Input {...p} name="account" required inputMode="numeric" pattern="[\d ]{5,15}" maxLength={15} autoComplete="off" />}</Field>
      </div>
      <div className="rounded-xl border border-line bg-surface p-4 text-small">
        <p className="mb-2 font-semibold">{t('pad.terms')}</p>
        <ol className="grid list-decimal gap-1.5 pl-5">{terms.map((x) => <li key={x}>{x}</li>)}</ol>
      </div>
      <label className="flex items-start gap-2 text-small">
        <input type="checkbox" name="waive" className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" />
        <span>{t('pad.waive')}</span>
      </label>
      <label className="flex items-start gap-2 text-small">
        <input type="checkbox" required checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" />
        <span>{devConsole ? t('pad.formOnFile') : t('pad.agree')}</span>
      </label>
      <p className="flex items-start gap-2 text-caption text-muted"><ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />{t('pad.security')}</p>
      <div><Button type="submit" disabled={!agree} loading={busy} icon={<Landmark className="h-4 w-4" aria-hidden="true" />}>{devConsole ? t('pad.record') : t('pad.authorize')}</Button></div>
    </form>
  );
}

export function PadSummary({ a }: { a: PadAgreement }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="grid gap-1 text-small">
      <p className="flex flex-wrap items-center gap-2"><StatusPill tone={a.status === 'ACTIVE' ? 'ok' : 'neutral'}>{t(`pad.status.${a.status}`)}</StatusPill><span className="font-semibold">{a.payorName}</span></p>
      <p>{t('pad.accountLine', { institution: a.institution, transit: a.transit, account: a.account })}</p>
      <p className="text-muted">{t('pad.signedBy', { name: a.signerName, title: a.signerTitle, date: formatDate(a.authorizedAt.slice(0, 10), i18n.language, 'dated'), channel: t(`pad.channel.${a.channel}`) })}{a.waivedPreNotice ? ` · ${t('pad.waivedShort')}` : ''}</p>
      {a.cancelledAt ? <p className="text-muted">{t('pad.cancelledLine', { date: formatDate(a.cancelledAt.slice(0, 10), i18n.language, 'dated'), reason: a.cancelReason ?? '' })}</p> : null}
    </div>
  );
}
