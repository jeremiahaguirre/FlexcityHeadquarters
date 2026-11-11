import { PageHero } from './PageHero';
import { type Lang, copy } from '@/content/copy';
import { type LegalDocName, legalDoc } from '@/content/legal';

const TITLE = { privacy: 'privacyTitle', accessibility: 'accessibilityTitle', terms: 'termsTitle', copyright: 'copyrightTitle', cookies: 'cookiesTitle', refunds: 'refundsTitle' } as const;

export const legalTitle = (doc: LegalDocName, lang: Lang) => copy(lang).legal[TITLE[doc]];

export function LegalPage({ doc, lang }: { doc: LegalDocName; lang: Lang }) {
  const c = copy(lang).legal;
  const d = legalDoc(doc, lang);
  const date = new Intl.DateTimeFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${d.updated}T00:00:00Z`));
  return (
    <>
    <PageHero title={legalTitle(doc, lang)} size="md" narrow>
      <p className="mt-4 text-small text-muted">
        {c.version.replace('{v}', d.version)} · {c.updated} <time dateTime={d.updated}>{date}</time>
      </p>
    </PageHero>
    <section className="mx-auto max-w-3xl px-4 py-12 md:px-6 md:py-16">
      <article>
        <p className="mb-6 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-small">{c.draft}</p>
        <p className="text-body leading-7">{d.intro}</p>
        <p className="mt-3 text-small text-muted">{c.notAdvice}</p>
        {d.sections.map((s) => (
          <section key={s.heading} className="mt-10">
            <h2 className="text-heading">{s.heading}</h2>
            {s.body.map((p) => (
              <p key={p} className="mt-3 text-body leading-7 text-muted [overflow-wrap:anywhere]">{p}</p>
            ))}
          </section>
        ))}
      </article>
    </section>
    </>
  );
}
