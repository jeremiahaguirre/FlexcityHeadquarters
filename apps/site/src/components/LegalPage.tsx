import { Section } from '@/components/Section';
import { type Lang, copy } from '@/content/copy';
import { type LegalDocName, legalDoc } from '@/content/legal';

const TITLE = { privacy: 'privacyTitle', accessibility: 'accessibilityTitle', terms: 'termsTitle' } as const;

export const legalTitle = (doc: LegalDocName, lang: Lang) => copy(lang).legal[TITLE[doc]];

export function LegalPage({ doc, lang }: { doc: LegalDocName; lang: Lang }) {
  const c = copy(lang).legal;
  const d = legalDoc(doc, lang);
  const date = new Intl.DateTimeFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${d.updated}T00:00:00Z`));
  return (
    <Section>
      <article className="mx-auto max-w-2xl">
        <p className="mb-6 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-small">{c.draft}</p>
        <h1 className="text-title">{legalTitle(doc, lang)}</h1>
        <p className="mt-2 text-small text-muted">
          <time dateTime={d.updated}>{date}</time>
        </p>
        <p className="mt-6 text-body leading-7">{d.intro}</p>
        {d.sections.map((s) => (
          <section key={s.heading} className="mt-10">
            <h2 className="text-heading">{s.heading}</h2>
            {s.body.map((p) => (
              <p key={p} className="mt-3 text-body leading-7 text-muted">{p}</p>
            ))}
          </section>
        ))}
      </article>
    </Section>
  );
}
