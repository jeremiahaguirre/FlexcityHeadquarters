'use client';

import { Eraser } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/Button';
import { Field, Input } from './ui/Field';
import { Segmented } from './ui/Segmented';

/**
 * Draw a signature, or type your name (keyboard and screen-reader friendly).
 * Either way the result is a PNG data URL.
 */
export function SignaturePad({ onChange }: { onChange: (png: string | null) => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [typed, setTyped] = useState('');
  const drawing = useRef(false);
  const dirty = useRef(false);

  const ctx = () => {
    const c = ref.current!;
    const g = c.getContext('2d')!;
    g.lineWidth = 2.4;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = '#0B1F22';
    return g;
  };
  const clear = () => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    dirty.current = false;
    onChange(null);
  };
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const scale = window.devicePixelRatio || 1;
    c.width = c.clientWidth * scale;
    c.height = c.clientHeight * scale;
    c.getContext('2d')!.scale(scale, scale);
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (mode !== 'type') return;
    const c = ref.current!;
    const g = c.getContext('2d')!;
    clear();
    if (!typed.trim()) return;
    g.fillStyle = '#0B1F22';
    g.font = `italic 600 ${Math.min(36, (c.clientWidth / Math.max(typed.length, 6)) * 1.7)}px "Segoe Script", "Brush Script MT", cursive`;
    g.textBaseline = 'middle';
    g.fillText(typed.trim(), 16, c.clientHeight / 2);
    onChange(c.toDataURL('image/png'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed, mode]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  return (
    <div className="grid gap-3">
      <Segmented
        label={t('signature.how')}
        value={mode}
        onChange={setMode}
        options={[
          { value: 'draw', label: t('signature.draw') },
          { value: 'type', label: t('signature.type') },
        ]}
      />
      {mode === 'type' ? (
        <Field label={t('signature.typeLabel')}>{(p) => <Input {...p} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="name" />}</Field>
      ) : null}
      <canvas
        ref={ref}
        aria-label={mode === 'draw' ? t('signature.drawArea') : t('signature.preview')}
        role="img"
        className="h-36 w-full touch-none rounded-xl border border-dashed border-muted/50 bg-white"
        onPointerDown={(e) => {
          if (mode !== 'draw') return;
          drawing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const g = ctx();
          const [x, y] = point(e);
          g.beginPath();
          g.moveTo(x, y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const g = ctx();
          const [x, y] = point(e);
          g.lineTo(x, y);
          g.stroke();
          dirty.current = true;
        }}
        onPointerUp={() => {
          drawing.current = false;
          if (dirty.current) onChange(ref.current!.toDataURL('image/png'));
        }}
      />
      {mode === 'draw' ? (
        <Button variant="ghost" size="sm" className="justify-self-start" icon={<Eraser className="h-4 w-4" aria-hidden="true" />} onClick={clear}>
          {t('signature.clear')}
        </Button>
      ) : null}
    </div>
  );
}
