/**
 * The static demo's What's new (no API there): one sample note, shown once per browser tab
 * session and then in the list, and the same note in the demo Dev console. Nothing is saved.
 */
const READ_KEY = 'flexcity-demo-whats-new-read';
const publishAt = () => new Date(Date.now() - 2 * 86_400_000).toISOString();
const NOTE = {
  id: '00000000-0000-4000-8000-0000000000e1',
  title: { en: 'Team messages', fr: 'Messages d’équipe' },
  body: {
    en: 'Talk to your team without leaving FlexcityHeadquarters.\n- One-to-one, shift and department conversations\n- Your phone gets a notification when someone writes\n\nOpen Messages from the menu to start.',
    fr: 'Discutez avec votre équipe sans quitter FlexcityHeadquarters.\n- Conversations à deux, de quart et de service\n- Votre téléphone reçoit une notification quand quelqu’un écrit\n\nOuvrez Messages dans le menu pour commencer.',
  },
};
const read = () => {
  try {
    return sessionStorage.getItem(READ_KEY) === '1';
  } catch {
    return false;
  }
};

/** Organization side: undefined when the path isn't What's new. */
export function demoWhatsNew(path: string, method: string): unknown {
  // No maintenance planned and no releases scheduled in the demo.
  if (path === '/api/maintenance' && method === 'GET') return { banners: [], upcoming: [] };
  if (path === '/api/updates/changes' && method === 'GET') return [];
  if (path === '/api/me/whats-new' && method === 'GET') {
    const r = read();
    return { notes: [{ ...NOTE, publishAt: publishAt(), readAt: r ? new Date().toISOString() : null }], unseen: r ? [] : [NOTE.id] };
  }
  if (path === '/api/me/whats-new/read' && method === 'POST') {
    try {
      sessionStorage.setItem(READ_KEY, '1');
    } catch {
      /* fine */
    }
    return { marked: 1 };
  }
  return undefined;
}

/** Dev console side: the same note as written there. */
export function demoConsoleNotes(path: string, method: string): unknown {
  if (method === 'GET' && (path === '/rings' || path === '/releases' || path === '/maintenance')) return [];
  if (path !== '/notes' || method !== 'GET') return undefined;
  const at = publishAt();
  return [{ id: NOTE.id, titleEn: NOTE.title.en, titleFr: NOTE.title.fr, bodyEn: NOTE.body.en, bodyFr: NOTE.body.fr, roles: [], tenantIds: [], ringIds: [], publishAt: at, publishedAt: at, withdrawnAt: null, status: 'published' }];
}
