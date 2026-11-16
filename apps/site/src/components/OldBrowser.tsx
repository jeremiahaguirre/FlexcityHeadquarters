import { Logo } from '@/components/Logo';
import { type Lang, copy } from '@/content/copy';
import { OLD_BROWSER_CSS } from '@/lib/browserCheck';

/**
 * "Please update your browser": plain HTML in every page, hidden unless lib/browserCheck.ts marks the
 * page as opened in a browser too old for the site. Then it is all that shows, with no script of its
 * own. Both languages, the page's first.
 */
export function OldBrowser({ lang }: { lang: Lang }) {
  const order: Lang[] = lang === 'fr' ? ['fr', 'en'] : ['en', 'fr'];
  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: OLD_BROWSER_CSS }} />
      <div id="fh-old-browser" className="min-h-screen px-4 py-10">
        <div className="mx-auto max-w-lg rounded-xl2 border border-line bg-panel p-6 shadow-card sm:p-8">
          <Logo size={32} />
          {order.map((l, i) => {
            const c = copy(l).oldBrowser;
            const Heading = i === 0 ? 'h1' : 'h2';
            return (
              <section key={l} lang={l === 'fr' ? 'fr-CA' : 'en-CA'} className={i === 0 ? 'mt-6' : 'mt-6 border-t border-line pt-6'}>
                <Heading className="text-heading text-ink">{c.title}</Heading>
                <p className="mt-3 text-body text-ink">{c.body}</p>
                <p className="fh-ob-update mt-3 text-small text-muted">{c.update}</p>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
