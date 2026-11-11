'use client';

import { useRef, useState } from 'react';
import { Logo } from './Logo';

/** The FH logo in the app's header: it draws itself in when the app opens, and again under the pointer. */
export function LiveLogo(props: { variant?: 'horizontal' | 'mark'; size?: number }) {
  const [n, setN] = useState(0);
  const last = useRef(0);
  return (
    <span
      className="inline-flex"
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
