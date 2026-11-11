/**
 * Website legal pages. These are drafts: they describe how the product and
 * this site actually work, and must be reviewed by counsel before launch.
 */
import type { Lang } from './copy';
import { COMPANY } from '../lib/site';

export interface LegalSection { heading: string; body: string[] }
export interface LegalDoc { updated: string; intro: string; sections: LegalSection[] }
type Doc = 'privacy' | 'accessibility' | 'terms' | 'copyright';

const DOCS: Record<Doc, Record<Lang, LegalDoc>> = {
  privacy: {
    en: {
      updated: '2026-11-11',
      intro: 'This notice explains what personal information FlexcityHeadquarters collects through this website and through the FlexcityHeadquarters application, why, and the choices you have. It is written to meet the Personal Information Protection and Electronic Documents Act (PIPEDA), Quebec’s Act respecting the protection of personal information in the private sector (Law 25), and the privacy expectations of the public bodies we serve.',
      sections: [
        {
          heading: 'This website',
          body: [
            'The site does not use cookies, advertising pixels or session recording (nothing records your screen, clicks or typing). To count visits, it uses Vercel Web Analytics, run by our hosting provider: it records the pages viewed, the referring site, and the country, browser and type of device, without cookies and without identifying you; visitors are told apart only by a hash that changes every day.',
            'You can turn this counting off with the “Analytics” switch at the bottom of every page (remembered in your browser). It is also off automatically if your browser sends a Global Privacy Control or Do Not Track signal.',
            'When you send the contact form we collect your name, work email, organization, role, province, number of facilities and your message. We use them only to reply and, if you tick the box, to send product news. We keep a record of the wording you agreed to and when, as Canada’s Anti-Spam Legislation (CASL) requires. Because you wrote to us, we may also follow up on your enquiry by email for up to six months (implied consent under CASL); every such message identifies us, gives our mailing address and has a one-click unsubscribe link that takes effect immediately.',
            'The contact form is for organizations. It is not meant for children, and we ask you not to include information about children in your message.',
            'Our hosting provider keeps standard server logs (IP address, browser, pages requested) for security for a short period.',
          ],
        },
        {
          heading: 'The application: who is responsible',
          body: [
            'When a municipality or club uses FlexcityHeadquarters, that organization decides what information about its staff is collected and is responsible for it under the privacy or access-to-information law that applies to it (for example MFIPPA in Ontario or FIPPA in British Columbia). FlexcityHeadquarters acts as its service provider and processes that information only on the organization’s instructions and under a written agreement.',
            'Staff questions or access requests about their employment records should go first to their employer’s privacy or FOI coordinator. We will help the employer answer.',
          ],
        },
        {
          heading: 'What the application holds',
          body: [
            'Work contact details, positions, certifications, availability, schedules, time punches (with location only at the moment of punching, to confirm you are on site), time-off requests, pay rates and payroll hours, onboarding checks (only that a check was seen, when and by whom; never its result, a SIN or banking details), work restrictions for accommodation, pool operations logs and encrypted incident reports.',
            'Union Hub records are kept in a separate database area with their own encryption key per union local, and the employer cannot read them.',
            'Passkeys (Face ID, fingerprint, Windows Hello) never leave your device: we store only a public key.',
          ],
        },
        {
          heading: 'Attendance and people review',
          body: [
            'The application keeps an attendance score and lets supervisors write notes about conduct, performance and safety, including commendations. Employers use them to notice when a conversation may help and to document discipline.',
            'Nothing is decided automatically: a person makes every decision, sick days and protected leave never count, and being named in an incident report never counts. Employees can see their own file, ask for corrections, and add a written response to any record. Every time a manager opens a file, it is logged.',
          ],
        },
        {
          heading: 'Your agreement at first sign-in',
          body: [
            'The first time you sign in, the application explains what it collects, why and who sees it, and asks for your two optional permissions: notifications, and location (checked once at clock-in, and shared only during a working-alone session you start). You choose each one, then sign with your name and a drawn or typed signature.',
            'A copy is kept as a record that you were informed: the exact version and language you saw with its fingerprint, your signature, your choices, the time, and your device’s internet address and browser. It can’t be changed. When the text changes, you are asked to read and sign the new version.',
          ],
        },
        {
          heading: 'Safeguards',
          body: [
            'Each organization’s data is separated at the database level with row-level security. Passwords are hashed, sensitive changes require you to confirm your identity again, and administrative actions are written to an audit log.',
            'Access within FlexcityHeadquarters is limited to staff who need it to provide support, and every such access is logged.',
          ],
        },
        {
          heading: 'Where information is stored',
          body: [
            'The application is built to be hosted in Canada (AWS, Montréal region); it is not yet in production. Where a customer’s contract or provincial law requires Canadian residency, we confirm the hosting location in writing before go-live. This website and its contact form may be served from outside Canada.',
          ],
        },
        {
          heading: 'Retention',
          body: [
            'Payroll and time records are kept for the period the employer sets (at least the minimum required by provincial employment-standards law, commonly three to six years). Website enquiries are kept for up to two years after our last exchange unless you become a customer.',
          ],
        },
        {
          heading: 'Your rights',
          body: [
            'You can ask to see or correct the personal information we hold about you, withdraw consent to marketing email at any time (every message has an unsubscribe link), or make a complaint. If you are not satisfied with our answer you can contact the Office of the Privacy Commissioner of Canada or, in Quebec, the Commission d’accès à l’information.',
          ],
        },
        {
          heading: 'Privacy officer',
          body: ['Our privacy officer can be reached through the contact page. We reply within 30 days.'],
        },
      ],
    },
    fr: {
      updated: '2026-11-11',
      intro: 'Le présent avis explique quels renseignements personnels FlexcityHeadquarters recueille par ce site et par l’application FlexcityHeadquarters, pourquoi, et quels choix vous avez. Il vise à respecter la Loi sur la protection des renseignements personnels et les documents électroniques (LPRPDE), la Loi sur la protection des renseignements personnels dans le secteur privé du Québec (Loi 25) et les attentes des organismes publics que nous servons.',
      sections: [
        {
          heading: 'Ce site',
          body: [
            'Le site n’utilise ni témoins (cookies), ni pixels publicitaires, ni enregistrement de session (rien n’enregistre votre écran, vos clics ou votre saisie). Pour compter les visites, il utilise Vercel Web Analytics, fourni par notre hébergeur : l’outil consigne les pages consultées, le site d’où vous venez, ainsi que le pays, le navigateur et le type d’appareil, sans témoins et sans vous identifier; les visiteurs ne sont distingués que par une empreinte qui change chaque jour.',
            'Vous pouvez désactiver ce décompte avec l’interrupteur « Statistiques » au bas de chaque page (le choix est mémorisé dans votre navigateur). Il est aussi désactivé automatiquement si votre navigateur envoie un signal Global Privacy Control ou « Ne pas me suivre ».',
            'Lorsque vous envoyez le formulaire de contact, nous recueillons votre nom, votre courriel professionnel, votre organisation, votre rôle, votre province, le nombre d’installations et votre message. Nous les utilisons seulement pour vous répondre et, si vous cochez la case, pour vous envoyer des nouvelles. Nous conservons le libellé accepté et la date, comme l’exige la Loi canadienne anti-pourriel (LCAP). Comme vous nous avez écrit, nous pouvons aussi faire un suivi de votre demande par courriel pendant au plus six mois (consentement tacite au sens de la LCAP); chacun de ces messages nous identifie, donne notre adresse postale et comporte un lien de désabonnement en un clic qui prend effet immédiatement.',
            'Le formulaire de contact s’adresse aux organisations. Il n’est pas destiné aux enfants, et nous vous demandons de ne pas inclure de renseignements sur des enfants dans votre message.',
            'Notre hébergeur conserve brièvement des journaux de serveur standards (adresse IP, navigateur, pages consultées) à des fins de sécurité.',
          ],
        },
        {
          heading: 'L’application : qui est responsable',
          body: [
            'Lorsqu’une municipalité ou un club utilise FlexcityHeadquarters, c’est cette organisation qui décide des renseignements recueillis sur son personnel et qui en est responsable en vertu de la loi sur l’accès à l’information ou la protection des renseignements personnels qui s’applique à elle. FlexcityHeadquarters agit comme son fournisseur de services et traite ces renseignements uniquement selon ses instructions et en vertu d’une entente écrite.',
            'Les questions ou demandes d’accès du personnel concernant leur dossier d’emploi doivent d’abord être adressées au responsable de l’accès à l’information de l’employeur. Nous aiderons l’employeur à y répondre.',
          ],
        },
        {
          heading: 'Ce que contient l’application',
          body: [
            'Coordonnées professionnelles, postes, certifications, disponibilités, horaires, pointages (avec la position uniquement au moment du pointage, pour confirmer votre présence sur place), demandes de congé, taux de salaire et heures de paie, vérifications d’intégration (seulement le fait qu’elles ont été vues, quand et par qui; jamais le résultat, un NAS ou des coordonnées bancaires), restrictions de travail liées aux mesures d’adaptation, registres d’exploitation des bassins et rapports d’incident chiffrés.',
            'Les dossiers du Carrefour syndical sont conservés dans une zone distincte de la base de données, chiffrés avec une clé propre à chaque section locale, et l’employeur ne peut pas les lire.',
            'Les clés d’accès (Face ID, empreinte, Windows Hello) ne quittent jamais votre appareil : nous ne conservons qu’une clé publique.',
          ],
        },
        {
          heading: 'Assiduité et suivi du personnel',
          body: [
            'L’application tient un score d’assiduité et permet aux superviseurs de rédiger des notes sur la conduite, le rendement et la sécurité, y compris des mentions d’éloge. Les employeurs s’en servent pour voir quand une discussion pourrait aider et pour documenter la discipline.',
            'Rien n’est décidé automatiquement : une personne prend chaque décision, les congés de maladie et protégés ne comptent jamais, et être nommé dans un rapport d’incident ne compte jamais. Le personnel peut consulter son dossier, demander des corrections et ajouter une réponse écrite à tout dossier. Chaque consultation par un gestionnaire est consignée.',
          ],
        },
        {
          heading: 'Votre entente à la première connexion',
          body: [
            'À votre première connexion, l’application explique ce qu’elle recueille, pourquoi et qui y a accès, et vous demande vos deux autorisations facultatives : les notifications, et la position (vérifiée une fois au pointage, et partagée seulement pendant une séance de travail seul que vous commencez). Vous choisissez chacune, puis signez de votre nom et d’une signature dessinée ou tapée.',
            'Une copie est conservée comme preuve que vous avez été informé : la version et la langue exactes affichées avec leur empreinte, votre signature, vos choix, l’heure, ainsi que l’adresse Internet et le navigateur de votre appareil. Elle ne peut pas être modifiée. Quand le texte change, on vous demande de lire et de signer la nouvelle version.',
          ],
        },
        {
          heading: 'Mesures de protection',
          body: [
            'Les données de chaque organisation sont séparées au niveau de la base de données par la sécurité au niveau des lignes. Les mots de passe sont hachés, les changements sensibles exigent de confirmer votre identité à nouveau et les actions administratives sont consignées dans un journal d’audit.',
            'Chez FlexcityHeadquarters, l’accès est limité au personnel qui en a besoin pour le soutien, et chaque accès est consigné.',
          ],
        },
        {
          heading: 'Lieu de conservation',
          body: [
            'L’application est conçue pour être hébergée au Canada (AWS, région de Montréal); elle n’est pas encore en production. Lorsque le contrat ou la loi provinciale exige une résidence canadienne, nous confirmons le lieu d’hébergement par écrit avant la mise en service. Ce site et son formulaire de contact peuvent être servis depuis l’extérieur du Canada.',
          ],
        },
        {
          heading: 'Conservation',
          body: [
            'Les dossiers de paie et de temps sont conservés pendant la période fixée par l’employeur (au moins le minimum exigé par les normes du travail provinciales, généralement de trois à six ans). Les demandes reçues par le site sont conservées jusqu’à deux ans après notre dernier échange, sauf si vous devenez client.',
          ],
        },
        {
          heading: 'Vos droits',
          body: [
            'Vous pouvez demander à consulter ou à corriger les renseignements que nous détenons sur vous, retirer votre consentement aux courriels promotionnels en tout temps (chaque message comporte un lien de désabonnement) ou porter plainte. Si notre réponse ne vous satisfait pas, vous pouvez communiquer avec le Commissariat à la protection de la vie privée du Canada ou, au Québec, avec la Commission d’accès à l’information.',
          ],
        },
        {
          heading: 'Responsable de la protection des renseignements personnels',
          body: ['Notre responsable est joignable par la page de contact. Nous répondons dans un délai de 30 jours.'],
        },
      ],
    },
  },
  accessibility: {
    en: {
      updated: '2026-11-09',
      intro: 'We want everyone on a city team, and everyone evaluating us, to be able to use FlexcityHeadquarters and this website. Our target is WCAG 2.1 level AA, the standard referenced by Ontario’s AODA, the Accessible Canada Act and most municipal procurement.',
      sections: [
        {
          heading: 'What we design for',
          body: [
            'Full keyboard use, visible focus, skip links and landmarks; labels on every form field; text and controls that meet contrast ratios in light and dark mode; layouts that work at 400% zoom and on phones; touch targets at least 44 pixels; animations that stop when your device asks for reduced motion.',
            'Everything is available in English and Canadian French.',
          ],
        },
        {
          heading: 'Known limitations',
          body: [
            'Some charts in reports are summarized in text but not yet as data tables. Uploaded documents such as certification scans are only as accessible as the file provided.',
            'We have not yet completed an independent audit, so we do not claim conformance; one is planned before general availability.',
          ],
        },
        {
          heading: 'Feedback and alternate formats',
          body: ['Tell us about a barrier or ask for information in another format through the contact page. We acknowledge within two business days.'],
        },
      ],
    },
    fr: {
      updated: '2026-11-09',
      intro: 'Nous voulons que toute l’équipe municipale, et toute personne qui nous évalue, puisse utiliser FlexcityHeadquarters et ce site. Notre cible est le niveau AA des WCAG 2.1, la norme citée par la LAPHO de l’Ontario, la Loi canadienne sur l’accessibilité et la plupart des appels d’offres municipaux.',
      sections: [
        {
          heading: 'Ce que nous visons',
          body: [
            'Utilisation complète au clavier, focus visible, liens d’évitement et repères; étiquette pour chaque champ; contrastes conformes en mode clair et sombre; mises en page fonctionnelles à 400 % de zoom et sur téléphone; cibles tactiles d’au moins 44 pixels; animations qui s’arrêtent lorsque votre appareil demande moins de mouvement.',
            'Tout est offert en anglais et en français canadien.',
          ],
        },
        {
          heading: 'Limites connues',
          body: [
            'Certains graphiques des rapports sont résumés en texte, mais pas encore sous forme de tableaux de données. Les documents téléversés, comme les certifications numérisées, ne sont accessibles que dans la mesure où le fichier fourni l’est.',
            'Aucune vérification indépendante n’a encore été réalisée, et nous ne déclarons donc pas la conformité; elle est prévue avant la disponibilité générale.',
          ],
        },
        {
          heading: 'Commentaires et formats de rechange',
          body: ['Signalez un obstacle ou demandez un autre format par la page de contact. Nous en accusons réception dans un délai de deux jours ouvrables.'],
        },
      ],
    },
  },
  terms: {
    en: {
      updated: '2026-11-11',
      intro: 'These terms cover your use of this website and the public demo. Use of the FlexcityHeadquarters application by an organization is governed by the subscription agreement signed with that organization, which prevails over these terms.',
      sections: [
        { heading: 'The demo', body: ['The demo uses invented people and a fictional city. Do not enter real personal information. Nothing you do in the demo is saved.'] },
        { heading: 'Information on this site', body: ['Prices and features are described in good faith and may change; a written quote or agreement is binding. Employment-standards and pool-safety information is general and is not legal advice. Each organization remains responsible for meeting the law that applies to it.'] },
        { heading: 'Acceptable use', body: ['Do not try to break, overload or probe the site or demo for weaknesses except through a responsible disclosure arranged with us through the contact page.'] },
        { heading: 'Liability', body: ['The site and demo are provided as is. To the extent permitted by law, we are not liable for indirect losses arising from their use.'] },
        { heading: 'Subscriptions and renewal', body: ['Prices on this site are per month, before applicable taxes (GST/HST, and QST in Quebec). Your written quote and subscription agreement confirm the price, how often you are invoiced (monthly, yearly or the whole term up front) and the length of the term. When a term ends it renews automatically month to month at the same rates, without the commitment discount, until you sign a new term or cancel. We email your billing contact a reminder 30 days before a term ends. To cancel, write to us before the end of the term (or, month to month, before the next month starts); nothing further is invoiced after the period already billed.'] },
        { heading: 'Content customers upload', body: ['Organizations using the application are responsible for the documents, logos, résumés and other files they upload. If you believe something stored on the service infringes your copyright, see our Copyright notices page for how to send a notice under the Copyright Act.'] },
        { heading: 'Copyright and trademarks', body: ['© 2026 FlexcityHeadquarters. All rights reserved. The FlexcityHeadquarters name, logo, application, screenshots and the text and design of this site are protected by copyright and may not be copied or reused without written permission. Organization names and logos shown belong to their owners.'] },
        { heading: 'Governing law', body: ['These terms are governed by the laws of the province of British Columbia and the federal laws of Canada that apply there, unless the law of your province requires otherwise.'] },
      ],
    },
    fr: {
      updated: '2026-11-11',
      intro: 'Les présentes conditions encadrent l’utilisation de ce site et de la démo publique. L’utilisation de l’application FlexcityHeadquarters par une organisation est régie par l’entente d’abonnement conclue avec elle, qui a préséance sur les présentes.',
      sections: [
        { heading: 'La démo', body: ['La démo utilise des personnes inventées et une ville fictive. N’y entrez aucun renseignement personnel réel. Rien n’y est enregistré.'] },
        { heading: 'Information sur ce site', body: ['Les prix et fonctions sont décrits de bonne foi et peuvent changer; seule une soumission ou une entente écrite engage. L’information sur les normes du travail et la sécurité aquatique est générale et ne constitue pas un avis juridique. Chaque organisation demeure responsable de respecter la loi qui s’applique à elle.'] },
        { heading: 'Utilisation acceptable', body: ['N’essayez pas de briser, de surcharger ou de sonder le site ou la démo, sauf dans le cadre d’une divulgation responsable convenue avec nous par la page de contact.'] },
        { heading: 'Responsabilité', body: ['Le site et la démo sont fournis tels quels. Dans la mesure permise par la loi, nous ne sommes pas responsables des pertes indirectes découlant de leur utilisation.'] },
        { heading: 'Abonnements et renouvellement', body: ['Les prix affichés sur ce site sont mensuels, avant les taxes applicables (TPS/TVH, et TVQ au Québec). Votre soumission écrite et votre entente d’abonnement confirment le prix, la fréquence de facturation (au mois, à l’année ou toute la durée d’avance) et la durée de l’engagement. À la fin de la durée, l’abonnement se renouvelle automatiquement au mois, aux mêmes tarifs, sans le rabais d’engagement, jusqu’à ce que vous signiez une nouvelle durée ou que vous résiliiez. Nous envoyons un rappel par courriel à votre contact de facturation 30 jours avant la fin d’une durée. Pour résilier, écrivez-nous avant la fin de la durée (ou, au mois, avant le début du mois suivant); rien n’est facturé au-delà de la période déjà facturée.'] },
        { heading: 'Contenu téléversé par les clients', body: ['Les organisations qui utilisent l’application sont responsables des documents, logos, curriculum vitæ et autres fichiers qu’elles téléversent. Si vous croyez qu’un contenu hébergé sur le service viole votre droit d’auteur, consultez notre page Avis relatifs au droit d’auteur pour savoir comment envoyer un avis en vertu de la Loi sur le droit d’auteur.'] },
        { heading: 'Droit d’auteur et marques', body: ['© 2026 FlexcityHeadquarters. Tous droits réservés. Le nom, le logo, l’application et les captures d’écran FlexcityHeadquarters ainsi que le texte et la conception de ce site sont protégés par le droit d’auteur et ne peuvent être copiés ni réutilisés sans autorisation écrite. Les noms et logos d’organisations affichés appartiennent à leurs propriétaires.'] },
        { heading: 'Droit applicable', body: ['Les présentes conditions sont régies par les lois de la Colombie-Britannique et les lois fédérales du Canada qui s’y appliquent, sauf si la loi de votre province en exige autrement. Au Québec, la version française prévaut.'] },
      ],
    },
  },
  /**
   * Copyright notices: Canada's notice-and-notice regime, Copyright Act ss. 41.25–41.27 (in force
   * 2015; s. 41.25(3) content limits added 2018). FH provides the digital memory (hosting) for its
   * customers' files. Internal procedure: docs/LEGAL-OPS.md. Draft for counsel review.
   */
  copyright: {
    en: {
      updated: '2026-11-11',
      intro: 'Organizations that use FlexcityHeadquarters store files in it: documents, policies, logos, photos and job applicants’ résumés. If you believe content stored on the service infringes your copyright, Canada’s Copyright Act sets out a notice-and-notice system (sections 41.25 to 41.27). This page explains how to send us a notice and what we do with it.',
      sections: [
        { heading: 'Who is responsible for uploaded content', body: ['Each customer organization decides what it uploads and is responsible for it under its subscription agreement with us. We provide the storage; we do not review or choose the files customers upload.'] },
        {
          heading: 'How to send a notice of claimed infringement',
          body: [
            'A notice must be in writing (email or mail) and must state, as section 41.25(2) of the Copyright Act requires:',
            '1. your name and address (the claimant’s);',
            '2. the work or other subject matter concerned, and your interest or right in it;',
            '3. the location data: the web address, or a description of where the file is in the service (for example the organization’s address, the page and the file name);',
            '4. the infringement you claim;',
            '5. the date and time of the alleged infringement;',
            '6. any other information prescribed by regulation.',
          ],
        },
        { heading: 'Where to send it', body: [`${COMPANY.copyrightContact.name}, ${COMPANY.copyrightContact.address}. Email: ${COMPANY.copyrightContact.email}.`] },
        {
          heading: 'What we do when we receive a notice',
          body: [
            'When a notice meets the requirements, we forward it electronically, as soon as feasible, to the person to whom the content belongs (the customer organization that uploaded it, through its administrator), and we tell you that it was forwarded. If we cannot forward it, we tell you why.',
            'We keep records that allow that person to be identified for six months from the day we receive the notice, or for one year if, within those six months, you start proceedings about the claimed infringement and tell us so.',
            'We do not charge a fee for this: none is set by regulation.',
            'We do not give you the identity of the organization or person concerned. Disclosing it requires a court order.',
          ],
        },
        { heading: 'Notices we cannot forward', body: ['Under section 41.25(3), a notice is not valid if it contains an offer to settle the claimed infringement, a request or demand for payment or for personal information, or a reference (including a link) to such an offer, request or demand. We do not forward those notices.'] },
        { heading: 'Removing or disabling content', body: ['The notice-and-notice system does not require us to remove content, and forwarding a notice is not a finding that anything infringes. Where the customer agreement allows, we may remove or disable access to content, for example content that is clearly unlawful or that a court orders removed, and we tell the customer when we do.'] },
        { heading: 'Not legal advice', body: ['This page explains our process; it is not legal advice. If you are unsure whether you have a claim, consult a lawyer.'] },
      ],
    },
    fr: {
      updated: '2026-11-11',
      intro: 'Les organisations qui utilisent FlexcityHeadquarters y conservent des fichiers : documents, politiques, logos, photos et curriculum vitæ de candidats. Si vous croyez qu’un contenu hébergé sur le service viole votre droit d’auteur, la Loi sur le droit d’auteur du Canada prévoit un régime d’avis et avis (articles 41.25 à 41.27). Cette page explique comment nous envoyer un avis et ce que nous en faisons.',
      sections: [
        { heading: 'Qui est responsable du contenu téléversé', body: ['Chaque organisation cliente décide de ce qu’elle téléverse et en est responsable aux termes de son entente d’abonnement avec nous. Nous fournissons le stockage; nous n’examinons ni ne choisissons les fichiers que les clients téléversent.'] },
        {
          heading: 'Comment envoyer un avis de prétendue violation',
          body: [
            'L’avis doit être écrit (courriel ou courrier) et préciser, comme l’exige le paragraphe 41.25(2) de la Loi sur le droit d’auteur :',
            '1. vos nom et adresse (ceux du demandeur);',
            '2. l’œuvre ou l’autre objet du droit d’auteur en cause, et vos droits ou intérêts à son égard;',
            '3. les données de localisation : l’adresse Web ou une description de l’endroit où se trouve le fichier dans le service (par exemple l’adresse de l’organisation, la page et le nom du fichier);',
            '4. la violation que vous alléguez;',
            '5. la date et l’heure de la prétendue violation;',
            '6. tout autre renseignement prévu par règlement.',
          ],
        },
        { heading: 'Où l’envoyer', body: [`${COMPANY.copyrightContact.name}, ${COMPANY.copyrightContact.address}. Courriel : ${COMPANY.copyrightContact.email}.`] },
        {
          heading: 'Ce que nous faisons à la réception d’un avis',
          body: [
            'Lorsqu’un avis respecte les exigences, nous le transmettons par voie électronique, dès que possible, à la personne à qui appartient le contenu (l’organisation cliente qui l’a téléversé, par l’entremise de son administrateur), et nous vous informons de cette transmission. Si nous ne pouvons pas le transmettre, nous vous en donnons la raison.',
            'Nous conservons les registres permettant d’identifier cette personne pendant six mois à compter de la réception de l’avis, ou pendant un an si, dans ces six mois, vous intentez une procédure relative à la prétendue violation et nous en avisez.',
            'Nous n’exigeons aucuns droits pour ce faire : aucun montant n’est fixé par règlement.',
            'Nous ne vous communiquons pas l’identité de l’organisation ou de la personne en cause. Sa divulgation exige une ordonnance du tribunal.',
          ],
        },
        { heading: 'Avis que nous ne pouvons pas transmettre', body: ['Selon le paragraphe 41.25(3), un avis n’est pas valide s’il contient une offre de règlement de la prétendue violation, une demande ou exigence de paiement ou de renseignements personnels, ou un renvoi (y compris par hyperlien) à une telle offre, demande ou exigence. Nous ne transmettons pas ces avis.'] },
        { heading: 'Retrait ou blocage d’un contenu', body: ['Le régime d’avis et avis ne nous oblige pas à retirer un contenu, et la transmission d’un avis ne constitue pas une conclusion de violation. Lorsque l’entente avec le client le permet, nous pouvons retirer un contenu ou en bloquer l’accès, par exemple un contenu manifestement illicite ou dont un tribunal ordonne le retrait, et nous en informons le client.'] },
        { heading: 'Pas un avis juridique', body: ['Cette page décrit notre processus; elle ne constitue pas un avis juridique. En cas de doute sur votre réclamation, consultez un avocat.'] },
      ],
    },
  },
};

export const legalDoc = (doc: Doc, lang: Lang) => DOCS[doc][lang];
export type { Doc as LegalDocName };
