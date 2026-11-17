'use client';

/**
 * The organization's words for the built-in roles and the deck menu group
 * (apps/api/src/services/people/vocabulary.ts). An aquatic organization keeps the aquatic words
 * ("Lifeguard / instructor", "Pool deck"); a municipal one without pools gets neutral words; a
 * private employer its own defaults; and any organization can name each role itself (EN and FR).
 */
import { useTranslation } from 'react-i18next';
import { useSession } from './session';

export type Profile = 'AQUATIC' | 'MUNICIPAL' | 'PRIVATE';
export interface Vocabulary { profile: Profile; /** The organization's own choice; null = worked out. */ chosen?: Profile | null; roleLabels: Partial<Record<string, { en: string; fr: string }>> }

/** A built-in role's name for this organization: its own name, else its sector's word, else the aquatic default. */
export function roleLabel(t: (k: string, o?: Record<string, unknown>) => string, lng: string, vocab: Vocabulary | null | undefined, role: string): string {
  const own = vocab?.roleLabels?.[role];
  if (own) return lng.startsWith('fr') ? own.fr : own.en;
  const profile = vocab?.profile ?? 'AQUATIC';
  if (profile === 'AQUATIC') return t(`roles.${role}`);
  return t(`roleNames.${profile}.${role}`, { defaultValue: t(`roles.${role}`) });
}

/** A menu group's name: the deck group is "Pool deck" only where there are pools. */
export function groupLabel(t: (k: string) => string, vocab: Vocabulary | null | undefined, group: string): string {
  if (group === 'deck' && vocab && vocab.profile !== 'AQUATIC') return t('navGroups.deckGeneral');
  return t(`navGroups.${group}`);
}

/** The signed-in organization's role and group names. */
export function useVocabulary() {
  const { t, i18n } = useTranslation();
  const { me } = useSession();
  const vocab = me?.vocabulary ?? null;
  return { role: (r: string) => roleLabel(t, i18n.language, vocab, r), group: (g: string) => groupLabel(t, vocab, g), vocabulary: vocab };
}
