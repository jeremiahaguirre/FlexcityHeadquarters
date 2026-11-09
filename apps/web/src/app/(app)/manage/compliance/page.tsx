'use client';

import { AlertTriangle, CheckCircle2, FileSearch, Printer } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill } from '@/components/ui/StatusPill';
import { ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';

interface Snapshot {
  facility: { id: string; name: string; province: string };
  at: string;
  localAt: string;
  rotationLogged: boolean;
  people: Array<{ userId: string; name: string; position: string | null; scheduled: boolean; clockedIn: boolean; clockedInAt: string | null; locationStatus: string | null; station: string | null | undefined; certifications: Array<{ name: string; status: string }> }>;
  pools: Array<{ id: string; name: string; headcount: { count: number; at: string; maxCapacity: number | null; overCapacity: boolean } | null; lifeguardsRequired: number | null; lifeguardsOnStation: number | null; chemistry: { at: string; freeChlorinePpm: string | null; ph: string | null; outOfRange: boolean; signedOff: boolean } | null; closure: { reason: string; since: string; confirmed: boolean } | null }>;
  incidents: Array<{ id: string; category: string; at: string }>;
  issues: Array<{ code: string; detail: string }>;
}

const localInput = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const hm = (local: string) => local.slice(11, 16);

/** Compliance at any minute: rebuild the deck as it was, for an inspector, insurer or inquiry. */
export default function CompliancePage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const facilities = useQuery<Array<{ id: string; name: string }>>('/api/facilities');
  const [facilityId, setFacilityId] = useState('');
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!facilityId && facilities.data?.[0]) setFacilityId(facilities.data[0].id);
  }, [facilities.data, facilityId]);

  async function load(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const at = new Date(String(f.get('at'))).toISOString();
      setSnap(await api<Snapshot>(`/api/compliance/snapshot?facilityId=${facilityId}&at=${encodeURIComponent(at)}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }
  const certTone = (s: string) => (s === 'VALID' ? 'ok' : s === 'UNVERIFIED' ? 'warn' : 'danger');

  return (
    <div className="grid gap-6">
      <PageHeader title={t('compliance.title')} description={t('compliance.description')} />
      <Card className="print:hidden">
        <CardBody>
          <form onSubmit={(e) => void load(e)} className="grid items-end gap-4 sm:grid-cols-[1fr_1fr_auto]">
            <Field label={t('timeclock.facility')}>
              {(p) => (
                <Select {...p} value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
                  {facilities.data?.map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('compliance.at')} hint={t('compliance.atHint')}>{(p) => <Input {...p} name="at" type="datetime-local" required defaultValue={localInput()} max={localInput()} />}</Field>
            <Button type="submit" loading={busy} icon={<FileSearch className="h-4 w-4" aria-hidden="true" />}>{t('compliance.build')}</Button>
          </form>
          {error ? <p className="mt-3 text-small text-danger">{error}</p> : null}
        </CardBody>
      </Card>

      {!snap ? (
        <EmptyState icon={FileSearch} title={t('compliance.pick')}>{t('compliance.pickHelp')}</EmptyState>
      ) : (
        <div className="grid gap-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-label uppercase text-muted">{snap.facility.name} · {snap.facility.province}</p>
              <h2 className="text-title">{formatDate(snap.localAt, lng, 'long')}, {hm(snap.localAt)}</h2>
            </div>
            <Button variant="secondary" icon={<Printer className="h-4 w-4" aria-hidden="true" />} onClick={() => window.print()} className="print:hidden">{t('compliance.print')}</Button>
          </div>

          {snap.issues.length ? (
            <Card className="border-warn/50">
              <CardHeader title={t('compliance.issues', { count: snap.issues.length })} />
              <CardBody className="pt-2">
                <ul className="grid gap-1.5 text-small">
                  {snap.issues.map((i) => (
                    <li key={`${i.code}${i.detail}`} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />{t(`compliance.issue.${i.code}`, { detail: i.detail })}</li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : (
            <p className="flex items-center gap-2 rounded-2xl bg-ok-bg px-4 py-3 text-small text-ok"><CheckCircle2 className="h-5 w-5" aria-hidden="true" />{t('compliance.noIssues')}</p>
          )}

          <Card>
            <CardHeader title={t('compliance.people', { count: snap.people.length })} description={snap.rotationLogged ? undefined : t('compliance.noRotation')} />
            <CardBody className="overflow-x-auto pt-2">
              {!snap.people.length ? (
                <p className="text-small text-muted">{t('compliance.nobody')}</p>
              ) : (
                <table className="w-full min-w-[40rem] text-left text-small">
                  <thead className="text-label uppercase text-muted">
                    <tr><th className="py-2">{t('compliance.person')}</th><th>{t('compliance.station')}</th><th>{t('compliance.clock')}</th><th>{t('compliance.certs')}</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {snap.people.map((p) => (
                      <tr key={p.userId} className="align-top">
                        <td className="py-2.5"><span className="font-semibold">{p.name}</span><span className="block text-caption text-muted">{p.position ?? '—'}</span></td>
                        <td className="py-2.5">{p.station ?? (p.station === null ? t('compliance.offChair') : '—')}</td>
                        <td className="py-2.5">{p.clockedIn ? t('compliance.inSince', { time: hm(p.clockedInAt!) }) : <StatusPill tone="danger">{t('compliance.notClockedIn')}</StatusPill>}</td>
                        <td className="py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {p.certifications.length ? p.certifications.map((c) => <StatusPill key={c.name} tone={certTone(c.status)}>{c.name}: {t(`compliance.cert.${c.status}`)}</StatusPill>) : <span className="text-muted">{t('compliance.noneRequired')}</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            {snap.pools.map((p) => (
              <Card key={p.id}>
                <CardHeader title={p.name} />
                <CardBody className="grid gap-2 pt-2 text-small">
                  <p>{p.headcount ? t('compliance.bathers', { count: p.headcount.count, max: p.headcount.maxCapacity ?? '—', time: hm(p.headcount.at) }) : t('compliance.noHeadcount')}</p>
                  {p.lifeguardsRequired !== null ? (
                    <p className={p.lifeguardsOnStation !== null && p.lifeguardsOnStation < p.lifeguardsRequired ? 'font-semibold text-danger' : ''}>
                      {p.lifeguardsOnStation !== null ? t('compliance.guards', { on: p.lifeguardsOnStation, need: p.lifeguardsRequired }) : t('compliance.guardsNeeded', { need: p.lifeguardsRequired })}
                    </p>
                  ) : null}
                  <p className={p.chemistry?.outOfRange ? 'font-semibold text-danger' : ''}>
                    {p.chemistry ? t('compliance.chem', { time: hm(p.chemistry.at), fc: p.chemistry.freeChlorinePpm ?? '—', ph: p.chemistry.ph ?? '—' }) : t('compliance.noChem')}
                    {p.chemistry?.outOfRange ? ` · ${t('compliance.outOfRange')}` : ''}
                  </p>
                  {p.closure ? <p className="text-warn">{t(p.closure.confirmed ? 'compliance.closed' : 'compliance.closureRecommended', { reason: p.closure.reason, time: hm(p.closure.since) })}</p> : null}
                </CardBody>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader title={t('compliance.incidents')} description={t('compliance.incidentsHelp')} />
            <CardBody className="pt-2 text-small">
              {snap.incidents.length ? (
                <ul className="grid gap-1">{snap.incidents.map((i) => <li key={i.id}>{hm(i.at)} · {t(`incidents.categories.${i.category}`, { defaultValue: i.category })}</li>)}</ul>
              ) : (
                <p className="text-muted">{t('compliance.noIncidents')}</p>
              )}
            </CardBody>
          </Card>
          <p className="text-caption text-muted">{t('compliance.footer')}</p>
        </div>
      )}
    </div>
  );
}
