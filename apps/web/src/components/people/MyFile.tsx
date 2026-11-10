'use client';

import { CountUp } from '@/components/ui/CountUp';
import { Award, Info, MessageSquareWarning } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Textarea } from '@/components/ui/Field';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { type CaseFile, dayOf } from '@/lib/people';
import { useAction, useQuery } from '@/lib/useQuery';
import { RecordRow, scoreTone } from './CaseFilePanel';

/** The employee's own file: the same facts a manager sees, how it's used, and their right to respond. */
export function MyFile() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const file = useQuery<CaseFile>('/api/me/case-file');
  const { run, busy } = useAction();
  const [responding, setResponding] = useState<string | null>(null);
  const [howOpen, setHowOpen] = useState(false);
  const f = file.data;
  if (!f) return null;
  const date = (iso: string) => formatDate(dayOf(iso), lng, 'dated');

  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title={t('people.myFile')}
        description={t('people.myFileHelp')}
        action={
          <Button size="sm" variant="ghost" icon={<Info className="h-4 w-4" aria-hidden="true" />} onClick={() => setHowOpen(true)}>
            {t('people.howItWorks')}
          </Button>
        }
      />
      <CardBody className="grid gap-6 pt-3 lg:grid-cols-[14rem_1fr]">
        <div>
          <p className="text-label uppercase text-muted">{t('profile.reliability')}</p>
          <div className="mt-1 flex items-end gap-2">
            <p className="text-stat tabular-nums"><CountUp value={f.score} format={String} /></p>
            <StatusPill tone={scoreTone(f.score)} className="mb-2">
              {t('profile.outOf100')}
            </StatusPill>
          </div>
          <p className="mt-2 text-caption text-muted">{t('profile.reliabilityHelp')}</p>
        </div>
        <div className="grid min-w-0 gap-5">
          <section>
            <h3 className="mb-2 text-small font-semibold">{t('people.attendance')}</h3>
            {f.events.length ? (
              <ul className="grid gap-1.5 text-small">
                {f.events.map((e) => (
                  <li key={e.id} className={`flex justify-between gap-3 ${e.counted ? '' : 'text-muted'}`}>
                    <span className="min-w-0">
                      {t(`profile.events.${e.type}`)} · <span className="text-muted">{date(e.occurredAt)}</span>
                      {e.note ? <span className="block text-caption text-muted">{e.note}</span> : null}
                      {e.excludedReason ? <span className="block text-caption">{t('people.excusedBecause', { reason: e.excludedReason })}</span> : null}
                    </span>
                    {e.counted ? <span className={`tabular-nums font-semibold ${e.points < 0 ? 'text-warn' : 'text-ok'}`}>{e.points > 0 ? `+${e.points}` : e.points}</span> : <StatusPill tone="neutral">{t('people.excused')}</StatusPill>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-small text-muted">{t('profile.noEvents')}</p>
            )}
          </section>
          {f.notes.length ? (
            <section>
              <h3 className="mb-2 text-small font-semibold">{t('people.notes')}</h3>
              <ul className="grid gap-2 text-small">
                {f.notes.map((n) => (
                  <li key={n.id} className={`flex gap-2 rounded-xl bg-surface px-3 py-2 ${n.retractedAt ? 'opacity-70' : ''}`}>
                    {n.category === 'COMMENDATION' ? <Award className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" /> : <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />}
                    <span className="min-w-0">
                      <span className="font-semibold">{t(`people.category.${n.category}`)}</span> · <span className="text-muted">{date(n.occurredAt)} · {n.recordedBy}</span>
                      <span className="block whitespace-pre-wrap">{n.summary}</span>
                      {n.retractedReason ? <span className="block text-caption text-muted">{t('people.retractedBecause', { reason: n.retractedReason })}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {f.records.length ? (
            <section>
              <h3 className="mb-2 text-small font-semibold">{t('staff.records')}</h3>
              <ul className="grid gap-2">
                {f.records.map((r) => (
                  <li key={r.id} className="grid gap-1">
                    <RecordRow r={r} />
                    {!r.employeeResponse ? (
                      <button type="button" className="justify-self-end text-caption font-semibold text-brand-text hover:underline" onClick={() => setResponding(r.id)}>
                        {t('people.addResponse')}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </CardBody>

      <Dialog open={!!responding} onClose={() => setResponding(null)} title={t('people.addResponse')} description={t('people.addResponseHelp')} closeLabel={t('common.close')}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const response = String(new FormData(e.currentTarget).get('response'));
            void run('resp', () => api(`/api/me/discipline/${responding}/response`, { method: 'POST', body: { response } }), t('people.responseSaved')).then((ok) => {
              if (ok !== undefined) {
                setResponding(null);
                void file.reload();
              }
            });
          }}
        >
          <Field label={t('people.yourResponse')}>{(p) => <Textarea {...p} name="response" required minLength={3} maxLength={4000} className="min-h-[10rem]" />}</Field>
          <Button type="submit" loading={busy === 'resp'}>{t('people.saveResponse')}</Button>
        </form>
      </Dialog>

      <Dialog open={howOpen} onClose={() => setHowOpen(false)} title={t('people.howItWorks')} closeLabel={t('common.close')}>
        <ul className="grid list-disc gap-2 pl-5 text-small">
          {(t('people.how', { returnObjects: true }) as string[]).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Dialog>
    </Card>
  );
}
