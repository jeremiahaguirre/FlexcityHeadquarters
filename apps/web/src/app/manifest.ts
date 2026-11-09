import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

/** Installable web app (Add to Home Screen). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FlexcityHeadquarters',
    short_name: 'FH',
    description: 'Aquatic staff scheduling, timekeeping and operations',
    start_url: './',
    display: 'standalone',
    background_color: '#F3F7F6',
    theme_color: '#0F766E',
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
