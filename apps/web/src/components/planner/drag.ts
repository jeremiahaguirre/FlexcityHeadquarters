'use client';

/**
 * Pointer-based drag and drop for the planner (mouse and pen; touch uses tap-to-assign instead).
 * No library: one window listener per drag, the ghost moves through a ref (no re-renders), and
 * targets are found with elementFromPoint and `data-drop` attributes:
 *   shift|<id>            a shift card or bar
 *   day|<date>|<rowKey>   an empty part of a day (row optional)
 *   time|<date>|<rowKey>  the day view's timeline (minute from the pointer, `data-axis` JSON)
 *   panel                 the people panel (drop a shift here to unassign)
 */
import { useCallback, useEffect, useRef } from 'react';
import { type Axis, type BoardShift, xToMinutes } from '@/lib/planner';

export type DragItem = { kind: 'people'; ids: string[]; label: string } | { kind: 'shift'; shift: BoardShift; mode: 'move' | 'start' | 'end'; label: string };
export type Target = { kind: 'shift'; id: string } | { kind: 'day'; date: string; row: string | null } | { kind: 'time'; date: string; row: string; minute: number } | { kind: 'panel' };
export interface PointerInfo { alt: boolean; dx: number; dy: number }

export function parseTarget(el: Element | null, x: number): Target | null {
  const t = el?.closest<HTMLElement>('[data-drop]');
  if (!t) return null;
  const v = t.dataset.drop!;
  if (v === 'panel') return { kind: 'panel' };
  const [kind, a = '', b = ''] = v.split('|');
  if (kind === 'shift') return { kind: 'shift', id: a };
  if (kind === 'day') return { kind: 'day', date: a, row: b || null };
  if (kind === 'time') {
    const axis = JSON.parse(t.dataset.axis ?? '{}') as Axis;
    const r = t.getBoundingClientRect();
    return { kind: 'time', date: a, row: b, minute: xToMinutes(x - r.left, axis) };
  }
  return null;
}

export const targetKey = (t: Target | null) => (!t ? '' : t.kind === 'shift' ? `shift|${t.id}` : t.kind === 'day' ? `day|${t.date}|${t.row ?? ''}` : t.kind === 'time' ? `time|${t.date}|${t.row}` : 'panel');

interface Handlers {
  onStart: (item: DragItem) => void;
  onOver: (item: DragItem, target: Target | null, p: PointerInfo) => void;
  onDrop: (item: DragItem, target: Target | null, p: PointerInfo) => void;
  onCancel: () => void;
}

export function useDrag(handlers: Handlers) {
  const h = useRef(handlers);
  h.current = handlers;
  const ghost = useRef<HTMLDivElement>(null);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const begin = useCallback((e: React.PointerEvent, item: DragItem) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    // No text selection or native drag while the pointer is down (the click still happens).
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    let active = false;
    const info = (ev: PointerEvent | KeyboardEvent, x = sx, y = sy): PointerInfo => ({ alt: ev.altKey, dx: x - sx, dy: y - sy });
    let lastX = sx;
    let lastY = sy;
    const place = (x: number, y: number) => {
      const g = ghost.current;
      if (!g) return;
      // Beside the pointer, flipped to the other side near the window's edge.
      const w = g.offsetWidth || 200;
      const h = g.offsetHeight || 48;
      const gx = x + 14 + w > window.innerWidth ? x - 14 - w : x + 14;
      const gy = y + 14 + h > window.innerHeight ? y - 14 - h : y + 14;
      g.style.transform = `translate(${Math.max(0, gx)}px, ${Math.max(0, gy)}px)`;
    };
    const move = (ev: PointerEvent) => {
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (!active) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        active = true;
        document.documentElement.classList.add('fh-dragging');
        h.current.onStart(item);
      }
      ev.preventDefault();
      place(ev.clientX, ev.clientY);
      h.current.onOver(item, parseTarget(document.elementFromPoint(ev.clientX, ev.clientY), ev.clientX), info(ev, ev.clientX, ev.clientY));
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('pointercancel', cancel);
      document.documentElement.classList.remove('fh-dragging');
      stop.current = null;
    };
    const up = (ev: PointerEvent) => {
      cleanup();
      if (!active) return;
      // The click that follows a drag isn't a tap on whatever is under the pointer.
      window.addEventListener('click', (c) => c.stopPropagation(), { capture: true, once: true });
      setTimeout(() => window.dispatchEvent(new Event('fh-drag-end')), 0);
      h.current.onDrop(item, parseTarget(document.elementFromPoint(ev.clientX, ev.clientY), ev.clientX), info(ev, ev.clientX, ev.clientY));
    };
    const cancel = () => {
      cleanup();
      if (active) h.current.onCancel();
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        cancel();
      } else if (active && ev.key === 'Alt') h.current.onOver(item, parseTarget(document.elementFromPoint(lastX, lastY), lastX), info(ev, lastX, lastY));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
    stop.current = cleanup;
  }, []);

  return { begin, ghost };
}

/** True on devices whose main pointer is a finger (phones, most tablets): tap instead of drag. */
export function coarsePointer(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}
