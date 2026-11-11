/**
 * The Trust area's control library: FlexcityHeadquarters' own security controls, and the
 * framework requirements each one helps meet. Seed data in code, versioned (LIBRARY_VERSION):
 * a change here is reviewed like any other change, and the version is printed on every export.
 *
 * Requirement titles are short plain-language paraphrases written for FH, not the standards' text.
 * Section numbers for the provincial laws (BC, Ontario, Alberta, Quebec) are as commonly cited and
 * are marked for counsel in the UI (the frameworks' notes): have counsel or the customer's privacy
 * office confirm them before quoting them in a contract.
 */

export const LIBRARY_VERSION = '2026.11-2';

export type FrameworkKey = 'soc2' | 'iso27001' | 'hipaa' | 'pipeda' | 'provincial' | 'law25';
export interface Requirement {
  id: string;
  title: string;
  titleFr: string;
  /** Grouping shown in the UI (e.g. "Common criteria", "Annex A 8"), and in French. */
  group: string;
  groupFr: string;
  /** Doesn't apply to FH at all (shown, never counted), and why in French. */
  na?: string;
  naFr?: string;
}
export interface Framework {
  key: FrameworkKey;
  name: string;
  nameFr: string;
  description: string;
  descriptionFr: string;
  /** Shown in the UI: when the framework applies. */
  note?: string;
  noteFr?: string;
  /** Optional frameworks start out of scope. */
  optional?: boolean;
  requirements: Requirement[];
}

type Row = [id: string, en: string, fr: string];
/** Requirement groups in French (keyed by the English group). */
export const GROUP_FR: Record<string, string> = {
  'CC1 Control environment': 'CC1 Environnement de contrôle',
  'CC2 Communication and information': 'CC2 Communication et information',
  'CC3 Risk assessment': 'CC3 Évaluation des risques',
  'CC4 Monitoring': 'CC4 Surveillance',
  'CC5 Control activities': 'CC5 Activités de contrôle',
  'CC6 Logical and physical access': 'CC6 Accès logique et physique',
  'CC7 System operations': 'CC7 Exploitation des systèmes',
  'CC8 Change management': 'CC8 Gestion des changements',
  'CC9 Risk mitigation': 'CC9 Atténuation des risques',
  'A1 Availability': 'A1 Disponibilité',
  'C1 Confidentiality': 'C1 Confidentialité',
  'P Privacy': 'P Protection de la vie privée',
  'Clauses 4–10': 'Articles 4 à 10',
  'Annex A 5 Organizational': 'Annexe A 5 Mesures organisationnelles',
  'Annex A 6 People': 'Annexe A 6 Mesures liées aux personnes',
  'Annex A 7 Physical': 'Annexe A 7 Mesures physiques',
  'Annex A 8 Technological': 'Annexe A 8 Mesures technologiques',
  '164.308 Administrative': '164.308 Mesures administratives',
  '164.310 Physical': '164.310 Mesures physiques',
  '164.312 Technical': '164.312 Mesures techniques',
  '164.314–316 Organizational and documentation': '164.314 à 316 Organisation et documentation',
  'Fair information principles': 'Principes relatifs à l’équité dans le traitement de l’information',
  'Breach of security safeguards': 'Atteintes aux mesures de sécurité',
  'British Columbia FIPPA': 'FIPPA (Colombie-Britannique)',
  'Ontario MFIPPA': 'LAIMPVP (Ontario)',
  'Alberta FOIP / POPA': 'FOIP / POPA (Alberta)',
  'Quebec private-sector Act (Law 25)': 'Loi sur le secteur privé (Loi 25, Québec)',
};
type Na = Record<string, [en: string, fr: string]>;
const reqs = (group: string, rows: Row[], na: Na = {}): Requirement[] =>
  rows.map(([id, title, titleFr]) => ({ id, title, titleFr, group, groupFr: GROUP_FR[group] ?? group, ...(na[id] ? { na: na[id][0], naFr: na[id][1] } : {}) }));

const SOC2: Requirement[] = [
  ...reqs('CC1 Control environment', [
    ['CC1.1', 'Commitment to integrity and ethical values', 'Engagement envers l’intégrité et l’éthique'],
    ['CC1.2', 'Oversight of internal control independent of management', 'Surveillance du contrôle interne indépendante de la gestion'],
    ['CC1.3', 'Structures, reporting lines and authority', 'Structures, liens hiérarchiques et pouvoirs'],
    ['CC1.4', 'Attract, develop and keep competent people', 'Attirer, former et retenir des personnes compétentes'],
    ['CC1.5', 'Hold people accountable for their control duties', 'Responsabiliser chacun à l’égard de ses tâches de contrôle'],
  ]),
  ...reqs('CC2 Communication and information', [
    ['CC2.1', 'Use relevant, good-quality information', 'Utiliser une information pertinente et de qualité'],
    ['CC2.2', 'Communicate internally about objectives and controls', 'Communiquer à l’interne sur les objectifs et les contrôles'],
    ['CC2.3', 'Communicate with customers and other outside parties', 'Communiquer avec les clients et les parties externes'],
  ]),
  ...reqs('CC3 Risk assessment', [
    ['CC3.1', 'Set objectives clear enough to assess risk', 'Fixer des objectifs assez clairs pour évaluer les risques'],
    ['CC3.2', 'Identify and analyze risks', 'Repérer et analyser les risques'],
    ['CC3.3', 'Consider the potential for fraud', 'Tenir compte du risque de fraude'],
    ['CC3.4', 'Assess changes that could affect controls', 'Évaluer les changements qui pourraient toucher les contrôles'],
  ]),
  ...reqs('CC4 Monitoring', [
    ['CC4.1', 'Ongoing and separate evaluations of controls', 'Évaluations continues et ponctuelles des contrôles'],
    ['CC4.2', 'Report control deficiencies and fix them', 'Signaler les lacunes de contrôle et les corriger'],
  ]),
  ...reqs('CC5 Control activities', [
    ['CC5.1', 'Choose control activities that reduce risk', 'Choisir des activités de contrôle qui réduisent les risques'],
    ['CC5.2', 'General controls over technology', 'Contrôles généraux des technologies'],
    ['CC5.3', 'Put controls in place through policies and procedures', 'Mettre les contrôles en place par des politiques et procédures'],
  ]),
  ...reqs('CC6 Logical and physical access', [
    ['CC6.1', 'Logical access security over data and systems', 'Sécurité de l’accès logique aux données et aux systèmes'],
    ['CC6.2', 'Register and authorize people before giving access', 'Inscrire et autoriser les personnes avant de donner l’accès'],
    ['CC6.3', 'Grant, change and remove access by role', 'Accorder, modifier et retirer l’accès selon le rôle'],
    ['CC6.4', 'Restrict physical access to facilities and equipment', 'Restreindre l’accès physique aux installations et au matériel'],
    ['CC6.5', 'Protect data when equipment is retired', 'Protéger les données lors du retrait du matériel'],
    ['CC6.6', 'Protect against threats from outside the system', 'Se protéger des menaces venant de l’extérieur du système'],
    ['CC6.7', 'Protect data while it moves', 'Protéger les données en transit'],
    ['CC6.8', 'Prevent or detect malicious software', 'Prévenir ou détecter les logiciels malveillants'],
  ]),
  ...reqs('CC7 System operations', [
    ['CC7.1', 'Detect configuration changes and new vulnerabilities', 'Détecter les changements de configuration et les nouvelles vulnérabilités'],
    ['CC7.2', 'Monitor systems for anomalies and attacks', 'Surveiller les systèmes pour repérer anomalies et attaques'],
    ['CC7.3', 'Evaluate security events', 'Évaluer les événements de sécurité'],
    ['CC7.4', 'Respond to security incidents', 'Intervenir lors d’incidents de sécurité'],
    ['CC7.5', 'Recover from incidents', 'Se rétablir après un incident'],
  ]),
  ...reqs('CC8 Change management', [['CC8.1', 'Authorize, test and approve changes before release', 'Autoriser, tester et approuver les changements avant leur mise en production']]),
  ...reqs('CC9 Risk mitigation', [
    ['CC9.1', 'Plan for business disruption', 'Se préparer aux interruptions des activités'],
    ['CC9.2', 'Manage vendor and partner risk', 'Gérer le risque lié aux fournisseurs et partenaires'],
  ]),
  ...reqs('A1 Availability', [
    ['A1.1', 'Watch and plan capacity', 'Surveiller et planifier la capacité'],
    ['A1.2', 'Backups, environmental protection and recovery infrastructure', 'Sauvegardes, protections et infrastructure de reprise'],
    ['A1.3', 'Test recovery', 'Tester la reprise'],
  ]),
  ...reqs('C1 Confidentiality', [
    ['C1.1', 'Identify and protect confidential information', 'Repérer et protéger l’information confidentielle'],
    ['C1.2', 'Dispose of confidential information on schedule', 'Éliminer l’information confidentielle selon le calendrier'],
  ]),
  ...reqs('P Privacy', [
    ['P1.1', 'Give notice of privacy practices', 'Informer des pratiques en matière de vie privée'],
    ['P2.1', 'Offer choice and obtain consent', 'Offrir des choix et obtenir le consentement'],
    ['P3.1', 'Collect only what the purpose needs', 'Ne recueillir que le nécessaire'],
    ['P3.2', 'Get explicit consent where it’s required', 'Obtenir un consentement explicite lorsqu’il est requis'],
    ['P4.1', 'Use information only for the stated purposes', 'N’utiliser l’information qu’aux fins déclarées'],
    ['P4.2', 'Keep information only as long as needed', 'Ne conserver l’information que le temps nécessaire'],
    ['P4.3', 'Dispose of information securely', 'Éliminer l’information de façon sécuritaire'],
    ['P5.1', 'Let people see their information', 'Permettre aux personnes de consulter leurs renseignements'],
    ['P5.2', 'Correct information on request', 'Corriger les renseignements sur demande'],
    ['P6.1', 'Disclose to third parties only for stated purposes or with consent', 'Ne communiquer à des tiers qu’aux fins déclarées ou avec consentement'],
    ['P6.2', 'Record authorized disclosures', 'Consigner les communications autorisées'],
    ['P6.3', 'Record unauthorized disclosures', 'Consigner les communications non autorisées'],
    ['P6.4', 'Get privacy commitments from vendors', 'Obtenir des engagements de confidentialité des fournisseurs'],
    ['P6.5', 'Vendors report breaches to FH', 'Les fournisseurs signalent les atteintes à FH'],
    ['P6.6', 'Notify affected people and customers of breaches', 'Aviser les personnes et clients touchés par une atteinte'],
    ['P6.7', 'Account for disclosures on request', 'Rendre compte des communications sur demande'],
    ['P7.1', 'Keep information accurate and complete', 'Garder l’information exacte et complète'],
    ['P8.1', 'Handle privacy questions, complaints and disputes', 'Traiter les questions, plaintes et différends sur la vie privée'],
  ]),
];

const ISO: Requirement[] = [
  ...reqs('Clauses 4–10', [
    ['4.1', 'Understand the organization and its context', 'Comprendre l’organisation et son contexte'],
    ['4.2', 'Needs of interested parties', 'Besoins des parties intéressées'],
    ['4.3', 'Scope of the management system', 'Périmètre du système de management'],
    ['4.4', 'Establish, run and improve the management system', 'Établir, exploiter et améliorer le système de management'],
    ['5.1', 'Leadership and commitment', 'Leadership et engagement'],
    ['5.2', 'Information security policy', 'Politique de sécurité de l’information'],
    ['5.3', 'Roles, responsibilities and authorities', 'Rôles, responsabilités et autorités'],
    ['6.1.2', 'Information security risk assessment', 'Appréciation des risques de sécurité'],
    ['6.1.3', 'Risk treatment and Statement of Applicability', 'Traitement des risques et déclaration d’applicabilité'],
    ['6.2', 'Security objectives and plans to reach them', 'Objectifs de sécurité et plans pour les atteindre'],
    ['6.3', 'Planning changes to the management system', 'Planifier les modifications du système de management'],
    ['7.1', 'Resources', 'Ressources'],
    ['7.2', 'Competence', 'Compétences'],
    ['7.3', 'Awareness', 'Sensibilisation'],
    ['7.4', 'Communication', 'Communication'],
    ['7.5', 'Documented information', 'Informations documentées'],
    ['8.1', 'Operational planning and control', 'Planification et maîtrise opérationnelles'],
    ['8.2', 'Run risk assessments at planned intervals', 'Apprécier les risques à intervalles planifiés'],
    ['8.3', 'Carry out the risk treatment plan', 'Mettre en œuvre le plan de traitement des risques'],
    ['9.1', 'Monitoring, measurement and evaluation', 'Surveillance, mesure et évaluation'],
    ['9.2', 'Internal audit', 'Audit interne'],
    ['9.3', 'Management review', 'Revue de direction'],
    ['10.1', 'Continual improvement', 'Amélioration continue'],
    ['10.2', 'Nonconformity and corrective action', 'Non-conformité et action corrective'],
  ]),
  ...reqs('Annex A 5 Organizational', [
    ['A.5.1', 'Policies for information security', 'Politiques de sécurité de l’information'],
    ['A.5.2', 'Security roles and responsibilities', 'Rôles et responsabilités en sécurité'],
    ['A.5.3', 'Segregation of duties', 'Séparation des tâches'],
    ['A.5.4', 'Management responsibilities', 'Responsabilités de la direction'],
    ['A.5.5', 'Contact with authorities', 'Contacts avec les autorités'],
    ['A.5.6', 'Contact with special interest groups', 'Contacts avec des groupes d’intérêt'],
    ['A.5.7', 'Threat intelligence', 'Renseignement sur les menaces'],
    ['A.5.8', 'Security in project management', 'Sécurité dans la gestion de projet'],
    ['A.5.9', 'Inventory of information and assets', 'Inventaire de l’information et des actifs'],
    ['A.5.10', 'Acceptable use of information and assets', 'Utilisation acceptable de l’information et des actifs'],
    ['A.5.11', 'Return of assets', 'Restitution des actifs'],
    ['A.5.12', 'Classification of information', 'Classification de l’information'],
    ['A.5.13', 'Labelling of information', 'Marquage de l’information'],
    ['A.5.14', 'Information transfer', 'Transfert de l’information'],
    ['A.5.15', 'Access control', 'Contrôle d’accès'],
    ['A.5.16', 'Identity management', 'Gestion des identités'],
    ['A.5.17', 'Authentication information', 'Informations d’authentification'],
    ['A.5.18', 'Access rights', 'Droits d’accès'],
    ['A.5.19', 'Security in supplier relationships', 'Sécurité dans les relations avec les fournisseurs'],
    ['A.5.20', 'Security in supplier agreements', 'Sécurité dans les accords avec les fournisseurs'],
    ['A.5.21', 'Security in the ICT supply chain', 'Sécurité de la chaîne d’approvisionnement TIC'],
    ['A.5.22', 'Monitoring and review of supplier services', 'Surveillance et revue des services des fournisseurs'],
    ['A.5.23', 'Security for cloud services', 'Sécurité des services infonuagiques'],
    ['A.5.24', 'Planning incident management', 'Planification de la gestion des incidents'],
    ['A.5.25', 'Assessing security events', 'Évaluation des événements de sécurité'],
    ['A.5.26', 'Responding to incidents', 'Réponse aux incidents'],
    ['A.5.27', 'Learning from incidents', 'Tirer des leçons des incidents'],
    ['A.5.28', 'Collecting evidence', 'Collecte de preuves'],
    ['A.5.29', 'Security during disruption', 'Sécurité pendant une perturbation'],
    ['A.5.30', 'ICT readiness for business continuity', 'Préparation des TIC pour la continuité des activités'],
    ['A.5.31', 'Legal, regulatory and contractual requirements', 'Exigences légales, réglementaires et contractuelles'],
    ['A.5.32', 'Intellectual property rights', 'Droits de propriété intellectuelle'],
    ['A.5.33', 'Protection of records', 'Protection des enregistrements'],
    ['A.5.34', 'Privacy and protection of personal information', 'Vie privée et protection des renseignements personnels'],
    ['A.5.35', 'Independent review of information security', 'Revue indépendante de la sécurité de l’information'],
    ['A.5.36', 'Compliance with policies and standards', 'Conformité aux politiques et normes'],
    ['A.5.37', 'Documented operating procedures', 'Procédures d’exploitation documentées'],
  ]),
  ...reqs('Annex A 6 People', [
    ['A.6.1', 'Screening', 'Vérification des antécédents'],
    ['A.6.2', 'Terms of employment', 'Conditions d’emploi'],
    ['A.6.3', 'Security awareness, education and training', 'Sensibilisation, éducation et formation en sécurité'],
    ['A.6.4', 'Disciplinary process', 'Processus disciplinaire'],
    ['A.6.5', 'Responsibilities after leaving or changing jobs', 'Responsabilités après un départ ou un changement de poste'],
    ['A.6.6', 'Confidentiality agreements', 'Ententes de confidentialité'],
    ['A.6.7', 'Remote working', 'Télétravail'],
    ['A.6.8', 'Reporting security events', 'Signalement des événements de sécurité'],
  ]),
  ...reqs('Annex A 7 Physical', [
    ['A.7.1', 'Physical security perimeters', 'Périmètres de sécurité physique'],
    ['A.7.2', 'Physical entry', 'Contrôle des entrées physiques'],
    ['A.7.3', 'Securing offices, rooms and facilities', 'Sécurisation des bureaux, salles et installations'],
    ['A.7.4', 'Physical security monitoring', 'Surveillance de la sécurité physique'],
    ['A.7.5', 'Protecting against physical and environmental threats', 'Protection contre les menaces physiques et environnementales'],
    ['A.7.6', 'Working in secure areas', 'Travail dans les zones sécurisées'],
    ['A.7.7', 'Clear desk and clear screen', 'Bureau propre et écran verrouillé'],
    ['A.7.8', 'Equipment siting and protection', 'Emplacement et protection du matériel'],
    ['A.7.9', 'Security of assets off-premises', 'Sécurité des actifs hors des locaux'],
    ['A.7.10', 'Storage media', 'Supports de stockage'],
    ['A.7.11', 'Supporting utilities', 'Services de soutien'],
    ['A.7.12', 'Cabling security', 'Sécurité du câblage'],
    ['A.7.13', 'Equipment maintenance', 'Entretien du matériel'],
    ['A.7.14', 'Secure disposal or re-use of equipment', 'Élimination ou réutilisation sécuritaire du matériel'],
  ]),
  ...reqs('Annex A 8 Technological', [
    ['A.8.1', 'User endpoint devices', 'Terminaux des utilisateurs'],
    ['A.8.2', 'Privileged access rights', 'Droits d’accès privilégiés'],
    ['A.8.3', 'Information access restriction', 'Restriction de l’accès à l’information'],
    ['A.8.4', 'Access to source code', 'Accès au code source'],
    ['A.8.5', 'Secure authentication', 'Authentification sécurisée'],
    ['A.8.6', 'Capacity management', 'Gestion de la capacité'],
    ['A.8.7', 'Protection against malware', 'Protection contre les logiciels malveillants'],
    ['A.8.8', 'Management of technical vulnerabilities', 'Gestion des vulnérabilités techniques'],
    ['A.8.9', 'Configuration management', 'Gestion de la configuration'],
    ['A.8.10', 'Information deletion', 'Suppression de l’information'],
    ['A.8.11', 'Data masking', 'Masquage des données'],
    ['A.8.12', 'Data leakage prevention', 'Prévention des fuites de données'],
    ['A.8.13', 'Information backup', 'Sauvegarde de l’information'],
    ['A.8.14', 'Redundancy of processing facilities', 'Redondance des moyens de traitement'],
    ['A.8.15', 'Logging', 'Journalisation'],
    ['A.8.16', 'Monitoring activities', 'Activités de surveillance'],
    ['A.8.17', 'Clock synchronization', 'Synchronisation des horloges'],
    ['A.8.18', 'Use of privileged utility programs', 'Utilisation d’utilitaires privilégiés'],
    ['A.8.19', 'Installing software on operational systems', 'Installation de logiciels sur les systèmes en exploitation'],
    ['A.8.20', 'Network security', 'Sécurité des réseaux'],
    ['A.8.21', 'Security of network services', 'Sécurité des services réseau'],
    ['A.8.22', 'Segregation of networks', 'Cloisonnement des réseaux'],
    ['A.8.23', 'Web filtering', 'Filtrage Web'],
    ['A.8.24', 'Use of cryptography', 'Utilisation de la cryptographie'],
    ['A.8.25', 'Secure development life cycle', 'Cycle de développement sécurisé'],
    ['A.8.26', 'Application security requirements', 'Exigences de sécurité des applications'],
    ['A.8.27', 'Secure system architecture and engineering', 'Architecture et ingénierie sécurisées des systèmes'],
    ['A.8.28', 'Secure coding', 'Codage sécurisé'],
    ['A.8.29', 'Security testing in development and acceptance', 'Tests de sécurité en développement et en acceptation'],
    ['A.8.30', 'Outsourced development', 'Développement externalisé'],
    ['A.8.31', 'Separation of development, test and production', 'Séparation des environnements de développement, d’essai et de production'],
    ['A.8.32', 'Change management', 'Gestion des changements'],
    ['A.8.33', 'Test information', 'Informations de test'],
    ['A.8.34', 'Protecting systems during audit testing', 'Protection des systèmes pendant les tests d’audit'],
  ]),
];

const HIPAA: Requirement[] = [
  ...reqs('164.308 Administrative', [
    ['164.308(a)(1)', 'Security management: risk analysis, risk management, sanctions, activity review', 'Gestion de la sécurité : analyse et gestion des risques, sanctions, revue des activités'],
    ['164.308(a)(2)', 'A named person responsible for security', 'Une personne désignée responsable de la sécurité'],
    ['164.308(a)(3)', 'Workforce security: authorize, supervise and remove access', 'Sécurité du personnel : autoriser, superviser et retirer l’accès'],
    ['164.308(a)(4)', 'Information access management', 'Gestion de l’accès à l’information'],
    ['164.308(a)(5)', 'Security awareness and training', 'Sensibilisation et formation à la sécurité'],
    ['164.308(a)(6)', 'Security incident procedures', 'Procédures en cas d’incident de sécurité'],
    ['164.308(a)(7)', 'Contingency plan: backups, disaster recovery, emergency mode', 'Plan de contingence : sauvegardes, reprise après sinistre, mode d’urgence'],
    ['164.308(a)(8)', 'Periodic technical and non-technical evaluation', 'Évaluation périodique technique et non technique'],
    ['164.308(b)', 'Written agreements with business associates', 'Ententes écrites avec les associés d’affaires'],
  ]),
  ...reqs('164.310 Physical', [
    ['164.310(a)', 'Facility access controls', 'Contrôle de l’accès aux installations'],
    ['164.310(b)', 'Workstation use', 'Utilisation des postes de travail'],
    ['164.310(c)', 'Workstation security', 'Sécurité des postes de travail'],
    ['164.310(d)', 'Device and media controls', 'Contrôle des appareils et des supports'],
  ]),
  ...reqs('164.312 Technical', [
    ['164.312(a)', 'Access control: unique ids, emergency access, automatic logoff, encryption', 'Contrôle d’accès : identifiants uniques, accès d’urgence, déconnexion automatique, chiffrement'],
    ['164.312(b)', 'Audit controls', 'Contrôles d’audit'],
    ['164.312(c)', 'Integrity of health information', 'Intégrité des renseignements de santé'],
    ['164.312(d)', 'Person or entity authentication', 'Authentification des personnes ou entités'],
    ['164.312(e)', 'Transmission security', 'Sécurité des transmissions'],
  ]),
  ...reqs('164.314–316 Organizational and documentation', [
    ['164.314(a)', 'Business associate contract terms', 'Clauses des contrats d’associés d’affaires'],
    ['164.314(b)', 'Group health plan requirements', 'Exigences des régimes collectifs de santé'],
    ['164.316(a)', 'Policies and procedures', 'Politiques et procédures'],
    ['164.316(b)', 'Documentation kept six years and reviewed', 'Documentation conservée six ans et révisée'],
  ], { '164.314(b)': ['FH is not a group health plan.', 'FH n’est pas un régime d’assurance maladie collectif.'] }),
];

const PIPEDA: Requirement[] = [
  ...reqs('Fair information principles', [
    ['4.1', 'Accountability: a named person answers for privacy', 'Responsabilité : une personne désignée répond de la vie privée'],
    ['4.2', 'Identify purposes before or at collection', 'Déterminer les fins avant ou pendant la collecte'],
    ['4.3', 'Meaningful consent', 'Consentement valable'],
    ['4.4', 'Limit collection to what’s needed', 'Limiter la collecte au nécessaire'],
    ['4.5', 'Limit use, disclosure and retention', 'Limiter l’utilisation, la communication et la conservation'],
    ['4.6', 'Accuracy', 'Exactitude'],
    ['4.7', 'Security safeguards suited to the sensitivity', 'Mesures de sécurité adaptées à la sensibilité'],
    ['4.8', 'Openness about policies and practices', 'Transparence des politiques et pratiques'],
    ['4.9', 'Individual access', 'Accès aux renseignements personnels'],
    ['4.10', 'Challenging compliance', 'Possibilité de contester le respect des principes'],
  ]),
  // Division 1.1: report to the Commissioner and notify people (s. 10.1); keep a record of every breach (s. 10.3, 24 months under the regulations).
  ...reqs('Breach of security safeguards', [
    ['10.1', 'Report breaches with a real risk of significant harm (s. 10.1) and keep a record of every breach for 24 months (s. 10.3)', 'Déclarer les atteintes présentant un risque réel de préjudice grave (art. 10.1) et consigner chaque atteinte pendant 24 mois (art. 10.3)'],
  ]),
];

const PROVINCIAL: Requirement[] = [
  ...reqs('British Columbia FIPPA', [
    ['BC-30', 'Reasonable security arrangements against unauthorized access', 'Mesures de sécurité raisonnables contre l’accès non autorisé'],
    ['BC-30.5', 'Service providers report unauthorized disclosure to the public body', 'Les fournisseurs signalent toute communication non autorisée à l’organisme public'],
    ['BC-33', 'Disclosure only as the Act allows (s. 33), outside Canada only under s. 33.1 and its regulations', 'Communication seulement selon la Loi (art. 33), hors du Canada seulement selon l’art. 33.1 et ses règlements'],
    ['BC-36.2', 'Privacy management program', 'Programme de gestion de la vie privée'],
    ['BC-36.3', 'Notify affected people and the Commissioner of serious breaches', 'Aviser les personnes touchées et le commissaire des atteintes graves'],
  ]),
  ...reqs('Ontario MFIPPA', [
    ['ON-REG823', 'Reasonable measures to prevent unauthorized access (O. Reg. 823)', 'Mesures raisonnables contre l’accès non autorisé (Règl. de l’Ont. 823)'],
    ['ON-30', 'Retention and accuracy of personal information', 'Conservation et exactitude des renseignements personnels'],
    ['ON-31-32', 'Use and disclosure only as permitted', 'Utilisation et divulgation seulement si permises'],
    ['ON-IPC', 'Breach response following the IPC’s guidance', 'Réponse aux atteintes selon les lignes directrices du CIPVP'],
  ]),
  ...reqs('Alberta FOIP / POPA', [
    ['AB-38', 'Protect personal information with reasonable security', 'Protéger les renseignements personnels par des mesures raisonnables'],
    ['AB-35', 'Accuracy and retention', 'Exactitude et conservation'],
    ['AB-39-40', 'Use and disclosure only as permitted', 'Utilisation et communication seulement si permises'],
  ]),
];

const LAW25: Requirement[] = reqs('Quebec private-sector Act (Law 25)', [
  ['Q-3.1', 'A person in charge of protecting personal information', 'Une personne responsable de la protection des renseignements personnels'],
  ['Q-3.2', 'Governance policies, published in plain language', 'Politiques de gouvernance publiées en termes simples'],
  ['Q-3.3', 'Privacy impact assessment for new systems that handle personal information', 'Évaluation des facteurs relatifs à la vie privée pour les nouveaux systèmes'],
  ['Q-3.5', 'Confidentiality incidents: reduce harm, notify the CAI and people at risk', 'Incidents de confidentialité : réduire le préjudice, aviser la CAI et les personnes à risque'],
  ['Q-3.8', 'Register of confidentiality incidents', 'Registre des incidents de confidentialité'],
  ['Q-8', 'Inform people at collection: purposes, means, rights', 'Informer lors de la collecte : fins, moyens, droits'],
  ['Q-9.1', 'Most privacy-protective settings by default', 'Paramètres les plus protecteurs par défaut'],
  ['Q-12.1', 'Say when a decision is made only by automated processing', 'Informer lorsqu’une décision est fondée uniquement sur un traitement automatisé'],
  ['Q-14', 'Consent that is clear, free, informed and specific', 'Consentement manifeste, libre, éclairé et donné à des fins spécifiques'],
  ['Q-17', 'Assessment before information leaves Quebec', 'Évaluation avant que les renseignements quittent le Québec'],
  ['Q-18.3', 'Written agreement with service providers', 'Entente écrite avec les fournisseurs de services'],
  ['Q-23', 'Destroy or anonymize once the purpose is met', 'Détruire ou anonymiser une fois la fin atteinte'],
  ['Q-27', 'Access, and portability in a structured format', 'Accès, et portabilité dans un format structuré'],
  ['Q-28.1', 'Stop dissemination or de-index on request', 'Cesser la diffusion ou désindexer sur demande'],
]);

export const FRAMEWORKS: Framework[] = [
  { key: 'soc2', name: 'SOC 2', nameFr: 'SOC 2', description: 'AICPA Trust Services Criteria (2017): Security, Availability, Confidentiality and Privacy.', descriptionFr: 'Critères des services de confiance de l’AICPA (2017) : sécurité, disponibilité, confidentialité et vie privée.', requirements: SOC2 },
  { key: 'iso27001', name: 'ISO/IEC 27001:2022', nameFr: 'ISO/CEI 27001:2022', description: 'Management system clauses 4–10 and the 93 Annex A controls.', descriptionFr: 'Articles 4 à 10 du système de management et les 93 mesures de l’annexe A.', requirements: ISO },
  {
    key: 'hipaa', name: 'HIPAA Security Rule', nameFr: 'HIPAA (règle de sécurité)', optional: true,
    description: 'US 45 CFR 164 Subpart C safeguards.', descriptionFr: 'Mesures de protection du 45 CFR 164, sous-partie C (États-Unis).',
    note: 'HIPAA applies to US protected health information. It’s optional for a Canadian HR service; keep it in scope only if a customer asks.',
    noteFr: 'La HIPAA s’applique aux renseignements de santé protégés aux États-Unis. Elle est facultative pour un service RH canadien; gardez-la seulement si un client le demande.',
    requirements: HIPAA,
  },
  { key: 'pipeda', name: 'PIPEDA', nameFr: 'LPRPDE', description: 'The ten fair information principles (Schedule 1) and breach reporting.', descriptionFr: 'Les dix principes relatifs à l’équité dans le traitement de l’information (annexe 1) et la déclaration des atteintes.', requirements: PIPEDA },
  {
    key: 'provincial', name: 'Provincial public-sector privacy', nameFr: 'Vie privée du secteur public provincial',
    description: 'What cities’ own privacy laws ask of their service providers: BC FIPPA, Ontario MFIPPA, Alberta FOIP.',
    descriptionFr: 'Ce que les lois sur la vie privée des villes exigent de leurs fournisseurs : FIPPA (C.-B.), MFIPPA (Ont.), FOIP (Alb.).',
    note: 'Customer-requirement framework: these laws bind the cities, which pass them on by contract. BC: until 2021, s. 30.1 required storage and access in Canada; amendments that year removed it and s. 33.1 now allows disclosure outside Canada under the regulations, but many BC bodies still require Canadian storage by contract. Alberta replaced FOIP with the Protection of Privacy Act and the Access to Information Act in 2025; older contracts still cite FOIP. Section numbers are as commonly cited: have counsel confirm them before quoting them in a contract.',
    noteFr: 'Cadre d’exigences des clients : ces lois s’appliquent aux villes, qui les transmettent par contrat. C.-B. : jusqu’en 2021, l’art. 30.1 exigeait le stockage et l’accès au Canada; les modifications de cette année-là l’ont retiré et l’art. 33.1 permet maintenant la communication hors du Canada selon les règlements, mais de nombreux organismes exigent encore un stockage canadien par contrat. L’Alberta a remplacé la FOIP par la Protection of Privacy Act et l’Access to Information Act en 2025; d’anciens contrats citent encore la FOIP. Les numéros d’articles sont ceux couramment cités : faites-les confirmer par un conseiller juridique avant de les citer dans un contrat.',
    requirements: PROVINCIAL,
  },
  {
    key: 'law25', name: 'Quebec Law 25', nameFr: 'Loi 25 (Québec)', description: 'Quebec’s modernized private-sector privacy Act.', descriptionFr: 'La loi québécoise modernisée sur la protection des renseignements personnels dans le secteur privé.',
    note: 'Section numbers are those of the Act respecting the protection of personal information in the private sector as amended by Law 25, as commonly cited: have counsel confirm them before quoting them in a contract.',
    noteFr: 'Les numéros d’articles sont ceux de la Loi sur la protection des renseignements personnels dans le secteur privé modifiée par la Loi 25, tels qu’ils sont couramment cités : faites-les confirmer par un conseiller juridique avant de les citer dans un contrat.',
    requirements: LAW25,
  },
];
export const FRAMEWORK_KEYS = FRAMEWORKS.map((f) => f.key);

export type ControlCategory = 'access' | 'crypto' | 'tenant' | 'logging' | 'backup' | 'vuln' | 'sdlc' | 'change' | 'incident' | 'continuity' | 'vendor' | 'hr' | 'retention' | 'privacy' | 'physical' | 'governance';
export interface Control {
  key: string;
  category: ControlCategory;
  title: string;
  titleFr: string;
  description: string;
  descriptionFr: string;
  /** Automated tests that prove it (services/trust/monitors.ts). */
  tests: string[];
  /** Needs a person's evidence too, renewed this often (days). */
  evidenceDays?: number;
  evidenceHint?: string;
  evidenceHintFr?: string;
  /** Inherited from the cloud provider (its report is the evidence). */
  inherited?: boolean;
  /** "framework:requirement" */
  maps: string[];
}

const m = (fw: FrameworkKey, ...ids: string[]) => ids.map((i) => `${fw}:${i}`);

export const CONTROLS: Control[] = [
  {
    key: 'AC-01', category: 'access', title: 'Dev console needs a passkey', titleFr: 'Passe-clé exigé pour la console Dev',
    description: 'Every FH console admin signs in with a password and a passkey; sensitive actions need a fresh passkey confirmation.', descriptionFr: 'Chaque administrateur de la console FH se connecte avec un mot de passe et un passe-clé; les actions sensibles exigent une nouvelle confirmation.',
    tests: ['platform_mfa'], maps: [...m('soc2', 'CC6.1', 'CC6.2'), ...m('iso27001', 'A.5.17', 'A.8.5', 'A.8.2'), ...m('hipaa', '164.312(d)', '164.312(a)'), ...m('pipeda', '4.7'), ...m('provincial', 'BC-30', 'ON-REG823', 'AB-38')],
  },
  {
    key: 'AC-02', category: 'access', title: 'Least-privilege database role', titleFr: 'Rôle de base de données à privilèges minimaux',
    description: 'The application connects as a role that can’t bypass row-level security, isn’t a superuser and owns no tables.', descriptionFr: 'L’application se connecte avec un rôle qui ne peut contourner la sécurité au niveau des lignes, n’est pas superutilisateur et ne possède aucune table.',
    tests: ['db_role'], maps: [...m('soc2', 'CC6.1', 'CC6.3', 'CC5.2'), ...m('iso27001', 'A.8.2', 'A.8.18', 'A.8.3'), ...m('hipaa', '164.312(a)')],
  },
  {
    key: 'AC-03', category: 'access', title: 'Access reviews and stale accounts', titleFr: 'Revues d’accès et comptes inactifs',
    description: 'Console accounts unused for 90 days are flagged; access is reviewed every quarter.', descriptionFr: 'Les comptes de console inutilisés depuis 90 jours sont signalés; l’accès est revu chaque trimestre.',
    tests: ['stale_admins'], evidenceDays: 100, evidenceHint: 'Quarterly access review record (who has access, who was removed).', evidenceHintFr: 'Compte rendu de la revue d’accès trimestrielle (qui a accès, qui a été retiré).',
    maps: [...m('soc2', 'CC6.2', 'CC6.3', 'CC4.1'), ...m('iso27001', 'A.5.15', 'A.5.16', 'A.5.18'), ...m('hipaa', '164.308(a)(3)', '164.308(a)(4)')],
  },
  {
    key: 'AC-04', category: 'access', title: 'Customers can require MFA', titleFr: 'Les clients peuvent exiger l’AMF',
    description: 'Each organization can require a passkey for its powerful roles; the test reports organizations that haven’t turned it on for HR administrators.', descriptionFr: 'Chaque organisation peut exiger un passe-clé pour ses rôles puissants; le test signale celles qui ne l’ont pas activé pour les administrateurs RH.',
    tests: ['city_mfa'], maps: [...m('soc2', 'CC6.1'), ...m('iso27001', 'A.8.5'), ...m('hipaa', '164.312(d)'), ...m('pipeda', '4.7'), ...m('law25', 'Q-9.1')],
  },
  {
    key: 'AC-05', category: 'access', title: 'Integration keys scoped and rotated', titleFr: 'Clés d’intégration limitées et renouvelées',
    description: 'API keys have scopes and optional IP limits; keys older than a year are flagged for rotation.', descriptionFr: 'Les clés API ont des portées et des limites d’adresses IP facultatives; les clés de plus d’un an sont signalées pour renouvellement.',
    tests: ['api_key_age'], maps: [...m('soc2', 'CC6.1', 'CC6.6'), ...m('iso27001', 'A.5.17', 'A.8.5')],
  },
  {
    key: 'AC-06', category: 'access', title: 'Strong session secrets', titleFr: 'Secrets de session robustes',
    description: 'Sign-in tokens are short-lived and signed with a long random secret that isn’t a development value.', descriptionFr: 'Les jetons de connexion sont de courte durée et signés avec un long secret aléatoire qui n’est pas une valeur de développement.',
    tests: ['jwt_secret'], maps: [...m('soc2', 'CC6.1'), ...m('iso27001', 'A.8.5', 'A.5.17'), ...m('hipaa', '164.312(a)', '164.312(d)')],
  },
  {
    key: 'AC-07', category: 'access', title: 'Segregation of duties', titleFr: 'Séparation des tâches',
    description: 'Sensitive actions need a passkey step-up; payroll can require a second approver; no one approves their own changes.', descriptionFr: 'Les actions sensibles exigent une confirmation par passe-clé; la paie peut exiger un second approbateur; personne n’approuve ses propres changements.',
    tests: [], evidenceDays: 365, evidenceHint: 'Branch protection settings and a sample of reviewed changes.', evidenceHintFr: 'Paramètres de protection des branches et échantillon de changements révisés.',
    maps: [...m('soc2', 'CC5.1', 'CC3.3'), ...m('iso27001', 'A.5.3')],
  },
  {
    key: 'CR-01', category: 'crypto', title: 'Encryption in transit', titleFr: 'Chiffrement en transit',
    description: 'HTTPS only (HSTS), strict security headers, and TLS to the database in production.', descriptionFr: 'HTTPS seulement (HSTS), en-têtes de sécurité stricts et TLS vers la base de données en production.',
    tests: ['security_headers', 'db_tls'], maps: [...m('soc2', 'CC6.7', 'CC6.6'), ...m('iso27001', 'A.8.24', 'A.5.14', 'A.8.20', 'A.8.21'), ...m('hipaa', '164.312(e)'), ...m('pipeda', '4.7'), ...m('provincial', 'BC-30', 'ON-REG823', 'AB-38')],
  },
  {
    key: 'CR-02', category: 'crypto', title: 'Encryption at rest with managed keys', titleFr: 'Chiffrement au repos avec clés gérées',
    description: 'Sensitive records are sealed with per-record data keys wrapped by a key in AWS KMS (Canada); the database and backups are encrypted.', descriptionFr: 'Les dossiers sensibles sont scellés avec des clés de données par dossier, enveloppées par une clé AWS KMS (Canada); la base de données et les sauvegardes sont chiffrées.',
    tests: ['kek'], maps: [...m('soc2', 'CC6.1', 'C1.1'), ...m('iso27001', 'A.8.24'), ...m('hipaa', '164.312(a)', '164.312(c)'), ...m('pipeda', '4.7'), ...m('provincial', 'BC-30', 'ON-REG823', 'AB-38')],
  },
  {
    key: 'CR-03', category: 'crypto', title: 'Key management and rotation', titleFr: 'Gestion et renouvellement des clés',
    description: 'KMS keys rotate yearly, key policies limit who can decrypt, and a closed organization’s key is scheduled for deletion.', descriptionFr: 'Les clés KMS sont renouvelées chaque année, les politiques limitent qui peut déchiffrer et la clé d’une organisation fermée est programmée pour suppression.',
    tests: [], evidenceDays: 365, evidenceHint: 'KMS key policy and automatic rotation settings.', evidenceHintFr: 'Politique de clé KMS et paramètres de renouvellement automatique.',
    maps: [...m('soc2', 'CC6.1'), ...m('iso27001', 'A.8.24'), ...m('hipaa', '164.312(a)')],
  },
  {
    key: 'CR-04', category: 'crypto', title: 'Secrets kept out of code', titleFr: 'Secrets tenus hors du code',
    description: 'Secrets live in the environment, never in the repository; CI scans every change for committed keys.', descriptionFr: 'Les secrets sont dans l’environnement, jamais dans le dépôt; l’intégration continue vérifie chaque changement.',
    tests: ['dependency_audit'], maps: [...m('soc2', 'CC6.1'), ...m('iso27001', 'A.5.17', 'A.8.4')],
  },
  {
    key: 'TI-01', category: 'tenant', title: 'Tenant isolation by row-level security', titleFr: 'Isolement des clients par sécurité au niveau des lignes',
    description: 'Postgres enforces each organization’s boundary on every table that holds its data, whatever the code does.', descriptionFr: 'Postgres impose la frontière de chaque organisation sur chaque table qui contient ses données, quoi que fasse le code.',
    tests: ['rls'], maps: [...m('soc2', 'CC6.1', 'C1.1', 'CC5.2'), ...m('iso27001', 'A.8.3', 'A.8.22', 'A.8.27'), ...m('hipaa', '164.312(a)'), ...m('pipeda', '4.7'), ...m('provincial', 'BC-30', 'ON-REG823', 'AB-38')],
  },
  {
    key: 'LM-01', category: 'logging', title: 'Audit logging', titleFr: 'Journal d’audit',
    description: 'Sensitive actions in organizations and in the Dev console are written to append-only audit logs.', descriptionFr: 'Les actions sensibles des organisations et de la console Dev sont consignées dans des journaux d’audit en ajout seulement.',
    tests: ['audit_log'], maps: [...m('soc2', 'CC7.2', 'CC4.1', 'P6.2'), ...m('iso27001', 'A.8.15', 'A.5.28', 'A.5.33'), ...m('hipaa', '164.312(b)', '164.308(a)(1)')],
  },
  {
    key: 'LM-02', category: 'logging', title: 'Health monitoring', titleFr: 'Surveillance de l’état',
    description: 'Readiness checks the database, the background worker and the message outbox; alerts follow the runbook.', descriptionFr: 'La vérification de disponibilité contrôle la base de données, le traitement en arrière-plan et la file de messages; les alertes suivent le guide d’exploitation.',
    tests: ['readiness', 'outbox'], maps: [...m('soc2', 'CC7.2', 'CC7.3', 'A1.1'), ...m('iso27001', 'A.8.16', 'A.8.6', '9.1')],
  },
  {
    key: 'LM-03', category: 'logging', title: 'Error tracking', titleFr: 'Suivi des erreurs',
    description: 'Unexpected errors are reported to an error-tracking service after personal information is scrubbed.', descriptionFr: 'Les erreurs inattendues sont signalées à un service de suivi après le retrait des renseignements personnels.',
    tests: ['error_tracking'], maps: [...m('soc2', 'CC7.2', 'CC7.3'), ...m('iso27001', 'A.8.16')],
  },
  {
    key: 'LM-04', category: 'logging', title: 'Protected metrics', titleFr: 'Mesures protégées',
    description: 'Prometheus metrics need a bearer token and carry counts only.', descriptionFr: 'Les mesures Prometheus exigent un jeton et ne contiennent que des nombres.',
    tests: ['metrics_token'], maps: [...m('soc2', 'CC7.2'), ...m('iso27001', 'A.8.16')],
  },
  {
    key: 'LM-05', category: 'logging', title: 'Synchronized clocks', titleFr: 'Horloges synchronisées',
    description: 'Servers and the database use the cloud provider’s time service; all times are stored in UTC.', descriptionFr: 'Les serveurs et la base de données utilisent le service de temps du fournisseur infonuagique; toutes les heures sont stockées en UTC.',
    tests: [], inherited: true, evidenceDays: 365, evidenceHint: 'Cloud provider report covering time synchronization.', evidenceHintFr: 'Rapport du fournisseur infonuagique couvrant la synchronisation du temps.',
    maps: [...m('iso27001', 'A.8.17')],
  },
  {
    key: 'BK-01', category: 'backup', title: 'Encrypted, immutable backups', titleFr: 'Sauvegardes chiffrées et immuables',
    description: 'Nightly snapshots, point-in-time recovery, and a weekly copy to a second Canadian region with object lock.', descriptionFr: 'Instantanés nocturnes, restauration à un moment précis et copie hebdomadaire dans une seconde région canadienne avec verrouillage.',
    tests: ['backup_evidence'], evidenceDays: 8, evidenceHint: 'This week’s backup confirmation (snapshot list or copy job result).', evidenceHintFr: 'Confirmation de sauvegarde de la semaine (liste des instantanés ou résultat de la copie).',
    maps: [...m('soc2', 'A1.2', 'CC9.1'), ...m('iso27001', 'A.8.13', 'A.8.14'), ...m('hipaa', '164.308(a)(7)')],
  },
  {
    key: 'BK-02', category: 'backup', title: 'Restore tested monthly', titleFr: 'Restauration testée chaque mois',
    description: 'A backup is restored to an isolated environment every month and the result is recorded.', descriptionFr: 'Une sauvegarde est restaurée dans un environnement isolé chaque mois et le résultat est consigné.',
    tests: ['restore_evidence'], evidenceDays: 35, evidenceHint: 'Restore test record: date, backup used, time taken, row counts, result.', evidenceHintFr: 'Compte rendu du test de restauration : date, sauvegarde utilisée, durée, nombres de lignes, résultat.',
    maps: [...m('soc2', 'A1.3'), ...m('iso27001', 'A.5.30', 'A.8.13'), ...m('hipaa', '164.308(a)(7)')],
  },
  {
    key: 'VM-01', category: 'vuln', title: 'Dependency audit and code scanning', titleFr: 'Audit des dépendances et analyse du code',
    description: 'CI runs CodeQL and a dependency audit on every change and weekly; a high advisory fails the run.', descriptionFr: 'L’intégration continue exécute CodeQL et un audit des dépendances à chaque changement et chaque semaine; un avis élevé fait échouer l’exécution.',
    tests: ['dependency_audit'], maps: [...m('soc2', 'CC7.1', 'CC8.1', 'CC6.8'), ...m('iso27001', 'A.8.8', 'A.8.7', 'A.8.29'), ...m('hipaa', '164.308(a)(1)')],
  },
  {
    key: 'VM-02', category: 'vuln', title: 'Patching on time', titleFr: 'Correctifs dans les délais',
    description: 'Critical vulnerabilities patched within 48 hours, high within 7 days; threat feeds checked daily.', descriptionFr: 'Vulnérabilités critiques corrigées en 48 heures, élevées en 7 jours; sources de menaces consultées chaque jour.',
    tests: [], evidenceDays: 35, evidenceHint: 'Monthly patch report (open advisories and their age).', evidenceHintFr: 'Rapport mensuel des correctifs (avis ouverts et leur âge).',
    maps: [...m('soc2', 'CC7.1'), ...m('iso27001', 'A.8.8', 'A.5.7', 'A.5.6', 'A.8.19')],
  },
  {
    key: 'VM-03', category: 'vuln', title: 'Yearly penetration test', titleFr: 'Test d’intrusion annuel',
    description: 'An independent firm tests the application yearly; findings are tracked to closure.', descriptionFr: 'Une firme indépendante teste l’application chaque année; les constats sont suivis jusqu’à leur résolution.',
    tests: [], evidenceDays: 365, evidenceHint: 'Penetration test report summary and remediation status.', evidenceHintFr: 'Résumé du rapport de test d’intrusion et état des corrections.',
    maps: [...m('soc2', 'CC4.1', 'CC7.1'), ...m('iso27001', 'A.8.29', 'A.5.35', 'A.8.34'), ...m('hipaa', '164.308(a)(8)')],
  },
  {
    key: 'SD-01', category: 'sdlc', title: 'Secure development', titleFr: 'Développement sécurisé',
    description: 'Changes are reviewed, tested in CI (unit, integration, isolation and injection tests) and never use real customer data in tests.', descriptionFr: 'Les changements sont révisés, testés en intégration continue (tests unitaires, d’intégration, d’isolement et d’injection) et n’utilisent jamais de vraies données clients dans les tests.',
    tests: [], evidenceDays: 180, evidenceHint: 'CI configuration, branch protection, a sample of reviewed pull requests.', evidenceHintFr: 'Configuration CI, protection des branches, échantillon de demandes de fusion révisées.',
    maps: [...m('soc2', 'CC8.1', 'CC5.2'), ...m('iso27001', 'A.8.25', 'A.8.26', 'A.8.27', 'A.8.28', 'A.8.29', 'A.8.30', 'A.8.31', 'A.8.33', 'A.8.4', 'A.5.8'), ...m('hipaa', '164.312(c)')],
  },
  {
    key: 'CM-01', category: 'change', title: 'Change management', titleFr: 'Gestion des changements',
    description: 'Every production change goes through review and CI; database migrations are versioned; configuration is code.', descriptionFr: 'Chaque changement en production passe par la révision et l’intégration continue; les migrations sont versionnées; la configuration est du code.',
    tests: [], evidenceDays: 180, evidenceHint: 'Release log and the matching reviews.', evidenceHintFr: 'Journal des versions et révisions correspondantes.',
    maps: [...m('soc2', 'CC8.1', 'CC3.4'), ...m('iso27001', 'A.8.32', 'A.8.9', 'A.8.19', '6.3')],
  },
  {
    key: 'IR-01', category: 'incident', title: 'Incident response plan', titleFr: 'Plan d’intervention en cas d’incident',
    description: 'A runbook with roles, severity levels and steps; a tabletop exercise each quarter; lessons recorded.', descriptionFr: 'Un guide avec rôles, niveaux de gravité et étapes; un exercice sur table chaque trimestre; leçons consignées.',
    tests: [], evidenceDays: 100, evidenceHint: 'Latest tabletop exercise notes or incident review.', evidenceHintFr: 'Notes du dernier exercice sur table ou revue d’incident.',
    maps: [...m('soc2', 'CC7.3', 'CC7.4', 'CC7.5', 'CC2.2'), ...m('iso27001', 'A.5.24', 'A.5.25', 'A.5.26', 'A.5.27', 'A.5.28', 'A.6.8', '10.2'), ...m('hipaa', '164.308(a)(6)'), ...m('provincial', 'BC-30.5', 'ON-IPC'), ...m('law25', 'Q-3.8'), ...m('pipeda', '10.1')],
  },
  {
    key: 'IR-02', category: 'incident', title: 'Breach notification on time', titleFr: 'Avis d’atteinte dans les délais',
    description: 'Customers are told within the window each contract promises (24–72 hours); regulators and people are notified when the law requires.', descriptionFr: 'Les clients sont avisés dans le délai promis par chaque contrat (24 à 72 heures); les autorités et les personnes sont avisées lorsque la loi l’exige.',
    tests: ['commitments_overdue'], maps: [...m('soc2', 'CC2.3', 'P6.6', 'P6.3'), ...m('iso27001', 'A.5.26', 'A.5.5'), ...m('pipeda', '10.1'), ...m('provincial', 'BC-36.3', 'BC-30.5', 'ON-IPC'), ...m('law25', 'Q-3.5')],
  },
  {
    key: 'BC-01', category: 'continuity', title: 'Business continuity and disaster recovery', titleFr: 'Continuité des activités et reprise après sinistre',
    description: 'Recovery targets (15-minute RPO, 4-hour RTO), a second Canadian region, and a plan tested yearly.', descriptionFr: 'Cibles de reprise (PRP de 15 minutes, DMIA de 4 heures), seconde région canadienne et plan testé chaque année.',
    tests: [], evidenceDays: 365, evidenceHint: 'Continuity plan and the latest failover or DR test.', evidenceHintFr: 'Plan de continuité et dernier test de basculement ou de reprise.',
    maps: [...m('soc2', 'CC9.1', 'A1.2', 'CC7.5'), ...m('iso27001', 'A.5.29', 'A.5.30', 'A.8.14'), ...m('hipaa', '164.308(a)(7)')],
  },
  {
    key: 'BC-02', category: 'continuity', title: 'Urgent messages keep flowing', titleFr: 'Les messages urgents continuent de partir',
    description: 'Safety texts and calls are watched; any unsent after two minutes raises an alert.', descriptionFr: 'Les textos et appels de sécurité sont surveillés; tout message non envoyé après deux minutes déclenche une alerte.',
    tests: ['outbox', 'webhooks_failing'], maps: [...m('soc2', 'A1.1', 'A1.2'), ...m('iso27001', 'A.8.6', 'A.8.16')],
  },
  {
    key: 'VN-01', category: 'vendor', title: 'Vendor due diligence', titleFr: 'Vérification diligente des fournisseurs',
    description: 'Before use and yearly: agreement, certifications, data location and a security questionnaire for each vendor.', descriptionFr: 'Avant l’utilisation et chaque année : entente, certifications, lieu des données et questionnaire de sécurité pour chaque fournisseur.',
    tests: ['vendor_reviews'], maps: [...m('soc2', 'CC9.2', 'P6.4', 'P6.5'), ...m('iso27001', 'A.5.19', 'A.5.20', 'A.5.21', 'A.5.22', 'A.5.23'), ...m('hipaa', '164.308(b)', '164.314(a)'), ...m('pipeda', '4.1'), ...m('law25', 'Q-18.3', 'Q-17'), ...m('provincial', 'BC-33')],
  },
  {
    key: 'VN-02', category: 'vendor', title: 'Subprocessor list kept current', titleFr: 'Liste des sous-traitants à jour',
    description: 'The subprocessor list is published to customers, who hear 30 days before a new one is used.', descriptionFr: 'La liste des sous-traitants est communiquée aux clients, qui sont avisés 30 jours avant l’ajout d’un nouveau.',
    tests: [], evidenceDays: 365, evidenceHint: 'Current subprocessor list and the last change notice.', evidenceHintFr: 'Liste actuelle des sous-traitants et dernier avis de changement.',
    maps: [...m('soc2', 'CC2.3', 'P6.4'), ...m('iso27001', 'A.5.19'), ...m('pipeda', '4.8')],
  },
  {
    key: 'HR-01', category: 'hr', title: 'Hiring: screening and confidentiality', titleFr: 'Embauche : vérifications et confidentialité',
    description: 'Background checks where the law allows, signed confidentiality terms and security duties in every contract.', descriptionFr: 'Vérification des antécédents lorsque la loi le permet, clauses de confidentialité signées et obligations de sécurité dans chaque contrat.',
    tests: [], evidenceDays: 365, evidenceHint: 'Onboarding checklist for each new hire this year.', evidenceHintFr: 'Liste d’accueil de chaque nouvelle personne embauchée cette année.',
    maps: [...m('soc2', 'CC1.1', 'CC1.4'), ...m('iso27001', 'A.6.1', 'A.6.2', 'A.6.6', 'A.6.4', 'A.6.7'), ...m('hipaa', '164.308(a)(3)')],
  },
  {
    key: 'HR-02', category: 'hr', title: 'Yearly security and privacy training', titleFr: 'Formation annuelle en sécurité et vie privée',
    description: 'Everyone with access completes security and privacy training at hire and every year.', descriptionFr: 'Toute personne ayant accès suit une formation en sécurité et vie privée à l’embauche et chaque année.',
    tests: [], evidenceDays: 365, evidenceHint: 'Training completion list.', evidenceHintFr: 'Liste des formations suivies.',
    maps: [...m('soc2', 'CC1.4', 'CC2.2'), ...m('iso27001', 'A.6.3', '7.2', '7.3'), ...m('hipaa', '164.308(a)(5)'), ...m('pipeda', '4.1')],
  },
  {
    key: 'HR-03', category: 'hr', title: 'Offboarding removes access the same day', titleFr: 'Le départ retire l’accès le jour même',
    description: 'A departing person’s console account is disabled, sessions ended and equipment returned.', descriptionFr: 'Le compte de console d’une personne qui part est désactivé, ses sessions terminées et son matériel rendu.',
    tests: ['offboarded_admins'], maps: [...m('soc2', 'CC6.2', 'CC6.3'), ...m('iso27001', 'A.5.11', 'A.6.5', 'A.5.18'), ...m('hipaa', '164.308(a)(3)')],
  },
  {
    key: 'HR-04', category: 'hr', title: 'Policies read and accepted', titleFr: 'Politiques lues et acceptées',
    description: 'Every console admin accepts each published policy; reminders go out until they do.', descriptionFr: 'Chaque administrateur de la console accepte chaque politique publiée; des rappels sont envoyés jusqu’à ce qu’il le fasse.',
    tests: ['policy_acks'], maps: [...m('soc2', 'CC1.1', 'CC2.2', 'CC5.3'), ...m('iso27001', '5.2', 'A.5.1', 'A.5.10', '7.3', 'A.5.36'), ...m('hipaa', '164.316(a)')],
  },
  {
    key: 'RT-01', category: 'retention', title: 'Retention applied automatically', titleFr: 'Conservation appliquée automatiquement',
    description: 'The worker removes records past each organization’s retention period every hour.', descriptionFr: 'Le traitement en arrière-plan retire chaque heure les dossiers dont la durée de conservation est échue.',
    tests: ['retention_job'], maps: [...m('soc2', 'C1.2', 'P4.2', 'P4.3'), ...m('iso27001', 'A.8.10', 'A.5.33'), ...m('pipeda', '4.5'), ...m('provincial', 'ON-30', 'AB-35'), ...m('law25', 'Q-23')],
  },
  {
    key: 'RT-02', category: 'retention', title: 'Deletion at end of contract', titleFr: 'Suppression à la fin du contrat',
    description: 'A closed organization gets an export window, then its data is purged and its key scheduled for deletion.', descriptionFr: 'Une organisation fermée dispose d’une période d’exportation, puis ses données sont purgées et sa clé programmée pour suppression.',
    tests: [], evidenceDays: 365, evidenceHint: 'Purge record for the last closed organization (or a dry run).', evidenceHintFr: 'Compte rendu de purge de la dernière organisation fermée (ou un essai).',
    maps: [...m('soc2', 'C1.2', 'CC6.5', 'P4.3'), ...m('iso27001', 'A.8.10', 'A.7.14', 'A.7.10'), ...m('hipaa', '164.310(d)'), ...m('law25', 'Q-23')],
  },
  {
    key: 'PR-01', category: 'privacy', title: 'Notice and consent', titleFr: 'Avis et consentement',
    description: 'People see a plain-language notice and sign a versioned consent; optional uses stay off until they choose them.', descriptionFr: 'Les personnes voient un avis en termes simples et signent un consentement versionné; les utilisations facultatives restent désactivées jusqu’à leur choix.',
    tests: [], evidenceDays: 365, evidenceHint: 'Current privacy notice and consent text.', evidenceHintFr: 'Avis de confidentialité et texte de consentement actuels.',
    maps: [...m('soc2', 'P1.1', 'P2.1', 'P3.2'), ...m('pipeda', '4.2', '4.3', '4.8'), ...m('law25', 'Q-8', 'Q-14', 'Q-9.1'), ...m('iso27001', 'A.5.34')],
  },
  {
    key: 'PR-02', category: 'privacy', title: 'Access, correction and portability', titleFr: 'Accès, rectification et portabilité',
    description: 'People can download their records; organizations export everything in open formats; corrections are logged.', descriptionFr: 'Les personnes peuvent télécharger leurs dossiers; les organisations exportent tout en formats ouverts; les corrections sont consignées.',
    tests: [], evidenceDays: 365, evidenceHint: 'Request log and response times for the year.', evidenceHintFr: 'Registre des demandes et délais de réponse de l’année.',
    maps: [...m('soc2', 'P5.1', 'P5.2', 'P6.7', 'P7.1', 'P8.1'), ...m('pipeda', '4.6', '4.9', '4.10'), ...m('law25', 'Q-27', 'Q-28.1'), ...m('provincial', 'ON-30', 'AB-35')],
  },
  {
    key: 'PR-03', category: 'privacy', title: 'Privacy program and officer', titleFr: 'Programme de vie privée et responsable',
    description: 'A named privacy officer, privacy impact assessments for new features, and published governance policies.', descriptionFr: 'Un responsable de la vie privée désigné, des évaluations des facteurs relatifs à la vie privée pour les nouvelles fonctions et des politiques de gouvernance publiées.',
    tests: [], evidenceDays: 365, evidenceHint: 'Privacy officer designation and the latest PIA.', evidenceHintFr: 'Désignation du responsable et dernière EFVP.',
    maps: [...m('soc2', 'CC1.3', 'P8.1'), ...m('pipeda', '4.1', '4.10'), ...m('law25', 'Q-3.1', 'Q-3.2', 'Q-3.3', 'Q-12.1'), ...m('provincial', 'BC-36.2'), ...m('iso27001', 'A.5.34', 'A.5.2')],
  },
  {
    key: 'PR-04', category: 'privacy', title: 'Collect and share only what’s needed', titleFr: 'Ne recueillir et partager que le nécessaire',
    description: 'No SINs, banking or health data through integrations; masked identifiers in reports; disclosures logged.', descriptionFr: 'Aucun NAS, renseignement bancaire ou de santé par les intégrations; identifiants masqués dans les rapports; communications consignées.',
    tests: [], evidenceDays: 365, evidenceHint: 'Data inventory with the purpose of each field.', evidenceHintFr: 'Inventaire des données avec la fin de chaque champ.',
    maps: [...m('soc2', 'P3.1', 'P4.1', 'P6.1', 'C1.1'), ...m('pipeda', '4.4', '4.5'), ...m('iso27001', 'A.8.11', 'A.8.12'), ...m('provincial', 'ON-31-32', 'AB-39-40')],
  },
  {
    key: 'PR-05', category: 'privacy', title: 'Data stays in Canada', titleFr: 'Les données restent au Canada',
    description: 'The service refuses to start outside a Canadian cloud region; backups stay in Canada too.', descriptionFr: 'Le service refuse de démarrer hors d’une région infonuagique canadienne; les sauvegardes restent aussi au Canada.',
    tests: ['data_residency'], maps: [...m('soc2', 'C1.1'), ...m('iso27001', 'A.5.23', 'A.5.31'), ...m('provincial', 'BC-33'), ...m('law25', 'Q-17'), ...m('pipeda', '4.7')],
  },
  {
    key: 'PS-01', category: 'physical', title: 'Physical security (inherited)', titleFr: 'Sécurité physique (héritée)',
    description: 'FH runs no data centre: physical and environmental security are the cloud provider’s, covered by its audit reports.', descriptionFr: 'FH n’exploite aucun centre de données : la sécurité physique et environnementale relève du fournisseur infonuagique, couverte par ses rapports d’audit.',
    tests: [], inherited: true, evidenceDays: 365, evidenceHint: 'The cloud provider’s current SOC 2 Type II report.', evidenceHintFr: 'Le rapport SOC 2 Type II actuel du fournisseur infonuagique.',
    maps: [...m('soc2', 'CC6.4', 'CC6.5', 'A1.2'), ...m('iso27001', 'A.7.1', 'A.7.2', 'A.7.3', 'A.7.4', 'A.7.5', 'A.7.6', 'A.7.8', 'A.7.11', 'A.7.12', 'A.7.13'), ...m('hipaa', '164.310(a)', '164.310(d)')],
  },
  {
    key: 'PS-02', category: 'physical', title: 'Staff devices secured', titleFr: 'Appareils du personnel sécurisés',
    description: 'Laptops have disk encryption, screen lock, automatic updates, malware protection and filtering of malicious websites; remote work rules apply.', descriptionFr: 'Les portables ont le chiffrement du disque, le verrouillage de l’écran, les mises à jour automatiques, une protection contre les logiciels malveillants et le filtrage des sites Web malveillants; des règles de télétravail s’appliquent.',
    tests: [], evidenceDays: 100, evidenceHint: 'Device inventory with encryption, update, malware and web filtering status.', evidenceHintFr: 'Inventaire des appareils avec l’état du chiffrement, des mises à jour, de la protection contre les logiciels malveillants et du filtrage Web.',
    maps: [...m('soc2', 'CC6.8', 'CC6.5'), ...m('iso27001', 'A.8.1', 'A.7.7', 'A.7.9', 'A.6.7', 'A.8.7', 'A.8.23', 'A.7.10'), ...m('hipaa', '164.310(b)', '164.310(c)')],
  },
  {
    key: 'NW-01', category: 'access', title: 'Network protections', titleFr: 'Protections réseau',
    description: 'A web application firewall, private database networking and tight security groups.', descriptionFr: 'Un pare-feu applicatif Web, une base de données en réseau privé et des groupes de sécurité restreints.',
    tests: [], evidenceDays: 180, evidenceHint: 'WAF rules and security group export.', evidenceHintFr: 'Règles du pare-feu et exportation des groupes de sécurité.',
    maps: [...m('soc2', 'CC6.6'), ...m('iso27001', 'A.8.20', 'A.8.21', 'A.8.22')],
  },
  {
    key: 'GV-01', category: 'governance', title: 'Security program governance', titleFr: 'Gouvernance du programme de sécurité',
    description: 'A policy set, named owners, objectives and a yearly management review of the program.', descriptionFr: 'Un ensemble de politiques, des responsables désignés, des objectifs et une revue annuelle du programme par la direction.',
    tests: [], evidenceDays: 365, evidenceHint: 'Minutes of the latest management review.', evidenceHintFr: 'Procès-verbal de la dernière revue de direction.',
    maps: [...m('soc2', 'CC1.2', 'CC1.3', 'CC1.5', 'CC2.1', 'CC3.1', 'CC5.3'), ...m('iso27001', '4.1', '4.3', '4.4', '5.1', '5.3', '6.2', '7.1', '7.4', '7.5', '9.3', '10.1', 'A.5.4', 'A.5.37', 'A.5.2'), ...m('hipaa', '164.308(a)(2)', '164.316(b)')],
  },
  {
    key: 'GV-02', category: 'governance', title: 'Risk assessment and treatment', titleFr: 'Appréciation et traitement des risques',
    description: 'A risk register reviewed every quarter, with owners and treatment dates.', descriptionFr: 'Un registre des risques revu chaque trimestre, avec responsables et dates de traitement.',
    tests: ['risks_overdue'], maps: [...m('soc2', 'CC3.1', 'CC3.2', 'CC3.3', 'CC3.4', 'CC9.1'), ...m('iso27001', '6.1.2', '6.1.3', '8.2', '8.3'), ...m('hipaa', '164.308(a)(1)')],
  },
  {
    key: 'GV-03', category: 'governance', title: 'Continuous monitoring and internal audit', titleFr: 'Surveillance continue et audit interne',
    description: 'Automated tests run every few minutes; evidence requests are met on time; an internal audit runs yearly.', descriptionFr: 'Des tests automatisés s’exécutent aux quelques minutes; les demandes de preuves sont satisfaites à temps; un audit interne a lieu chaque année.',
    tests: ['evidence_overdue'], evidenceDays: 365, evidenceHint: 'Internal audit report.', evidenceHintFr: 'Rapport d’audit interne.',
    maps: [...m('soc2', 'CC4.1', 'CC4.2', 'CC2.1'), ...m('iso27001', '9.1', '9.2', '8.1', 'A.5.35', 'A.5.36'), ...m('hipaa', '164.308(a)(8)')],
  },
  {
    key: 'GV-04', category: 'governance', title: 'Customer commitments met', titleFr: 'Engagements envers les clients respectés',
    description: 'Every security promise to a customer is tracked with an owner and a due date, and met on time.', descriptionFr: 'Chaque promesse de sécurité faite à un client est suivie avec un responsable et une échéance, et respectée à temps.',
    tests: ['commitments_overdue'], maps: [...m('soc2', 'CC2.3'), ...m('iso27001', '4.2', 'A.5.31'), ...m('pipeda', '4.1')],
  },
  {
    key: 'GV-05', category: 'governance', title: 'Legal and contract register', titleFr: 'Registre légal et contractuel',
    description: 'The laws, contracts and licences that apply to FH are listed and reviewed yearly.', descriptionFr: 'Les lois, contrats et licences qui s’appliquent à FH sont répertoriés et revus chaque année.',
    tests: [], evidenceDays: 365, evidenceHint: 'Legal and regulatory register.', evidenceHintFr: 'Registre légal et réglementaire.',
    maps: [...m('soc2', 'CC2.3', 'CC3.1'), ...m('iso27001', 'A.5.31', 'A.5.32', 'A.5.5', '4.2')],
  },
  {
    key: 'GV-06', category: 'governance', title: 'Asset inventory and classification', titleFr: 'Inventaire et classification des actifs',
    description: 'Systems, data stores and their sensitivity are listed; acceptable use rules apply to all of them.', descriptionFr: 'Les systèmes, magasins de données et leur sensibilité sont répertoriés; des règles d’utilisation acceptable s’appliquent à tous.',
    tests: [], evidenceDays: 365, evidenceHint: 'Asset inventory with classification.', evidenceHintFr: 'Inventaire des actifs avec classification.',
    maps: [...m('soc2', 'CC6.1', 'CC2.1'), ...m('iso27001', 'A.5.9', 'A.5.10', 'A.5.12', 'A.5.13')],
  },
];

export const controlByKey = new Map(CONTROLS.map((c) => [c.key, c]));
export const frameworkByKey = new Map(FRAMEWORKS.map((f) => [f.key, f]));

/** Library problems (a mapping to a requirement that doesn't exist, a duplicate key): the unit test asserts none. */
export function libraryProblems(): string[] {
  const out: string[] = [];
  const ids = new Set(FRAMEWORKS.flatMap((f) => f.requirements.map((r) => `${f.key}:${r.id}`)));
  const keys = new Set<string>();
  for (const c of CONTROLS) {
    if (keys.has(c.key)) out.push(`duplicate control ${c.key}`);
    keys.add(c.key);
    for (const x of c.maps) if (!ids.has(x)) out.push(`${c.key} maps to unknown ${x}`);
  }
  for (const f of FRAMEWORKS) {
    const seen = new Set<string>();
    for (const r of f.requirements) {
      if (seen.has(r.id)) out.push(`duplicate requirement ${f.key}:${r.id}`);
      seen.add(r.id);
    }
  }
  return out;
}

/** Controls mapped to one requirement. */
export function controlsFor(framework: FrameworkKey, requirementId: string): Control[] {
  const k = `${framework}:${requirementId}`;
  return CONTROLS.filter((c) => c.maps.includes(k));
}
