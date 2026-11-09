import type { Lang } from './copy';

export type Audience = 'staff' | 'leads' | 'admin';
interface Body { title: string; summary: string; steps: string[]; tip?: string }
export interface Article { slug: string; audience: Audience; en: Body; fr: Body }

/** Help-centre articles. Steps are short and in the order people do them. */
export const ARTICLES: Article[] = [
  {
    slug: 'first-sign-in',
    audience: 'staff',
    en: {
      title: 'Your first sign-in',
      summary: 'Set your password from the invitation and add a passkey.',
      steps: ['Open the invitation email from your organization and choose a password (the link works for 7 days).', 'Sign in at your organization’s web address (it’s in the invitation email).', 'When asked, set up a passkey so next time you can sign in with Face ID, your fingerprint or Windows Hello.', 'Add the site to your home screen for one-tap access.'],
      tip: 'Invitation expired? Ask your supervisor to resend it from Staff.',
    },
    fr: {
      title: 'Votre première connexion',
      summary: 'Choisissez votre mot de passe depuis l’invitation et ajoutez une clé d’accès.',
      steps: ['Ouvrez le courriel d’invitation de votre organisation et choisissez un mot de passe (le lien est valide 7 jours).', 'Connectez-vous à l’adresse Web de votre organisation (elle figure dans le courriel d’invitation).', 'Si on vous le propose, configurez une clé d’accès pour vous connecter avec Face ID, votre empreinte ou Windows Hello.', 'Ajoutez le site à votre écran d’accueil pour y accéder d’un geste.'],
      tip: 'Invitation expirée? Demandez à votre superviseur de la renvoyer depuis Personnel.',
    },
  },
  {
    slug: 'clock-in-and-out',
    audience: 'staff',
    en: {
      title: 'Clocking in and out',
      summary: 'Slide to clock in for your shift, and back out at the end.',
      steps: ['Open Today, or tap Clock in at the top of any screen.', 'Slide the button to the right. If your shift starts within 30 minutes or has started, you’re clocked into it.', 'No shift right now? Choose the facility and position, then clock in.', 'At the end, slide to clock out. Your supervisor reviews punches before payroll.'],
      tip: 'We check your location once, at the moment you clock in. We never track you.',
    },
    fr: {
      title: 'Pointer l’arrivée et la sortie',
      summary: 'Glissez pour pointer votre quart, puis pour pointer la sortie.',
      steps: ['Ouvrez Aujourd’hui, ou touchez Pointer en haut de n’importe quel écran.', 'Glissez le bouton vers la droite. Si votre quart commence dans 30 minutes ou est en cours, vous y êtes pointé.', 'Pas de quart en ce moment? Choisissez l’installation et le poste, puis pointez.', 'À la fin, glissez pour pointer la sortie. Votre superviseur révise les pointages avant la paie.'],
      tip: 'Nous vérifions votre position une seule fois, au moment du pointage. Nous ne vous suivons jamais.',
    },
  },
  {
    slug: 'headcount',
    audience: 'staff',
    en: {
      title: 'Counting bathers on rotation',
      summary: 'Use the clicker, then save so the next person picks up your count.',
      steps: ['Open Headcount (Count on phones) and tap your pool.', 'Tap + and −, or the quick +5, +10 and +20 buttons.', 'Tap Save count. The bar turns amber near capacity and red over it.', 'Over capacity? Stop entry and tell the head guard; they’ve been alerted too.'],
    },
    fr: {
      title: 'Compter les baigneurs en rotation',
      summary: 'Utilisez le compteur, puis enregistrez pour que la personne suivante reprenne votre compte.',
      steps: ['Ouvrez Dénombrement (Compter sur téléphone) et touchez votre bassin.', 'Touchez + et −, ou les raccourcis +5, +10 et +20.', 'Touchez Enregistrer. La barre passe à l’orange près de la capacité et au rouge au-delà.', 'Capacité dépassée? Arrêtez les entrées et avisez le sauveteur en chef, qui a aussi été alerté.'],
    },
  },
  {
    slug: 'pick-up-a-shift',
    audience: 'staff',
    en: {
      title: 'Picking up and giving away shifts',
      summary: 'Use the shift board to swap shifts with coworkers.',
      steps: ['Open Shift board to see open shifts you’re eligible for.', 'Tap Claim. If it would put you into overtime, a supervisor approves it first.', 'To give away a shift, open it from My schedule and choose Post to board.', 'You stay on the shift until someone takes it.'],
    },
    fr: {
      title: 'Prendre et céder des quarts',
      summary: 'Utilisez le babillard pour échanger des quarts avec vos collègues.',
      steps: ['Ouvrez Babillard des quarts pour voir les quarts ouverts auxquels vous êtes admissible.', 'Touchez Réclamer. S’il vous ferait faire des heures supplémentaires, un superviseur l’approuve d’abord.', 'Pour céder un quart, ouvrez-le depuis Mon horaire et choisissez Afficher au babillard.', 'Le quart reste le vôtre jusqu’à ce que quelqu’un le prenne.'],
    },
  },
  {
    slug: 'build-the-schedule',
    audience: 'leads',
    en: {
      title: 'Building and publishing the schedule',
      summary: 'Draft the week, fill it with the assistant, then publish.',
      steps: ['Open Schedule builder and choose the facility and week.', 'Add shifts on each day, or copy from a past week.', 'Tap Fill with assistant: it proposes people and explains each pick against the rules.', 'Publish. Staff are notified and open shifts go to the board.'],
    },
    fr: {
      title: 'Préparer et publier l’horaire',
      summary: 'Ébauchez la semaine, remplissez-la avec l’assistant, puis publiez.',
      steps: ['Ouvrez Préparation d’horaire et choisissez l’installation et la semaine.', 'Ajoutez des quarts chaque jour, ou copiez une semaine passée.', 'Touchez Remplir avec l’assistant : il propose des personnes et justifie chaque choix selon les règles.', 'Publiez. Le personnel est avisé et les quarts ouverts vont au babillard.'],
    },
  },
  {
    slug: 'water-chemistry',
    audience: 'leads',
    en: {
      title: 'Water chemistry and closures',
      summary: 'Record readings, sign them off, and handle closure recommendations.',
      steps: ['Set each pool’s permit limits in Settings → Pools.', 'Record readings in Water chemistry. Out-of-range readings recommend a closure.', 'A head guard confirms or dismisses the closure, with a reason.', 'Use the Report tab for inspections: 7 or 30 days, by pool, with a CSV download.'],
    },
    fr: {
      title: 'Chimie de l’eau et fermetures',
      summary: 'Inscrivez les lectures, approuvez-les et traitez les recommandations de fermeture.',
      steps: ['Indiquez les limites du permis de chaque bassin dans Paramètres → Bassins.', 'Inscrivez les lectures dans Chimie de l’eau. Une lecture hors limites recommande une fermeture.', 'Un sauveteur en chef confirme ou rejette la fermeture, avec un motif.', 'Utilisez l’onglet Rapport pour les inspections : 7 ou 30 jours, par bassin, avec téléchargement CSV.'],
    },
  },
  {
    slug: 'people-review',
    audience: 'leads',
    en: {
      title: 'People review and documenting discipline',
      summary: 'See who may need a conversation, why, and write a record that holds up.',
      steps: [
        'Open Manage, then People review. "Needs attention" lists people whose facts crossed a threshold, with the reason for each flag.',
        'Open someone to see their case file: attendance events, supervisors’ notes and records in one timeline. Excuse an event or retract a note with a reason if it shouldn’t count.',
        'Use Record attendance for what the timeclock can’t see, like a missed in-service, and Add a note for conduct, performance, safety or a commendation. Link the incident if there is one.',
        'Have the conversation first. Then choose Start a record, pick the step, tick the facts it relies on and complete the drafted summary: impact, what was discussed, expectation, support and next step.',
        'For a suspension or termination (HR only), confirm each fair-process step. The employee is notified, signs to confirm they received it, and can add their own response.',
      ],
      tip: 'The typical next step is a suggestion. Your policy, your collective agreement and the seriousness of what happened decide; when you skip steps, say why in the summary.',
    },
    fr: {
      title: 'Suivi du personnel et documentation disciplinaire',
      summary: 'Voyez qui pourrait avoir besoin d’une discussion, pourquoi, et rédigez un dossier solide.',
      steps: [
        'Ouvrez Gestion, puis Suivi du personnel. « À examiner » liste les personnes dont les faits ont dépassé un seuil, avec la raison de chaque signalement.',
        'Ouvrez une personne pour voir son dossier : événements d’assiduité, notes des superviseurs et dossiers sur une seule ligne du temps. Excusez un événement ou retirez une note avec une raison s’il ne doit pas compter.',
        'Utilisez Consigner l’assiduité pour ce que le pointage ne voit pas, comme une formation manquée, et Ajouter une note pour la conduite, le rendement, la sécurité ou une mention d’éloge. Liez l’incident s’il y en a un.',
        'Tenez d’abord la discussion. Choisissez ensuite Ouvrir un dossier, l’étape, cochez les faits sur lesquels il repose et complétez le résumé rédigé : conséquences, discussion, attente, soutien et suite.',
        'Pour une suspension ou un congédiement (RH seulement), confirmez chaque étape d’équité. L’employé est avisé, signe pour confirmer la réception et peut ajouter sa propre réponse.',
      ],
      tip: 'L’étape habituelle suivante est une suggestion. Votre politique, votre convention collective et la gravité des faits décident; si vous sautez des étapes, expliquez pourquoi dans le résumé.',
    },
  },
  {
    slug: 'my-file',
    audience: 'staff',
    en: {
      title: 'Your file and your right to respond',
      summary: 'See what your managers see, and add your side to any record.',
      steps: [
        'Open your profile and scroll to My file. You see your attendance score, every event and note, and any records.',
        'Sick days and protected leave never count. If something is wrong, ask your supervisor to excuse it; the reason stays visible to you.',
        'On a record, choose Add my response to give your account. It stays with the record for anyone who reads it.',
        'Choose How this works for a plain explanation of what is tracked and how it is used.',
      ],
      tip: 'Signing a record confirms you received it, not that you agree with it.',
    },
    fr: {
      title: 'Votre dossier et votre droit de réponse',
      summary: 'Voyez ce que voient vos gestionnaires, et ajoutez votre version à tout dossier.',
      steps: [
        'Ouvrez votre profil et descendez jusqu’à Mon dossier. Vous y voyez votre score d’assiduité, chaque événement et chaque note, et vos dossiers.',
        'Les congés de maladie et protégés ne comptent jamais. Si quelque chose est inexact, demandez à votre superviseur de l’excuser; la raison reste visible pour vous.',
        'Dans un dossier, choisissez Ajouter ma réponse pour donner votre version. Elle reste avec le dossier pour quiconque le lit.',
        'Choisissez Comment ça fonctionne pour une explication simple de ce qui est suivi et de son utilisation.',
      ],
      tip: 'Signer un dossier confirme que vous l’avez reçu, pas que vous êtes d’accord.',
    },
  },
  {
    slug: 'import-staff',
    audience: 'admin',
    en: {
      title: 'Importing staff from a spreadsheet',
      summary: 'Upload a CSV, check every row, then import.',
      steps: ['Add your positions first so they can be matched.', 'Download the template, or export your HR list as CSV.', 'Upload it: every row is checked and problems are explained line by line.', 'Import the ready rows, with or without invitation emails. Fix the rest and upload again; nobody is added twice.'],
    },
    fr: {
      title: 'Importer le personnel d’un chiffrier',
      summary: 'Téléversez un CSV, vérifiez chaque ligne, puis importez.',
      steps: ['Ajoutez d’abord vos postes pour qu’ils soient reconnus.', 'Téléchargez le modèle, ou exportez votre liste RH en CSV.', 'Téléversez-le : chaque ligne est vérifiée et les problèmes expliqués.', 'Importez les lignes prêtes, avec ou sans courriel d’invitation. Corrigez les autres et téléversez de nouveau; personne n’est ajouté deux fois.'],
    },
  },
  {
    slug: 'payroll-export',
    audience: 'admin',
    en: {
      title: 'Exporting payroll',
      summary: 'Download approved hours as a CSV for your payroll system.',
      steps: ['Approve open punches in Approvals.', 'Open Payroll export and choose the first day and length of the pay period.', 'Confirm it’s you (passkey or password), then download.', 'If something would make your payroll system reject the file, it’s listed with a link to fix it.'],
    },
    fr: {
      title: 'Exporter la paie',
      summary: 'Téléchargez les heures approuvées en CSV pour votre système de paie.',
      steps: ['Approuvez les pointages ouverts dans Approbations.', 'Ouvrez Exportation de la paie et choisissez le premier jour et la durée de la période.', 'Confirmez votre identité (clé d’accès ou mot de passe), puis téléchargez.', 'Si un élément ferait rejeter le fichier, il est listé avec un lien pour le corriger.'],
    },
  },
  {
    slug: 'city-roles',
    audience: 'admin',
    en: {
      title: 'Roles for water works, maintenance and parks',
      summary: 'Give non-aquatic staff their own roles without pool screens.',
      steps: ['Open Settings → Roles and add a role, e.g. Water Works Operator.', 'Choose what it can do: own work, shift board, or leading a team.', 'Assign it from Staff or in the import file’s roles column.', 'People with only city roles never see pool, chemistry, headcount or incident screens.'],
    },
    fr: {
      title: 'Rôles pour l’aqueduc, l’entretien et les parcs',
      summary: 'Donnez au personnel hors aquatique ses propres rôles, sans écrans de piscine.',
      steps: ['Ouvrez Paramètres → Rôles et ajoutez un rôle, p. ex. Opérateur d’aqueduc.', 'Choisissez ses permissions : son propre travail, babillard, ou diriger une équipe.', 'Attribuez-le depuis Personnel ou dans la colonne roles du fichier d’importation.', 'Les personnes n’ayant qu’un rôle municipal ne voient jamais les écrans de piscine, de chimie, de dénombrement ou d’incident.'],
    },
  },
];

export const articleIn = (a: Article, lang: Lang) => (lang === 'fr' ? a.fr : a.en);
