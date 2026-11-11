'use client';

import { useEffect, useState } from 'react';
import { LogoMark, type LogoMotion } from '@/components/Logo';
import { AUTH_MOTION_EVENT, type AuthMotion } from '@/lib/authMotion';
import { cn } from '@/lib/cn';

/**
 * The sign-in screens' logo: it draws itself in, then stays gently alive; it
 * rebuilds on a loop while signing in (the same loop as the app's loading
 * screen, which follows), and gives one confident beat when sign-in succeeds.
 */
export function AuthLogo({ size = 88 }: { size?: number }) {
  const [state, setState] = useState<AuthMotion | 'start'>('start');
  useEffect(() => {
    const on = (e: Event) => setState((e as CustomEvent<AuthMotion>).detail);
    window.addEventListener(AUTH_MOTION_EVENT, on);
    return () => window.removeEventListener(AUTH_MOTION_EVENT, on);
  }, []);
  const motion: LogoMotion = state === 'start' ? 'hero' : state === 'working' ? 'loop' : state;
  return (
    <span role="img" aria-label="FlexcityHeadquarters" className="inline-flex flex-col items-center gap-2 text-center">
      <span className="relative grid place-items-center">
        <span aria-hidden="true" className="absolute h-[150%] w-[150%] rounded-full bg-[radial-gradient(closest-side,rgb(var(--brand)/0.16),transparent)]" />
        <span aria-hidden="true" className={cn('fh-halo absolute inset-0 rounded-full border border-brand/30', state === 'working' && 'fh-halo-fast')} />
        <span aria-hidden="true" className={cn('fh-halo fh-halo-2 absolute inset-0 rounded-full border border-brand/20', state === 'working' && 'fh-halo-fast')} />
        <LogoMark key={motion === 'done' ? 'done' : 'mark'} size={size} animate={motion} className="relative" />
      </span>
      <span aria-hidden="true" className="font-display leading-none">
        <span className="fh-word-1 block text-3xl font-extrabold tracking-[-0.035em] text-ink">Flexcity</span>
        <span className="fh-word-2 mt-2 block pl-[0.32em] text-xs font-semibold uppercase tracking-[0.32em] text-brand-text">Headquarters</span>
      </span>
    </span>
  );
}
