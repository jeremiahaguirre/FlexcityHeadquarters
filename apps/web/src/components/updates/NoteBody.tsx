import { parseNoteBody } from '@/lib/noteText';

/** A What's new note's text: paragraphs and simple lists, always as text (never HTML). */
export function NoteBody({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className ?? 'grid gap-2 text-body text-ink'}>
      {parseNoteBody(text).map((b, i) =>
        b.type === 'p' ? (
          <p key={i}>{b.text}</p>
        ) : b.type === 'ul' ? (
          <ul key={i} className="grid list-disc gap-1 pl-5 marker:text-muted">{b.items.map((x, j) => <li key={j}>{x}</li>)}</ul>
        ) : (
          <ol key={i} className="grid list-decimal gap-1 pl-5 marker:text-muted">{b.items.map((x, j) => <li key={j}>{x}</li>)}</ol>
        ),
      )}
    </div>
  );
}
