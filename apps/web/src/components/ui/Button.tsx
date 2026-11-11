'use client';

import Link from 'next/link';
import { type ButtonHTMLAttributes, type ComponentProps, type ReactNode, forwardRef } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-[background-color,border-color,color,transform,box-shadow] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100';
const variants: Record<Variant, string> = {
  primary: 'bg-brand text-brand-contrast shadow-card hover:bg-brand-hover',
  secondary: 'border border-line bg-panel text-ink hover:bg-surface',
  ghost: 'text-ink hover:bg-surface',
  danger: 'bg-danger text-white hover:bg-danger/90 dark:text-page',
};
// Touch targets: md and lg are at least 44px tall (FH Typography doc).
const sizes: Record<Size, string> = {
  sm: 'h-11 px-3 text-small sm:h-9',
  md: 'h-11 px-4 text-body-strong',
  lg: 'h-[3.25rem] px-5 text-body-strong',
};

/**
 * Classes from the caller win over the defaults they replace: cn() only joins class names, and in
 * the stylesheet "whitespace-nowrap" and "h-11" would otherwise beat "whitespace-normal" and "h-auto"
 * (a button whose label may wrap on a phone).
 */
function withOverrides(defaults: string, className?: string): string {
  if (!className) return defaults;
  let out = defaults;
  if (/(^|\s)whitespace-normal(\s|$)/.test(className)) out = out.replace(/(^|\s)whitespace-nowrap(?=\s|$)/g, '');
  if (/(^|\s)h-auto(\s|$)/.test(className)) out = out.replace(/(^|\s)(sm:)?h-(\d+|\[[^\]]+\])(?=\s|$)/g, '');
  return cn(out, className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={withOverrides(cn(base, variants[variant], sizes[size], block && 'w-full'), className)}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4" /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  icon,
  block,
  className,
  children,
  ...rest
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size; icon?: ReactNode; block?: boolean }) {
  return (
    <Link className={withOverrides(cn(base, variants[variant], sizes[size], block && 'w-full'), className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
