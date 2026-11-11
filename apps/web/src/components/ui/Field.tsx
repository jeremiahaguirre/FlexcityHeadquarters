'use client';

import { AlertCircle } from 'lucide-react';
import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, forwardRef, useId } from 'react';
import { cn } from '@/lib/cn';

const control =
  'block w-full rounded-xl border border-field bg-panel px-3.5 text-body text-ink placeholder:text-muted transition-colors hover:border-ink/50 disabled:border-line disabled:bg-surface aria-[invalid=true]:border-warn';

/**
 * Label above, optional hint, error below with an icon. Inputs are 16px so phones
 * don't zoom in, and at least 44px tall.
 */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <label htmlFor={id} className="text-small font-semibold text-ink">
        {label}
      </label>
      {children({ id, 'aria-describedby': [hintId, errId].filter(Boolean).join(' ') || undefined, 'aria-invalid': error ? true : undefined })}
      {hint && !error ? (
        <p id={hintId} className="text-small text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errId} className="flex items-start gap-1.5 text-small text-warn">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Phone keyboards: sensible defaults from the field's type, which any prop overrides.
 * Email, web addresses, passwords and codes never get auto-capitals or autocorrect;
 * numbers get the number pad (with a decimal point when the step allows one, and
 * the full keyboard when negatives are allowed, since iPhone's pad has no minus key).
 */
function keyboardFor(p: InputHTMLAttributes<HTMLInputElement>): InputHTMLAttributes<HTMLInputElement> {
  const plain = { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } as const;
  switch (p.type) {
    case 'email':
      return { ...plain, inputMode: 'email' };
    case 'url':
      return { ...plain, inputMode: 'url' };
    case 'password':
      return plain;
    case 'tel':
      return { inputMode: 'tel' };
    case 'search':
      return { enterKeyHint: 'search', autoCorrect: 'off' };
    case 'number': {
      const min = p.min === undefined || p.min === '' ? undefined : Number(p.min);
      if (min === undefined || min < 0) return {};
      const step = p.step === undefined ? 1 : Number(p.step);
      return { inputMode: Number.isInteger(step) && step > 0 ? 'numeric' : 'decimal' };
    }
    default:
      // A field that only takes digits (bank transit, institution, a verification code) gets the number pad.
      if (typeof p.pattern === 'string' && /^(\\d|\[0-9\])(\{[\d,]+\}|[+*])?$/.test(p.pattern)) return { ...plainCode, inputMode: 'numeric' };
      return {};
  }
}
const plainCode = { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } as const;

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(control, 'h-11', className)} {...keyboardFor(rest)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...rest }, ref) {
  return <select ref={ref} className={cn(control, 'h-11 pr-9', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(control, 'min-h-[6rem] py-2.5', className)} {...rest} />;
});
