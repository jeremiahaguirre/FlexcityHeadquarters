'use client';

import { ImageUp, Trash2 } from 'lucide-react';
import { type ChangeEvent, type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CityBrand, CoBrand } from '@/components/CoBrand';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { papi } from '@/lib/platform';
import { useAction } from '@/lib/useQuery';
import type { PanelProps } from './types';

const MAX_BYTES = 512 * 1024;

export function OrganizationPanel({ id, city, reload }: PanelProps) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const file = useRef<HTMLInputElement>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const o = city.organization;

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await run(
      'org',
      () =>
        papi(`/tenants/${id}`, {
          method: 'PATCH',
          body: {
            name: String(f.get('name')).trim(),
            defaultLocale: f.get('locale'),
            themeColors: { primary: f.get('primary') },
            payWeekStartDay: Number(f.get('payWeek')),
            vacationPayMode: f.get('vacation'),
            payrollRetentionYears: Number(f.get('retention')),
          },
        }),
      t('profile.saved'),
    );
    await reload();
  }

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    setLogoError(null);
    if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) return setLogoError(t('platform.logoType'));
    if (f.size > MAX_BYTES) return setLogoError(t('platform.logoSize'));
    const reader = new FileReader();
    reader.onload = () => void run('logo', () => papi(`/tenants/${id}/logo`, { method: 'PUT', body: { dataUrl: reader.result } }), t('platform.logoSaved')).then(reload);
    reader.readAsDataURL(f);
  }

  const days = Array.from({ length: 7 }, (_, i) => i);
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader title={t('platform.logo')} description={t('platform.logoHelp')} />
        <CardBody className="grid gap-5 pt-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid place-items-center gap-3 rounded-xl border border-line bg-page p-5 text-center">
              <Logo variant="stacked" size={44} />
              <div className="w-full border-t border-line pt-3">
                <CityBrand org={o} size="lg" />
              </div>
              <p className="text-caption text-muted">{t('platform.previewSignIn')}</p>
            </div>
            <div className="grid place-items-center gap-3 rounded-xl border border-line bg-page p-5">
              <CoBrand org={o} logoSize={28} />
              <p className="text-caption text-muted">{t('platform.previewHeader')}</p>
            </div>
          </div>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={pick} aria-label={t('platform.uploadLogo')} />
          <div className="flex flex-wrap items-center gap-2">
            <Button icon={<ImageUp className="h-4 w-4" aria-hidden="true" />} loading={busy === 'logo'} onClick={() => file.current?.click()}>
              {o.logoUrl ? t('platform.replaceLogo') : t('platform.uploadLogo')}
            </Button>
            {o.logoUrl ? (
              <Button variant="ghost" icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} loading={busy === 'rmlogo'} onClick={() => void run('rmlogo', () => papi(`/tenants/${id}/logo`, { method: 'DELETE' }), t('platform.logoRemoved')).then(reload)}>
                {t('platform.removeLogo')}
              </Button>
            ) : null}
            <p className="text-caption text-muted">{t('platform.logoRules')}</p>
          </div>
          {logoError ? <p className="rounded-xl bg-warn-bg px-4 py-3 text-small text-warn">{logoError}</p> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('settings.org')} description={t('platform.orgHelp')} />
        <CardBody className="pt-3">
          <form onSubmit={(e) => void save(e)} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('settings.orgName')}>{(p) => <Input {...p} name="name" required minLength={2} defaultValue={o.name} />}</Field>
              <Field label={t('platform.subdomain')} hint={t('platform.subdomainFixed')}>{(p) => <Input {...p} value={o.subdomain} readOnly disabled />}</Field>
              <Field label={t('settings.defaultLanguage')}>
                {(p) => (
                  <Select {...p} name="locale" defaultValue={o.defaultLocale}>
                    <option value="en-CA">English</option>
                    <option value="fr-CA">Français</option>
                  </Select>
                )}
              </Field>
              <Field label={t('settings.payWeek')}>
                {(p) => (
                  <Select {...p} name="payWeek" defaultValue={String(o.payWeekStartDay)}>
                    {days.map((d) => (
                      <option key={d} value={d}>
                        {t(`settings.days.${d}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('settings.vacation')}>
                {(p) => (
                  <Select {...p} name="vacation" defaultValue={o.vacationPayMode}>
                    <option value="PAY_EACH_PERIOD">{t('settings.vacationModes.PAY_EACH_PERIOD')}</option>
                    <option value="ACCRUE">{t('settings.vacationModes.ACCRUE')}</option>
                  </Select>
                )}
              </Field>
              <Field label={t('settings.retention')}>{(p) => <Input {...p} name="retention" type="number" min={6} max={15} defaultValue={o.payrollRetentionYears} />}</Field>
              <Field label={t('settings.brandColour')} hint={t('platform.brandColourHint')}>
                {(p) => (
                  <div className="w-24">
                    <Input {...p} name="primary" type="color" defaultValue={o.themeColors?.primary ?? '#0f766e'} className="h-12 cursor-pointer p-1" />
                  </div>
                )}
              </Field>
            </div>
            <Button type="submit" className="justify-self-start" loading={busy === 'org'}>
              {t('common.save')}
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('platform.admins')} description={t('platform.adminsHelp')} />
        <CardBody className="pt-3">
          {!city.admins.length ? (
            <p className="text-small text-muted">{t('platform.noAdmins')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {city.admins.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-small">
                  <span>
                    <span className="font-semibold">{a.name}</span> · {a.email}
                  </span>
                  {a.invited ? <span className="text-caption text-muted">{t('staff.pendingInvite')}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
