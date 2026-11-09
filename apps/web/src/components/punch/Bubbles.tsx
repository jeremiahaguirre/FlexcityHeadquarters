'use client';

/** A short burst of rising bubbles: the pool deck's confetti. Hidden for reduced motion (globals.css). */
export function Bubbles({ burst }: { burst: number }) {
  if (!burst) return null;
  const bubbles = Array.from({ length: 14 }, (_, i) => ({
    left: 8 + ((i * 53) % 84),
    size: 6 + ((i * 7) % 14),
    dx: ((i % 5) - 2) * 14,
    delay: (i % 7) * 60,
  }));
  return (
    <div key={burst} aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-6 h-0">
      {bubbles.map((b, i) => (
        <span
          key={i}
          className="fh-bubble absolute bottom-0 rounded-full border-2 border-brand/50 bg-brand/15"
          style={{ left: `${b.left}%`, width: b.size, height: b.size, animationDelay: `${b.delay}ms`, ['--dx' as string]: `${b.dx}px` }}
        />
      ))}
    </div>
  );
}
