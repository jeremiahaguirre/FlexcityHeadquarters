import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { copy } from '../content/copy';
import { type Cut, PORTRAIT_QUERY, adFiles, pickCut } from '../lib/adVideo';
import { AdVideo } from './AdVideo';

const SITE = resolve(__dirname, '../..');
const render = (lang: 'en' | 'fr', cut: Cut | null) => renderToStaticMarkup(createElement(AdVideo, { lang, labels: copy(lang).demo.ad, initialCut: cut }));

describe('the demo page video ad', () => {
  it('picks the 9:16 cut only for narrow screens held upright', () => {
    expect(pickCut(true)).toBe('9x16');
    expect(pickCut(false)).toBe('16x9');
    expect(PORTRAIT_QUERY).toBe('(orientation: portrait) and (max-width: 767px)');
  });

  it.each([
    ['en', '16x9'],
    ['en', '9x16'],
    ['fr', '16x9'],
    ['fr', '9x16'],
  ] as const)('%s page, %s cut: that language’s video, poster and captions, and nothing else', (lang, cut) => {
    const html = render(lang, cut);
    const other = lang === 'en' ? 'fr' : 'en';
    const otherCut = cut === '16x9' ? '9x16' : '16x9';
    expect(html).toContain(`<source src="/clips/ad-${lang}-${cut}.mp4" type="video/mp4"/>`);
    expect(html).toContain(`poster="/clips/ad-${lang}-${cut}.jpg"`);
    expect(html).toMatch(new RegExp(`<track kind="captions" src="/clips/ad-${lang}\\.vtt" srclang="${lang}" label="${copy(lang).demo.ad.captions}" default=""/>`, 'i'));
    expect(html).toContain(`aria-label="${copy(lang).demo.ad.label}"`);
    // One video, one source: the other language and the other cut are never requested.
    expect(html.match(/<video/g)).toHaveLength(1);
    expect(html.match(/<source/g)).toHaveLength(1);
    expect(html).not.toContain(`/clips/ad-${other}`);
    expect(html).not.toContain(`-${otherCut}.`);
  });

  it('plays only when asked: controls, inline on phones, metadata only, never autoplay or muted', () => {
    const html = render('en', '16x9');
    expect(html).toMatch(/<video[^>]* controls=""/);
    expect(html).toMatch(/<video[^>]* playsInline=""/i);
    expect(html).toMatch(/<video[^>]* preload="metadata"/);
    expect(html).not.toMatch(/autoplay|muted|loop/i);
  });

  it('before the screen is known, renders an empty sized frame and no video at all', () => {
    const html = render('en', null);
    expect(html).not.toMatch(/<video|\.mp4|\.jpg|\.vtt/);
    expect(html).toContain('ad-frame');
  });

  it('every file it points at is committed, the videos at web size', () => {
    for (const lang of ['en', 'fr'] as const) {
      for (const cut of ['16x9', '9x16'] as const) {
        const f = adFiles(lang, cut);
        for (const p of [f.src, f.poster, f.captions]) expect(existsSync(join(SITE, 'public', p)), p).toBe(true);
        expect(statSync(join(SITE, 'public', f.src)).size, f.src).toBeLessThan(2.5 * 1024 * 1024);
        expect(statSync(join(SITE, 'public', f.poster)).size, f.poster).toBeLessThan(150 * 1024);
        expect(readFileSync(join(SITE, 'public', f.captions), 'utf8')).toMatch(/^WEBVTT\n/);
      }
    }
  });

  it('the Content-Security-Policy allows media from our own origin only', () => {
    const v = JSON.parse(readFileSync(join(SITE, 'vercel.json'), 'utf8')) as { headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }> };
    const csp = v.headers.find((h) => h.source === '/(.*)')!.headers.find((h) => h.key === 'Content-Security-Policy')!.value;
    expect(csp).toMatch(/(^|; )media-src 'self'(;|$)/);
    expect(csp).not.toMatch(/\*|https?:|data:|blob:/);
    // The same rule in the page itself, for static hosts that send no headers.
    expect(readFileSync(join(SITE, 'src/app/[lang]/layout.tsx'), 'utf8')).toContain(`content="media-src 'self'"`);
  });
});
