'use client';

import { useTranslation } from 'react-i18next';
import { Field, Input, Select } from '@/components/ui/Field';
import { PROVINCES } from '@/lib/regions';

export interface MailingAddress { line1: string; line2?: string | null; city: string; province: string; postalCode: string }

/** Mailing address inputs, named `${prefix}line1` etc. Read back with readAddress. */
export function AddressFields({ prefix = 'addr_', value, disabled }: { prefix?: string; value?: MailingAddress | null; disabled?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="grid items-end gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2"><Field label={t('address.line1')}>{(p) => <Input {...p} name={`${prefix}line1`} defaultValue={value?.line1 ?? ''} autoComplete="address-line1" maxLength={60} disabled={disabled} />}</Field></div>
      <div className="sm:col-span-2"><Field label={t('address.line2')}>{(p) => <Input {...p} name={`${prefix}line2`} defaultValue={value?.line2 ?? ''} autoComplete="address-line2" maxLength={60} disabled={disabled} />}</Field></div>
      <Field label={t('address.city')}>{(p) => <Input {...p} name={`${prefix}city`} defaultValue={value?.city ?? ''} autoComplete="address-level2" maxLength={40} disabled={disabled} />}</Field>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] items-end gap-3">
        <Field label={t('address.province')}>
          {(p) => (
            <Select {...p} name={`${prefix}province`} defaultValue={value?.province ?? ''} disabled={disabled}>
              <option value="" />
              {PROVINCES.map((x) => <option key={x} value={x}>{x}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('address.postalCode')}>{(p) => <Input {...p} name={`${prefix}postalCode`} defaultValue={value?.postalCode ?? ''} autoComplete="postal-code" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={7} disabled={disabled} />}</Field>
      </div>
    </div>
  );
}

/** The address from a form, or undefined when left blank (so saving other fields keeps the one on file). */
export function readAddress(f: FormData, prefix = 'addr_'): MailingAddress | undefined {
  const v = (k: string) => String(f.get(`${prefix}${k}`) ?? '').trim();
  if (!v('line1') && !v('city') && !v('postalCode')) return undefined;
  return { line1: v('line1'), line2: v('line2') || null, city: v('city'), province: v('province'), postalCode: v('postalCode') };
}
