'use client';

/**
 * The quick "new shift" sheet a drop on an empty day (or the timeline) opens: date, times,
 * position and facility prefilled from the person's availability and the department's usual
 * shifts. The API re-checks each person; a refusal is shown here with its reasons, and overtime
 * asks for confirmation before anything is kept.
 */
import { AlertTriangle } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select } from '@/components/ui/Field';
import { ApiError } from '@/lib/api';
import { type Board, hhmm, plusDays } from '@/lib/planner';
import { zonedToInstant } from '@/lib/tz';
import { reasonsFromError } from './text';

export interface Draft { date: string; start: number; end: number; positionId: string; facilityId: string; userIds: string[] }
export interface CreateRequest { facilityId: string; positionId: string; startsAt: string; endsAt: string; userIds: string[]; shiftType?: string; customTitle?: string | null }

export function QuickCreate({ draft, board, onClose, onCreate }: { draft: Draft | null; board: Board; onClose: () => void; onCreate: (body: CreateRequest, ack: boolean) => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [problem, setProblem] = useState<{ kind: 'overtime'; hours: string } | { kind: 'refused'; text: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState<CreateRequest | null>(null);
  useEffect(() => {
    setProblem(null);
    setBody(null);
  }, [draft]);
  if (!draft) return <Dialog open={false} onClose={onClose} title="" closeLabel={t('common.close')} />;
  const names = draft.userIds.map((id) => board.people.find((p) => p.id === id)?.name ?? '').filter(Boolean);
  const posName = (p: { name: string; nameFr: string | null }) => (lng === 'fr-CA' && p.nameFr ? p.nameFr : p.name);

  async function send(b: CreateRequest, ack: boolean) {
    setBusy(true);
    setBody(b);
    try {
      await onCreate(b, ack);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OVERTIME_REQUIRES_ACK') setProblem({ kind: 'overtime', hours: String((e.details as { overtimeHours?: string })?.overtimeHours ?? '') });
      else setProblem({ kind: 'refused', text: reasonsFromError(t, lng, e) });
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const facility = board.facilities.find((x) => x.id === f.get('facility')) ?? board.facilities[0]!;
    const date = String(f.get('date'));
    const start = zonedToInstant(date, String(f.get('start')), facility.timezone);
    let end = zonedToInstant(date, String(f.get('end')), facility.timezone);
    if (end <= start) end = zonedToInstant(plusDays(date, 1), String(f.get('end')), facility.timezone);
    void send({ facilityId: facility.id, positionId: String(f.get('position')), startsAt: start.toISOString(), endsAt: end.toISOString(), userIds: draft!.userIds }, false);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={names.length ? t('planner.quick.titleFor', { names: names.join(', ') }) : t('builder.addShift')}
      description={t('planner.quick.help', { zone: board.facilities[0]?.timezone ?? '' })}
      closeLabel={t('common.close')}
    >
      <form onSubmit={submit} className="grid gap-4">
        <Field label={t('timeOff.date')}>{(p) => <Input {...p} type="date" name="date" defaultValue={draft.date} required />}</Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('timeOff.startTime')}>{(p) => <Input {...p} type="time" step={900} name="start" defaultValue={hhmm(draft.start)} required />}</Field>
          <Field label={t('timeOff.endTime')}>{(p) => <Input {...p} type="time" step={900} name="end" defaultValue={hhmm(draft.end)} required />}</Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('builder.position')}>
            {(p) => (
              <Select {...p} name="position" defaultValue={draft.positionId} required>
                {board.positions.map((x) => (
                  <option key={x.id} value={x.id}>
                    {posName(x)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('timeclock.facility')}>
            {(p) => (
              <Select {...p} name="facility" defaultValue={draft.facilityId} required>
                {board.facilities.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {names.length > 1 ? <p className="text-small text-muted">{t('planner.quick.onePerPerson', { count: names.length })}</p> : null}
        {problem?.kind === 'refused' ? (
          <div role="alert" className="flex gap-2 rounded-xl bg-danger-bg p-3 text-small text-ink">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
            <div>
              <p className="font-semibold">{t('planner.refused')}</p>
              <ul className="mt-1 list-disc pl-4">
                {problem.text.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
        {problem?.kind === 'overtime' ? (
          <div role="alert" className="rounded-xl bg-warn-bg p-3 text-small text-ink">
            <p>{t('builder.overtimeAsk', { hours: problem.hours })}</p>
            <div className="mt-2 flex justify-end">
              <Button size="sm" loading={busy} onClick={() => body && void send(body, true)}>
                {t('builder.assignWithOvertime')}
              </Button>
            </div>
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={busy && problem?.kind !== 'overtime'}>
            {names.length ? t('planner.quick.create') : t('builder.addAsDraft')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

