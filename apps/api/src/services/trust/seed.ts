/**
 * Starter content for the Trust area, created once (idempotent): FH's policy templates as drafts
 * (an owner approves and publishes them), a realistic starter risk register, the vendors from
 * docs/SUBPROCESSORS.md, and a security questionnaire answer library. Customer commitments are
 * never invented: they're entered from real contracts.
 */
import type { PrismaClient } from '../../generated/prisma/client.js';
import { MONITORS } from './monitors.js';

const DAY = 86_400_000;

type P = { key: string; title: string; titleFr: string; controls: string[]; en: string; fr: string };
export const POLICY_TEMPLATES: P[] = [
  {
    key: 'information-security', title: 'Information security policy', titleFr: 'Politique de sécurité de l’information', controls: ['GV-01'],
    en: `Purpose: protect the information our customers trust us with, and keep the service available.
Scope: everyone who works for or with FlexcityHeadquarters (FH), every system that runs the service, and every copy of customer data.
1. The security lead owns this program, reports on it to leadership each quarter, and holds a yearly management review.
2. Every control has a named owner. Owners keep evidence current in the Trust area of the Dev console.
3. We follow the policies listed in the Trust area. Exceptions are written down, approved by the security lead, and expire within a year.
4. Customer data stays in Canada, is encrypted in transit and at rest, and is isolated per organization by the database itself.
5. Anyone who suspects a security problem reports it at once to security@ (see the incident response policy). Reporting in good faith is never punished.
6. Breaking this policy may lead to loss of access and discipline, up to ending employment or a contract.
Review: yearly, and after any major incident or change.`,
    fr: `But : protéger l’information que nos clients nous confient et garder le service disponible.
Portée : toute personne qui travaille pour ou avec FlexcityHeadquarters (FH), chaque système qui fait fonctionner le service et chaque copie des données clients.
1. Le responsable de la sécurité porte ce programme, en rend compte à la direction chaque trimestre et tient une revue de direction annuelle.
2. Chaque contrôle a un responsable désigné. Les responsables tiennent les preuves à jour dans l’espace Confiance de la console Dev.
3. Nous suivons les politiques de l’espace Confiance. Les exceptions sont écrites, approuvées par le responsable de la sécurité et expirent en moins d’un an.
4. Les données clients restent au Canada, sont chiffrées en transit et au repos, et sont isolées par organisation par la base de données elle-même.
5. Quiconque soupçonne un problème de sécurité le signale aussitôt à security@ (voir la politique d’intervention). Un signalement de bonne foi n’est jamais sanctionné.
6. Le non-respect de cette politique peut entraîner le retrait des accès et des mesures disciplinaires, jusqu’à la fin de l’emploi ou du contrat.
Revue : chaque année, et après tout incident ou changement majeur.`,
  },
  {
    key: 'acceptable-use', title: 'Acceptable use policy', titleFr: 'Politique d’utilisation acceptable', controls: ['GV-06', 'PS-02'],
    en: `1. Use FH systems and customer data only for your job. Never browse a customer’s records out of curiosity.
2. Work on a company-managed or approved device with disk encryption, a screen lock of 5 minutes or less, and automatic updates.
3. Never copy customer data to personal accounts, USB drives, chat tools or AI services that aren’t approved.
4. Keep passwords in the approved password manager; use a passkey wherever offered. Never share an account.
5. Lock your screen when you step away; don’t work on customer data in public where screens can be seen.
6. Report a lost device or a suspicious message right away.`,
    fr: `1. N’utilisez les systèmes de FH et les données clients que pour votre travail. Ne consultez jamais les dossiers d’un client par curiosité.
2. Travaillez sur un appareil géré ou approuvé avec chiffrement du disque, verrouillage de l’écran en 5 minutes ou moins et mises à jour automatiques.
3. Ne copiez jamais de données clients vers des comptes personnels, des clés USB, des outils de clavardage ou des services d’IA non approuvés.
4. Gardez vos mots de passe dans le gestionnaire approuvé; utilisez un passe-clé partout où c’est offert. Ne partagez jamais un compte.
5. Verrouillez votre écran quand vous vous absentez; ne travaillez pas sur des données clients en public à la vue des autres.
6. Signalez sans délai un appareil perdu ou un message suspect.`,
  },
  {
    key: 'access-control', title: 'Access control policy', titleFr: 'Politique de contrôle d’accès', controls: ['AC-01', 'AC-02', 'AC-03', 'HR-03'],
    en: `1. Access is granted for a job, at the least level that job needs, and approved by the person’s manager.
2. Dev console accounts need a passkey; sensitive actions need a fresh passkey confirmation.
3. Production database access is through the least-privilege application role; direct owner access is for migrations and break-glass only, and is logged.
4. Accounts unused for 90 days are disabled. Access is reviewed every quarter and the review is recorded.
5. When someone leaves or changes role, access is removed the same day.
6. Support visits to a customer’s organization need the customer’s grant and are time-limited and audited.`,
    fr: `1. L’accès est accordé pour un travail, au niveau minimal requis, et approuvé par le gestionnaire de la personne.
2. Les comptes de la console Dev exigent un passe-clé; les actions sensibles exigent une nouvelle confirmation par passe-clé.
3. L’accès à la base de production passe par le rôle applicatif à privilèges minimaux; l’accès propriétaire direct est réservé aux migrations et aux urgences, et il est journalisé.
4. Les comptes inutilisés depuis 90 jours sont désactivés. L’accès est revu chaque trimestre et la revue est consignée.
5. Quand une personne part ou change de rôle, l’accès est retiré le jour même.
6. Les visites de soutien dans l’organisation d’un client exigent son autorisation, sont limitées dans le temps et sont auditées.`,
  },
  {
    key: 'incident-response', title: 'Incident response policy', titleFr: 'Politique d’intervention en cas d’incident', controls: ['IR-01', 'IR-02'],
    en: `1. Report any suspected incident at once to security@. The on-call person acknowledges within 15 minutes.
2. Severity: SEV1 customer data exposed or service down; SEV2 a control failed with no known exposure; SEV3 everything else.
3. Steps: contain, preserve evidence, assess who and what is affected, eradicate, recover, then review.
4. Affected customers are told within 24 hours of confirming an incident, or sooner where their contract says so. The Trust area lists each customer’s promised window.
5. Where the law requires (PIPEDA real risk of significant harm, Quebec serious injury, provincial public-body rules), we support the customer’s notices and record the breach in our register for at least 24 months.
6. Every SEV1 and SEV2 gets a written review with actions, owners and dates. Tabletop exercises run each quarter.`,
    fr: `1. Signalez tout incident soupçonné aussitôt à security@. La personne de garde en accuse réception en 15 minutes.
2. Gravité : SEV1 données clients exposées ou service arrêté; SEV2 un contrôle a échoué sans exposition connue; SEV3 tout le reste.
3. Étapes : contenir, préserver les preuves, évaluer qui et quoi est touché, éliminer, rétablir, puis analyser.
4. Les clients touchés sont avisés dans les 24 heures suivant la confirmation d’un incident, ou plus tôt si leur contrat le prévoit. L’espace Confiance indique le délai promis à chaque client.
5. Lorsque la loi l’exige (risque réel de préjudice grave selon la LPRPDE, préjudice sérieux au Québec, règles des organismes publics provinciaux), nous appuyons les avis du client et inscrivons l’atteinte au registre pendant au moins 24 mois.
6. Chaque SEV1 et SEV2 fait l’objet d’une analyse écrite avec actions, responsables et dates. Des exercices sur table ont lieu chaque trimestre.`,
  },
  {
    key: 'business-continuity', title: 'Business continuity and disaster recovery policy', titleFr: 'Politique de continuité des activités et de reprise après sinistre', controls: ['BC-01', 'BK-01', 'BK-02'],
    en: `1. Targets: lose at most 15 minutes of data (RPO) and restore service within 4 hours (RTO).
2. The database has point-in-time recovery and nightly snapshots; a weekly copy goes to a second Canadian region with object lock for 35 days.
3. A restore is tested every month and the result recorded in the Trust area; the full continuity plan is tested yearly.
4. Urgent safety messages (working alone, call for help) have their own alerting so a delay is noticed within two minutes.
5. Customers are kept informed during any outage through the status channel their contract names.`,
    fr: `1. Cibles : perdre au plus 15 minutes de données (PRP) et rétablir le service en 4 heures (DMIA).
2. La base de données offre la restauration à un moment précis et des instantanés nocturnes; une copie hebdomadaire va dans une seconde région canadienne avec verrouillage de 35 jours.
3. Une restauration est testée chaque mois et le résultat consigné dans l’espace Confiance; le plan de continuité complet est testé chaque année.
4. Les messages de sécurité urgents (travail isolé, appel à l’aide) ont leurs propres alertes, de sorte qu’un retard est remarqué en deux minutes.
5. Les clients sont tenus informés pendant toute panne par le canal prévu à leur contrat.`,
  },
  {
    key: 'vendor-management', title: 'Vendor management policy', titleFr: 'Politique de gestion des fournisseurs', controls: ['VN-01', 'VN-02'],
    en: `1. Before a vendor handles customer personal information: a data processing agreement, a current SOC 2 Type II report or ISO 27001 certificate, a data location check (Canada preferred; Quebec transfers need an assessment) and the built-in security questionnaire.
2. Customers are told 30 days before a new subprocessor is used.
3. Each vendor has an owner, a criticality and a review date. Critical and high vendors are reviewed yearly; others every two years.
4. Expiring agreements and reports raise reminders 30, 7 and 1 days before.
5. When we stop using a vendor, we confirm our data was returned or deleted.`,
    fr: `1. Avant qu’un fournisseur traite des renseignements personnels de clients : une entente de traitement des données, un rapport SOC 2 Type II ou un certificat ISO 27001 en vigueur, une vérification du lieu des données (Canada de préférence; les transferts hors Québec exigent une évaluation) et le questionnaire de sécurité intégré.
2. Les clients sont avisés 30 jours avant l’utilisation d’un nouveau sous-traitant.
3. Chaque fournisseur a un responsable, une criticité et une date de revue. Les fournisseurs critiques et élevés sont revus chaque année; les autres aux deux ans.
4. Les ententes et rapports qui expirent déclenchent des rappels 30, 7 et 1 jour avant.
5. Quand nous cessons d’utiliser un fournisseur, nous confirmons que nos données ont été rendues ou supprimées.`,
  },
  {
    key: 'data-retention', title: 'Data retention and deletion policy', titleFr: 'Politique de conservation et de suppression des données', controls: ['RT-01', 'RT-02'],
    en: `1. We keep personal information only as long as the purpose or the law needs (docs/RETENTION.md has the schedule).
2. Routine records are removed automatically every hour by the background worker; the Trust area checks it ran in the last 25 hours.
3. Payroll and tax records follow the legal minimums (six years in most provinces), set per organization.
4. When a customer leaves, they get an export window, then their data is purged and their encryption key scheduled for deletion; backups expire within 35 days.
5. Deletion is recorded; nothing is restored from backup into production except to recover from an incident.`,
    fr: `1. Nous ne conservons les renseignements personnels que le temps exigé par la fin ou par la loi (docs/RETENTION.md contient le calendrier).
2. Les dossiers courants sont retirés automatiquement chaque heure par le traitement en arrière-plan; l’espace Confiance vérifie qu’il s’est exécuté dans les 25 dernières heures.
3. Les dossiers de paie et fiscaux suivent les durées légales minimales (six ans dans la plupart des provinces), fixées par organisation.
4. Quand un client part, il dispose d’une période d’exportation, puis ses données sont purgées et sa clé de chiffrement programmée pour suppression; les sauvegardes expirent en 35 jours.
5. Les suppressions sont consignées; rien n’est restauré en production depuis une sauvegarde, sauf pour se rétablir d’un incident.`,
  },
  {
    key: 'privacy', title: 'Privacy policy (internal)', titleFr: 'Politique de protection de la vie privée (interne)', controls: ['PR-01', 'PR-02', 'PR-03', 'PR-04'],
    en: `1. FH acts for its customers (the employers): we process their staff’s information only to provide the service they signed up for.
2. A named privacy officer answers questions and complaints, keeps the privacy impact assessment current and approves new uses of personal information.
3. We collect the least information each feature needs and keep optional uses (location, texts) off until the person turns them on.
4. People can see and download their records; organizations can export everything in open formats.
5. A suspected breach follows the incident response policy, including the breach register.
6. New features that touch personal information get a privacy review before release.`,
    fr: `1. FH agit pour ses clients (les employeurs) : nous ne traitons les renseignements de leur personnel que pour fournir le service auquel ils ont souscrit.
2. Un responsable de la vie privée désigné répond aux questions et plaintes, tient l’évaluation des facteurs relatifs à la vie privée à jour et approuve les nouvelles utilisations.
3. Nous recueillons le moins d’information possible pour chaque fonction et gardons les utilisations facultatives (localisation, textos) désactivées jusqu’à ce que la personne les active.
4. Les personnes peuvent consulter et télécharger leurs dossiers; les organisations peuvent tout exporter en formats ouverts.
5. Une atteinte soupçonnée suit la politique d’intervention, y compris le registre des atteintes.
6. Les nouvelles fonctions qui touchent des renseignements personnels font l’objet d’un examen de la vie privée avant leur lancement.`,
  },
  {
    key: 'encryption', title: 'Encryption and key management policy', titleFr: 'Politique de chiffrement et de gestion des clés', controls: ['CR-01', 'CR-02', 'CR-03', 'CR-04'],
    en: `1. All traffic uses TLS 1.2 or later, with HSTS; database connections require TLS in production.
2. Databases, backups and file storage are encrypted at rest. Sensitive records (SINs, bank accounts, incident narratives, documents, evidence files) are sealed with per-record keys wrapped by AWS KMS in Canada.
3. KMS keys rotate yearly; only the service’s role may decrypt; key use is logged.
4. Secrets live in the hosting environment’s secret store, never in code. CI scans every change for committed secrets.
5. Lost or exposed keys are rotated at once under the incident response policy.`,
    fr: `1. Tout le trafic utilise TLS 1.2 ou plus récent, avec HSTS; les connexions à la base de données exigent TLS en production.
2. Les bases de données, sauvegardes et fichiers sont chiffrés au repos. Les dossiers sensibles (NAS, comptes bancaires, récits d’incidents, documents, fichiers de preuves) sont scellés avec des clés par dossier enveloppées par AWS KMS au Canada.
3. Les clés KMS sont renouvelées chaque année; seul le rôle du service peut déchiffrer; l’utilisation des clés est journalisée.
4. Les secrets sont dans le coffre de l’environnement d’hébergement, jamais dans le code. L’intégration continue vérifie chaque changement.
5. Une clé perdue ou exposée est renouvelée aussitôt selon la politique d’intervention.`,
  },
  {
    key: 'change-management', title: 'Change management policy', titleFr: 'Politique de gestion des changements', controls: ['CM-01', 'SD-01'],
    en: `1. Every change to production goes through version control, a review by someone other than the author, and passing CI.
2. Database changes are versioned migrations; row-level security is re-applied after each one.
3. Emergency fixes may ship first, but are reviewed within one business day.
4. Configuration and infrastructure are kept as code where possible; manual changes are recorded.
5. Releases are logged with what changed and who approved them.`,
    fr: `1. Chaque changement en production passe par la gestion des versions, une révision par une autre personne que l’auteur et une intégration continue réussie.
2. Les changements de base de données sont des migrations versionnées; la sécurité au niveau des lignes est réappliquée après chacune.
3. Les correctifs urgents peuvent partir d’abord, mais sont révisés en un jour ouvrable.
4. La configuration et l’infrastructure sont gérées comme du code autant que possible; les changements manuels sont consignés.
5. Les versions sont journalisées avec ce qui a changé et qui les a approuvées.`,
  },
  {
    key: 'secure-development', title: 'Secure development policy', titleFr: 'Politique de développement sécurisé', controls: ['SD-01', 'VM-01', 'VM-02', 'VM-03'],
    en: `1. Design: new features that touch personal or sensitive data get a short threat and privacy review.
2. Code: parameterized queries only; every organization-scoped query runs under the organization’s row-level security context; permissions are checked on the server.
3. Tests: CI runs unit, integration, isolation and SQL-injection tests on every change; tests never use real customer data.
4. Dependencies: a dependency audit and CodeQL run on every change and weekly; critical fixes ship within 48 hours, high within 7 days.
5. An independent penetration test runs yearly and its findings are tracked to closure.`,
    fr: `1. Conception : les nouvelles fonctions qui touchent des données personnelles ou sensibles font l’objet d’un court examen des menaces et de la vie privée.
2. Code : requêtes paramétrées seulement; chaque requête propre à une organisation s’exécute dans le contexte de sécurité au niveau des lignes de cette organisation; les permissions sont vérifiées sur le serveur.
3. Tests : l’intégration continue exécute des tests unitaires, d’intégration, d’isolement et d’injection SQL à chaque changement; les tests n’utilisent jamais de vraies données clients.
4. Dépendances : un audit des dépendances et CodeQL s’exécutent à chaque changement et chaque semaine; les correctifs critiques partent en 48 heures, les élevés en 7 jours.
5. Un test d’intrusion indépendant a lieu chaque année et ses constats sont suivis jusqu’à leur résolution.`,
  },
  {
    key: 'hr-security', title: 'HR security policy', titleFr: 'Politique de sécurité des ressources humaines', controls: ['HR-01', 'HR-02', 'HR-03', 'HR-04'],
    en: `1. Before access: a background check where the law allows and the role warrants, and signed confidentiality terms.
2. In the first week and every year: security and privacy training, and acceptance of FH’s published policies.
3. Security duties are part of every job description; breaches of policy follow the disciplinary process.
4. On leaving: accounts disabled and sessions ended the same day, equipment returned, confidentiality continues.`,
    fr: `1. Avant l’accès : une vérification des antécédents lorsque la loi le permet et que le rôle le justifie, et des clauses de confidentialité signées.
2. La première semaine et chaque année : formation en sécurité et vie privée, et acceptation des politiques publiées de FH.
3. Les obligations de sécurité font partie de chaque description de poste; les manquements suivent le processus disciplinaire.
4. Au départ : comptes désactivés et sessions terminées le jour même, matériel rendu, la confidentialité demeure.`,
  },
];

type Risk = { ref: string; title: string; titleFr: string; category: string; description: string; l: number; i: number; rl: number; ri: number; treatment: string; plan: string; controls: string[]; dueDays?: number };
export const STARTER_RISKS: Risk[] = [
  { ref: 'R-001', title: 'Tenant data leak through a row-level security gap', titleFr: 'Fuite de données entre clients par une faille de sécurité au niveau des lignes', category: 'tenant', description: 'A new table or a migration without its policy could let one organization’s request read another’s rows.', l: 3, i: 5, rl: 1, ri: 5, treatment: 'MITIGATE', plan: 'Forced RLS on every tenant table, the RLS test every 5 minutes, isolation tests in CI.', controls: ['TI-01', 'AC-02'] },
  { ref: 'R-002', title: 'Credential stuffing against sign-in', titleFr: 'Bourrage d’identifiants contre la connexion', category: 'access', description: 'Reused passwords from other breaches tried at scale against organization and console sign-in.', l: 4, i: 4, rl: 2, ri: 3, treatment: 'MITIGATE', plan: 'Rate limits, lockouts, common-password checks, passkeys; recommend MFA to every organization.', controls: ['AC-01', 'AC-04'] },
  { ref: 'R-003', title: 'Text provider outage during a safety escalation', titleFr: 'Panne du fournisseur de textos pendant une alerte de sécurité', category: 'continuity', description: 'A worker alone calls for help and the text or call never goes out.', l: 2, i: 5, rl: 2, ri: 4, treatment: 'MITIGATE', plan: 'Two-minute overdue alert, in-app and push fallback; evaluate a second (Canadian) provider.', controls: ['BC-02', 'LM-02'], dueDays: 60 },
  { ref: 'R-004', title: 'Single cloud region outage', titleFr: 'Panne d’une région infonuagique', category: 'continuity', description: 'ca-central-1 unavailable for hours.', l: 2, i: 4, rl: 2, ri: 3, treatment: 'MITIGATE', plan: 'Backups in ca-west-1, a tested recovery runbook, a 4-hour RTO.', controls: ['BC-01', 'BK-01', 'BK-02'], dueDays: 120 },
  { ref: 'R-005', title: 'Insider access by support staff', titleFr: 'Accès d’initiés par le personnel de soutien', category: 'access', description: 'An FH employee looks at an organization’s records without a reason.', l: 2, i: 4, rl: 1, ri: 4, treatment: 'MITIGATE', plan: 'Support visits only with the customer’s grant, time-limited and audited; quarterly access review.', controls: ['AC-03', 'LM-01', 'AC-07'] },
  { ref: 'R-006', title: 'Weather data unverified', titleFr: 'Données météo non vérifiées', category: 'vendor', description: 'The forecast relies on a public weather API whose answers aren’t authenticated beyond TLS.', l: 2, i: 2, rl: 2, ri: 1, treatment: 'ACCEPT', plan: 'Accepted: forecasts are advisory, and the feature works without weather. Values are range-checked.', controls: ['VN-01'] },
  { ref: 'R-007', title: 'No error-tracking vendor chosen', titleFr: 'Aucun fournisseur de suivi des erreurs choisi', category: 'logging', description: 'Unexpected errors are only logged, so a quiet failure could go unnoticed.', l: 4, i: 3, rl: 4, ri: 3, treatment: 'MITIGATE', plan: 'Choose a Canadian-hosted Sentry-compatible service (or self-host GlitchTip), sign its DPA, set SENTRY_DSN.', controls: ['LM-03', 'VN-01'], dueDays: 30 },
  { ref: 'R-008', title: 'Encryption key compromise', titleFr: 'Compromission d’une clé de chiffrement', category: 'crypto', description: 'A key-encryption key or the signing secret is exposed.', l: 1, i: 5, rl: 1, ri: 4, treatment: 'MITIGATE', plan: 'KMS with least-privilege key policies and logging; rotation runbook; secrets scanning in CI.', controls: ['CR-02', 'CR-03', 'CR-04', 'AC-06'] },
  { ref: 'R-009', title: 'Missed promise to a customer', titleFr: 'Promesse manquée envers un client', category: 'governance', description: 'A contract clause (a report, a notice window, a pen test) is forgotten.', l: 3, i: 3, rl: 1, ri: 3, treatment: 'MITIGATE', plan: 'Every commitment tracked in Trust with an owner and 30/7/1-day reminders.', controls: ['GV-04'] },
];

type V = { name: string; purpose: string; purposeFr: string; criticality: string; data: string; personal: boolean; location: string; canada: boolean; controls: string[]; status?: string; notes?: string };
export const STARTER_VENDORS: V[] = [
  { name: 'Amazon Web Services', purpose: 'Hosting, database, backups, key management (KMS)', purposeFr: 'Hébergement, base de données, sauvegardes, gestion des clés (KMS)', criticality: 'CRITICAL', data: 'All application data', personal: true, location: 'Canada (ca-central-1; backups ca-west-1)', canada: true, controls: ['PS-01', 'CR-02', 'BK-01', 'LM-05'], notes: 'To confirm before launch: DPA, SOC 2 Type II and ISO 27001 reports on file.' },
  { name: 'Email delivery (to be chosen)', purpose: 'Sign-in links and notifications', purposeFr: 'Liens de connexion et avis', criticality: 'HIGH', data: 'Recipient address and message', personal: true, location: 'Canada preferred', canada: false, controls: ['VN-01'], status: 'PROPOSED' },
  { name: 'Twilio', purpose: 'Urgent texts and calls (optional, per organization)', purposeFr: 'Textos et appels urgents (facultatif, par organisation)', criticality: 'HIGH', data: 'Confirmed mobile number, alert text', personal: true, location: 'United States', canada: false, controls: ['BC-02', 'VN-01'], notes: 'Before launch: DPA; consider a Canadian provider.' },
  { name: 'Stripe', purpose: 'Card and pre-authorized debit payments for FH invoices (optional)', purposeFr: 'Paiements par carte et prélèvement pour les factures de FH (facultatif)', criticality: 'MEDIUM', data: 'Billing contact, payment method (held by Stripe)', personal: true, location: 'Canada / United States', canada: false, controls: ['VN-01'] },
  { name: 'Vercel', purpose: 'Marketing website hosting and web analytics', purposeFr: 'Hébergement du site Web et mesure d’audience', criticality: 'LOW', data: 'Website visitors only; no application data', personal: false, location: 'Global edge network', canada: false, controls: ['VN-01'] },
  { name: 'Error tracking (to be chosen)', purpose: 'Reports of unexpected errors (scrubbed)', purposeFr: 'Signalement des erreurs inattendues (épurées)', criticality: 'MEDIUM', data: 'Error type, stack, request id, hashed user id', personal: false, location: 'Canada required', canada: false, controls: ['LM-03'], status: 'PROPOSED' },
  { name: 'Browser push services', purpose: 'Delivering notifications to devices (end-to-end encrypted)', purposeFr: 'Livraison d’avis aux appareils (chiffrés de bout en bout)', criticality: 'LOW', data: 'Encrypted message, device push address', personal: false, location: 'Global (the browser maker)', canada: false, controls: ['VN-01'] },
  { name: 'Environment and Climate Change Canada', purpose: 'Open weather data for the demand forecast', purposeFr: 'Données météo ouvertes pour la prévision de la demande', criticality: 'LOW', data: 'None (forecast site codes only)', personal: false, location: 'Canada (Government of Canada)', canada: true, controls: ['VN-01'] },
];

type A = { category: string; q: string; qFr: string; a: string; aFr: string; controls: string[] };
export const STARTER_ANSWERS: A[] = [
  { category: 'Data residency', q: 'Where is our data stored and processed?', qFr: 'Où nos données sont-elles stockées et traitées?', a: 'In Canada: AWS ca-central-1, with backups in ca-west-1. The service refuses to start in a non-Canadian region.', aFr: 'Au Canada : AWS ca-central-1, avec sauvegardes dans ca-west-1. Le service refuse de démarrer dans une région hors du Canada.', controls: ['PR-05'] },
  { category: 'Encryption', q: 'Is data encrypted in transit and at rest?', qFr: 'Les données sont-elles chiffrées en transit et au repos?', a: 'Yes. TLS 1.2+ with HSTS in transit; encrypted database and backups at rest; sensitive records are additionally sealed with per-record keys wrapped by AWS KMS.', aFr: 'Oui. TLS 1.2+ avec HSTS en transit; base de données et sauvegardes chiffrées au repos; les dossiers sensibles sont en plus scellés avec des clés par dossier enveloppées par AWS KMS.', controls: ['CR-01', 'CR-02'] },
  { category: 'Isolation', q: 'How is our data kept separate from other customers?', qFr: 'Comment nos données sont-elles séparées de celles des autres clients?', a: 'PostgreSQL row-level security on every table with customer data, forced for the application role, and checked automatically every few minutes.', aFr: 'Sécurité au niveau des lignes de PostgreSQL sur chaque table contenant des données clients, imposée au rôle applicatif et vérifiée automatiquement aux quelques minutes.', controls: ['TI-01'] },
  { category: 'Access', q: 'Does the service support multi-factor authentication and SSO?', qFr: 'Le service prend-il en charge l’authentification multifacteur et l’authentification unique?', a: 'Yes: passkeys (Windows Hello, Face ID, security keys) can be required per role, and SAML/Entra ID single sign-on is supported.', aFr: 'Oui : les passe-clés (Windows Hello, Face ID, clés de sécurité) peuvent être exigés par rôle, et l’authentification unique SAML/Entra ID est prise en charge.', controls: ['AC-04', 'AC-01'] },
  { category: 'Incident response', q: 'How quickly will you notify us of a breach?', qFr: 'Dans quel délai serons-nous avisés d’une atteinte?', a: 'Within 24 hours of confirming an incident that affects you, or sooner if your contract says so; we support your own notices to people and regulators.', aFr: 'Dans les 24 heures suivant la confirmation d’un incident qui vous touche, ou plus tôt si votre contrat le prévoit; nous appuyons vos propres avis aux personnes et aux autorités.', controls: ['IR-01', 'IR-02'] },
  { category: 'Certifications', q: 'Do you have a SOC 2 report or ISO 27001 certificate?', qFr: 'Avez-vous un rapport SOC 2 ou un certificat ISO 27001?', a: 'Not yet. We run our controls against SOC 2 and ISO 27001 and can share our current readiness summary on request. Our cloud provider’s reports cover physical security.', aFr: 'Pas encore. Nous évaluons nos contrôles selon SOC 2 et ISO 27001 et pouvons transmettre un résumé de notre état de préparation sur demande. Les rapports de notre fournisseur infonuagique couvrent la sécurité physique.', controls: ['GV-03', 'PS-01'] },
  { category: 'Backups', q: 'How are backups handled and tested?', qFr: 'Comment les sauvegardes sont-elles gérées et testées?', a: 'Point-in-time recovery and nightly snapshots, a weekly immutable copy in a second Canadian region kept 35 days, and a restore test every month.', aFr: 'Restauration à un moment précis et instantanés nocturnes, une copie hebdomadaire immuable dans une seconde région canadienne conservée 35 jours, et un test de restauration chaque mois.', controls: ['BK-01', 'BK-02'] },
  { category: 'Subprocessors', q: 'Which subprocessors handle our data?', qFr: 'Quels sous-traitants traitent nos données?', a: 'Our current list is in the subprocessor appendix; you’re told 30 days before a new one is used.', aFr: 'Notre liste actuelle figure dans l’annexe des sous-traitants; vous êtes avisés 30 jours avant l’ajout d’un nouveau.', controls: ['VN-02'] },
  { category: 'Retention', q: 'What happens to our data when the contract ends?', qFr: 'Qu’advient-il de nos données à la fin du contrat?', a: 'You get an export window in open formats; then your data is purged, your encryption key is scheduled for deletion and backups expire within 35 days.', aFr: 'Vous disposez d’une période d’exportation en formats ouverts; ensuite vos données sont purgées, votre clé de chiffrement est programmée pour suppression et les sauvegardes expirent en 35 jours.', controls: ['RT-02'] },
  { category: 'Testing', q: 'Do you perform penetration testing?', qFr: 'Effectuez-vous des tests d’intrusion?', a: 'An independent penetration test is planned yearly; automated security scanning (CodeQL, dependency audit, secrets scan) runs on every change.', aFr: 'Un test d’intrusion indépendant est prévu chaque année; une analyse de sécurité automatisée (CodeQL, audit des dépendances, recherche de secrets) s’exécute à chaque changement.', controls: ['VM-01', 'VM-03'] },
];

/** Creates the starter content and a row per test, once. Safe to call on every start. */
export async function ensureTrustSeeded(p: PrismaClient, now = new Date()): Promise<void> {
  await p.trustSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  await p.trustTest.createMany({ data: MONITORS.map((m) => ({ key: m.key })), skipDuplicates: true });
  if (!(await p.trustPolicy.count())) {
    for (const t of POLICY_TEMPLATES) {
      await p.trustPolicy.create({
        data: { key: t.key, title: t.title, titleFr: t.titleFr, controlKeys: t.controls, versions: { create: { version: 1, body: t.en, bodyFr: t.fr, changeNote: 'Starter template', status: 'DRAFT' } } },
      });
    }
  }
  if (!(await p.trustRisk.count())) {
    await p.trustRisk.createMany({
      data: STARTER_RISKS.map((x) => ({ ref: x.ref, title: x.title, titleFr: x.titleFr, category: x.category, description: x.description, likelihood: x.l, impact: x.i, residualLikelihood: x.rl, residualImpact: x.ri, treatment: x.treatment, treatmentPlan: x.plan, controlKeys: x.controls, dueAt: x.dueDays ? new Date(now.getTime() + x.dueDays * DAY) : null, lastReviewedAt: now })),
      skipDuplicates: true,
    });
  }
  if (!(await p.trustVendor.count())) {
    await p.trustVendor.createMany({
      data: STARTER_VENDORS.map((v) => ({ name: v.name, purpose: v.purpose, purposeFr: v.purposeFr, criticality: v.criticality, dataAccessed: v.data, personalInfo: v.personal, dataLocation: v.location, inCanada: v.canada, controlKeys: v.controls, status: v.status ?? 'ACTIVE', notes: v.notes ?? null, reviewEveryMonths: v.criticality === 'CRITICAL' || v.criticality === 'HIGH' ? 12 : 24 })),
      skipDuplicates: true,
    });
  }
  if (!(await p.trustAnswer.count())) {
    await p.trustAnswer.createMany({ data: STARTER_ANSWERS.map((a) => ({ category: a.category, question: a.q, questionFr: a.qFr, answer: a.a, answerFr: a.aFr, controlKeys: a.controls, lastReviewedAt: now })) });
  }
}
