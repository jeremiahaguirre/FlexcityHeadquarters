'use client';

import { type CSSProperties, type RefObject, useEffect, useState } from 'react';

/**
 * For a row that scrolls sideways: fades the edge that has more content, so a cut-off item reads
 * as "more this way" rather than as clipped. Returns the style to put on the scrolling element.
 */
export function useScrollFade(ref: RefObject<HTMLElement | null>, width = '2rem', { endOnly = false }: { /** A sticky first column must not fade. */ endOnly?: boolean } = {}): CSSProperties | undefined {
  const [edges, setEdges] = useState({ start: false, end: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setEdges({ start: el.scrollLeft > 2, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [ref]);
  const start = edges.start && !endOnly;
  if (!start && !edges.end) return undefined;
  const fade = `linear-gradient(to right, ${start ? `transparent, #000 ${width}` : '#000'}, ${edges.end ? `#000 calc(100% - ${width}), transparent` : '#000'})`;
  return { WebkitMaskImage: fade, maskImage: fade };
}
