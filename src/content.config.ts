import { defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Dates can be exact (2026-05-22) or partial (2024-09, 2024) when the source
// does not give the day. YAML parses full dates as Date objects, so both forms
// are normalised to an ISO-like string.
const fuzzyDate = z.union([
  z.date().transform((d) => d.toISOString().slice(0, 10)),
  // A bare year (2026) is parsed by YAML as a number.
  z
    .number()
    .int()
    .min(1900)
    .max(2100)
    .transform((y) => String(y)),
  z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, 'Date attendue : AAAA, AAAA-MM ou AAAA-MM-JJ'),
]);

// The three levels that must never be mixed: verifiable fact, position declared
// by the candidate or party, judgement made by someone else (always attributed).
const nature = z.enum(['fait', 'position', 'jugement']);

const sourcesList = z.array(reference('sources')).min(1, 'Au moins une source');

// An order of magnitude that helps a reader picture a figure (e.g. "15 GW" in reactors or in a share of
// today's fleet). Always a computation shown step by step from sourced data, never a rhetorical comparison;
// the same kind of reference is used for every candidate.
const repere = z.object({
  // Key question of the theme this reference illustrates: the overview table shows it only in that column.
  question: z.string().optional(),
  mesure: z.string(),
  equivalent: z.string(),
  calcul: z.string(),
  sources: sourcesList,
});

const quote = z.object({
  texte: z.string(),
  date: fuzzyDate,
  contexte: z.string(),
});

// A sourced statement block, reused in several places (vision, theme overview...).
const sourcedItem = z
  .object({
    nature,
    texte: z.string(),
    auteur: z.string().optional(),
    date: fuzzyDate,
    sources: sourcesList,
    // Key figures quoted from `texte`, shown as large numbers at the top of a theme page.
    chiffres_cles: z.array(z.object({ valeur: z.string(), libelle: z.string() })).default([]),
    reperes: z.array(repere).default([]),
    // Placeholder items attached to real records (e.g. a theme overview), hidden in production.
    demo: z.boolean().default(false),
  })
  .refine((d) => d.nature !== 'jugement' || !!d.auteur, {
    message: 'Un jugement doit être attribué (champ auteur)',
    path: ['auteur'],
  });

const yaml = (base: string) => glob({ pattern: '**/*.yaml', base });

const sources = defineCollection({
  loader: yaml('./content/sources'),
  schema: z.object({
    url: z.url(),
    titre: z.string(),
    media: z.string(),
    auteur: z.string().optional(),
    date_publication: fuzzyDate,
    date_consultation: fuzzyDate,
    type: z.enum(['primaire', 'presse', 'institution', 'agregateur']),
    note: z.string().optional(),
  }),
});

const candidats = defineCollection({
  loader: yaml('./content/candidats'),
  schema: z.object({
    prenom: z.string(),
    nom: z.string(),
    parti: z.string(),
    fiche: z.enum(['complete', 'courte']),
    // Demo entries hold placeholder text to validate the design; hidden in production.
    demo: z.boolean().default(false),
    fonction: z.string().optional(),
    candidature: z.object({
      texte: z.string(),
      date: fuzzyDate,
      sources: sourcesList,
    }),
    en_30_secondes: z
      .object({
        parcours: z.string(),
        // Empty until the programme is published: the page then shows the theme summaries instead.
        propose: z.array(z.string()).max(3).default([]),
        sources: sourcesList,
      })
      .optional(),
    vision: z.array(sourcedItem).default([]),
    // What was searched for each section, shown when the section is empty.
    recherches: z.record(z.string(), z.string()).default({}),
    derniere_verification: fuzzyDate,
  }),
});

const themes = defineCollection({
  loader: yaml('./content/themes'),
  schema: z.object({
    titre: z.string(),
    ordre: z.number(),
    accroche: z.string(),
    etat_des_lieux: z.array(sourcedItem).default([]),
    // Key questions used as columns of the overview table and rows of the comparator.
    questions: z.array(z.object({ id: z.string(), libelle: z.string() })).default([]),
    // What was searched for each section of the theme page, shown when the section is empty.
    recherches: z.record(z.string(), z.string()).default({}),
    derniere_verification: fuzzyDate.optional(),
  }),
});

const institutions = defineCollection({
  loader: yaml('./content/institutions'),
  schema: z.object({
    nom: z.string(),
    sigle: z.string().optional(),
    categorie: z.enum([
      'institution_publique',
      'autorite_independante',
      'institution_europeenne',
      'organisation_internationale',
      'recherche',
      'think_tank',
    ]),
    // Think tanks are labelled with their orientation, as described by themselves or the press.
    orientation: z.string().optional(),
    url: z.url(),
  }),
});

// The base unit: one candidate x one theme x one measure, statement, record item...
const entrees = defineCollection({
  loader: yaml('./content/entrees'),
  schema: z
    .object({
      candidat: reference('candidats'),
      theme: reference('themes').optional(),
      rubrique: z.enum(['mesure', 'bilan', 'promesse', 'participation', 'declaration', 'soutien_adversaire']),
      // Also listed (as a link) under "Place laissée à la population" on the candidate page.
      aussi_participation: z.boolean().default(false),
      nature,
      auteur: z.string().optional(),
      titre: z.string(),
      // For rubrique "promesse": `promesse` is what was promised, `texte` what was actually done.
      promesse: quote.optional(),
      texte: z.string(),
      citation: quote.optional(),
      chiffres: z
        .array(z.object({ libelle: z.string(), valeur: z.string(), nature }))
        .default([]),
      reperes: z.array(repere).default([]),
      // Ids of the theme's key questions this entry details: the overview table links to it.
      questions: z.array(z.string()).default([]),
      date: fuzzyDate,
      sources: sourcesList,
    })
    .refine((d) => d.nature !== 'jugement' || !!d.auteur, {
      message: 'Un jugement doit être attribué (champ auteur)',
      path: ['auteur'],
    })
    .refine((d) => d.rubrique !== 'promesse' || !!d.promesse, {
      message: 'Une entrée « promesse » doit citer la promesse (champ promesse)',
      path: ['promesse'],
    }),
});

// One short, faithful summary of a candidate's position on a theme, plus short
// answers to the theme's key questions. Always a declared position.
const syntheses = defineCollection({
  loader: yaml('./content/syntheses'),
  schema: z.object({
    candidat: reference('candidats'),
    theme: reference('themes'),
    phrase: z.string(),
    reponses: z.record(z.string(), z.string()).default({}),
    date: fuzzyDate,
    sources: sourcesList,
  }),
});

const avis = defineCollection({
  loader: yaml('./content/avis'),
  schema: z.object({
    institution: reference('institutions'),
    candidats: z.array(reference('candidats')).min(1),
    theme: reference('themes').optional(),
    date: fuzzyDate,
    perimetre: z.string(),
    resume: z.string(),
    sources: sourcesList,
  }),
});

const verifications = defineCollection({
  loader: yaml('./content/verifications'),
  schema: z.object({
    candidat: reference('candidats'),
    theme: reference('themes').optional(),
    declaration: quote,
    verificateur: z.string(),
    // The checker's own verdict wording, never ours.
    verdict: z.string(),
    resume: z.string(),
    date_verification: fuzzyDate,
    sources: sourcesList,
  }),
});

const stade = z.enum([
  'enquete',
  'mise_en_examen',
  'premiere_instance',
  'appel',
  'cassation',
  'definitive',
  'relaxe',
  'non_lieu',
  'classement',
]);

const justice = defineCollection({
  loader: yaml('./content/justice'),
  schema: z.object({
    candidat: reference('candidats'),
    affaire: z.string(),
    // The candidate's own position in the case (defendant, assisted witness, not charged...).
    role: z.string(),
    // 'campagne': investigation into one of the candidate's own election campaigns in which
    // the candidate is not personally charged; listed apart on the page.
    concerne: z.enum(['candidat', 'campagne']).default('candidat'),
    faits: z.string(),
    stade,
    // 'non_documente': no source states whether the decision became final.
    definitive: z.union([z.boolean(), z.literal('non_documente')]),
    etapes: z
      .array(z.object({ date: fuzzyDate, stade, juridiction: z.string(), decision: z.string() }))
      .min(1),
    prochaine_etape: z.string().optional(),
    sources: sourcesList,
  }),
});

export const collections = {
  sources,
  candidats,
  themes,
  institutions,
  entrees,
  syntheses,
  avis,
  verifications,
  justice,
};
