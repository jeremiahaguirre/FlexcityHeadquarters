'use client';

import { CheckCircle2, Send } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { type Lang, copy } from '@/content/copy';
import { COMPANY, SITE } from '@/lib/site';

const PROVINCES = ['BC', 'AB', 'SK', 'MB', 'ON', 'QC', 'NB', 'NS', 'PE', 'NL', 'YT', 'NT', 'NU'];
const input = 'block h-12 w-full rounded-xl border border-line bg-panel px-3.5 text-body text-ink placeholder:text-muted/70 focus:border-brand';

/**
 * Sales, demo or support request form. For now it sends to the email form service
 * (NEXT_PUBLIC_CONTACT_FORM_URL, Formspree), which emails the enquiry to FH's inbox; later it can post to
 * the app's enquiry endpoint instead (NEXT_PUBLIC_LEADS_URL). With neither set, the form says it can't
 * send and keeps what was typed.
 */
export function LeadForm({ lang, kind = 'SALES' }: { lang: Lang; kind?: 'SALES' | 'DEMO' | 'SUPPORT' }) {
  const c = copy(lang).contact;
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim() || null;
    // Not connected yet: say so kindly and keep what the person typed.
    if (!SITE.contactFormUrl && !SITE.leadsUrl) return setState('error');
    // Bots fill the hidden field (_gotcha, Formspree's own honeypot name); they get the same
    // thank-you as people, and nothing is sent. Formspree also drops any submission with it filled.
    const trap = String(f.get('_gotcha') ?? '');
    if (trap !== '') return setState('sent');
    setState('sending');
    if (SITE.contactFormUrl) {
      const kind = (s('kind') ?? 'SALES') as keyof typeof c.kinds;
      const consent = f.get('consent') === 'on';
      try {
        // Labelled fields, so the email reads well; "email" becomes the reply-to address.
        const r = await fetch(SITE.contactFormUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            _subject: `FlexcityHeadquarters website: ${c.kinds[kind] ?? kind}`,
            _gotcha: trap,
            Type: c.kinds[kind] ?? kind,
            Name: s('name'),
            email: s('email'),
            Organization: s('organization'),
            Role: s('role'),
            Province: s('province'),
            Facilities: s('facilities'),
            Message: s('message'),
            Language: lang === 'fr' ? 'French' : 'English',
            // What the person ticked, in the words they saw. The browser reports it, so it records what
            // was asserted, not proof of consent on its own.
            'Marketing consent': consent ? `Yes: “${c.consent}”` : 'No',
          }),
        });
        setState(r.ok ? 'sent' : 'error');
      } catch {
        setState('error');
      }
      return;
    }
    try {
      const r = await fetch(SITE.leadsUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: s('kind'),
          name: s('name'),
          email: s('email'),
          organization: s('organization'),
          role: s('role'),
          province: s('province'),
          facilities: s('facilities') ? Number(s('facilities')) : null,
          message: s('message'),
          locale: lang === 'fr' ? 'fr-CA' : 'en-CA',
          marketingConsent: f.get('consent') === 'on',
          website: trap,
        }),
      });
      setState(r.ok ? 'sent' : 'error');
    } catch {
      setState('error');
    }
  }

  if (state === 'sent') {
    return (
      <p role="status" className="rise flex items-center gap-3 rounded-2xl bg-ok-bg px-5 py-4 text-body-strong text-ok">
        <CheckCircle2 className="h-6 w-6 shrink-0" aria-hidden="true" />
        {c.sent}
      </p>
    );
  }
  const field = (id: string, label: string, el: React.ReactNode, hint?: string) => (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-small font-semibold">
        {label}
      </label>
      {el}
      {hint ? <p className="text-caption text-muted">{hint}</p> : null}
    </div>
  );
  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-4">
      <p className="text-small text-muted">{c.orgOnly}</p>
      {field('kind', c.kind, (
        <select id="kind" name="kind" defaultValue={kind} className={`${input} pr-9`}>
          {(['SALES', 'DEMO', 'SUPPORT'] as const).map((k) => (
            <option key={k} value={k}>
              {c.kinds[k]}
            </option>
          ))}
        </select>
      ))}
      <div className="grid gap-4 sm:grid-cols-2">
        {field('name', c.name, <input id="name" name="name" required minLength={2} maxLength={120} autoComplete="name" className={input} />)}
        {field('email', c.email, <input id="email" name="email" type="email" required maxLength={160} autoComplete="email" className={input} />)}
        {field('organization', c.organization, <input id="organization" name="organization" maxLength={160} autoComplete="organization" className={input} />)}
        {field('role', c.role, <input id="role" name="role" maxLength={120} autoComplete="organization-title" className={input} />)}
        {field('province', c.province, (
          <select id="province" name="province" defaultValue="" className={`${input} pr-9`}>
            <option value="">{c.choose}</option>
            {PROVINCES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        ))}
        {field('facilities', c.facilities, <input id="facilities" name="facilities" type="number" min={0} max={500} className={input} />)}
      </div>
      {field('message', c.message, <textarea id="message" name="message" required minLength={5} maxLength={4000} rows={5} placeholder={c.messagePlaceholder} className={`${input} h-auto py-3`} />)}
      {/* Honeypot: hidden from people and screen readers. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website <input name="_gotcha" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <label className="flex items-start gap-3 text-small">
        <input type="checkbox" name="consent" className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" />
        <span>
          {c.consent}
          <span className="block text-caption text-muted">{c.consentHint}</span>
          {/* CASL s. 10(1): a consent request names who is asking, with a mailing address and a way to reach them. */}
          <span className="block text-caption text-muted [overflow-wrap:anywhere]">{c.consentFrom.replace('{name}', COMPANY.legalName).replace('{address}', COMPANY.mailingAddress).replace('{email}', COMPANY.email)}</span>
        </span>
      </label>
      <div role="alert">
        {state === 'error' ? <p className="rise rounded-xl bg-warn-bg px-4 py-3 text-small text-warn">{c.error}</p> : null}
      </div>
      <button type="submit" disabled={state === 'sending'} className="inline-flex h-12 items-center justify-center gap-2 justify-self-start rounded-xl bg-brand px-6 text-body-strong text-brand-contrast shadow-card hover:bg-brand-hover disabled:opacity-60">
        <Send className="nudge h-4 w-4" aria-hidden="true" />
        {state === 'sending' ? c.sending : c.send}
      </button>
      <p className="text-caption text-muted">
        {c.privacy}{' '}
        <Link href={`/${lang}/privacy/`} className="font-semibold text-brand-text underline">{c.privacyLink}</Link>
      </p>
    </form>
  );
}
