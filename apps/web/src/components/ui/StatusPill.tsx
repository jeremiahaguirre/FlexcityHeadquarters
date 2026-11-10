import { AlertTriangle, CheckCircle2, OctagonX, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'ok' | 'warn' | 'danger' | 'new' | 'neutral' | 'brand';

/** Neutral and brand labels (roles, kinds, plain states) get a small dot, not a hollow ring that reads as a radio button. */
const Dot = ({ className }: { className?: string }) => <span className={cn('inline-block h-1.5 w-1.5 rounded-full bg-current opacity-70', className)} />;

const tones: Record<Tone, { cls: string; Icon: typeof CheckCircle2 | typeof Dot }> = {
  ok: { cls: 'bg-ok-bg text-ok', Icon: CheckCircle2 },
  warn: { cls: 'bg-warn-bg text-warn', Icon: AlertTriangle },
  danger: { cls: 'bg-danger-bg text-danger', Icon: OctagonX },
  new: { cls: 'bg-new-bg text-new', Icon: Sparkles },
  neutral: { cls: 'bg-surface text-muted', Icon: Dot },
  brand: { cls: 'bg-brand/10 text-brand-text', Icon: Dot },
};

/** Status is always colour + icon shape + words (never colour alone). */
export function StatusPill({ tone, children, icon, className }: { tone: Tone; children: ReactNode; icon?: ReactNode; className?: string }) {
  const { cls, Icon } = tones[tone];
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-semibold', cls, className)}>
      {icon ?? (Icon === Dot ? <Dot className="shrink-0" /> : <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" strokeWidth={2.5} />)}
      <span className="truncate">{children}</span>
    </span>
  );
}
