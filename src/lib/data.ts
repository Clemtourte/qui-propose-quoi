import { getCollection, getEntries, type CollectionEntry } from 'astro:content';

// Demo content is visible in dev and on preview deployments (PUBLIC_SHOW_DEMO=true),
// never in the production build.
export const showDemo = import.meta.env.DEV || import.meta.env.PUBLIC_SHOW_DEMO === 'true';

/** French typography: no line break inside « », before ; : ! ? % € or between a number and its unit. */
export function typo(s: string): string {
  return s
    .replace(/« /g, '« ')
    .replace(/ »/g, ' »')
    .replace(/ ([;:!?%€])/g, ' $1')
    .replace(/(\d) (Md€|milliards|millions|ans|mois)/g, '$1 $2');
}

/** Drops placeholder items (demo: true) outside dev and preview builds. */
export function visible<T extends { demo?: boolean }>(items: T[]): T[] {
  return items.filter((i) => showDemo || !i.demo);
}

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

export type CandidatTheme = {
  candidat: CollectionEntry<'candidats'>;
  synthese?: CollectionEntry<'syntheses'>;
  mesures: CollectionEntry<'entrees'>[];
  // Past record and past promises on this theme.
  passe: CollectionEntry<'entrees'>[];
};

const byDateDesc = (a: { data: { date: string } }, b: { data: { date: string } }) =>
  b.data.date.localeCompare(a.data.date);

/** Everything shown on a theme page, for visible candidates only. */
export async function getThemeData(theme: CollectionEntry<'themes'>) {
  const candidats = await getCandidats();
  const ids = new Set(candidats.map((c) => c.id));
  const onTheme = (d: { theme?: { id: string }; candidat: { id: string } }) =>
    d.theme?.id === theme.id && ids.has(d.candidat.id);

  const entrees = await getCollection('entrees', ({ data }) => onTheme(data));
  const syntheses = await getCollection('syntheses', ({ data }) => onTheme(data));
  const avis = (
    await getCollection('avis', ({ data }) => data.theme?.id === theme.id && data.candidats.some((c) => ids.has(c.id)))
  ).sort(byDateDesc);
  const verifications = (await getCollection('verifications', ({ data }) => onTheme(data))).sort(
    (a, b) => b.data.declaration.date.localeCompare(a.data.declaration.date),
  );

  // A synthesis may only answer the theme's declared questions.
  const questionIds = new Set(theme.data.questions.map((q) => q.id));
  for (const s of syntheses) {
    for (const q of Object.keys(s.data.reponses)) {
      if (!questionIds.has(q)) throw new Error(`syntheses/${s.id}: question inconnue « ${q} » pour le thème ${theme.id}`);
    }
  }

  const parCandidat: CandidatTheme[] = candidats.map((c) => {
    const mine = entrees.filter((e) => e.data.candidat.id === c.id);
    return {
      candidat: c,
      synthese: syntheses.find((s) => s.data.candidat.id === c.id),
      mesures: mine.filter((e) => e.data.rubrique === 'mesure').sort(byDateDesc),
      passe: mine.filter((e) => e.data.rubrique === 'bilan' || e.data.rubrique === 'promesse').sort(byDateDesc),
    };
  });

  const etat = visible(theme.data.etat_des_lieux);
  const promesses = entrees.filter((e) => e.data.rubrique === 'promesse').sort(byDateDesc);
  const sources = await collectSources([
    ...etat,
    ...entrees.map((e) => e.data),
    ...syntheses.map((s) => s.data),
    ...avis.map((a) => a.data),
    ...verifications.map((v) => v.data),
  ]);

  return { candidats, parCandidat, etat, avis, verifications, promesses, sources };
}
