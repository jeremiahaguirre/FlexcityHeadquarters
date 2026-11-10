/**
 * The information and consent agreement each person signs at their first sign-in.
 *
 * It says what FlexcityHeadquarters captures, why, who sees it, and which permissions are
 * optional (notifications, location), then records the person's signature as evidence: the
 * exact version and language shown, a SHA-256 fingerprint of that text, the typed name, the
 * drawn signature (and its fingerprint), the choices made, the time, and the device's address
 * and browser. A new version is signed again at the next sign-in.
 *
 * The text is drafted for review by counsel; the organization is the controller of its staff's
 * information, FlexcityHeadquarters processes it for them.
 */
import { createHash } from 'node:crypto';

/** Bump when the text changes: everyone is asked to sign the new version. */
export const CONSENT_VERSION = '2026-11-10';

export interface AgreementText { title: string; intro: string; sections: Array<{ heading: string; body: string[] }>; confirm: string }

const EN: AgreementText = {
  title: 'Using FlexcityHeadquarters: what’s collected, and your choices',
  intro: 'Your employer uses FlexcityHeadquarters for scheduling, timekeeping, pay, safety and HR. Your employer decides how it’s used and is responsible for your information; FlexcityHeadquarters handles it on their behalf, in Canada.',
  sections: [
    { heading: 'What is captured', body: ['Your profile: name, contact details, positions, certifications and employment details your employer enters.', 'Your work: schedules, shifts you take or give away, availability, time off, clock-in and clock-out times, and, if your employer runs payroll here, pay, deductions and banking for direct deposit (encrypted).', 'Records your employer keeps in the app, such as onboarding checks, incident reports, training and, where they apply, HR records you are told about.', 'Security information: when and how you sign in, your device’s internet address and browser at sign-in and when you sign this agreement, and a log of changes made to records.'] },
    { heading: 'Location', body: ['When you clock in, your phone is asked once where you are, only to confirm you’re at the facility. Only whether you were on site and how far away is kept, never the location itself.', 'During a working-alone session you start, you can choose to share your location with the people who monitor lone workers. It’s updated only while the app is open, and removed when you stop sharing or 30 days after the session.', 'Location is never tracked at any other time, and you can refuse it in your phone’s settings; clocking in then needs your supervisor’s review.'] },
    { heading: 'Notifications', body: ['You can allow notifications on your phone or computer for shift offers, schedule changes and working-alone reminders. The lock screen shows a short heading only, never details about pay, health, discipline or documents. You can turn them off at any time.'] },
    { heading: 'Why, and who sees it', body: ['Your information is used to schedule and pay you, keep you safe at work, and meet your employer’s duties under employment standards, health and safety and tax law. It is not sold or used for advertising.', 'People see only what their role needs: you see your own records; supervisors see their department; HR and payroll see what their work requires. FlexcityHeadquarters staff can’t see your records unless your employer asks for support and lets them, for a limited time, and every visit is logged.'] },
    { heading: 'Keeping it, and your rights', body: ['Records are kept as long as your employer needs them and the law requires, then deleted. You can see and download your records from Your privacy in your menu, ask your employer to correct them, and ask them about how your information is handled under PIPEDA, your province’s privacy law or, in Quebec, Law 25.'] },
  ],
  confirm: 'By signing, I confirm I have read this notice, and I agree to the use of my information described here and to the optional choices I made below. I can change those choices at any time in my profile and phone settings.',
};

const FR: AgreementText = {
  title: 'Utiliser FlexcityHeadquarters : ce qui est recueilli, et vos choix',
  intro: 'Votre employeur utilise FlexcityHeadquarters pour les horaires, le pointage, la paie, la sécurité et les RH. Votre employeur décide de son utilisation et est responsable de vos renseignements; FlexcityHeadquarters les traite en son nom, au Canada.',
  sections: [
    { heading: 'Ce qui est recueilli', body: ['Votre profil : nom, coordonnées, postes, certifications et renseignements d’emploi saisis par votre employeur.', 'Votre travail : horaires, quarts pris ou cédés, disponibilités, congés, heures d’arrivée et de départ et, si votre employeur fait la paie ici, la paie, les retenues et les renseignements bancaires pour le dépôt direct (chiffrés).', 'Les dossiers que votre employeur tient dans l’application, comme les vérifications d’intégration, les rapports d’incident, la formation et, le cas échéant, les dossiers RH dont vous êtes informé.', 'Renseignements de sécurité : quand et comment vous vous connectez, l’adresse Internet et le navigateur de votre appareil à la connexion et à la signature de cette entente, et un journal des modifications apportées aux dossiers.'] },
    { heading: 'Position', body: ['Au pointage, votre téléphone est interrogé une fois sur votre position, seulement pour confirmer que vous êtes à l’installation. Seuls le fait d’être sur place et la distance sont conservés, jamais la position elle-même.', 'Pendant une séance de travail seul que vous commencez, vous pouvez choisir de partager votre position avec les personnes qui surveillent le travail seul. Elle n’est mise à jour que pendant que l’application est ouverte, et supprimée quand vous cessez de la partager ou 30 jours après la séance.', 'Votre position n’est jamais suivie à un autre moment, et vous pouvez la refuser dans les réglages de votre téléphone; le pointage doit alors être révisé par votre superviseur.'] },
    { heading: 'Notifications', body: ['Vous pouvez autoriser les notifications sur votre téléphone ou votre ordinateur pour les offres de quarts, les changements d’horaire et les rappels de travail seul. L’écran verrouillé n’affiche qu’un court titre, jamais de détails sur la paie, la santé, la discipline ou les documents. Vous pouvez les désactiver en tout temps.'] },
    { heading: 'Pourquoi, et qui y a accès', body: ['Vos renseignements servent à établir votre horaire et votre paie, à assurer votre sécurité au travail et à respecter les obligations de votre employeur en matière de normes du travail, de santé et sécurité et de fiscalité. Ils ne sont ni vendus ni utilisés à des fins publicitaires.', 'Chacun ne voit que ce que son rôle exige : vous voyez vos propres dossiers; les superviseurs voient leur service; les RH et la paie voient ce que leur travail requiert. Le personnel de FlexcityHeadquarters ne peut voir vos dossiers que si votre employeur demande du soutien et le permet, pour une durée limitée, et chaque visite est consignée.'] },
    { heading: 'Conservation et vos droits', body: ['Les dossiers sont conservés tant que votre employeur en a besoin et que la loi l’exige, puis supprimés. Vous pouvez consulter et télécharger vos dossiers depuis Votre vie privée dans votre menu, demander à votre employeur de les corriger, et l’interroger sur le traitement de vos renseignements en vertu de la LPRPDE, de la loi de votre province ou, au Québec, de la Loi 25.'] },
  ],
  confirm: 'En signant, je confirme avoir lu cet avis et j’accepte l’utilisation de mes renseignements décrite ici ainsi que les choix facultatifs que j’ai faits ci-dessous. Je peux modifier ces choix en tout temps dans mon profil et les réglages de mon téléphone.',
};

export const agreementFor = (locale: string): AgreementText => (locale.startsWith('fr') ? FR : EN);

/** The exact text as shown, one line per paragraph, so its fingerprint can be checked later. */
export function canonicalText(version: string, a: AgreementText): string {
  return [`FlexcityHeadquarters agreement ${version}`, a.title, a.intro, ...a.sections.flatMap((s) => [s.heading, ...s.body]), a.confirm].join('\n');
}

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

export type Choice = 'granted' | 'denied' | 'skipped' | 'unsupported';
