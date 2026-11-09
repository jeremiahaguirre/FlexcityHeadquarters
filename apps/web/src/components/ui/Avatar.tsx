import { cn } from '@/lib/cn';

const SHADES = ['bg-brand/15 text-brand-text', 'bg-new-bg text-new', 'bg-ok-bg text-ok', 'bg-surface text-ink'];

export function Avatar({ name, size = 'md', className }: { name: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  const shade = SHADES[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % SHADES.length];
  const dims = { sm: 'h-8 w-8 text-caption', md: 'h-10 w-10 text-small', lg: 'h-14 w-14 text-subheading' }[size];
  return (
    <span aria-hidden="true" className={cn('inline-grid shrink-0 place-items-center rounded-full font-bold', dims, shade, className)}>
      {initials}
    </span>
  );
}
