/** The two cuts of the FH video ad: landscape for most screens, portrait for phones held upright. */
export type Cut = '16x9' | '9x16';

/** Narrow screens held upright get the 9:16 cut; everything else gets 16:9 (same query as .ad-frame in globals.css). */
export const PORTRAIT_QUERY = '(orientation: portrait) and (max-width: 767px)';

export const pickCut = (narrowPortrait: boolean): Cut => (narrowPortrait ? '9x16' : '16x9');

/** The self-hosted files for one language and cut (public/clips): the video, its poster and the captions in that language. */
export function adFiles(lang: 'en' | 'fr', cut: Cut) {
  const base = `/clips/ad-${lang}-${cut}`;
  return { src: `${base}.mp4`, poster: `${base}.jpg`, captions: `/clips/ad-${lang}.vtt`, width: cut === '16x9' ? 1280 : 720, height: cut === '16x9' ? 720 : 1280 };
}
