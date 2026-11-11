'use client';

import { AlertTriangle, CheckCircle2, Download, FileUp, Info, Upload } from 'lucide-react';
import { type ChangeEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Field';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { saveBlob } from '@/lib/api';
import { ApiError } from '@/lib/apiError';
import { type ImportIssue, type ImportPreview, papi } from '@/lib/platform';
import type { PanelProps } from './types';

const TEMPLATE = [
  'first_name,last_name,email,employment,positions,roles,hire_date,date_of_birth,employee_number,phone,language,union_member,manager',
  'Jordan,Singh,jordan.singh@example.ca,part-time,Lifeguard; Swim Instructor,staff,2024-05-01,2001-06-01,E1001,250-555-0101,en,yes,camille.roy@example.ca',
  'Camille,Roy,camille.roy@example.ca,casual,Lifeguard,,2025-06-15,,E1002,,fr,no,',
].join('\r\n');
const TONE = { create: 'ok', exists: 'neutral', error: 'warn' } as const;

export function ImportPanel({ id, city, reload }: PanelProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [invite, setInvite] = useState(true);
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);

  const issue = (i: ImportIssue) => t(`platform.import.codes.${i.code}`, { field: t(`platform.import.fields.${i.field}`, { defaultValue: i.field }), value: i.value ?? '' });

  async function check(text = csv) {
    setBusy('preview');
    try {
      setPreview(await papi<ImportPreview>(`/tenants/${id}/import/preview`, { method: 'POST', body: { csv: text } }));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('common.error'), 'warn');
    } finally {
      setBusy(null);
    }
  }

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    void f.text().then((text) => {
      setCsv(text);
      void check(text);
    });
  }

  async function commit() {
    setBusy('import');
    try {
      const r = await papi<{ created: number; invited: number }>(`/tenants/${id}/import`, { method: 'POST', body: { csv, sendInvites: invite } });
      toast(t('platform.import.done', { count: r.created }), 'ok');
      setPreview(null);
      setCsv('');
      await reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('common.error'), 'warn');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader title={t('platform.import.title')} description={t('platform.import.help', { count: city.positions.length })} />
        <CardBody className="grid gap-4 pt-3">
          <div className="flex flex-wrap gap-2">
            <input ref={file} type="file" accept=".csv,text/csv" className="sr-only" onChange={pick} aria-label={t('platform.import.choose')} />
            <Button icon={<FileUp className="h-4 w-4" aria-hidden="true" />} loading={busy === 'preview'} onClick={() => file.current?.click()}>
              {t('platform.import.choose')}
            </Button>
            <Button variant="ghost" icon={<Download className="h-4 w-4" aria-hidden="true" />} onClick={() => saveBlob(new Blob([TEMPLATE], { type: 'text/csv' }), 'fh-staff-template.csv')}>
              {t('platform.import.template')}
            </Button>
          </div>
          <details className="rounded-xl bg-surface px-4 py-3 text-small">
            <summary className="cursor-pointer font-semibold">{t('platform.import.columns')}</summary>
            <p className="mt-2 text-muted">{t('platform.import.columnsHelp')}</p>
            {city.positions.length ? <p className="mt-2 text-muted">{t('platform.import.positionsKnown', { list: city.positions.map((p) => p.name).join(', ') })}</p> : null}
          </details>
          <Textarea aria-label={t('platform.import.paste')} placeholder={t('platform.import.paste')} value={csv} onChange={(e) => setCsv(e.target.value)} className="min-h-[7rem] font-mono text-caption" />
          <Button variant="secondary" className="justify-self-start" disabled={!csv.trim()} loading={busy === 'preview'} onClick={() => void check()}>
            {t('platform.import.check')}
          </Button>
        </CardBody>
      </Card>

      {preview ? (
        <Card>
          <CardHeader title={t('platform.import.previewTitle')} />
          <CardBody className="grid gap-4 pt-3">
            {preview.missingColumns.length ? (
              <p className="flex gap-2 rounded-xl bg-warn-bg px-4 py-3 text-small text-warn">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {t('platform.import.missing', { list: preview.missingColumns.map((c) => t(`platform.import.fields.${c}`)).join(', ') })}
              </p>
            ) : null}
            {preview.unknownColumns.length ? (
              <p className="flex gap-2 text-small text-muted">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {t('platform.import.ignored', { list: preview.unknownColumns.join(', ') })}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <StatusPill tone="ok">{t('platform.import.willCreate', { count: preview.summary.create })}</StatusPill>
              <StatusPill tone="neutral">{t('platform.import.alreadyThere', { count: preview.summary.exists })}</StatusPill>
              <StatusPill tone="warn">{t('platform.import.toFix', { count: preview.summary.error })}</StatusPill>
            </div>
            <div className="max-h-[28rem] overflow-auto rounded-xl border border-line">
              <table className="w-full min-w-[40rem] text-left text-small">
                <thead className="sticky top-0 bg-surface text-caption font-semibold text-muted">
                  <tr>
                    <th className="px-3 py-2">{t('platform.import.line')}</th>
                    <th className="px-3 py-2">{t('union.name')}</th>
                    <th className="px-3 py-2">{t('login.email')}</th>
                    <th className="px-3 py-2">{t('staff.status')}</th>
                    <th className="px-3 py-2">{t('platform.import.notes')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {preview.rows.map((r) => (
                    <tr key={r.line} className="align-top">
                      <td className="px-3 py-2 tabular-nums text-muted">{r.line}</td>
                      <td className="px-3 py-2 font-semibold">
                        {r.firstName} {r.lastName}
                      </td>
                      <td className="px-3 py-2">{r.email}</td>
                      <td className="px-3 py-2">
                        <StatusPill tone={TONE[r.status]}>{t(`platform.import.status.${r.status}`)}</StatusPill>
                      </td>
                      <td className="px-3 py-2">
                        <ul className="grid gap-0.5">
                          {r.errors.map((i, k) => (
                            <li key={`e${k}`} className="text-warn">
                              {issue(i)}
                            </li>
                          ))}
                          {r.warnings.map((i, k) => (
                            <li key={`w${k}`} className="text-muted">
                              {issue(i)}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="flex items-center gap-2 text-small font-semibold">
              <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} className="h-5 w-5 accent-[rgb(var(--brand))]" />
              {t('platform.import.sendInvites')}
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                icon={<Upload className="h-4 w-4" aria-hidden="true" />}
                disabled={!preview.summary.create || preview.missingColumns.length > 0}
                loading={busy === 'import'}
                onClick={() => void commit()}
              >
                {t('platform.import.run', { count: preview.summary.create })}
              </Button>
              {preview.summary.error ? (
                <p className="text-small text-muted">{t('platform.import.skipNote')}</p>
              ) : preview.summary.create ? (
                <p className="flex items-center gap-1.5 text-small text-ok">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  {t('platform.import.allGood')}
                </p>
              ) : null}
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
