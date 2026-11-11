'use client';

import { CheckCircle2, LifeBuoy, LogOut, MapPin, MonitorSmartphone, ShieldCheck, UserRound } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { INTERVALS, type LoneSession, currentPosition, watchLocation } from '@/lib/loneWork';
import { keepAwake, wakeLockSupported } from '@/lib/device';
import { PushCard } from '@/components/device/PushCard';
import { useAction, useQuery } from '@/lib/useQuery';
import { dateFormat } from '@/lib/format';

/** Working alone: start a session, check in on a timer, or ask for help. */
export default function AlonePage() {
  const { t, i18n } = useTranslation();
  const q = useQuery<LoneSession | null>('/api/me/lone-work');
  const facilities = useQuery<Array<{ id: string; name: string }>>('/api/facilities');
  const { run, busy } = useAction();
  const [now, setNow] = useState(() => Date.now());
  const [helpOpen, setHelpOpen] = useState(false);
  const [share, setShare] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    // Pick up a monitor's "I'm on it" or a missed check-in without a reload.
    const poll = setInterval(() => void q.reload(), 30_000);
    return () => {
      clearInterval(id);
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const s = q.data;
  const sharing = !!s && s.shareLocation && s.status !== 'ENDED';
  const [locError, setLocError] = useState<'denied' | 'unavailable' | null>(null);
  const [awake, setAwake] = useState(false);
  // While sharing is on and this screen is open, send the position every 30 seconds at most.
  useEffect(() => {
    if (!sharing) return;
    setLocError(null);
    return watchLocation(
      (p) => void api('/api/me/lone-work/location', { method: 'POST', body: p }).then(() => setLocError(null)).catch(() => undefined),
      (denied) => setLocError(denied ? 'denied' : 'unavailable'),
    );
  }, [sharing]);
  // "Keep the screen on": the app stays in front, so location and the timer keep going.
  useEffect(() => {
    if (!awake || !s) return;
    let release: (() => void) | null = null;
    let gone = false;
    void keepAwake().then((r) => {
      if (gone) r?.();
      else if (!r) setAwake(false);
      else release = r;
    });
    return () => {
      gone = true;
      release?.();
    };
  }, [awake, s]);
  const time = (iso: string) => dateFormat(i18n.language, { timeStyle: 'short' }).format(new Date(iso));
  const where = () => (share ? currentPosition() : Promise.resolve(null));

  async function start(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const pos = await where();
    await run(
      'start',
      () => api('/api/me/lone-work', { method: 'POST', body: { location: String(f.get('location')), task: String(f.get('task') || '') || null, facilityId: String(f.get('facilityId') || '') || null, intervalMinutes: Number(f.get('interval')), shareLocation: share, ...pos } }),
      t('loneWork.started'),
    );
    await q.reload();
  }
  async function setSharing(on: boolean) {
    await run('share', () => api('/api/me/lone-work/share-location', { method: 'PUT', body: { on } }), on ? t('loneWork.sharingOn') : t('loneWork.sharingOff'));
    await q.reload();
  }
  async function act(path: 'check-in' | 'help' | 'end', body: object = {}, ok?: string) {
    const pos = path === 'end' ? null : await where();
    await run(path, () => api(`/api/me/lone-work/${path}`, { method: 'POST', body: { ...body, ...pos } }), ok);
    await q.reload();
  }

  if (q.data === null && q.loading) return <Skeleton className="h-96" />;

  if (!s) {
    return (
      <div className="grid gap-6">
        <PageHeader title={t('loneWork.title')} description={t('loneWork.description')} />
        <Card className="max-w-xl">
          <CardHeader title={t('loneWork.startTitle')} description={`${t('loneWork.startHelp')} ${t('loneWork.aid')}`} />
          <CardBody className="pt-2">
            <form className="grid gap-4" onSubmit={(e) => void start(e)}>
              <Field label={t('loneWork.location')} hint={t('loneWork.locationHint')}>{(p) => <Input {...p} name="location" required minLength={2} maxLength={120} />}</Field>
              <Field label={t('loneWork.task')}>{(p) => <Input {...p} name="task" maxLength={200} />}</Field>
              {facilities.data?.length ? (
                <Field label={t('loneWork.facility')}>
                  {(p) => (
                    <Select {...p} name="facilityId" defaultValue="">
                      <option value="">{t('loneWork.noFacility')}</option>
                      {facilities.data!.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </Select>
                  )}
                </Field>
              ) : null}
              <Field label={t('loneWork.interval')} hint={t('loneWork.intervalHint')}>
                {(p) => (
                  <Select {...p} name="interval" defaultValue="30">
                    {INTERVALS.map((m) => <option key={m} value={m}>{t('loneWork.every', { count: m })}</option>)}
                  </Select>
                )}
              </Field>
              <label className="flex items-start gap-3 text-small">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--brand)]" checked={share} onChange={(e) => setShare(e.target.checked)} />
                <span>{t('loneWork.share')}<span className="block text-caption text-muted">{t('loneWork.shareHint')}</span></span>
              </label>
              <Button type="submit" size="lg" loading={busy === 'start'} icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}>{t('loneWork.start')}</Button>
            </form>
          </CardBody>
        </Card>
        <div className="max-w-xl"><PushCard compact /></div>
      </div>
    );
  }

  const left = new Date(s.nextDueAt).getTime() - now;
  const late = s.status === 'OVERDUE' || s.status === 'ESCALATED' || left <= 0;
  const mm = Math.max(0, Math.floor(left / 60_000));
  const ss = Math.max(0, Math.floor((left % 60_000) / 1000));

  return (
    <div className="grid gap-6">
      <PageHeader title={t('loneWork.title')} description={s.task ? `${s.location} · ${s.task}` : s.location} />
      <Card className={`max-w-xl ${s.status === 'HELP' ? 'border-danger' : late ? 'border-warn' : ''}`}>
        <CardBody className="grid gap-5 text-center">
          {s.status === 'HELP' ? (
            <div role="alert" className="grid gap-2">
              <StatusPill tone="danger" className="justify-self-center">{t('loneWork.helpSent')}</StatusPill>
              <p className="text-body">{s.responder ? t('loneWork.responding', { name: s.responder }) : t('loneWork.helpWait')}</p>
            </div>
          ) : (
            <div aria-live="polite">
              <p className="text-caption font-semibold uppercase tracking-wide text-muted">{late ? t('loneWork.late') : t('loneWork.nextCheck')}</p>
              <p className={`mt-1 font-semibold tabular-nums ${late ? 'text-warn' : ''}`} style={{ fontSize: '3.5rem', lineHeight: 1 }}>
                {late ? t('loneWork.now') : `${mm}:${String(ss).padStart(2, '0')}`}
              </p>
              <p className="mt-2 text-small text-muted">{t('loneWork.lastCheck', { time: time(s.lastCheckInAt), count: s.intervalMinutes })}</p>
              {s.responder ? <p className="mt-2 flex items-center justify-center gap-1.5 text-small"><UserRound className="h-4 w-4" aria-hidden="true" />{t('loneWork.responding', { name: s.responder })}</p> : null}
            </div>
          )}
          <Button size="lg" block loading={busy === 'check-in'} icon={<CheckCircle2 className="h-6 w-6" aria-hidden="true" />} className="h-16 text-title" onClick={() => void act('check-in', {}, t('loneWork.checkedIn'))}>
            {t('loneWork.ok')}
          </Button>
          <Button variant="danger" size="lg" block icon={<LifeBuoy className="h-5 w-5" aria-hidden="true" />} onClick={() => setHelpOpen(true)}>
            {t('loneWork.help')}
          </Button>
          <Button variant="ghost" block loading={busy === 'end'} icon={<LogOut className="h-4 w-4" aria-hidden="true" />} onClick={() => void act('end', {}, t('loneWork.ended'))}>
            {t('loneWork.end')}
          </Button>
          <p className="text-caption text-muted">{t('loneWork.emergency')}</p>
        </CardBody>
      </Card>
      <Card className="max-w-xl">
        <CardBody className="grid gap-4">
          <label className="flex items-start gap-3 text-small">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--brand)]" checked={s.shareLocation} disabled={busy === 'share'} onChange={(e) => void setSharing(e.target.checked)} />
            <span>
              <span className="flex items-center gap-1.5 font-semibold"><MapPin className="h-4 w-4" aria-hidden="true" />{t('loneWork.liveShare')}</span>
              <span className="block text-caption text-muted">{s.shareLocation && s.locationAt ? t('loneWork.liveUpdated', { time: time(s.locationAt) }) : t('loneWork.liveHint')}</span>
            </span>
          </label>
          {sharing && locError ? <p className="rounded-xl bg-warn-bg px-4 py-3 text-small text-warn">{locError === 'denied' ? t('loneWork.locDenied') : t('loneWork.locUnavailable')}</p> : null}
          {wakeLockSupported() ? (
            <label className="flex items-start gap-3 text-small">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--brand)]" checked={awake} onChange={(e) => setAwake(e.target.checked)} />
              <span>
                <span className="flex items-center gap-1.5 font-semibold"><MonitorSmartphone className="h-4 w-4" aria-hidden="true" />{t('loneWork.keepAwake')}</span>
                <span className="block text-caption text-muted">{t('loneWork.keepAwakeHint')}</span>
              </span>
            </label>
          ) : null}
          <p className="text-caption text-muted">{t('loneWork.backgroundNote')}</p>
        </CardBody>
      </Card>
      <div className="max-w-xl"><PushCard compact /></div>
      <Dialog open={helpOpen} onClose={() => setHelpOpen(false)} title={t('loneWork.helpTitle')} description={t('loneWork.helpHelp')} closeLabel={t('common.cancel')}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const note = String(new FormData(e.currentTarget).get('note') || '') || null;
            setHelpOpen(false);
            void act('help', { note }, t('loneWork.helpSent'));
          }}
        >
          <Field label={t('loneWork.helpNote')}>{(p) => <Textarea {...p} name="note" maxLength={300} rows={2} />}</Field>
          <Button type="submit" variant="danger" size="lg" block loading={busy === 'help'} icon={<LifeBuoy className="h-5 w-5" aria-hidden="true" />}>{t('loneWork.helpSend')}</Button>
        </form>
      </Dialog>
    </div>
  );
}
