'use client';

import { useEffect, useRef, useState } from 'react';
import { LOGO_SEEN_KEY } from '@/lib/colorScheme';
import { Logo } from './Logo';

/**
 * The FH logo in the app's header: it draws itself in the first time the app opens in a session,
 * and again under the pointer. min-w-0 lets the wordmark truncate inside narrow headers.
 */
export function LiveLogo(props: { variant?: 'horizontal' | 'mark'; size?: number }) {
  const [n, setN] = useState(0);
  const last = useRef(0);
  useEffect(() => {
    try {
      sessionStorage.setItem(LOGO_SEEN_KEY, '1');
    } catch {
      /* storage off: it simply draws in on every load */
    }
  }, []);
  return (
    <span
      className="fh-live inline-flex min-w-0"
      data-replay={n ? '' : undefined}
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse' || Date.now() - last.current < 2200) return;
        last.current = Date.now();
        setN((x) => x + 1);
      }}
    >
      <Logo key={n} {...props} animate="intro" />
    </span>
  );
}
