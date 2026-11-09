'use client';

import { FileLock2, ShieldCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';

const CATEGORIES = ['FIRST_AID', 'RESCUE', 'EMS_CALLED', 'INJURY', 'BEHAVIOUR', 'FACILITY', 'OTHER'] as const;
const PURPOSES = ['review', 'workerComp', 'healthAuthority', 'insurance', 'legal'] as const;
interface Row { id: string; category: string; localOccurredAt: string; facility: { name: string }; timesOpened: number }
interface Full { narrative: { summary: string; peopleInvolved: string; actionsTaken: string; emsCalled: boolean; witnesses?: string } }

const localNow = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export default function IncidentsPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const { can } = useSession();
  const facilities = useQuery<Array<{ id: string; name: string }>>('/api/facilities');
  const [range] = useState(() => ({ from: new Date(Date.now() - 30 * 86_400_000).toISOString(), to: new Date(Date.now() + 86_400_000).toISOString() }));
  const list = useQuery<Row[]>(can('incidents.read') ? `/api/incidents?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` : null);
  const { run, busy } = useAction();
  const [filed, setFiled] = useState(false);
  const [opening, setOpening] = useState<Row | null>(null);
  const [purpose, setPurpose] = useState<(typeof PURPOSES)[number]>('review');
  const [report, setReport] = useState<Full | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const r = await run('file', () =>
      api('/api/incidents', {
        method: 'POST',
        body: {
          facilityId: s('facility'),
          occurredAt: new Date(s('occurredAt')).toISOString(),
          category: s('category'),
          narrative: { summary: s('summary'), peopleInvolved: s('people'), actionsTaken: s('actions'), emsCalled: f.get('ems') === 'on', witnesses: s('witnesses') || undefined },
        },
      }),
    );
    if (r) {
      setFiled(true);
      void list.reload();
    }
  }

  async function open() {
    if (!opening) return;
    const r = await run('open', () => api<Full>(`/api/incidents/${opening.id}?purpose=${encodeURIComponent(t(`incidents.purposes.${purpose}`))}`));
    if (r) setReport(r);
  }

  return (
    <>
      <PageHeader title={t('incidents.title')} description={t('incidents.description')} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Card>
          <CardHeader title={t('incidents.file')} description={t('incidents.fileHelp')} />
          <CardBody>
            {filed ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-ok-bg text-ok">
                  <ShieldCheck className="h-7 w-7" aria-hidden="true" />
                </span>
                <p className="text-subheading">{t('incidents.filed')}</p>
                <p className="max-w-sm text-small text-muted">{t('incidents.filedBody')}</p>
                <Button variant="secondary" onClick={() => setFiled(false)}>
                  {t('incidents.another')}
                </Button>
              </div>
            ) : (
              <form onSubmit={(e) => void submit(e)} className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('timeclock.facility')}>
                    {(p) => (
                      <Select {...p} name="facility" required>
                        {facilities.data?.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label={t('incidents.when')}>{(p) => <Input {...p} type="datetime-local" name="occurredAt" defaultValue={localNow()} required />}</Field>
                </div>
                <Field label={t('incidents.category')}>
                  {(p) => (
                    <Select {...p} name="category" required>
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {t(`incidents.categories.${c}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={t('incidents.summary')}>{(p) => <Textarea {...p} name="summary" required maxLength={4000} />}</Field>
                <Field label={t('incidents.people')} hint={t('incidents.peopleHint')}>{(p) => <Textarea {...p} name="people" maxLength={2000} />}</Field>
                <Field label={t('incidents.actions')}>{(p) => <Textarea {...p} name="actions" required maxLength={4000} />}</Field>
                <Field label={t('incidents.witnesses')}>{(p) => <Input {...p} name="witnesses" maxLength={500} />}</Field>
                <label className="flex items-center gap-2 text-small font-semibold">
                  <input type="checkbox" name="ems" className="h-5 w-5 accent-[rgb(var(--brand))]" />
                  {t('incidents.ems')}
                </label>
                <Button type="submit" size="lg" loading={busy === 'file'} icon={<FileLock2 className="h-5 w-5" aria-hidden="true" />}>
                  {t('incidents.submit')}
                </Button>
              </form>
            )}
          </CardBody>
        </Card>

        {can('incidents.read') ? (
          <Card>
            <CardHeader title={t('incidents.recent')} description={t('incidents.recentHelp')} />
            <CardBody className="pt-3">
              {list.loading ? (
                <Skeleton className="h-32" />
              ) : !list.data?.length ? (
                <p className="text-small text-muted">{t('incidents.none')}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {list.data.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="text-small font-semibold">{t(`incidents.categories.${r.category}`)}</p>
                        <p className="text-caption text-muted">
                          {formatDate(r.localOccurredAt, lng)} · {formatTime(r.localOccurredAt, lng)} · {r.facility.name}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusPill tone="neutral">{t('incidents.opened', { count: r.timesOpened })}</StatusPill>
                        <Button size="sm" variant="secondary" onClick={() => { setReport(null); setOpening(r); }}>
                          {t('incidents.open')}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        ) : null}
      </div>

      <Dialog
        open={opening !== null}
        onClose={() => { setOpening(null); setReport(null); void list.reload(); }}
        title={opening ? t(`incidents.categories.${opening.category}`) : ''}
        description={report ? undefined : t('incidents.purposeHelp')}
        closeLabel={t('common.close')}
      >
        {report ? (
          <dl className="grid gap-3 text-small">
            {(['summary', 'peopleInvolved', 'actionsTaken', 'witnesses'] as const).map((k) =>
              report.narrative[k] ? (
                <div key={k}>
                  <dt className="text-label uppercase text-muted">{t(`incidents.fields.${k}`)}</dt>
                  <dd className="mt-1 whitespace-pre-wrap">{report.narrative[k]}</dd>
                </div>
              ) : null,
            )}
            <div>
              <dt className="text-label uppercase text-muted">{t('incidents.ems')}</dt>
              <dd className="mt-1">{report.narrative.emsCalled ? t('incidents.yes') : t('incidents.no')}</dd>
            </div>
          </dl>
        ) : (
          <div className="grid gap-4">
            <Field label={t('incidents.purpose')}>
              {(p) => (
                <Select {...p} value={purpose} onChange={(e) => setPurpose(e.target.value as (typeof PURPOSES)[number])}>
                  {PURPOSES.map((x) => (
                    <option key={x} value={x}>
                      {t(`incidents.purposes.${x}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button loading={busy === 'open'} onClick={() => void open()}>
              {t('incidents.openLogged')}
            </Button>
          </div>
        )}
      </Dialog>
    </>
  );
}
