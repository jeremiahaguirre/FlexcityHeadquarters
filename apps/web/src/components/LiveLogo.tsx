'use client';

import { useRef, useState } from 'react';
import { Logo } from './Logo';

/**
 * The FH logo in the header: it draws itself in when the page opens, and again under the pointer
 * (data-replay marks a replay the pointer asked for). min-w-0 lets the wordmark truncate in narrow headers.
 */
export function LiveLogo(props: { variant?: 'horizontal' | 'mark'; size?: number }) {
  const [n, setN] = useState(0);
  const last = useRef(0);
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
