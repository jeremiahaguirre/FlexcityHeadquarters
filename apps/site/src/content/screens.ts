import type { Lang } from './copy';

/**
 * The app screenshots the site shows (public/screens/<name>-<lang>-<light|dark>.webp, captured by
 * scripts/capture-screens.cjs from the fictional demo organization), their alt text, and the short
 * captions beside them. Alt text says what the screen shows; captions only claim what that screen
 * (or the app's code) does. English and Canadian French side by side.
 */
export const SCREENS = ['phone-board', 'phone-count', 'phone-schedule', 'phone-pay', 'phone-timeoff', 'laptop-hr', 'laptop-casefile', 'laptop-orgchart', 'laptop-coverage', 'laptop-overtime', 'laptop-onboarding'] as const;
export type ScreenName = (typeof SCREENS)[number];

const ALT: Record<Lang, Record<ScreenName, string>> = {
  en: {
    'phone-board': 'Shift board on a phone: open lifeguard and swim instructor shifts at Lakeview Aquatic Centre, each with a Take this shift button',
    'phone-count': 'Head count on a phone: 7 bathers counted in the hot tub out of 12 allowed, with minus, plus and Save count buttons',
    'phone-schedule': 'My schedule on a phone: upcoming lifeguard shifts, each with Give away and Trade buttons',
    'phone-pay': 'My pay on a phone: a pay statement with gross pay, deductions and the net deposit, and the direct deposit account',
    'phone-timeoff': 'Time off on a phone: a Request time off button and the 2026 balances for vacation and sick days',
    'laptop-hr': 'HR overview on a laptop: missing or expired training, an open injury claim, open grievances and a person flagged for review, with counts of active employees and open postings',
    'laptop-casefile': 'An employee’s case file on a laptop: a reliability score of 71 with how it was reached, and dated entries such as late clock-ins and a suspension',
    'laptop-orgchart': 'Org chart on a laptop: who reports to whom, filtered by department, with each person’s position',
    'laptop-coverage': 'Required coverage on a laptop: gaps in the next 7 days where the published schedule has fewer certified lifeguards than the rule requires',
    'laptop-overtime': 'Overtime on a laptop: who is offered overtime next, in collective agreement order, with hours charged and seniority dates',
    'laptop-onboarding': 'Onboarding on a laptop: new staff with their HR, supervisor and employee checklists and how far along each one is',
  },
  fr: {
    'phone-board': 'Tableau des quarts sur un téléphone : quarts libres de sauveteur et de moniteur de natation au Lakeview Aquatic Centre, chacun avec un bouton Prendre ce quart',
    'phone-count': 'Dénombrement sur un téléphone : 7 baigneurs comptés dans le bain chaud sur 12 permis, avec les boutons moins, plus et Enregistrer',
    'phone-schedule': 'Mon horaire sur un téléphone : prochains quarts de sauveteur, chacun avec les boutons Céder et Échanger',
    'phone-pay': 'Ma paie sur un téléphone : un relevé de paie avec la paie brute, les retenues et le dépôt net, et le compte du dépôt direct',
    'phone-timeoff': 'Congés sur un téléphone : un bouton Demander un congé et les soldes 2026 de vacances et de congés de maladie',
    'laptop-hr': 'Vue d’ensemble RH sur un ordinateur portable : formations manquantes ou expirées, une réclamation pour blessure, des griefs ouverts et une personne signalée pour examen, avec le nombre d’employés actifs et d’affichages ouverts',
    'laptop-casefile': 'Dossier d’un employé sur un ordinateur portable : une fiabilité de 71 avec la façon dont elle a été obtenue, et des faits datés comme des arrivées en retard et une suspension',
    'laptop-orgchart': 'Organigramme sur un ordinateur portable : qui relève de qui, filtré par service, avec le poste de chacun',
    'laptop-coverage': 'Couverture requise sur un ordinateur portable : trous des 7 prochains jours où l’horaire publié compte moins de sauveteurs certifiés que la règle n’en exige',
    'laptop-overtime': 'Heures supplémentaires sur un ordinateur portable : à qui les offrir ensuite, dans l’ordre de la convention collective, avec les heures imputées et les dates d’ancienneté',
    'laptop-onboarding': 'Intégration sur un ordinateur portable : nouveaux employés avec leurs listes RH, superviseur et employé, et l’avancement de chacune',
  },
};

export const screenAlt = (name: ScreenName, lang: Lang) => ALT[lang][name];

/** Captions for the screenshot rows on each page. */
const CAPTIONS = {
  en: {
    showKicker: 'On every screen',
    showTitle: 'The phone in their pocket. The laptop on your desk.',
    showLead: 'Real screens from the demo, with its sample organization and invented people.',
    staffTitle: 'For the people on shift',
    staffBody: 'Give away or trade a shift, ask for time off against your balances, and read your pay statements, from any phone.',
    supTitle: 'For supervisors',
    supBody: 'Required coverage lists the next seven days where the published schedule doesn’t have enough people holding a valid, verified certificate.',
    hrTitle: 'For HR',
    hrBody: 'Each person’s case file keeps dated facts in one timeline, with a reliability score that shows how it was reached.',
    whyTitle: 'One app, at the desk and on the deck',
    whyBody: 'The HR overview on a computer and the schedule on each phone are the same app, working from the same records.',
    privateTitle: 'Trades and time off, on any phone',
    privateBody: 'Staff give away a shift or trade one, with a supervisor’s approval for trades, and ask for time off against their balances.',
    plansTitle: 'In every plan: coverage and pay',
    plansBody: 'Required coverage with gap alerts, and pay statements on each person’s phone, are part of the core, public or private.',
    demoTitle: 'What you’ll see',
    demoHr: 'A case file, with the facts behind a reliability score.',
    demoStaff: 'The shift board, with the open shifts you can take.',
  },
  fr: {
    showKicker: 'Sur tous les écrans',
    showTitle: 'Le téléphone dans leur poche. L’ordinateur sur votre bureau.',
    showLead: 'De vrais écrans de la démo, avec son organisation fictive et des personnes inventées.',
    staffTitle: 'Pour les personnes en service',
    staffBody: 'Céder ou échanger un quart, demander un congé selon ses soldes et consulter ses relevés de paie, sur n’importe quel téléphone.',
    supTitle: 'Pour la supervision',
    supBody: 'La couverture requise liste les sept prochains jours où l’horaire publié n’a pas assez de personnes détenant un certificat valide et vérifié.',
    hrTitle: 'Pour les RH',
    hrBody: 'Le dossier de chaque personne garde les faits datés sur une seule ligne du temps, avec un score de fiabilité qui montre comment il a été obtenu.',
    whyTitle: 'Une seule appli, au bureau comme au bord du bassin',
    whyBody: 'La vue d’ensemble RH sur un ordinateur et l’horaire sur chaque téléphone sont la même appli, qui travaille à partir des mêmes dossiers.',
    privateTitle: 'Échanges et congés, sur tout téléphone',
    privateBody: 'Le personnel cède un quart ou en échange un, avec l’approbation de la supervision pour les échanges, et demande un congé selon ses soldes.',
    plansTitle: 'Dans chaque forfait : couverture et paie',
    plansBody: 'La couverture requise avec alertes de manque et les relevés de paie sur le téléphone de chacun font partie de la base, publique ou privée.',
    demoTitle: 'Ce que vous verrez',
    demoHr: 'Un dossier, avec les faits derrière un score de fiabilité.',
    demoStaff: 'Le tableau des quarts, avec les quarts libres que vous pouvez prendre.',
  },
} satisfies Record<Lang, Record<string, string>>;

export const captions = (lang: Lang) => CAPTIONS[lang];
