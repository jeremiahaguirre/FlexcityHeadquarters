'use client';

import { ClipboardPen, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ButtonLink } from '@/components/ui/Button';
import { formatInstant } from '@/lib/format';
import { useLiveChange } from '@/lib/useLiveChange';
import { useSession } from '@/lib/session';
import { type MySurvey, surveyToNudge } from '@/lib/surveys';
import { useQuery } from '@/lib/useQuery';

const KEY = 'fh.surveyNudge.hidden';
const readHidden = (): string[] => {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

/**
 * Today: a calm card when an open survey is waiting for this person ("A short survey from HR ·
 * closes Nov 20 · Answer"). Hidden for the rest of the session when dismissed; nothing when there
 * is none or the surveys feature is off (its permission goes with it). Live: appears when sent.
 */
export function SurveyNudge() {
  const { t, i18n } = useTranslation();
  const { can } = useSession();
  const on = can('surveys.respond');
  const q = useQuery<MySurvey[]>(on ? '/api/me/surveys' : null);
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => setHidden(readHidden()), []);
  useLiveChange('surveys', () => void (on && q.reload()));
  const s = on ? surveyToNudge(q.data, hidden) : null;
  if (!s) return null;
  const hide = () => {
    const next = [...hidden, s.id];
    setHidden(next);
    try {
      sessionStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* private window: hidden until the page reloads */
    }
  };
  return (
    <section aria-labelledby={`nudge-${s.id}`} className="flex items-start gap-3 rounded-xl2 border border-line bg-panel p-4 shadow-card">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand-text"><ClipboardPen className="h-5 w-5" aria-hidden="true" /></span>
      <div className="grid min-w-0 flex-1 gap-1">
        <p id={`nudge-${s.id}`} className="text-body-strong text-ink">{t(s.from === 'manager' ? 'today.survey.fromManager' : 'today.survey.fromHr')}</p>
        <p className="text-small text-muted [overflow-wrap:anywhere]">{s.title} · {t('today.survey.closes', { date: formatInstant(s.closesAt, i18n.language as 'en-CA', 'short') })}</p>
        <ButtonLink href={`/surveys?s=${s.id}`} size="sm" className="mt-1 justify-self-start">{t('today.survey.answer')}</ButtonLink>
      </div>
      <button type="button" onClick={hide} aria-label={t('today.survey.dismiss')} title={t('today.survey.dismiss')} className="-mr-2 -mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted hover:bg-surface hover:text-ink">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </section>
  );
}
