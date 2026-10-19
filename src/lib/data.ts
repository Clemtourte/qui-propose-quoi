import { getCollection, getEntries, type CollectionEntry } from 'astro:content';

// Demo content is visible in dev and on preview deployments (PUBLIC_SHOW_DEMO=true),
// never in the production build.
export const showDemo = import.meta.env.DEV || import.meta.env.PUBLIC_SHOW_DEMO === 'true';

const frCollator = new Intl.Collator('fr', { sensitivity: 'base' });

/** Candidates in alphabetical order by last name — never by poll score. */
export async function getCandidats() {
  const all = await getCollection('candidats', ({ data }) => showDemo || !data.demo);
  return all.sort((a, b) => frCollator.compare(a.data.nom, b.data.nom));
}

export async function getThemes() {
  return (await getCollection('themes')).sort((a, b) => a.data.ordre - b.data.ordre);
}

const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

/** "2026-05-22" → "22 mai 2026", "2024-09" → "septembre 2024", "2024" → "2024". */
export function formatDate(date: string): string {
  const [y, m, d] = date.split('-');
  if (!m) return y;
  const month = MONTHS[Number(m) - 1];
  if (!d) return `${month} ${y}`;
  const day = Number(d) === 1 ? '1er' : String(Number(d));
  return `${day} ${month} ${y}`;
}

export const NATURE_LABELS = {
  fait: 'Fait',
  position: 'Position déclarée',
  jugement: 'Jugement attribué',
} as const;

export const STADE_LABELS: Record<CollectionEntry<'justice'>['data']['stade'], string> = {
  enquete: 'Enquête',
  mise_en_examen: 'Mise en examen',
  premiere_instance: 'Première instance',
  appel: 'Appel',
  cassation: 'Cassation',
  definitive: 'Décision définitive',
  relaxe: 'Relaxe',
  non_lieu: 'Non-lieu',
  classement: 'Classement sans suite',
};

export const CATEGORIE_LABELS: Record<CollectionEntry<'institutions'>['data']['categorie'], string> = {
  institution_publique: 'Institution publique',
  autorite_independante: 'Autorité indépendante',
  institution_europeenne: 'Institution européenne',
  organisation_internationale: 'Organisation internationale',
  recherche: 'Organisme de recherche',
  think_tank: 'Think tank',
};

type SourceRef = { collection: 'sources'; id: string };

/** Unique sources referenced by a set of items, most recent first. */
export async function collectSources(items: Array<{ sources: SourceRef[] } | undefined>) {
  const ids = new Map<string, SourceRef>();
  for (const item of items) item?.sources.forEach((s) => ids.set(s.id, s));
  const entries = await getEntries([...ids.values()]);
  return entries.sort((a, b) => b.data.date_publication.localeCompare(a.data.date_publication));
}
