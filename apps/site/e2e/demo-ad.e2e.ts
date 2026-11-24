import { expect, test } from '@playwright/test';

/**
 * The demo page's video ad, in English and French: the page's own language cut and captions, the
 * landscape cut on a desktop and the portrait one on a phone, nothing autoplayed, and no
 * Content-Security-Policy violation (the server sends vercel.json's headers).
 */
const LABEL = { en: 'FlexcityHeadquarters in 20 seconds: video with sound and captions', fr: 'FlexcityHeadquarters en 20 secondes : vidéo avec son et sous-titres' };
const TRACK = { en: 'English', fr: 'Français' };

for (const lang of ['en', 'fr'] as const) {
  test(`${lang}: the demo page plays its own language cut with its captions, within the CSP`, async ({ page, isMobile }) => {
    const violations: string[] = [];
    const errors: string[] = [];
    await page.addInitScript(() => {
      const w = window as unknown as { __csp: string[] };
      w.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
      if (/content security policy/i.test(m.text())) violations.push(m.text());
    });
    const media: string[] = [];
    page.on('request', (r) => {
      if (/\/clips\/ad-/.test(r.url())) media.push(new URL(r.url()).pathname);
    });

    const res = await page.goto(`/${lang}/demo/`);
    expect(res?.headers()['content-security-policy']).toContain("media-src 'self'");

    const cut = isMobile ? '9x16' : '16x9';
    const video = page.getByLabel(LABEL[lang]);
    await video.scrollIntoViewIfNeeded();
    await expect(video).toBeVisible();
    await expect(page.locator('#video video')).toHaveCount(1);
    await expect(video.locator('source')).toHaveAttribute('src', `/clips/ad-${lang}-${cut}.mp4`);
    await expect(video).toHaveAttribute('poster', `/clips/ad-${lang}-${cut}.jpg`);
    await expect(video).toHaveAttribute('controls', '');
    await expect(video).toHaveAttribute('preload', 'metadata');
    const track = video.locator('track');
    await expect(track).toHaveAttribute('kind', 'captions');
    await expect(track).toHaveAttribute('src', `/clips/ad-${lang}.vtt`);
    await expect(track).toHaveAttribute('srclang', lang);
    await expect(track).toHaveAttribute('label', TRACK[lang]);
    await expect(track).toHaveAttribute('default', '');

    // Captions on by default and actually loaded from our own origin.
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.textTracks[0]?.mode)).toBe('showing');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => (v.querySelector('track') as HTMLTrackElement).readyState)).toBe(2);
    expect(await video.evaluate((v: HTMLVideoElement) => v.textTracks[0]?.cues?.length ?? 0)).toBeGreaterThan(0);

    // Nothing plays until asked.
    await page.waitForTimeout(500);
    expect(await video.evaluate((v: HTMLVideoElement) => ({ paused: v.paused, autoplay: v.autoplay, muted: v.muted }))).toEqual({ paused: true, autoplay: false, muted: false });

    // Only this language and this cut were ever requested.
    const other = lang === 'en' ? 'fr' : 'en';
    const otherCut = cut === '16x9' ? '9x16' : '16x9';
    expect(media.length).toBeGreaterThan(0);
    expect(media.filter((p) => p.includes(`/ad-${other}`) || p.includes(`-${otherCut}.`))).toEqual([]);

    expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
    expect(violations).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('en: the video starts from the keyboard', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard check on the desktop layout');
  await page.goto('/en/demo/');
  const video = page.getByLabel(LABEL.en);
  await video.scrollIntoViewIfNeeded();
  const codec = await video.evaluate((v: HTMLVideoElement) => v.canPlayType('video/mp4; codecs="avc1.640020, mp4a.40.2"'));
  test.skip(!codec, 'this Chromium build has no H.264 decoder');
  await video.focus();
  await expect(video).toBeFocused();
  await page.keyboard.press('Space');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0)).toBe(true);
  await page.keyboard.press('Space');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
});
