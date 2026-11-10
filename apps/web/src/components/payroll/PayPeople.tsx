'use client';

import { Eye, Landmark } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import type { BankAccount, PayProfile } from '@/lib/payroll';
import { useAction, useQuery } from '@/lib/useQuery';
import { AddressFields, readAddress } from './AddressFields';

interface Person { id: string; name: string; employeeNumber: string | null; departmentIds: string[]; profile: PayProfile; bankAccounts: BankAccount[] }
const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'];

/** Everyone's tax set-up and direct deposit, with banking changes waiting for a second person. */
export function PayPeople() {
  const { t } = useTranslation();
  const data = useQuery<{ people: Person[]; me: string }>('/api/payroll/people');
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<Person | null>(null);
  const [sins, setSins] = useState<Record<string, string>>({});
  if (!data.data) return <Skeleton className="h-64" />;
  const { people, me } = data.data;
  const pending = people.flatMap((p) => p.bankAccounts.filter((b) => b.status === 'PENDING').map((b) => ({ person: p, bank: b })));

  async function verify(id: string, approve: boolean) {
    const r = await run(`v-${id}`, () => api(`/api/bank-accounts/${id}/verify`, { method: 'POST', body: { approve } }), approve ? t('payroll.bankVerified') : t('payroll.bankRejected'));
    if (r !== undefined) await data.reload();
  }
  async function reveal(id: string) {
    const r = await run(`sin-${id}`, () => api<{ sin: string }>(`/api/users/${id}/sin`));
    if (r) setSins((s) => ({ ...s, [id]: r.sin }));
  }

  return (
    <div className="grid gap-6">
      {pending.length ? (
        <Card>
          <CardHeader title={t('payroll.toVerify')} description={t('payroll.toVerifyHelp')} />
          <CardBody className="grid gap-3 pt-2">
            {pending.map(({ person, bank }) => (
              <div key={bank.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-3">
                <div>
                  <p className="text-body-strong">{person.name}</p>
                  <p className="text-small text-muted">{t('payroll.bankLine', { holder: bank.holderName, institution: bank.institution, transit: bank.transit, account: bank.account })}</p>
                  {bank.enteredById === me ? <p className="text-caption text-warn">{t('payroll.youEnteredThis')}</p> : null}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={bank.enteredById === me} loading={busy === `v-${bank.id}`} onClick={() => void verify(bank.id, true)}>{t('payroll.verify')}</Button>
                  <Button size="sm" variant="ghost" disabled={bank.enteredById === me} onClick={() => void verify(bank.id, false)}>{t('payroll.reject')}</Button>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t('payroll.peopleTitle')} description={t('payroll.peopleHelp')} />
        <CardBody className="pt-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-small">
              <thead className="text-left text-caption text-muted"><tr><th className="py-2 font-semibold">{t('payroll.employee')}</th><th className="py-2 font-semibold">{t('payroll.directDeposit')}</th><th className="py-2 font-semibold">TD1</th><th className="py-2 font-semibold">SIN</th><th /></tr></thead>
              <tbody className="divide-y divide-line">
                {people.map((p) => {
                  const active = p.bankAccounts.find((b) => b.status === 'ACTIVE');
                  return (
                    <tr key={p.id}>
                      <td className="py-2.5 font-semibold">{p.name}</td>
                      <td className="py-2.5">{active ? <span className="inline-flex items-center gap-1"><Landmark className="h-4 w-4 text-brand-text" aria-hidden="true" />{active.account}</span> : <StatusPill tone="warn">{t('payroll.cheque')}</StatusPill>}</td>
                      <td className="py-2.5">{p.profile.td1SignedAt ? t('payroll.claimed') : t('payroll.basicAmounts')}</td>
                      <td className="py-2.5 tabular-nums">
                        {sins[p.id] ?? p.profile.sin ?? <StatusPill tone="warn">{t('payroll.missing')}</StatusPill>}
                        {p.profile.sin && !sins[p.id] ? (
                          <button type="button" className="ml-2 inline-flex items-center text-brand-text" aria-label={t('payroll.showSin', { name: p.name })} onClick={() => void reveal(p.id)}><Eye className="h-4 w-4" aria-hidden="true" /></button>
                        ) : null}
                      </td>
                      <td className="py-2.5 text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(p)}>{t('common.edit')}</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
      {editing ? <EditPerson person={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await data.reload(); }} /> : null}
    </div>
  );
}

function EditPerson({ person, onClose, onSaved }: { person: Person; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const p = person.profile;
  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => (String(f.get(k) ?? '').trim() ? Number(f.get(k)) : null);
    const sin = String(f.get('sin') ?? '').trim();
    const r = await run(
      'profile',
      () =>
        api(`/api/users/${person.id}/pay-profile`, {
          method: 'PUT',
          body: { province: String(f.get('province')) || null, federalClaim: num('federal'), provincialClaim: num('provincial'), extraTaxPerPeriod: num('extra') ?? 0, cppExempt: f.get('cpp') === 'on', eiExempt: f.get('ei') === 'on', ...(sin ? { sin } : {}), ...(readAddress(f) ? { mailingAddress: readAddress(f) } : {}) },
        }),
      t('profile.saved'),
    );
    if (r !== undefined) await onSaved();
  }
  async function saveBank(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const r = await run('bank', () => api(`/api/users/${person.id}/bank-accounts`, { method: 'POST', body: { holderName: s('holder'), institution: s('institution'), transit: s('transit'), account: s('account').replace(/\s/g, ''), agree: f.get('agree') === 'on' } }), t('payroll.bankEntered'));
    if (r !== undefined) await onSaved();
  }
  return (
    <Dialog open onClose={onClose} title={person.name}>
      <div className="grid gap-6">
        <form onSubmit={(e) => void saveProfile(e)} className="grid gap-3">
          <h3 className="text-body-strong">{t('payroll.taxSetup')}</h3>
          <Field label={t('payroll.provinceOfEmployment')} hint={t('payroll.provinceHint')}>
            {(f) => (
              <Select {...f} name="province" defaultValue={p.province ?? ''}>
                <option value="">{t('payroll.fromFacility')}</option>
                {PROVINCES.map((x) => <option key={x} value={x}>{x}</option>)}
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('myPay.federalClaim')} hint={t('myPay.blankBasic')}>{(f) => <Input {...f} name="federal" type="number" min={0} step="0.01" defaultValue={p.federalClaim ?? ''} />}</Field>
            <Field label={t('myPay.provincialClaim')} hint={t('myPay.blankBasic')}>{(f) => <Input {...f} name="provincial" type="number" min={0} step="0.01" defaultValue={p.provincialClaim ?? ''} />}</Field>
          </div>
          <Field label={t('myPay.extraTax')}>{(f) => <Input {...f} name="extra" type="number" min={0} step="0.01" defaultValue={p.extraTaxPerPeriod || ''} />}</Field>
          <label className="flex items-center gap-2 text-small"><input type="checkbox" name="cpp" defaultChecked={p.cppExempt} className="h-5 w-5 accent-[rgb(var(--brand))]" />{t('payroll.cppExempt')}</label>
          <label className="flex items-center gap-2 text-small"><input type="checkbox" name="ei" defaultChecked={p.eiExempt} className="h-5 w-5 accent-[rgb(var(--brand))]" />{t('payroll.eiExempt')}</label>
          <Field label={p.sin ? t('payroll.replaceSin', { sin: p.sin }) : t('myPay.sin')}>{(f) => <Input {...f} name="sin" inputMode="numeric" maxLength={11} autoComplete="off" />}</Field>
          <fieldset className="grid gap-2 sm:col-span-2">
            <legend className="mb-1 text-small font-semibold">{t('myPay.mailingAddress')}</legend>
            <AddressFields value={p.mailingAddress} />
          </fieldset>
          <div><Button type="submit" size="sm" loading={busy === 'profile'}>{t('common.save')}</Button></div>
        </form>
        <form onSubmit={(e) => void saveBank(e)} className="grid gap-3 border-t border-line pt-5">
          <h3 className="text-body-strong">{t('payroll.enterBank')}</h3>
          <p className="text-caption text-muted">{t('payroll.enterBankHelp')}</p>
          <Field label={t('myPay.holder')}>{(f) => <Input {...f} name="holder" required maxLength={30} defaultValue={person.name} />}</Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('myPay.institution')}>{(f) => <Input {...f} name="institution" required inputMode="numeric" pattern="\d{3}" maxLength={3} />}</Field>
            <Field label={t('myPay.transit')}>{(f) => <Input {...f} name="transit" required inputMode="numeric" pattern="\d{5}" maxLength={5} />}</Field>
            <Field label={t('myPay.account')}>{(f) => <Input {...f} name="account" required inputMode="numeric" maxLength={15} />}</Field>
          </div>
          <label className="flex items-start gap-2 text-small"><input type="checkbox" name="agree" required className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" />{t('payroll.haveAuthorization')}</label>
          <div><Button type="submit" size="sm" variant="secondary" loading={busy === 'bank'}>{t('payroll.saveForVerification')}</Button></div>
        </form>
      </div>
    </Dialog>
  );
}
