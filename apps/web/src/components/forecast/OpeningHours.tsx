'use client';

import { Clock, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import { dateFormat } from '@/lib/format';

export interface Block { dayOfWeek: number; opensMinute: number; closesMinute: number; minGuards: number }
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const toTime = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMinute = (v: string) => {
  const [h, m] = v.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * A facility's opening hours by weekday (several blocks a day for split hours) and the fewest
 * lifeguards on deck while open. The forecast needs no one while closed, and never fewer than
 * the minimum while open.
 */
export function OpeningHours({ facilityId, onSaved }: { facilityId: string; onSaved: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setBlocks(null);
    api<Block[]>(`/api/facilities/${facilityId}/hours`).then(setBlocks, () => setBlocks([]));
  }, [facilityId]);
  const dayName = (dow: number) => dateFormat(i18n.language, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + dow)));
  const edit = (i: number, patch: Partial<Block>) => setBlocks((b) => b!.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const invalid = !!blocks?.some((b) => b.closesMinute <= b.opensMinute);
  const save = async () => {
    if (!blocks) return;
    setSaving(true);
    try {
      await api(`/api/facilities/${facilityId}/hours`, { method: 'PUT', body: { blocks } });
      toast(t('forecast.hours.saved'), 'ok');
      onSaved();
    } catch {
      toast(t('forecast.hours.failed'), 'warn');
    } finally {
      setSaving(false);
    }
  };
  const summary = !blocks ? '' : blocks.length ? t('forecast.hours.summary', { count: new Set(blocks.map((b) => b.dayOfWeek)).size }) : t('forecast.hours.none');

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Clock className="h-5 w-5 text-brand-text" aria-hidden="true" />{t('forecast.hours.title')}</span>}
        description={summary}
        action={<Button size="sm" variant="secondary" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? t('forecast.hours.close') : t('forecast.hours.edit')}</Button>}
      />
      {open && blocks ? (
        <CardBody className="grid gap-4">
          <p className="text-small text-muted">{t('forecast.hours.help')}</p>
          <ul className="grid gap-3">
            {WEEK.map((dow) => {
              const mine = blocks.map((b, i) => ({ b, i })).filter((x) => x.b.dayOfWeek === dow);
              return (
                <li key={dow} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-start">
                  <p className="pt-2 font-semibold capitalize">{dayName(dow)}</p>
                  <div className="grid gap-2">
                    {!mine.length ? <p className="pt-2 text-small text-muted">{t('forecast.hours.closed')}</p> : null}
                    {mine.map(({ b, i }) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <div className="w-36"><Input type="time" aria-label={t('forecast.hours.opens', { day: dayName(dow) })} value={toTime(b.opensMinute)} onChange={(e) => edit(i, { opensMinute: toMinute(e.target.value) })} /></div>
                        <span aria-hidden="true">–</span>
                        <div className="w-36"><Input type="time" aria-label={t('forecast.hours.closes', { day: dayName(dow) })} value={toTime(b.closesMinute === 1440 ? 1439 : b.closesMinute)} onChange={(e) => edit(i, { closesMinute: toMinute(e.target.value) })} aria-invalid={b.closesMinute <= b.opensMinute || undefined} /></div>
                        <label className="flex items-center gap-2 text-small">
                          <span className="w-20"><Input type="number" min={0} max={50} value={b.minGuards} onChange={(e) => edit(i, { minGuards: Math.max(0, Math.min(50, Number(e.target.value) || 0)) })} /></span>
                          <span className="whitespace-nowrap">{t('forecast.hours.minGuards')}</span>
                        </label>
                        <Button size="sm" variant="ghost" aria-label={t('forecast.hours.remove', { day: dayName(dow) })} icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={() => setBlocks((x) => x!.filter((_, j) => j !== i))} />
                      </div>
                    ))}
                    <Button size="sm" variant="ghost" className="justify-self-start" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setBlocks((x) => [...x!, { dayOfWeek: dow, opensMinute: mine.length ? Math.min(1380, mine[mine.length - 1]!.b.closesMinute + 60) : 360, closesMinute: mine.length ? Math.min(1440, mine[mine.length - 1]!.b.closesMinute + 180) : 1260, minGuards: mine[0]?.b.minGuards ?? 1 }])}>
                      {mine.length ? t('forecast.hours.addBlock') : t('forecast.hours.open')}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          {invalid ? <p role="alert" className="text-small font-semibold text-danger">{t('forecast.hours.invalid')}</p> : null}
          <Button className="justify-self-start" loading={saving} disabled={invalid} onClick={() => void save()}>{t('forecast.hours.save')}</Button>
        </CardBody>
      ) : null}
    </Card>
  );
}
