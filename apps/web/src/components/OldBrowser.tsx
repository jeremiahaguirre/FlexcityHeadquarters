import { Logo } from '@/components/Logo';
import { OLD_BROWSER_CSS } from '@/lib/browserCheck';
import { type Locale, createI18n } from '@/lib/i18n';

/**
 * "Please update your browser": plain HTML in every page, hidden unless the check in lib/browserCheck.ts
 * marks the page as opened in a browser too old for the app. Then it is all that shows, with no script
 * of its own, so it works where Next's code can't run. Both languages, the page's first: the static
 * demo's pages are built in one language and an old browser never gets to apply the saved one.
 */
export function OldBrowser({ locale }: { locale: Locale }) {
  const order: Locale[] = locale === 'fr-CA' ? ['fr-CA', 'en-CA'] : ['en-CA', 'fr-CA'];
  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: OLD_BROWSER_CSS }} />
      <div id="fh-old-browser" className="min-h-screen px-4 py-10">
        <div className="mx-auto max-w-lg rounded-xl2 border border-line bg-panel p-6 shadow-card sm:p-8">
          <Logo size={32} />
          {order.map((l, i) => {
            const t = createI18n(l).t;
            const Heading = i === 0 ? 'h1' : 'h2';
            return (
              <section key={l} lang={l} className={i === 0 ? 'mt-6' : 'mt-6 border-t border-line pt-6'}>
                <Heading className="text-heading text-ink">{t('oldBrowser.title')}</Heading>
                <p className="mt-3 text-body text-ink">{t('oldBrowser.body')}</p>
                <p className="fh-ob-update mt-3 text-small text-muted">{t('oldBrowser.update')}</p>
                <p className="fh-ob-kiosk mt-3 text-body-strong text-ink">{t('oldBrowser.kiosk')}</p>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
