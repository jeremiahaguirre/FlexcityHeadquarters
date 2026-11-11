/**
 * Website legal pages (EN/FR). These are drafts written to describe how the product and this site
 * actually work; they do not replace review by a lawyer, and must be reviewed by counsel before
 * launch (docs/COMPLIANCE.md lists every judgment call). Company details come from config
 * (lib/site.ts COMPANY): until set, the pages show clearly marked placeholders, never invented facts.
 *
 * Each page has a version and a "last updated" date; bump both when the text changes.
 */
import type { Lang } from './copy';
import { COMPANY } from '../lib/site';

export interface LegalSection { heading: string; body: string[] }
export interface LegalDoc { version: string; updated: string; intro: string; sections: LegalSection[] }
type Doc = 'privacy' | 'accessibility' | 'terms' | 'copyright' | 'cookies' | 'refunds';

const C = COMPANY;
const officer = `${C.privacyOfficer.name}, ${C.mailingAddress}. Email: ${C.privacyOfficer.email}.`;
const officerFr = `${C.privacyOfficer.name}, ${C.mailingAddress}. Courriel : ${C.privacyOfficer.email}.`;

const DOCS: Record<Doc, Record<Lang, LegalDoc>> = {
  privacy: {
    en: {
      version: '2.1',
      updated: '2026-11-11',
      intro: `This policy explains what personal information ${C.operatingName} (${C.legalName}) handles through this website and the ${C.operatingName} application, why, where it is kept, and your rights. It is written for Canada’s Personal Information Protection and Electronic Documents Act (PIPEDA), Quebec’s Act respecting the protection of personal information in the private sector (Law 25), and the provincial public-sector laws that apply to our municipal customers.`,
      sections: [
        {
          heading: 'Two roles: service provider and organization in charge',
          body: [
            'In the application, we act for our customers (cities, municipalities and private employers). The customer decides what information about its staff, applicants and program participants is collected and is responsible for it under the law that applies to it (for example PIPEDA, Law 25, Alberta’s or BC’s Personal Information Protection Act, or a public-sector law such as BC’s FIPPA or Ontario’s MFIPPA). We process that information only to provide the service, on the customer’s instructions and under a written agreement.',
            'For this website, our marketing and our billing of customers, we decide why and how information is used, and this policy is our commitment to you.',
            'If you work for one of our customers, send questions or access requests about your employment records to your employer’s privacy or FOI coordinator first; we help the employer answer.',
          ],
        },
        {
          heading: 'What we collect, by where you meet us',
          body: [
            'This website: no cookies, advertising pixels or session recording. Page counts through Vercel Web Analytics only if you allow them (see Cookies and similar technologies). The contact form: your name, work email, organization, role, province, number of facilities and message; marketing consent only if you tick the separate box.',
            'Application accounts (staff): work contact details, positions, certifications, availability, schedules, time punches, time-off requests, pay rates and hours, onboarding checks, work restrictions for accommodation, operations logs and incident reports, as your employer sets up.',
            'Clocking in: whether you were at the facility and how far away, when your employer turns location checks on. Your coordinates and internet address are not stored with the punch.',
            'Working alone: if you start a working-alone session, its location label and check-ins; your live location only if you choose to share it during the session. Shared locations are deleted when you turn sharing off, or 30 days after the session.',
            'Shared kiosks: a facility tablet set up by your employer; your kiosk PIN is stored only as a one-way hash.',
            'Text alerts (SMS) and push notifications: only if your employer turns them on and you confirm a mobile number or allow notifications on a device. Message contents are removed from our systems once sent.',
            'Payroll (when your employer runs payroll in the application): your Social Insurance Number and banking details, encrypted with your employer’s own key; only the last digits are ever shown.',
            'Documents: files your employer or you upload (certificates, policies, receipts), encrypted at rest.',
            'Public program sign-up: the parent’s or guardian’s contact details, an emergency contact, an optional address, the participant’s name, date of birth (to place them in the right level), any safety note and an optional photo consent. The person filling the form must be an adult and, for a child, the child’s parent or guardian.',
            'Facility booking requests: the requester’s name, email and phone, and optionally an organization and notes.',
            'Careers page: the applicant’s contact details, message, certifications and optional résumé, and a confirmation of their age range (no date of birth). Applicants aged 14 or 15 give a parent’s or guardian’s name and consent.',
            'Error reports: when something breaks, a scrubbed technical report (error type and message, where in the code it happened, the page path without ids, the build version). Emails, phone numbers, SIN-like and card numbers, tokens and passwords are removed before it leaves; it never contains what you typed into forms, your screen or record contents. Error tracking is off unless we turn it on with a provider hosted in Canada.',
            'Billing (customers): the billing contact, billing address, purchase order number and payment history. Card and bank-debit details entered online are held by our payment processor, not by us.',
          ],
        },
        {
          heading: 'Why we use it, and on what basis',
          body: [
            'To provide the service our customer signed up for (scheduling, time and attendance, payroll, safety, HR), to keep it secure, to support users, to bill customers, and to meet our legal obligations (for example tax records).',
            'Consent: we rely on the consent you give at the time we collect (the notice next to each form and, for staff, the information agreement shown at first sign-in), or on consent implied by the context where the law allows it. Optional uses (marketing email, website analytics, notifications, location sharing) are off unless you choose them, and you can withdraw consent at any time; withdrawing may mean we cannot provide a feature.',
            'Public bodies: when a municipality uses the application, it collects information under the authority of its own legislation, and its notice of collection applies.',
          ],
        },
        {
          heading: 'Automated processing and decisions',
          body: [
            'The application calculates an attendance (reliability) score and offers a scheduling assistant that suggests who could take a shift. These are advisory tools: no decision about a person is made exclusively by automated processing. A supervisor or manager reviews and makes every decision; sick days and protected leave never count; people can see their own file, ask for corrections and add a response.',
            'If that ever changes, we will tell the people concerned, as section 12.1 of Quebec’s private-sector law requires, including the information used and their right to have the decision reviewed by a person.',
          ],
        },
        {
          heading: 'Children',
          body: [
            'The application is for organizations and their staff. Children’s information enters it only through a customer’s program sign-up, entered by the child’s parent or guardian with their consent, or through a job application by a 14 or 15 year old with a parent’s or guardian’s consent. This website and its contact form are not meant for children.',
          ],
        },
        {
          heading: 'Where information is stored, and transfers outside Canada',
          body: [
            'The application is designed to run in Canada on Amazon Web Services: the Canada Central region (Montréal) for production and Canada West (Calgary) for disaster recovery, with backups in Canada. This hosting is planned and not yet in production; we confirm the hosting location in writing before a customer goes live.',
            'Some service providers are outside Canada or may process outside Canada: Vercel hosts this website (global network, US company); the content delivery network may cache public, non-personal files at edge locations outside Canada; text alerts use a US provider when a customer turns them on; card and debit payments go through a payment processor that may process in the US; browser push notifications travel through the browser maker’s service, encrypted so it cannot read them. Email from the application will be delivered by an email delivery provider that is not yet chosen; we will name it in our list of service providers before launch, with a Canadian region preferred. Information processed outside Canada may be accessible to the authorities of that country under its laws.',
            'Our current list of service providers, what each receives and where, is kept up to date and available on request. Before information about Quebec residents is communicated outside Quebec, we assess the privacy impact (Law 25, s. 17).',
          ],
        },
        {
          heading: 'How long we keep it',
          body: [
            'Each kind of information has a retention period, many of them set by the customer to match its records by-law: for example, payroll records at least six years after the tax year (CRA), job applications one year after the last change, facility booking contact details two years after the booking, working-alone locations 30 days, email and text logs 90 days by default, and website enquiries two years after our last exchange unless you become a customer. When a period ends, information is deleted or anonymized; encrypted backups expire within 35 days.',
            'We keep a record of an unsubscribe for as long as we send commercial email, so that we never email you again by mistake.',
          ],
        },
        {
          heading: 'How we protect it',
          body: [
            'Each customer’s data is separated at the database level (row-level security). Sensitive fields such as SINs, bank accounts, incident narratives and documents are encrypted with a key specific to each customer. Information is encrypted in transit and, in the planned production hosting, at rest. Passwords are hashed; sensitive actions ask you to confirm your identity again; administrative actions and every access by our support staff are logged.',
          ],
        },
        {
          heading: 'Your rights',
          body: [
            'You can ask to access the personal information we hold about you and to have it corrected; withdraw a consent; and, in Quebec, ask for computerized information you provided to be communicated to you or to another organization in a structured, commonly used technological format (portability, Law 25, s. 27), and ask that information about you stop being disseminated or that a hyperlink to it be de-indexed where the law allows (s. 28.1).',
            'For information a customer holds about you (your employer, or the city that runs a program), we pass your request to that customer and help it answer. We answer requests we are responsible for within 30 days.',
            'You can complain to us first (below). You can also contact the Office of the Privacy Commissioner of Canada, Quebec’s Commission d’accès à l’information, or the privacy commissioner of your province or territory (for example BC’s Office of the Information and Privacy Commissioner or Ontario’s Information and Privacy Commissioner).',
          ],
        },
        {
          heading: 'Privacy incidents',
          body: [
            'If a breach of security safeguards involving personal information happens, we contain it, assess the risk and keep a record of it. As a service provider, we notify the affected customer promptly so it can meet its own obligations. Where we are responsible, we report incidents that create a real risk of significant harm to the Privacy Commissioner of Canada and notify the people affected (PIPEDA), and in Quebec report incidents that present a risk of serious injury to the Commission d’accès à l’information and notify the people concerned (Law 25).',
          ],
        },
        {
          heading: 'Person in charge of the protection of personal information',
          body: [officer, 'You can also write to us through the contact page.'],
        },
        {
          heading: 'Changes to this policy',
          body: ['When we change this policy, we update its version and date at the top. For significant changes we tell customers in advance and, where consent is needed, ask for it again (staff see the new information agreement at their next sign-in).'],
        },
      ],
    },
    fr: {
      version: '2.1',
      updated: '2026-11-11',
      intro: `La présente politique explique quels renseignements personnels ${C.operatingName} (${C.legalName}) traite par ce site et par l’application ${C.operatingName}, pourquoi, où ils sont conservés et quels sont vos droits. Elle vise la Loi sur la protection des renseignements personnels et les documents électroniques (LPRPDE), la Loi sur la protection des renseignements personnels dans le secteur privé du Québec (Loi 25) et les lois provinciales du secteur public qui s’appliquent à nos clients municipaux.`,
      sections: [
        {
          heading: 'Deux rôles : fournisseur de services et organisation responsable',
          body: [
            'Dans l’application, nous agissons pour nos clients (villes, municipalités et employeurs privés). Le client décide quels renseignements sur son personnel, ses candidats et les participants à ses programmes sont recueillis, et il en est responsable selon la loi qui s’applique à lui (par exemple la LPRPDE, la Loi 25, la Personal Information Protection Act de l’Alberta ou de la Colombie-Britannique, ou une loi du secteur public comme la FIPPA de la C.-B. ou la MFIPPA de l’Ontario). Nous traitons ces renseignements uniquement pour fournir le service, selon les instructions du client et en vertu d’une entente écrite.',
            'Pour ce site, notre marketing et la facturation de nos clients, c’est nous qui décidons pourquoi et comment les renseignements sont utilisés, et la présente politique est notre engagement envers vous.',
            'Si vous travaillez pour l’un de nos clients, adressez d’abord vos questions ou demandes d’accès sur vos dossiers d’emploi au responsable de la protection des renseignements ou de l’accès à l’information de votre employeur; nous aidons l’employeur à répondre.',
          ],
        },
        {
          heading: 'Ce que nous recueillons, selon l’endroit où vous nous rencontrez',
          body: [
            'Ce site : aucun témoin (cookie), pixel publicitaire ni enregistrement de session. Le décompte des pages par Vercel Web Analytics seulement si vous l’autorisez (voir Témoins et technologies semblables). Le formulaire de contact : votre nom, votre courriel professionnel, votre organisation, votre rôle, votre province, le nombre d’installations et votre message; le consentement aux courriels promotionnels seulement si vous cochez la case distincte.',
            'Comptes de l’application (personnel) : coordonnées professionnelles, postes, certifications, disponibilités, horaires, pointages, demandes de congé, taux de salaire et heures, vérifications d’accueil, restrictions de travail pour les mesures d’adaptation, registres d’exploitation et rapports d’incident, selon ce que votre employeur configure.',
            'Pointage : si vous étiez à l’installation et à quelle distance, lorsque votre employeur active la vérification de l’emplacement. Vos coordonnées et votre adresse Internet ne sont pas conservées avec le pointage.',
            'Travail en solitaire : si vous commencez une séance de travail en solitaire, l’étiquette de l’endroit et les vérifications; votre position en direct seulement si vous choisissez de la partager pendant la séance. Les positions partagées sont supprimées lorsque vous cessez le partage, ou 30 jours après la séance.',
            'Bornes partagées : une tablette d’installation configurée par votre employeur; votre NIP de borne n’est conservé que sous forme d’empreinte irréversible.',
            'Textos (SMS) et notifications : seulement si votre employeur les active et que vous confirmez un numéro de cellulaire ou autorisez les notifications sur un appareil. Le contenu des messages est retiré de nos systèmes une fois envoyé.',
            'Paie (lorsque votre employeur fait la paie dans l’application) : votre numéro d’assurance sociale et vos renseignements bancaires, chiffrés avec la clé propre à votre employeur; seuls les derniers chiffres sont affichés.',
            'Documents : fichiers téléversés par votre employeur ou par vous (certificats, politiques, reçus), chiffrés au repos.',
            'Inscription publique aux programmes : les coordonnées du parent ou du tuteur, une personne à joindre en cas d’urgence, une adresse facultative, ainsi que le nom, la date de naissance (pour le bon niveau), toute note de sécurité et un consentement facultatif aux photos du participant. La personne qui remplit le formulaire doit être majeure et, pour un enfant, en être le parent ou le tuteur.',
            'Demandes de réservation d’installations : le nom, le courriel et le téléphone du demandeur et, s’il le souhaite, une organisation et des notes.',
            'Page Carrières : les coordonnées du candidat, son message, ses certifications et, s’il le souhaite, son curriculum vitæ, ainsi qu’une confirmation de sa tranche d’âge (sans date de naissance). Les candidats de 14 ou 15 ans indiquent le nom et le consentement d’un parent ou d’un tuteur.',
            'Rapports d’erreur : lorsqu’un problème survient, un rapport technique épuré (type et message d’erreur, endroit du code où elle s’est produite, chemin de la page sans identifiants, version). Les courriels, numéros de téléphone, numéros semblables à un NAS ou à une carte, jetons et mots de passe en sont retirés avant l’envoi; il ne contient jamais ce que vous avez saisi dans les formulaires, votre écran ni le contenu des dossiers. Le suivi des erreurs est désactivé, sauf si nous l’activons avec un fournisseur hébergé au Canada.',
            'Facturation (clients) : la personne-ressource et l’adresse de facturation, le numéro de bon de commande et l’historique des paiements. Les renseignements de carte et de débit bancaire saisis en ligne sont détenus par notre processeur de paiement, et non par nous.',
          ],
        },
        {
          heading: 'Pourquoi nous les utilisons, et sur quelle base',
          body: [
            'Pour fournir le service auquel notre client s’est abonné (horaires, temps et présences, paie, sécurité, RH), le protéger, soutenir les utilisateurs, facturer nos clients et respecter nos obligations légales (par exemple les registres fiscaux).',
            'Consentement : nous nous appuyons sur le consentement que vous donnez au moment de la collecte (l’avis à côté de chaque formulaire et, pour le personnel, l’entente d’information présentée à la première connexion), ou sur un consentement implicite selon le contexte lorsque la loi le permet. Les utilisations facultatives (courriels promotionnels, statistiques du site, notifications, partage de position) sont désactivées à moins que vous les choisissiez, et vous pouvez retirer votre consentement en tout temps; ce retrait peut nous empêcher d’offrir une fonction.',
            'Organismes publics : lorsqu’une municipalité utilise l’application, elle recueille les renseignements en vertu de sa propre loi, et son avis de collecte s’applique.',
          ],
        },
        {
          heading: 'Traitement et décisions automatisés',
          body: [
            'L’application calcule un indice d’assiduité (fiabilité) et offre un assistant d’horaire qui suggère qui pourrait prendre un quart. Ce sont des outils d’aide : aucune décision concernant une personne n’est fondée exclusivement sur un traitement automatisé. Un superviseur ou un gestionnaire examine et prend chaque décision; les jours de maladie et les congés protégés ne comptent jamais; chacun peut voir son dossier, demander des corrections et y ajouter une réponse.',
            'Si cela devait changer, nous en informerions les personnes concernées comme l’exige l’article 12.1 de la loi québécoise sur le secteur privé, y compris les renseignements utilisés et leur droit de faire réviser la décision par une personne.',
          ],
        },
        {
          heading: 'Enfants',
          body: [
            'L’application s’adresse aux organisations et à leur personnel. Les renseignements d’enfants n’y entrent que par l’inscription aux programmes d’un client, saisis par le parent ou le tuteur avec son consentement, ou par la candidature d’un jeune de 14 ou 15 ans avec le consentement d’un parent ou d’un tuteur. Ce site et son formulaire de contact ne sont pas destinés aux enfants.',
          ],
        },
        {
          heading: 'Lieu de conservation et communication à l’extérieur du Canada',
          body: [
            'L’application est conçue pour être hébergée au Canada chez Amazon Web Services : la région Canada (Centre) à Montréal pour la production et la région Canada (Ouest) à Calgary pour la reprise après sinistre, avec des sauvegardes au Canada. Cet hébergement est prévu et n’est pas encore en production; nous confirmons par écrit le lieu d’hébergement avant la mise en service d’un client.',
            'Certains fournisseurs sont à l’extérieur du Canada ou peuvent traiter des renseignements à l’extérieur du Canada : Vercel héberge ce site (réseau mondial, entreprise américaine); le réseau de diffusion de contenu peut mettre en cache des fichiers publics, non personnels, hors du Canada; les textos passent par un fournisseur américain lorsqu’un client les active; les paiements par carte et par débit passent par un processeur de paiement qui peut traiter aux États-Unis; les notifications du navigateur transitent par le service du fabricant du navigateur, chiffrées de sorte qu’il ne peut pas les lire. Les courriels de l’application seront livrés par un fournisseur d’envoi de courriels qui n’est pas encore choisi; nous l’indiquerons dans notre liste de fournisseurs avant le lancement, de préférence avec une région canadienne. Les renseignements traités hors du Canada peuvent être accessibles aux autorités de ce pays selon ses lois.',
            'Notre liste à jour des fournisseurs, de ce que chacun reçoit et d’où, est disponible sur demande. Avant que des renseignements sur des résidents du Québec soient communiqués à l’extérieur du Québec, nous évaluons les facteurs relatifs à la vie privée (Loi 25, art. 17).',
          ],
        },
        {
          heading: 'Durée de conservation',
          body: [
            'Chaque type de renseignement a une durée de conservation, souvent fixée par le client selon son règlement sur la gestion des documents : par exemple, les dossiers de paie au moins six ans après l’année d’imposition (ARC), les candidatures un an après la dernière modification, les coordonnées des demandes de réservation deux ans après la réservation, les positions de travail en solitaire 30 jours, les journaux de courriels et de textos 90 jours par défaut, et les demandes reçues par le site deux ans après notre dernier échange, sauf si vous devenez client. À la fin de la période, les renseignements sont supprimés ou anonymisés; les sauvegardes chiffrées expirent dans un délai de 35 jours.',
            'Nous conservons la trace d’un désabonnement tant que nous envoyons des courriels commerciaux, afin de ne jamais vous écrire de nouveau par erreur.',
          ],
        },
        {
          heading: 'Comment nous les protégeons',
          body: [
            'Les données de chaque client sont séparées au niveau de la base de données (sécurité au niveau des lignes). Les champs sensibles comme le NAS, les comptes bancaires, les récits d’incident et les documents sont chiffrés avec une clé propre à chaque client. Les renseignements sont chiffrés en transit et, dans l’hébergement de production prévu, au repos. Les mots de passe sont hachés; les actions sensibles exigent de confirmer de nouveau votre identité; les actions administratives et chaque accès de notre personnel de soutien sont journalisés.',
          ],
        },
        {
          heading: 'Vos droits',
          body: [
            'Vous pouvez demander à accéder aux renseignements personnels que nous détenons à votre sujet et à les faire rectifier; retirer un consentement; et, au Québec, demander que les renseignements informatisés que vous avez fournis vous soient communiqués, ou communiqués à une autre organisation, dans un format technologique structuré et couramment utilisé (portabilité, Loi 25, art. 27), et demander que cesse la diffusion de renseignements vous concernant ou que soit désindexé un hyperlien qui y mène, lorsque la loi le permet (art. 28.1).',
            'Pour les renseignements qu’un client détient à votre sujet (votre employeur, ou la ville qui offre un programme), nous transmettons votre demande à ce client et l’aidons à répondre. Nous répondons aux demandes qui relèvent de nous dans un délai de 30 jours.',
            'Vous pouvez d’abord porter plainte auprès de nous (ci-dessous). Vous pouvez aussi vous adresser au Commissariat à la protection de la vie privée du Canada, à la Commission d’accès à l’information du Québec, ou au commissaire à la protection de la vie privée de votre province ou territoire (par exemple le commissaire à l’information et à la protection de la vie privée de la Colombie-Britannique ou de l’Ontario).',
          ],
        },
        {
          heading: 'Incidents de confidentialité',
          body: [
            'En cas d’atteinte aux mesures de sécurité visant des renseignements personnels, nous la contenons, évaluons le risque et la consignons dans un registre. À titre de fournisseur de services, nous avisons sans tarder le client touché afin qu’il puisse respecter ses propres obligations. Lorsque nous en sommes responsables, nous déclarons au Commissariat à la protection de la vie privée du Canada les atteintes présentant un risque réel de préjudice grave et avisons les personnes touchées (LPRPDE) et, au Québec, déclarons à la Commission d’accès à l’information les incidents présentant un risque de préjudice sérieux et avisons les personnes concernées (Loi 25).',
          ],
        },
        {
          heading: 'Responsable de la protection des renseignements personnels',
          body: [officerFr, 'Vous pouvez aussi nous écrire par la page de contact.'],
        },
        {
          heading: 'Modifications',
          body: ['Lorsque nous modifions la présente politique, nous mettons à jour sa version et sa date en haut de page. Pour les changements importants, nous avisons les clients à l’avance et, lorsqu’un consentement est nécessaire, le demandons de nouveau (le personnel voit la nouvelle entente d’information à sa prochaine connexion).'],
        },
      ],
    },
  },
  terms: {
    en: {
      version: '2.1',
      updated: '2026-11-11',
      intro: `These terms have two parts: the terms of use of this website and the public demo, and a plain-language summary of the subscription terms for organizations that use the ${C.operatingName} application. The signed order form and subscription agreement with each organization govern its subscription and prevail over this summary if they differ. ${C.operatingName} is operated by ${C.legalName}.`,
      sections: [
        { heading: 'Part 1. This website and the demo', body: ['The demo uses invented people and a fictional city. Do not enter real personal information; nothing you do in the demo is saved.', 'Prices and features on this site are described in good faith and may change; a written quote or agreement is what binds. Employment-standards, payroll and pool-safety information on this site is general information, not legal advice.', 'Do not try to break, overload or probe the site or the demo for weaknesses, except through a responsible disclosure arranged with us through the contact page.', 'The site and demo are provided as is. To the extent permitted by law, we are not liable for indirect losses arising from their use.'] },
        { heading: 'Part 2. Subscriptions: accounts and acceptable use', body: ['The organization creates its users’ accounts and is responsible for who has access, for keeping sign-in details secure, and for its users’ use of the service. Users must not misuse the service: no unlawful content, no attempts to access other organizations’ data, no interference with the service, and no uploading of content the organization does not have the right to use.'] },
        { heading: 'Customer data and confidentiality', body: ['The organization owns its data. We use it only to provide, secure and support the service, as described in the privacy policy and the agreement, and we keep it confidential. Each party keeps the other’s confidential information confidential.'] },
        { heading: 'Availability and support', body: ['We work to keep the service available and to fix problems quickly. Service levels, support hours and response times are as set out in your order form or service level agreement, if any; this summary does not promise any uptime figure.'] },
        { heading: 'Fees, taxes, renewal and cancellation', body: ['Fees are as set out in your order form, before applicable taxes (GST/HST, and provincial sales tax where it applies: PST, RST or QST), which are added to each invoice. You choose to be invoiced monthly, yearly in advance or for the whole term up front; staff beyond your allowance are billed monthly.', 'A committed term renews automatically month to month at the same rates, without the commitment discount, until you sign a new term or cancel. We email your billing contact a reminder 30 days before a term ends. To cancel, write to us before the end of the term (or, month to month, before the next month starts); nothing further is invoiced after the period already billed.', 'Invoices are due within the payment terms on the invoice. If an invoice remains unpaid after the grace period in your agreement (30 days after the due date by default), the account may become read-only until it is paid; we warn you first.', 'Refunds are covered by our refund policy.'] },
        { heading: 'Trials', body: ['A trial or pilot gives access to the features agreed for its length, free of charge unless your order form says otherwise. Invoicing starts only once a subscription begins.'] },
        { heading: 'Intellectual property', body: [`The application, its software, design, text, the ${C.operatingName} name and logo belong to us or our licensors; your subscription gives your organization a right to use the service, not ownership of it. Organization names and logos shown in the service belong to their owners. Customers are responsible for the files they upload; to report content that you believe infringes your copyright, see our Copyright notices page.`] },
        { heading: 'Safety, scheduling and payroll features', body: ['Working-alone check-ins, call-outs and safety alerts are aids that help an organization run its own safety procedures; they do not replace them, and they depend on phones, networks and people responding. Scheduling rules, overtime, holiday and payroll calculations are built to help organizations meet employment-standards and tax rules, but the organization remains responsible for its schedules and pay, and should review the results (including against current CRA and Revenu Québec tables). Nothing in the service is legal advice.'] },
        { heading: 'Warranties and liability', body: ['Except as stated in the agreement, the service is provided without other warranties, to the extent the law allows. Each party’s liability is limited as set out in the agreement; neither party is liable for indirect or consequential losses, except where the law does not allow this limit. Each party indemnifies the other as set out in the agreement (for example, the organization for content it uploads that it had no right to use).'] },
        { heading: 'Suspension, termination and your data', body: ['We may suspend access for non-payment (after notice), for a security threat, or for serious misuse. Either party may end the subscription as the agreement allows. When it ends, administrators can still sign in to download a complete export of the organization’s data until the deletion date in the agreement (90 days by default); after that date the data is deleted, except records we must keep by law (such as our invoices).'] },
        { heading: 'Governing law and disputes', body: [`These terms are governed by the laws of ${C.governingProvince.en} and the federal laws of Canada that apply there, unless the law of your province requires otherwise. We will first try to resolve any dispute by discussion; the agreement sets out any further process.`] },
        { heading: 'Language', body: ['These terms are available in English and French. In Quebec, the French version is provided first and prevails; the parties may agree to be bound by the English version where the Charter of the French Language allows it.'] },
        { heading: 'Changes and contact', body: [`We update the version and date above when these terms change, and give customers notice of material changes to the subscription terms. Questions: ${C.email}, or the contact page.`] },
      ],
    },
    fr: {
      version: '2.1',
      updated: '2026-11-11',
      intro: `Les présentes conditions comportent deux parties : les conditions d’utilisation de ce site et de la démo publique, et un résumé en langage clair des conditions d’abonnement pour les organisations qui utilisent l’application ${C.operatingName}. Le bon de commande et l’entente d’abonnement signés avec chaque organisation régissent son abonnement et ont préséance sur ce résumé en cas de divergence. ${C.operatingName} est exploitée par ${C.legalName}.`,
      sections: [
        { heading: 'Partie 1. Ce site et la démo', body: ['La démo utilise des personnes inventées et une ville fictive. N’y entrez aucun renseignement personnel réel; rien de ce que vous y faites n’est enregistré.', 'Les prix et fonctions décrits sur ce site le sont de bonne foi et peuvent changer; seule une soumission ou une entente écrite engage. L’information sur les normes du travail, la paie et la sécurité aquatique présentée sur ce site est générale et ne constitue pas un avis juridique.', 'N’essayez pas de briser, de surcharger ou de sonder le site ou la démo, sauf dans le cadre d’une divulgation responsable convenue avec nous par la page de contact.', 'Le site et la démo sont fournis tels quels. Dans la mesure permise par la loi, nous ne sommes pas responsables des pertes indirectes découlant de leur utilisation.'] },
        { heading: 'Partie 2. Abonnements : comptes et utilisation acceptable', body: ['L’organisation crée les comptes de ses utilisateurs et est responsable de qui y a accès, de la sécurité des identifiants et de l’utilisation du service par ses utilisateurs. Les utilisateurs ne doivent pas faire un mauvais usage du service : aucun contenu illicite, aucune tentative d’accéder aux données d’autres organisations, aucune entrave au service et aucun téléversement de contenu que l’organisation n’a pas le droit d’utiliser.'] },
        { heading: 'Données du client et confidentialité', body: ['L’organisation est propriétaire de ses données. Nous les utilisons uniquement pour fournir, protéger et soutenir le service, comme le décrivent la politique de confidentialité et l’entente, et nous en préservons la confidentialité. Chaque partie préserve la confidentialité des renseignements confidentiels de l’autre.'] },
        { heading: 'Disponibilité et soutien', body: ['Nous nous efforçons de garder le service disponible et de corriger rapidement les problèmes. Les niveaux de service, les heures de soutien et les délais de réponse sont ceux prévus à votre bon de commande ou à votre entente de niveau de service, le cas échéant; ce résumé ne promet aucun taux de disponibilité.'] },
        { heading: 'Frais, taxes, renouvellement et résiliation', body: ['Les frais sont ceux de votre bon de commande, avant les taxes applicables (TPS/TVH et, s’il y a lieu, taxe de vente provinciale : TVP, TVD ou TVQ), qui s’ajoutent à chaque facture. Vous choisissez d’être facturé au mois, à l’année d’avance ou pour toute la durée d’avance; le personnel au-delà de votre allocation est facturé au mois.', 'Un engagement à durée fixe se renouvelle automatiquement au mois, aux mêmes tarifs, sans le rabais d’engagement, jusqu’à ce que vous signiez une nouvelle durée ou que vous résiliiez. Nous envoyons un rappel par courriel à votre contact de facturation 30 jours avant la fin d’une durée. Pour résilier, écrivez-nous avant la fin de la durée (ou, au mois, avant le début du mois suivant); rien n’est facturé au-delà de la période déjà facturée.', 'Les factures sont payables dans le délai indiqué sur la facture. Si une facture demeure impayée après le délai de grâce prévu à votre entente (30 jours après l’échéance par défaut), le compte peut passer en lecture seule jusqu’au paiement; nous vous avisons d’abord.', 'Les remboursements sont régis par notre politique de remboursement.'] },
        { heading: 'Essais', body: ['Un essai ou un projet pilote donne accès aux fonctions convenues pour sa durée, sans frais sauf indication contraire de votre bon de commande. La facturation ne commence qu’au début d’un abonnement.'] },
        { heading: 'Propriété intellectuelle', body: [`L’application, son logiciel, sa conception, ses textes ainsi que le nom et le logo ${C.operatingName} nous appartiennent ou appartiennent à nos concédants; votre abonnement donne à votre organisation le droit d’utiliser le service, non d’en devenir propriétaire. Les noms et logos d’organisations affichés dans le service appartiennent à leurs propriétaires. Les clients sont responsables des fichiers qu’ils téléversent; pour signaler un contenu qui violerait votre droit d’auteur, consultez notre page Avis relatifs au droit d’auteur.`] },
        { heading: 'Fonctions de sécurité, d’horaire et de paie', body: ['Les vérifications de travail en solitaire, les rappels au travail et les alertes de sécurité sont des outils qui aident une organisation à appliquer ses propres procédures de sécurité; ils ne les remplacent pas et dépendent des téléphones, des réseaux et des personnes qui répondent. Les règles d’horaire et les calculs des heures supplémentaires, des jours fériés et de la paie sont conçus pour aider les organisations à respecter les normes du travail et les règles fiscales, mais l’organisation demeure responsable de ses horaires et de sa paie et devrait en vérifier les résultats (notamment selon les tables à jour de l’ARC et de Revenu Québec). Rien dans le service ne constitue un avis juridique.'] },
        { heading: 'Garanties et responsabilité', body: ['Sauf disposition contraire de l’entente, le service est fourni sans autre garantie, dans la mesure permise par la loi. La responsabilité de chaque partie est limitée selon l’entente; aucune partie n’est responsable des pertes indirectes ou consécutives, sauf si la loi ne permet pas cette limite. Chaque partie indemnise l’autre selon l’entente (par exemple, l’organisation pour un contenu téléversé qu’elle n’avait pas le droit d’utiliser).'] },
        { heading: 'Suspension, résiliation et vos données', body: ['Nous pouvons suspendre l’accès pour non-paiement (après avis), pour une menace à la sécurité ou pour un usage abusif grave. Chaque partie peut mettre fin à l’abonnement selon l’entente. À la fin, les administrateurs peuvent encore se connecter pour télécharger une exportation complète des données de l’organisation jusqu’à la date de suppression prévue à l’entente (90 jours par défaut); après cette date, les données sont supprimées, sauf les documents que la loi nous oblige à conserver (comme nos factures).'] },
        { heading: 'Droit applicable et différends', body: [`Les présentes conditions sont régies par les lois de ${C.governingProvince.fr} et les lois fédérales du Canada qui s’y appliquent, sauf si la loi de votre province en exige autrement. Nous tenterons d’abord de régler tout différend par la discussion; l’entente prévoit toute autre démarche.`] },
        { heading: 'Langue', body: ['Les présentes conditions sont offertes en français et en anglais. Au Québec, la version française est remise en premier et prévaut; les parties peuvent convenir d’être liées par la version anglaise lorsque la Charte de la langue française le permet.'] },
        { heading: 'Modifications et contact', body: [`Nous mettons à jour la version et la date ci-dessus lorsque ces conditions changent, et nous avisons les clients de toute modification importante des conditions d’abonnement. Questions : ${C.email}, ou la page de contact.`] },
      ],
    },
  },
  cookies: {
    en: {
      version: '1.1',
      updated: '2026-11-11',
      intro: 'This page lists every cookie and every item of browser storage that this website and the application set, what each one is for, how long it lasts, and whether it is strictly necessary. None is used for advertising or to follow you across other sites.',
      sections: [
        { heading: 'This website', body: ['Cookies: none.', 'fh-analytics (localStorage, first party, until you change it): remembers whether you allowed or refused anonymous page counts. Necessary to respect your choice.', 'fh-demo-return (sessionStorage, first party, until the tab closes): remembers the page you were on when you opened the demo, so the demo’s “Back to the website” button returns you there. Functional.', 'Vercel Web Analytics (only if you allow it): sends the page address, referring site, country, browser and device type to our host’s analytics, without cookies or storage on your device; visitors are distinguished by a hash that changes every day. Not necessary: off until you allow it, and always off when your browser sends Global Privacy Control or Do Not Track.'] },
        { heading: 'The application: cookies', body: ['fc_refresh (first party, HttpOnly, Secure in production, up to 14 days): keeps you signed in. Strictly necessary.', 'fh_platform (first party, HttpOnly, up to 8 hours): FH staff sign-in to the Dev console. Strictly necessary.', 'fc_sso (first party, HttpOnly, 10 minutes): protects a single sign-on with your organization’s identity provider. Strictly necessary.', 'fc_locale (first party, 1 year): your language. Functional.'] },
        { heading: 'The application: browser storage', body: ['fh-color-scheme (localStorage): light or dark mode. Functional.', 'fh-nav-groups, fh-nav-open, fh-department-tab, fh.planner.view.<user> (local or session storage): which menus and views you left open. Functional.', 'fh-passkey-dismissed:<user> (localStorage) and fh-offer-passkey (sessionStorage): whether to offer a passkey. Functional.', 'fh-punch-queue:<user>, fh-attendance-queue, fh-lessons-cache (localStorage): clock-ins and class attendance taken without signal, kept on the device until sent, and class rosters for offline use. Class rosters and cached pages are cleared at sign-out; signing out with clock-ins not yet sent asks you to stay and send them, or delete them. Necessary for offline use.', 'fh-headcount-v1 (sessionStorage): a head count in progress. Necessary for that feature.', 'fh-kiosk-token (localStorage, on a facility kiosk only): links a shared tablet to its facility. Strictly necessary for the kiosk.', 'fh-support-token (sessionStorage, until the tab closes): a read-only FH support visit your organization approved. Strictly necessary for that visit.', 'fh-v2 (service worker cache): the app’s own files for offline start-up; never your pay, documents or HR files. Necessary for offline use.'] },
        { heading: 'The public demo', body: ['flexcity-demo-v2, flexcity-demo-platform and fh-demo-back (sessionStorage, until the tab closes): the demo’s invented sample data, a demo view setting, and the way back to this website. Nothing is sent to a server.'] },
        { heading: 'Do we need your consent?', body: ['Strictly necessary and functional items are used to provide what you asked for, and are described here as PIPEDA and Quebec’s Law 25 require. The only optional item is website analytics, which stays off until you allow it (Law 25, s. 8.1 requires telling people about technology that can identify, locate or profile them and how to turn those functions on, which we read as off by default). You can change your choice at any time with the “Analytics” switch at the bottom of every page.'] },
        { heading: 'Managing storage', body: ['You can clear cookies and site data in your browser’s settings. Clearing the application’s data signs you out and removes any clock-ins waiting to be sent, so send them first.'] },
      ],
    },
    fr: {
      version: '1.1',
      updated: '2026-11-11',
      intro: 'Cette page énumère chaque témoin (cookie) et chaque élément de stockage du navigateur que ce site et l’application utilisent, à quoi chacun sert, combien de temps il dure et s’il est strictement nécessaire. Aucun ne sert à la publicité ni à vous suivre sur d’autres sites.',
      sections: [
        { heading: 'Ce site', body: ['Témoins : aucun.', 'fh-analytics (localStorage, interne, jusqu’à ce que vous le changiez) : mémorise si vous avez autorisé ou refusé le décompte anonyme des pages. Nécessaire pour respecter votre choix.', 'fh-demo-return (sessionStorage, interne, jusqu’à la fermeture de l’onglet) : mémorise la page où vous étiez en ouvrant la démo, pour que le bouton « Retour au site » vous y ramène. Fonctionnel.', 'Vercel Web Analytics (seulement si vous l’autorisez) : transmet l’adresse de la page, le site d’où vous venez, le pays, le navigateur et le type d’appareil aux statistiques de notre hébergeur, sans témoin ni stockage sur votre appareil; les visiteurs sont distingués par une empreinte qui change chaque jour. Non nécessaire : désactivé jusqu’à votre autorisation, et toujours désactivé lorsque votre navigateur envoie un signal Global Privacy Control ou « Ne pas me suivre ».'] },
        { heading: 'L’application : témoins', body: ['fc_refresh (interne, HttpOnly, Secure en production, jusqu’à 14 jours) : vous garde connecté. Strictement nécessaire.', 'fh_platform (interne, HttpOnly, jusqu’à 8 heures) : connexion du personnel de FH à la console. Strictement nécessaire.', 'fc_sso (interne, HttpOnly, 10 minutes) : protège une authentification unique avec le fournisseur d’identité de votre organisation. Strictement nécessaire.', 'fc_locale (interne, 1 an) : votre langue. Fonctionnel.'] },
        { heading: 'L’application : stockage du navigateur', body: ['fh-color-scheme (localStorage) : mode clair ou sombre. Fonctionnel.', 'fh-nav-groups, fh-nav-open, fh-department-tab, fh.planner.view.<utilisateur> (stockage local ou de session) : les menus et vues laissés ouverts. Fonctionnel.', 'fh-passkey-dismissed:<utilisateur> (localStorage) et fh-offer-passkey (sessionStorage) : s’il faut proposer une clé d’accès. Fonctionnel.', 'fh-punch-queue:<utilisateur>, fh-attendance-queue, fh-lessons-cache (localStorage) : pointages et présences prises sans réseau, conservés sur l’appareil jusqu’à leur envoi, et listes de classe pour l’usage hors ligne. Les listes de classe et les pages en cache sont effacées à la déconnexion; se déconnecter avec des pointages non envoyés vous propose de rester pour les envoyer, ou de les supprimer. Nécessaire à l’usage hors ligne.', 'fh-headcount-v1 (sessionStorage) : un dénombrement en cours. Nécessaire à cette fonction.', 'fh-kiosk-token (localStorage, sur une borne d’installation seulement) : relie une tablette partagée à son installation. Strictement nécessaire à la borne.', 'fh-support-token (sessionStorage, jusqu’à la fermeture de l’onglet) : une visite de soutien de FH, en lecture seule, approuvée par votre organisation. Strictement nécessaire à cette visite.', 'fh-v2 (cache du service worker) : les fichiers de l’application pour démarrer hors ligne; jamais votre paie, vos documents ou vos dossiers RH. Nécessaire à l’usage hors ligne.'] },
        { heading: 'La démo publique', body: ['flexcity-demo-v2, flexcity-demo-platform et fh-demo-back (sessionStorage, jusqu’à la fermeture de l’onglet) : les données fictives de la démo, un réglage d’affichage de la démo et le chemin de retour vers ce site. Rien n’est envoyé à un serveur.'] },
        { heading: 'Votre consentement est-il nécessaire?', body: ['Les éléments strictement nécessaires et fonctionnels servent à fournir ce que vous avez demandé et sont décrits ici comme l’exigent la LPRPDE et la Loi 25 du Québec. Le seul élément facultatif est le décompte des visites du site, désactivé jusqu’à votre autorisation (l’article 8.1 de la Loi 25 exige d’informer la personne de l’utilisation d’une technologie permettant de l’identifier, de la localiser ou d’effectuer son profilage, et des moyens d’activer ces fonctions, ce que nous interprétons comme une désactivation par défaut). Vous pouvez changer votre choix en tout temps avec l’interrupteur « Statistiques » au bas de chaque page.'] },
        { heading: 'Gérer le stockage', body: ['Vous pouvez effacer les témoins et les données des sites dans les paramètres de votre navigateur. Effacer les données de l’application vous déconnecte et supprime les pointages en attente d’envoi : envoyez-les d’abord.'] },
      ],
    },
  },
  refunds: {
    en: {
      version: '1.1',
      updated: '2026-11-11',
      intro: 'How refunds work for subscriptions to the application. Your order form or agreement prevails if it says something different. This policy describes how our billing works today.',
      sections: [
        { heading: 'Monthly, yearly and multi-year terms', body: ['Amounts already invoiced are not refunded for part of a period: when you cancel, the service continues to the end of the period already billed, and nothing further is invoiced.', 'Yearly or whole-term invoices paid in advance are not refunded if you cancel before the end of a committed term, unless your agreement says otherwise or the law requires it.'] },
        { heading: 'Plan changes', body: ['Adding options or facilities, or changing plan, applies from the next invoice; there is no automatic prorated charge or credit for the current period. If a change should apply sooner, ask us and we will issue a credit note or an adjusted invoice.'] },
        { heading: 'Trials', body: ['Trials and pilots are free unless your order form says otherwise, so there is nothing to refund. Invoicing starts only once a subscription begins.'] },
        { heading: 'Billing errors, disputes and chargebacks', body: ['If an invoice is wrong, tell us within 60 days of the invoice date and we will correct it with a credit note or a refund of the amount overcharged. Please contact us before disputing a card or bank-debit payment with your bank: a chargeback or debit reversal does not cancel the subscription. Pre-authorized debits can also be disputed under Payments Canada rules as set out in your debit agreement.'] },
        { heading: 'Taxes', body: ['A refund or credit note includes the sales tax (GST/HST, PST, RST or QST) charged on the amount refunded.'] },
        { heading: 'Contact', body: [`Billing questions: ${C.email}, or the contact page.`] },
      ],
    },
    fr: {
      version: '1.1',
      updated: '2026-11-11',
      intro: 'Le fonctionnement des remboursements pour les abonnements à l’application. Votre bon de commande ou votre entente a préséance s’il prévoit autre chose. La présente politique décrit le fonctionnement actuel de notre facturation.',
      sections: [
        { heading: 'Durées mensuelles, annuelles et pluriannuelles', body: ['Les montants déjà facturés ne sont pas remboursés pour une partie de période : en cas de résiliation, le service continue jusqu’à la fin de la période déjà facturée, et rien d’autre n’est facturé.', 'Les factures annuelles ou pour toute la durée payées d’avance ne sont pas remboursées en cas de résiliation avant la fin d’un engagement, sauf si votre entente le prévoit ou si la loi l’exige.'] },
        { heading: 'Changements de forfait', body: ['L’ajout d’options ou d’installations, ou un changement de forfait, s’applique à partir de la facture suivante; il n’y a pas de frais ni de crédit calculés au prorata pour la période en cours. Si un changement doit s’appliquer plus tôt, demandez-le-nous et nous émettrons une note de crédit ou une facture rectifiée.'] },
        { heading: 'Essais', body: ['Les essais et projets pilotes sont gratuits, sauf indication contraire de votre bon de commande : il n’y a donc rien à rembourser. La facturation ne commence qu’au début d’un abonnement.'] },
        { heading: 'Erreurs de facturation, contestations et rétrofacturations', body: ['Si une facture est erronée, avisez-nous dans les 60 jours suivant sa date et nous la corrigerons par une note de crédit ou le remboursement du montant facturé en trop. Communiquez avec nous avant de contester un paiement par carte ou par débit auprès de votre banque : une rétrofacturation ou l’annulation d’un débit ne résilie pas l’abonnement. Les débits préautorisés peuvent aussi être contestés selon les règles de Paiements Canada, comme le prévoit votre entente de débit.'] },
        { heading: 'Taxes', body: ['Un remboursement ou une note de crédit comprend la taxe de vente (TPS/TVH, TVP, TVD ou TVQ) facturée sur le montant remboursé.'] },
        { heading: 'Contact', body: [`Questions de facturation : ${C.email}, ou la page de contact.`] },
      ],
    },
  },
  accessibility: {
    en: {
      version: '2.1',
      updated: '2026-11-11',
      intro: `We want everyone on a team, and everyone evaluating us, to be able to use ${C.operatingName} and this website. Our target is the Web Content Accessibility Guidelines (WCAG) 2.1 level AA, which includes WCAG 2.0 level AA, the level required by the regulations under Ontario’s Accessibility for Ontarians with Disabilities Act (AODA); WCAG 2.1 is also the basis of the accessibility standard used under the Accessible Canada Act, and is often asked for in municipal procurement.`,
      sections: [
        { heading: 'What we design and test for', body: ['Full keyboard use with a visible focus, skip links and landmarks; a label on every form field, with errors announced and linked to their field; text and controls that meet AA contrast in light and dark mode; layouts that work at 400% zoom and on phones; touch targets at least 44 pixels; animations that stop when your device asks for reduced motion; descriptive text for informative images and screenshots.', 'Everything is available in English and Canadian French. We check pages with automated accessibility testing (axe) and by hand with a keyboard.'] },
        { heading: 'Known limitations', body: ['Some charts in reports are summarized in text but not yet as data tables. Uploaded documents such as certification scans are only as accessible as the file provided. Short product clips on this site are silent demonstrations with a text description beside them.', 'We have not yet completed an independent audit, so we do not claim full conformance; one is planned before general availability.'] },
        { heading: 'Feedback and alternate formats', body: [`Tell us about a barrier or ask for information in another format: ${C.email}, or the contact page.`] },
      ],
    },
    fr: {
      version: '2.1',
      updated: '2026-11-11',
      intro: `Nous voulons que toute l’équipe, et toute personne qui nous évalue, puisse utiliser ${C.operatingName} et ce site. Notre cible est le niveau AA des Règles pour l’accessibilité des contenus Web (WCAG) 2.1, qui englobe le niveau AA des WCAG 2.0 exigé par les règlements pris en application de la Loi de 2005 sur l’accessibilité pour les personnes handicapées de l’Ontario (LAPHO); les WCAG 2.1 servent aussi de base à la norme d’accessibilité utilisée en vertu de la Loi canadienne sur l’accessibilité et sont souvent demandées dans les appels d’offres municipaux.`,
      sections: [
        { heading: 'Ce que nous visons et vérifions', body: ['Utilisation complète au clavier avec un focus visible, liens d’évitement et repères; une étiquette pour chaque champ, avec des erreurs annoncées et liées à leur champ; textes et commandes au contraste AA en mode clair et sombre; mises en page fonctionnelles à 400 % de zoom et sur téléphone; cibles tactiles d’au moins 44 pixels; animations qui s’arrêtent lorsque votre appareil demande moins de mouvement; texte descriptif pour les images informatives et les captures d’écran.', 'Tout est offert en français canadien et en anglais. Nous vérifions les pages avec des tests d’accessibilité automatisés (axe) et à la main, au clavier.'] },
        { heading: 'Limites connues', body: ['Certains graphiques des rapports sont résumés en texte, mais pas encore sous forme de tableaux de données. Les documents téléversés, comme les certifications numérisées, ne sont accessibles que dans la mesure où le fichier fourni l’est. Les courtes séquences du produit sur ce site sont des démonstrations muettes accompagnées d’une description textuelle.', 'Aucune vérification indépendante n’a encore été réalisée; nous ne déclarons donc pas une conformité complète. Elle est prévue avant la disponibilité générale.'] },
        { heading: 'Commentaires et formats de rechange', body: [`Signalez un obstacle ou demandez un autre format : ${C.email}, ou la page de contact.`] },
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
      version: '1.1',
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
            'We do not give you the identity of the organization or person concerned. We disclose it only where the law requires it, for example under a court order.',
          ],
        },
        { heading: 'Notices we cannot forward', body: ['Under section 41.25(3), a notice is not valid if it contains an offer to settle the claimed infringement, a request or demand for payment or for personal information, a reference (including a link) to such an offer, request or demand, or any other information excluded by regulation. We do not forward those notices; we tell you why.'] },
        { heading: 'Removing or disabling content', body: ['The notice-and-notice system does not require us to remove content, and forwarding a notice is not a finding that anything infringes. Where the customer agreement allows, we may remove or disable access to content, for example content that is clearly unlawful or that a court orders removed, and we tell the customer when we do.'] },
        { heading: 'Not legal advice', body: ['This page explains our process; it is not legal advice. If you are unsure whether you have a claim, consult a lawyer.'] },
      ],
    },
    fr: {
      version: '1.1',
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
            'Nous ne vous communiquons pas l’identité de l’organisation ou de la personne en cause. Nous ne la divulguons que si la loi l’exige, par exemple en vertu d’une ordonnance du tribunal.',
          ],
        },
        { heading: 'Avis que nous ne pouvons pas transmettre', body: ['Selon le paragraphe 41.25(3), un avis n’est pas valide s’il contient une offre de règlement de la prétendue violation, une demande ou exigence de paiement ou de renseignements personnels, un renvoi (y compris par hyperlien) à une telle offre, demande ou exigence, ou tout autre renseignement exclu par règlement. Nous ne transmettons pas ces avis et vous en donnons la raison.'] },
        { heading: 'Retrait ou blocage d’un contenu', body: ['Le régime d’avis et avis ne nous oblige pas à retirer un contenu, et la transmission d’un avis ne constitue pas une conclusion de violation. Lorsque l’entente avec le client le permet, nous pouvons retirer un contenu ou en bloquer l’accès, par exemple un contenu manifestement illicite ou dont un tribunal ordonne le retrait, et nous en informons le client.'] },
        { heading: 'Pas un avis juridique', body: ['Cette page décrit notre processus; elle ne constitue pas un avis juridique. En cas de doute sur votre réclamation, consultez un avocat.'] },
      ],
    },
  },
};

export const legalDoc = (doc: Doc, lang: Lang) => DOCS[doc][lang];
export type { Doc as LegalDocName };
