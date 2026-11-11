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
      steps: ['Open the invitation email from your organization and choose a password (the link works for 7 days).', 'Sign in at your organization’s web address (it’s in the invitation email).', 'When asked, set up a passkey so next time you can sign in with Face ID, your fingerprint or Windows Hello.', 'On your phone, tap Get the app on your phone on the sign-in page to add it to your home screen (no app store).'],
      tip: 'Invitation expired? Ask your supervisor to resend it from Staff.',
    },
    fr: {
      title: 'Votre première connexion',
      summary: 'Choisissez votre mot de passe depuis l’invitation et ajoutez une clé d’accès.',
      steps: ['Ouvrez le courriel d’invitation de votre organisation et choisissez un mot de passe (le lien est valide 7 jours).', 'Connectez-vous à l’adresse Web de votre organisation (elle figure dans le courriel d’invitation).', 'Si on vous le propose, configurez une clé d’accès pour vous connecter avec Face ID, votre empreinte ou Windows Hello.', 'Sur votre téléphone, touchez Installer l’application sur votre téléphone à la page de connexion pour l’ajouter à votre écran d’accueil (sans boutique d’applications).'],
      tip: 'Invitation expirée? Demandez à votre superviseur de la renvoyer depuis Personnel.',
    },
  },
  {
    slug: 'install-the-app',
    audience: 'staff',
    en: {
      title: 'Installing the app and turning on notifications',
      summary: 'Put FlexcityHeadquarters on your phone’s home screen without an app store, then get shift offers and reminders as notifications.',
      steps: ['Open your organization’s sign-in page on your phone and tap Get the app on your phone.', 'Android: tap Install in the box that appears. iPhone or iPad: in Safari, tap Share, then Add to Home Screen, then Add.', 'Open the app from your home screen and sign in. It opens full screen like any other app.', 'Go to your profile and, under Notifications on this device, tap Turn on notifications, then Allow.', 'To stop them on that device, turn them off there or sign out.'],
      tip: 'On iPhone and iPad, notifications only work in the installed app (iOS 16.4 or later). Your lock screen shows a short heading only, never pay, health or discipline details.',
    },
    fr: {
      title: 'Installer l’application et activer les notifications',
      summary: 'Placez FlexcityHeadquarters sur l’écran d’accueil de votre téléphone sans boutique d’applications, puis recevez offres de quarts et rappels en notifications.',
      steps: ['Ouvrez la page de connexion de votre organisation sur votre téléphone et touchez Installer l’application sur votre téléphone.', 'Android : touchez Installer dans la fenêtre qui s’affiche. iPhone ou iPad : dans Safari, touchez Partager, puis Sur l’écran d’accueil, puis Ajouter.', 'Ouvrez l’application depuis votre écran d’accueil et connectez-vous. Elle s’ouvre en plein écran comme toute autre application.', 'Allez à votre profil et, sous Notifications sur cet appareil, touchez Activer les notifications, puis Autoriser.', 'Pour les arrêter sur cet appareil, désactivez-les au même endroit ou déconnectez-vous.'],
      tip: 'Sur iPhone et iPad, les notifications ne fonctionnent que dans l’application installée (iOS 16.4 ou plus récent). L’écran verrouillé n’affiche qu’un court titre, jamais de détails sur la paie, la santé ou la discipline.',
    },
  },
  {
    slug: 'working-alone',
    audience: 'staff',
    en: {
      title: 'Working alone: check-ins, help and location',
      summary: 'Start a working-alone session, check in on a timer, ask for help, and choose whether to share your location with your monitors.',
      steps: ['Open Working alone from the menu, say where you are and how often you’ll check in.', 'Leave Share my location on if you want your monitors to see where you are during this session, or turn it off.', 'Your phone reminds you 5 minutes before each check-in. Tap I’m OK to reset the timer.', 'In trouble? Tap I need help: your monitors and HR are alerted at once. In an emergency, call 911 first.', 'Tap I’m done working alone at the end. Sharing stops with the session.'],
      tip: 'Phones stop sharing a web app’s location when it’s in the background or the screen is locked. Turn on Keep the screen on if your monitors need your live position; a missed check-in alerts them either way.',
    },
    fr: {
      title: 'Travail seul : vérifications, aide et position',
      summary: 'Commencez une séance de travail seul, faites vos vérifications, demandez de l’aide et choisissez de partager ou non votre position.',
      steps: ['Ouvrez Travail seul dans le menu, indiquez où vous êtes et à quelle fréquence vous ferez vos vérifications.', 'Laissez Partager ma position activé si vous voulez que vos superviseurs voient où vous êtes pendant cette séance, ou désactivez-le.', 'Votre téléphone vous rappelle chaque vérification 5 minutes avant. Touchez Tout va bien pour relancer la minuterie.', 'En difficulté? Touchez J’ai besoin d’aide : vos superviseurs et les RH sont alertés aussitôt. En cas d’urgence, composez d’abord le 911.', 'À la fin, touchez J’ai fini de travailler seul. Le partage s’arrête avec la séance.'],
      tip: 'Les téléphones cessent de partager la position d’une application Web en arrière-plan ou écran verrouillé. Activez Garder l’écran allumé si vos superviseurs ont besoin de votre position en direct; une vérification manquée les alerte de toute façon.',
    },
  },
  {
    slug: 'clock-in-and-out',
    audience: 'staff',
    en: {
      title: 'Clocking in and out',
      summary: 'Slide to clock in for your shift, and back out at the end.',
      steps: ['Open Today, or tap Clock in at the top of any screen.', 'Slide the button to the right. If your shift starts within 30 minutes or has started, you’re clocked into it.', 'No shift right now? Choose the facility and position, then clock in.', 'At the end, slide to clock out. Your supervisor reviews punches before payroll.', 'No signal? Punch anyway: it’s saved on your phone and sent by itself when you’re back online. Your supervisor sees it was recorded offline. Don’t sign out until it’s sent (see Clocking in without signal).'],
      tip: 'Your location is checked only at the moment you punch, to confirm you’re on site. You are never tracked.',
    },
    fr: {
      title: 'Pointer l’arrivée et la sortie',
      summary: 'Glissez pour pointer votre quart, puis pour pointer la sortie.',
      steps: ['Ouvrez Aujourd’hui, ou touchez Pointer en haut de n’importe quel écran.', 'Glissez le bouton vers la droite. Si votre quart commence dans 30 minutes ou est en cours, vous y êtes pointé.', 'Pas de quart en ce moment? Choisissez l’installation et le poste, puis pointez.', 'À la fin, glissez pour pointer la sortie. Votre superviseur révise les pointages avant la paie.', 'Pas de réseau? Pointez quand même : le pointage est enregistré sur votre téléphone et envoyé de lui-même à votre retour en ligne. Votre superviseur voit qu’il a été enregistré hors ligne. Ne vous déconnectez pas avant l’envoi (voir Pointer sans réseau).'],
      tip: 'Votre position est vérifiée seulement au moment du pointage, pour confirmer que vous êtes sur place. Vous n’êtes jamais suivi.',
    },
  },
  {
    slug: 'clock-in-without-signal',
    audience: 'staff',
    en: {
      title: 'Clocking in without signal',
      summary: 'Punch in and out at a rink, a works yard or an outdoor site with no connection. The punch waits on your phone and sends itself.',
      steps: ['Slide to clock in or out as usual. With no connection you’ll see Saved on this phone, with the time of your punch.', 'Stay signed in. Saved punches send by themselves, in order, as soon as your phone is back online. You can also tap Try sending now.', 'When they’re sent, a short message confirms it. Your supervisor sees the punch marked Recorded offline, with the time it happened.', 'If a punch isn’t accepted (for example, it’s more than 3 days old), it stays on screen with the reason. Tap Send details to my supervisor so they can add the time.'],
      tip: 'Signing out deletes punches that haven’t been sent from that phone, so the app asks first. Your saved punches are yours: someone else signing in on the same phone never sees or sends them.',
    },
    fr: {
      title: 'Pointer sans réseau',
      summary: 'Pointez à l’aréna, à la cour des travaux publics ou à l’extérieur sans connexion. Le pointage attend sur votre téléphone et s’envoie de lui-même.',
      steps: ['Glissez pour pointer l’arrivée ou le départ comme d’habitude. Sans connexion, vous verrez Enregistré sur ce téléphone, avec l’heure du pointage.', 'Restez connecté. Les pointages enregistrés s’envoient d’eux-mêmes, dans l’ordre, dès que votre téléphone retrouve le réseau. Vous pouvez aussi toucher Essayer d’envoyer maintenant.', 'Une fois envoyés, un court message le confirme. Votre superviseur voit le pointage marqué Enregistré hors ligne, avec l’heure où il a eu lieu.', 'Si un pointage n’est pas accepté (par exemple s’il date de plus de 3 jours), il reste à l’écran avec la raison. Touchez Envoyer les détails à mon superviseur pour qu’il ajoute les heures.'],
      tip: 'Se déconnecter supprime du téléphone les pointages pas encore envoyés : l’application vous le demande d’abord. Vos pointages enregistrés sont les vôtres : une autre personne qui se connecte sur le même téléphone ne les voit ni ne les envoie jamais.',
    },
  },
  {
    slug: 'facility-kiosk',
    audience: 'staff',
    en: {
      title: 'Punching at the facility kiosk',
      summary: 'Clock in and out on the shared tablet at your facility with your employee number and a PIN, without a phone.',
      steps: ['In the app, go to your profile and, under Kiosk PIN, tap Set my PIN. Choose 4 to 6 digits that aren’t easy to guess.', 'At the facility tablet, enter your employee number (it’s shown next to your PIN on your profile), then your PIN.', 'Your punch goes to the shift you’re working, the same as a punch on your phone. With no shift there right now, a supervisor reviews it.', 'Never share your PIN. Forgot it? Set a new one on your profile.'],
      tip: 'Supervisors set up a tablet from Settings › Facilities › Facility kiosks: tap Add kiosk, then open the setup link once on the tablet. The link isn’t shown again.',
    },
    fr: {
      title: 'Pointer à la borne de l’installation',
      summary: 'Pointez à l’arrivée et au départ sur la tablette partagée de votre installation avec votre numéro d’employé et un NIP, sans téléphone.',
      steps: ['Dans l’application, allez à votre profil et, sous NIP de borne, touchez Créer mon NIP. Choisissez 4 à 6 chiffres difficiles à deviner.', 'À la tablette de l’installation, entrez votre numéro d’employé (il figure à côté de votre NIP, à votre profil), puis votre NIP.', 'Votre pointage va au quart que vous faites, comme un pointage sur votre téléphone. S’il n’y a aucun quart à cet endroit en ce moment, un superviseur le vérifie.', 'Ne partagez jamais votre NIP. Oublié? Créez-en un nouveau à votre profil.'],
      tip: 'Les superviseurs configurent une tablette dans Paramètres › Installations › Bornes de pointage : touchez Ajouter une borne, puis ouvrez le lien de configuration une fois sur la tablette. Le lien ne sera plus affiché.',
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
      summary: 'Use the shift board to take open shifts and hand off your own.',
      steps: ['Open Shift board to see open shifts you’re eligible for, with an estimate of what each pays.', 'Tap Take this shift. If it would put you into overtime, a supervisor approves it first.', 'To give away a shift, open it from My schedule and choose Give away.', 'You stay on the shift until someone takes it.'],
    },
    fr: {
      title: 'Prendre et céder des quarts',
      summary: 'Utilisez le babillard pour prendre des quarts ouverts et céder les vôtres.',
      steps: ['Ouvrez Babillard des quarts pour voir les quarts ouverts auxquels vous êtes admissible, avec une estimation de la paie.', 'Touchez Prendre ce quart. S’il vous ferait faire des heures supplémentaires, un superviseur l’approuve d’abord.', 'Pour céder un quart, ouvrez-le depuis Mon horaire et choisissez Céder.', 'Le quart reste le vôtre jusqu’à ce que quelqu’un le prenne.'],
    },
  },
  {
    slug: 'trade-a-shift',
    audience: 'staff',
    en: {
      title: 'Trading a shift with a coworker',
      summary: 'Swap one of your shifts for one of a coworker’s. They agree, then a supervisor approves.',
      steps: ['Open My schedule and tap Trade on the shift you want to swap.', 'Pick a shift you could take in exchange. Only shifts within two weeks where you’re both eligible are listed.', 'Add a message if you like, then tap Ask to trade.', 'Your coworker gets a notification and taps Agree or No thanks. A supervisor then approves it in Approvals.', 'Once approved, both schedules update together. Until then, you each keep your own shift.'],
      tip: 'If either shift changes before approval, the trade closes and you can ask again.',
    },
    fr: {
      title: 'Échanger un quart avec un collègue',
      summary: 'Échangez un de vos quarts contre un quart d’un collègue. Il accepte, puis un superviseur approuve.',
      steps: ['Ouvrez Mon horaire et touchez Échanger sur le quart à échanger.', 'Choisissez un quart que vous pourriez prendre en échange. Seuls les quarts des deux prochaines semaines où vous êtes tous les deux admissibles sont proposés.', 'Ajoutez un message si vous le voulez, puis touchez Demander l’échange.', 'Votre collègue reçoit une notification et touche Accepter ou Non merci. Un superviseur l’approuve ensuite dans Approbations.', 'Une fois l’échange approuvé, les deux horaires changent ensemble. D’ici là, chacun garde son quart.'],
      tip: 'Si l’un des quarts change avant l’approbation, l’échange est fermé et vous pouvez en proposer un autre.',
    },
  },
  {
    slug: 'shifts-in-your-calendar',
    audience: 'staff',
    en: {
      title: 'Your shifts in Google, Outlook or Apple Calendar',
      summary: 'Get a private link that keeps your own shifts up to date in your calendar app.',
      steps: ['Go to your profile and, under Shifts in your calendar, tap Get my calendar link.', 'Copy the link right away: for your privacy it isn’t shown again.', 'Google Calendar: Other calendars › From URL. Outlook: Add calendar › Subscribe from web. iPhone: Settings › Calendar › Accounts › Add subscribed calendar. On a phone you can also tap Add my shifts to my phone’s calendar.', 'Lost the link? Make a new one; the old one stops working. To stop the feed, tap Turn off.'],
      tip: 'The feed holds only your own shifts: times, position and facility, no other names. Calendar apps refresh it on their own schedule, so a change can take a while to show there; the app is always current.',
    },
    fr: {
      title: 'Vos quarts dans Google Agenda, Outlook ou Calendrier d’Apple',
      summary: 'Obtenez un lien privé qui tient vos propres quarts à jour dans votre agenda.',
      steps: ['Allez à votre profil et, sous Vos quarts dans votre agenda, touchez Obtenir mon lien d’agenda.', 'Copiez le lien aussitôt : pour votre confidentialité, il ne sera plus affiché.', 'Google Agenda : Autres agendas › À partir de l’URL. Outlook : Ajouter un calendrier › S’abonner à partir du web. iPhone : Réglages › Calendrier › Comptes › Ajouter un calendrier avec abonnement. Sur un téléphone, vous pouvez aussi toucher Ajouter mes quarts à l’agenda de mon téléphone.', 'Lien perdu? Créez-en un nouveau; l’ancien cessera de fonctionner. Pour arrêter le lien, touchez Désactiver.'],
      tip: 'Le lien ne contient que vos propres quarts : heures, poste et installation, aucun autre nom. Les agendas l’actualisent à leur propre rythme : un changement peut tarder à y paraître; l’application est toujours à jour.',
    },
  },
  {
    slug: 'build-the-schedule',
    audience: 'leads',
    en: {
      title: 'Building and publishing the schedule',
      summary: 'Draft the week, fill it with the assistant, then publish.',
      steps: ['Open Schedule builder and choose the facility and week.', 'Add shifts on each day, or copy from a past week.', 'Tap Fill the schedule: it proposes people for the open shifts and explains each pick against the rules.', 'Publish. Staff are notified and open shifts go to the board.'],
    },
    fr: {
      title: 'Préparer et publier l’horaire',
      summary: 'Ébauchez la semaine, remplissez-la avec l’assistant, puis publiez.',
      steps: ['Ouvrez Préparation d’horaire et choisissez l’installation et la semaine.', 'Ajoutez des quarts chaque jour, ou copiez une semaine passée.', 'Touchez Remplir l’horaire : l’assistant propose des personnes pour les quarts ouverts et justifie chaque choix selon les règles.', 'Publiez. Le personnel est avisé et les quarts ouverts vont au babillard.'],
    },
  },
  {
    slug: 'fill-the-schedule',
    audience: 'leads',
    en: {
      title: 'Fill the schedule with the assistant',
      summary: 'Fill a department’s open shifts for a week, two weeks, a month or three months at once, fairly and within every rule, then review before anything changes.',
      steps: [
        'Open Schedule builder and tap Fill the schedule.',
        'Choose the department (yours is preselected) and, if you like, one facility. Pick how far ahead: it starts on your Plan ahead window. If some people haven’t confirmed their availability, you can send them a reminder here.',
        'Optional: include the forecast’s suggested shifts, for the weeks where it expects more people than are scheduled. They’re proposed with the rest (marked New from forecast, at least your minimum shift length, none on holidays at facilities you close) and created only when you accept them.',
        'Check the usual choices: keep shifts already assigned, avoid overtime, spread weekends and evenings fairly, keep people at the same facility. Adjust priorities lets you say what matters most (and save it for your department).',
        'Tap Fill the schedule. The summary says how many shifts were filled, any overtime, and how many need you. Tap a name to see why (“qualified Lifeguard, available, 18 h so far this week”) or swap for one of the next three people.',
        'For a shift no one could take, see why (“3 qualified: 2 on time off, 1 at their weekly hours”) and post it to the shift board, ask the person who could do it with overtime, or leave it open.',
        'Tap Accept all, Accept week or Accept day. Each one is checked again against every rule as it’s saved, and overtime goes on the overtime ledger. Accepted shifts are drafts: staff don’t see them yet. Undo takes back your latest accept (tap again for the one before); if someone can no longer work a shift you’re putting back, it’s left open.',
        'Tap Publish. If required coverage would be short (for example no certified operator on site), or someone can no longer work a shift, you see the list first; tick that you’ve reviewed it to publish anyway.',
      ],
      tip: 'The same rules apply everywhere: your organization’s most hours a day and days in a row, daily and weekly rest, availability and certifications on the shift’s own date. Hours go to full-time staff first, then part-time, then casual and on-call, and holidays rotate fairly. Only people in your department, or who hold a position in it, are proposed, and their shifts in other departments count, so no one is double-booked. Weeks beyond your Plan ahead window are marked tentative, and people who confirmed their availability are preferred there. Seniority is used only if your organization (and department) uses it.',
    },
    fr: {
      title: 'Remplir l’horaire avec l’assistant',
      summary: 'Remplissez les quarts ouverts d’un service pour une semaine, deux semaines, un mois ou trois mois d’un coup, équitablement et selon toutes les règles, puis revoyez avant que rien ne change.',
      steps: [
        'Ouvrez Préparation d’horaire et touchez Remplir l’horaire.',
        'Choisissez le service (le vôtre est déjà choisi) et, si vous voulez, une installation. Choisissez jusqu’où : on part de votre période de planification. Si des personnes n’ont pas confirmé leurs disponibilités, vous pouvez leur envoyer un rappel ici.',
        'Facultatif : incluez les quarts suggérés par la prévision, pour les semaines où elle prévoit plus de personnes que prévu à l’horaire. Ils sont proposés avec les autres (marqués Nouveau (prévision), d’au moins votre durée minimale de quart, aucun les jours fériés aux installations que vous fermez) et créés seulement quand vous les acceptez.',
        'Vérifiez les choix habituels : garder les quarts déjà attribués, éviter les heures supplémentaires, répartir équitablement les fins de semaine et les soirs, garder les gens à la même installation. Ajuster les priorités vous permet de dire ce qui compte le plus (et de l’enregistrer pour votre service).',
        'Touchez Remplir l’horaire. Le résumé indique combien de quarts sont remplis, les heures supplémentaires et combien ont besoin de vous. Touchez un nom pour voir pourquoi (« qualifié·e Sauveteur, disponible, 18 h jusqu’ici cette semaine ») ou échanger avec l’une des trois personnes suivantes.',
        'Pour un quart que personne ne pouvait prendre, voyez pourquoi (« 3 personnes qualifiées : 2 en congé, 1 au maximum de ses heures ») et affichez-le au tableau des quarts, demandez à la personne qui pourrait le faire en heures supplémentaires, ou laissez-le ouvert.',
        'Touchez Tout accepter, Accepter la semaine ou Accepter la journée. Chaque quart est vérifié de nouveau selon toutes les règles à l’enregistrement, et les heures supplémentaires sont inscrites au registre. Les quarts acceptés sont des brouillons : le personnel ne les voit pas encore. Annuler reprend votre dernière acceptation (touchez de nouveau pour la précédente); si une personne ne peut plus faire un quart que vous remettez, il reste ouvert.',
        'Touchez Publier. Si la couverture requise serait insuffisante (par exemple aucun opérateur certifié sur place), ou si une personne ne peut plus faire un quart, la liste s’affiche d’abord; cochez que vous l’avez vérifiée pour publier quand même.',
      ],
      tip: 'Les mêmes règles s’appliquent partout : le maximum d’heures par jour et de jours d’affilée de votre organisation, le repos quotidien et hebdomadaire, les disponibilités et les certifications à la date du quart. Les heures vont d’abord au personnel à temps plein, puis à temps partiel, puis occasionnel et sur appel, et les jours fériés sont répartis équitablement. Seules les personnes de votre service, ou qui y occupent un poste, sont proposées, et leurs quarts dans d’autres services comptent : personne n’est inscrit deux fois. Les semaines au-delà de votre période de planification sont marquées provisoires, et les personnes qui ont confirmé leurs disponibilités y sont privilégiées. L’ancienneté n’est utilisée que si votre organisation (et votre service) l’utilise.',
    },
  },
  {
    slug: 'schedule-by-hand',
    audience: 'leads',
    en: {
      title: 'Schedule by hand: drag and drop',
      summary: 'Put people on shifts yourself in a month, week or day view, with every rule checked as you go.',
      steps: [
        'Open Schedule builder, choose the department (and a facility if you like), then Month, Week or Day. Your choice is remembered.',
        'The People list shows everyone you can schedule, including people from other departments who hold a position here: their positions and certifications, hours so far against their target, availability and time off for the days you see, and a check mark when they’ve confirmed availability. Search, filter by position, availability or under-target hours, and sort by fewest hours.',
        'Drag a person onto a shift to assign them. While you drag, every shift and day shows green (OK), amber (OK with a warning, such as “Overtime 2 h” or “Outside their availability”) or red (not allowed, such as “Not certified”, “On approved time off” or “Already working 9–1”).',
        'Drop a person on an empty day, or on the Day view’s timeline at the time they should start, to make a new shift for them. The times, position and facility come from their availability and your department’s usual shifts; change them before you create it.',
        'Drag a shift to another day to move it, hold Alt / Option (or turn on Copy) to copy it, drag a bar’s edges on the Day view to change the times, or drag it back to the People list to leave it open. Tick several people to put them all on one shift: each gets a spot.',
        'Use Copy last week (or Copy the day before) to start from what worked. People are kept only where every rule still allows it; the rest stay open.',
        'Undo and Redo (Ctrl / ⌘ + Z) step through this session’s changes. Everything is a draft until you tap Publish; if required coverage is short or someone can no longer work their shift, you see the list first.',
      ],
      tip: 'On a phone, or with a keyboard, tap a shift for a ranked list of who can work it, or pick a person and then a shift or a day. Each drop is checked again by the same rules as the shift board; a refusal says why, and overtime asks you first.',
    },
    fr: {
      title: 'Planifier à la main : glisser-déposer',
      summary: 'Placez vous-même les personnes sur les quarts en vue mois, semaine ou jour, avec chaque règle vérifiée au fur et à mesure.',
      steps: [
        'Ouvrez Création d’horaires, choisissez le service (et une installation si vous voulez), puis Mois, Semaine ou Jour. Votre choix est retenu.',
        'La liste Personnes montre tous ceux que vous pouvez planifier, y compris les personnes d’autres services qui occupent un poste chez vous : postes et certifications, heures jusqu’ici par rapport à leur cible, disponibilités et congés pour les jours affichés, et un crochet quand leurs disponibilités sont confirmées. Cherchez, filtrez par poste, disponibilité ou heures sous la cible, et triez par moins d’heures.',
        'Glissez une personne sur un quart pour l’affecter. Pendant que vous glissez, chaque quart et chaque journée s’affiche en vert (permis), en ambre (permis avec un avertissement, comme « Heures supplémentaires 2 h » ou « En dehors de ses disponibilités ») ou en rouge (non permis, comme « Non certifié·e », « En congé approuvé » ou « Travaille déjà 9 h – 13 h »).',
        'Déposez une personne sur une journée vide, ou sur la chronologie de la vue Jour à l’heure où elle commence, pour lui créer un quart. Les heures, le poste et l’installation viennent de ses disponibilités et des quarts habituels de votre service; modifiez-les avant de créer.',
        'Glissez un quart vers une autre journée pour le déplacer, maintenez Alt / Option (ou activez Copier) pour le copier, glissez les bords d’une barre dans la vue Jour pour changer les heures, ou ramenez-le vers la liste Personnes pour le laisser ouvert. Cochez plusieurs personnes pour les mettre toutes sur un même quart : chacune obtient une place.',
        'Utilisez Copier la semaine dernière (ou Copier la veille) pour partir de ce qui a fonctionné. Les personnes ne sont gardées que là où toutes les règles le permettent encore; les autres quarts restent ouverts.',
        'Annuler et Rétablir (Ctrl / ⌘ + Z) parcourent les changements de cette session. Tout reste en brouillon jusqu’à ce que vous touchiez Publier; s’il manque une couverture requise ou qu’une personne ne peut plus faire son quart, la liste s’affiche d’abord.',
      ],
      tip: 'Sur un téléphone, ou au clavier, touchez un quart pour voir qui peut le faire, en ordre, ou choisissez une personne puis un quart ou une journée. Chaque dépôt est vérifié de nouveau selon les mêmes règles que le tableau des quarts; un refus dit pourquoi, et les heures supplémentaires vous sont d’abord demandées.',
    },
  },
  {
    slug: 'rotation-templates',
    audience: 'leads',
    en: {
      title: 'Rotations: 4-on-4-off, 2-2-3 and your own cycles',
      summary: 'Save the pattern your crews work, then generate the shifts for a period and fill the gaps.',
      steps: [
        'Open Rotations and tap New rotation. Start from 12-hour 4 on, 4 off; 2-2-3 (Pitman); Monday to Friday; or two weeks of days and two of nights.',
        'Pick where and the position, the day the cycle starts and the unpaid break. Adjust the working days and their hours: an end before the start is a night.',
        'Add the crews: each works the same pattern, starting some days later. Choose the people on each crew, and any extra open shifts.',
        'Tap Generate shifts and choose the dates (up to 13 weeks). Preview shows what will be created. The shifts are drafts.',
        'Each crew member is placed only where every rule allows (time off, rest, other shifts, no overtime) and inside the Plan-ahead window. Anything else stays open, with the reason.',
        'Fill the rest with Fill the schedule (tick Start from rotation templates) or by hand. In the schedule builder, Templates generates for the dates on screen.',
      ],
      tip: 'Running Generate again adds nothing twice, and facilities closed on statutory holidays get no shifts those days. Night shifts keep their wall-clock times on daylight-saving nights.',
    },
    fr: {
      title: 'Rotations : 4-4, 2-2-3 et vos propres cycles',
      summary: 'Enregistrez le cycle de vos équipes, puis générez les quarts d’une période et comblez les trous.',
      steps: [
        'Ouvrez Rotations et touchez Nouvelle rotation. Partez de 12 heures 4-4; 2-2-3 (Pitman); du lundi au vendredi; ou deux semaines de jour et deux de nuit.',
        'Choisissez le lieu et le poste, le jour où le cycle commence et la pause non payée. Ajustez les jours travaillés et leurs heures : une fin avant le début est une nuit.',
        'Ajoutez les équipes : chacune suit le même cycle, avec un décalage de quelques jours. Choisissez les personnes de chaque équipe et, au besoin, des quarts ouverts en plus.',
        'Touchez Générer les quarts et choisissez les dates (jusqu’à 13 semaines). L’aperçu montre ce qui sera créé. Les quarts sont des brouillons.',
        'Chaque membre d’équipe est placé seulement si toutes les règles le permettent (congé, repos, autres quarts, pas d’heures supplémentaires) et dans la période de planification. Le reste demeure ouvert, avec la raison.',
        'Comblez le reste avec Remplir l’horaire (cochez Partir des modèles de rotation) ou à la main. Dans le planificateur, Modèles génère les quarts des dates affichées.',
      ],
      tip: 'Relancer la génération n’ajoute rien en double, et les installations fermées les jours fériés n’ont pas de quarts ces jours-là. Les quarts de nuit gardent leurs heures lors des changements d’heure.',
    },
  },
  {
    slug: 'on-call',
    audience: 'leads',
    en: {
      title: 'On-call rosters and call-backs',
      summary: 'Keep who’s on call for water, public works or snow, swap weeks, and call the person on call back in.',
      steps: [
        'Open On call and choose the department. The roster shows the next six weeks, with who’s on call now and their phone.',
        'Add a period, or Make a rotation: pick people in turn, the first day, the hand-over hour and how many weeks.',
        'To swap, tap Swap or reassign: trade with another person’s period or give it to someone else. Both are told.',
        'For an emergency, tap Call back: the person on call is asked by default. If it breaks the rest rules, you’re told; tick This is an emergency to call them anyway (recorded).',
        'Winter call-outs ask the person on call first, and a missed working-alone check-in alerts them first.',
      ],
      tip: 'Standby pay and the call-back minimum come from the department’s work rules and are added to payroll by themselves.',
    },
    fr: {
      title: 'Tableaux de garde et rappels au travail',
      summary: 'Tenez à jour qui est de garde pour l’eau, les travaux publics ou la neige, échangez des semaines et rappelez la personne de garde.',
      steps: [
        'Ouvrez Garde et choisissez le service. Le tableau montre les six prochaines semaines, avec la personne de garde maintenant et son numéro.',
        'Ajoutez une période ou créez une rotation : choisissez les personnes à tour de rôle, le premier jour, l’heure de relève et le nombre de semaines.',
        'Pour échanger, touchez Échanger ou réattribuer : échangez avec la période d’une autre personne ou confiez-la à quelqu’un d’autre. Les deux sont avisées.',
        'En cas d’urgence, touchez Rappeler au travail : la personne de garde est rappelée par défaut. Si cela ne respecte pas les règles de repos, vous êtes avisé; cochez Il s’agit d’une urgence pour la rappeler quand même (consigné).',
        'Les rappels d’hiver s’adressent d’abord à la personne de garde, et une vérification de travail seul manquée l’alerte en premier.',
      ],
      tip: 'L’indemnité de disponibilité et le minimum de rappel viennent des règles de travail du service et s’ajoutent d’eux-mêmes à la paie.',
    },
  },
  {
    slug: 'breaks-and-premiums',
    audience: 'admin',
    en: {
      title: 'Meal breaks, minimum call-in pay and premiums',
      summary: 'Set the work rules payroll and scheduling share: unpaid breaks, call-in minimums, late-change premiums, shift premiums and standby, with department rules where agreements differ.',
      steps: [
        'Open Work rules. What the law asks shows each province’s meal break and minimum call-in pay, with the source.',
        'Under Positions, set each position’s unpaid break (it applies to shifts over 5 hours; a shift can set its own) and tick Never alone where two qualified people must be there.',
        'Under Organization rules, set the call-in minimum (never below the law), when schedules are posted, and the late-change premium: time and a half on the changed hours, or a flat amount.',
        'Add shift premiums: evening, night, weekend or statutory holiday, by time and day, in $ an hour or a percent of the rate, for a department or position.',
        'Under Departments, set what a collective agreement changes, plus its limits and whether it’s federally regulated. Blank fields follow the organization.',
        'Paid hours are the shift less its break everywhere. Short shifts, missing breaks and never-alone shifts left alone are flagged before publishing; late changes warn before saving and pay their premium (you can waive one).',
      ],
      tip: 'Shifts without these rules are paid exactly as before. The statutory values are our reading of each law and are being reviewed by employment counsel.',
    },
    fr: {
      title: 'Pauses-repas, paie minimale de rappel et primes',
      summary: 'Fixez les règles de travail que la paie et l’horaire partagent : pauses non payées, minimums de rappel, primes de changement tardif, primes de quart et disponibilité, avec des règles par service lorsque les conventions diffèrent.',
      steps: [
        'Ouvrez Règles de travail. Ce que la loi exige montre la pause-repas et la paie minimale de rappel de chaque province, avec la source.',
        'Sous Postes, fixez la pause non payée de chaque poste (pour les quarts de plus de 5 heures; un quart peut avoir la sienne) et cochez Jamais seul lorsque deux personnes qualifiées doivent être présentes.',
        'Sous Règles de l’organisation, fixez le minimum de rappel (jamais sous la loi), le délai d’affichage de l’horaire et la prime de changement tardif : taux et demi sur les heures modifiées, ou un montant fixe.',
        'Ajoutez des primes de quart : soir, nuit, fin de semaine ou jour férié, selon l’heure et le jour, en $ l’heure ou en pourcentage du taux, pour un service ou un poste.',
        'Sous Services, indiquez ce qu’une convention collective change, ainsi que ses limites et s’il relève du fédéral. Les champs vides suivent l’organisation.',
        'Les heures payées sont le quart moins sa pause, partout. Les quarts trop courts, les pauses manquantes et les quarts « jamais seul » sans renfort sont signalés avant la publication; les changements tardifs avertissent avant l’enregistrement et paient leur prime (vous pouvez l’annuler).',
      ],
      tip: 'Les quarts sans ces règles sont payés exactement comme avant. Les valeurs légales sont notre lecture de chaque loi et sont en cours d’examen par un avocat en droit du travail.',
    },
  },
  {
    slug: 'confirm-your-availability',
    audience: 'staff',
    en: {
      title: 'Keeping your availability current',
      summary: 'Your organization plans a set time ahead; confirm your usual availability or update it so you’re scheduled when you can work.',
      steps: ['Open Availability. The top says how far ahead your organization plans and how far your availability is set.', 'Still available as usual? Tap I’m available as usual through the date shown.', 'Something changed? Update your days and times and save: that counts as confirming too.'],
      tip: 'A supervisor may send you a reminder when your availability isn’t confirmed far enough ahead.',
    },
    fr: {
      title: 'Garder vos disponibilités à jour',
      summary: 'Votre organisation planifie un certain temps à l’avance; confirmez vos disponibilités habituelles ou mettez-les à jour pour être planifié quand vous pouvez travailler.',
      steps: ['Ouvrez Disponibilités. Le haut de la page indique jusqu’où votre organisation planifie et jusqu’à quand vos disponibilités sont établies.', 'Toujours disponible comme d’habitude? Touchez Je suis disponible comme d’habitude jusqu’à la date indiquée.', 'Quelque chose a changé? Modifiez vos jours et heures et enregistrez : cela compte aussi comme une confirmation.'],
      tip: 'Un superviseur peut vous envoyer un rappel si vos disponibilités ne sont pas confirmées assez loin à l’avance.',
    },
  },
  {
    slug: 'forecast-weather-and-events',
    audience: 'leads',
    en: {
      title: 'Weather and special events in the forecast',
      summary: 'Let the forecast account for the weather, holidays and your own events, and see why each day moved.',
      steps: ['In Settings › Facilities, give each facility its location (or use Fill in from a city centre), whether it’s indoor or outdoor, and its kind (pool, beach, park, arena). The nearest Environment Canada forecast is used, or enter a site code.', 'Open Forecast and choose the facility and week. Each day shows its weather and why the figures changed, like “+18% hot and sunny (31 °C)”.', 'Under Special events, tap Add event for a tournament, a swim meet or a festival: this facility or every facility in the city, the dates (and times if needed), and extra people, a percentage or both. Tick Every year for yearly events.', 'Statutory holidays and the breaks in your school calendar are included by themselves.', 'To compare, switch Figures shown to Without adjustments. Draft shifts use the figures with weather and events.'],
      tip: 'Weather forecasts reach about six days ahead. Until a facility has its own history, the weather’s effect is a rule of thumb for its kind; then it’s learned from your headcounts. If the weather can’t be fetched, the forecast still works and says so.',
    },
    fr: {
      title: 'La météo et les événements spéciaux dans les prévisions',
      summary: 'Faites tenir compte de la météo, des jours fériés et de vos événements, et voyez pourquoi chaque jour a changé.',
      steps: ['Dans Paramètres › Installations, indiquez pour chaque installation son emplacement (ou utilisez Remplir à partir d’un centre-ville), si elle est intérieure ou extérieure, et son type (piscine, plage, parc, aréna). Les prévisions d’Environnement Canada les plus proches sont utilisées, ou entrez un code de lieu.', 'Ouvrez Prévisions et choisissez l’installation et la semaine. Chaque jour affiche sa météo et pourquoi les chiffres ont changé, comme « +18 % chaud et ensoleillé (31 °C) ».', 'Sous Événements spéciaux, touchez Ajouter un événement pour un tournoi, une compétition de natation ou un festival : cette installation ou toutes celles de la ville, les dates (et les heures au besoin), et des personnes de plus, un pourcentage ou les deux. Cochez Chaque année pour un événement annuel.', 'Les jours fériés et les congés de votre calendrier scolaire sont inclus d’eux-mêmes.', 'Pour comparer, passez Chiffres affichés à Sans ajustements. Les quarts provisoires utilisent les chiffres avec météo et événements.'],
      tip: 'Les prévisions météo couvrent environ six jours. Tant qu’une installation n’a pas son propre historique, l’effet de la météo suit une règle générale selon son type; il est ensuite appris de vos dénombrements. Si la météo n’est pas disponible, les prévisions fonctionnent quand même et l’indiquent.',
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
      tip: 'The typical next step is a suggestion. Your policy, your collective agreement and the seriousness of what happened decide; when you skip steps, say why in the summary. HR chooses in Settings › Organization whether the attendance score recovers gradually, restarts each year on a chosen date, or both.',
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
      tip: 'L’étape habituelle suivante est une suggestion. Votre politique, votre convention collective et la gravité des faits décident; si vous sautez des étapes, expliquez pourquoi dans le résumé. Les RH choisissent dans Paramètres › Organisation si le score d’assiduité se rétablit graduellement, repart à zéro chaque année à une date choisie, ou les deux.',
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
        'Under How the score got here, every change is explained: what lowered it, older deductions fading to half after 60 days, and what earned points back (on-time shifts, streaks, 30 days with nothing counted, commendations). If your organization restarts the score each year, you see the date it started again at 100.',
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
        'Sous Ce qui a fait bouger le score, chaque changement est expliqué : ce qui l’a fait baisser, les déductions plus anciennes qui comptent à moitié après 60 jours, et ce qui a permis de regagner des points (quarts à l’heure, séries, 30 jours sans rien de compté, mentions d’éloge). Si votre organisation remet le score à zéro chaque année, vous voyez la date où il est reparti à 100.',
        'Les congés de maladie et protégés ne comptent jamais. Si quelque chose est inexact, demandez à votre superviseur de l’excuser; la raison reste visible pour vous.',
        'Dans un dossier, choisissez Ajouter ma réponse pour donner votre version. Elle reste avec le dossier pour quiconque le lit.',
        'Choisissez Comment ça fonctionne pour une explication simple de ce qui est suivi et de son utilisation.',
      ],
      tip: 'Signer un dossier confirme que vous l’avez reçu, pas que vous êtes d’accord.',
    },
  },
  {
    slug: 'expenses-and-mileage',
    audience: 'staff',
    en: {
      title: 'Claiming expenses and mileage',
      summary: 'Claim kilometres you drove for work and costs you paid. Approved claims are paid back on your next pay, untaxed.',
      steps: ['Open Expenses from the menu and tap New claim.', 'Say what it’s for, then add each item: kilometres driven, or a cost with its receipt.', 'Attach a receipt for anything over your organization’s limit. Mileage needs no receipt.', 'Submit it. Your supervisor approves it, and you get a notification.', 'Approved claims are added to the next pay as reimbursements: not taxed and not counted for CPP or EI.'],
      tip: 'Mileage is paid at your organization’s rate per kilometre, with a lower rate after a yearly threshold, like CRA’s. Your page shows how many kilometres you’ve claimed this year.',
    },
    fr: {
      title: 'Réclamer des dépenses et du kilométrage',
      summary: 'Réclamez les kilomètres parcourus pour le travail et les frais que vous avez payés. Les demandes approuvées vous sont remboursées sur la paie suivante, sans impôt.',
      steps: ['Ouvrez Dépenses dans le menu et touchez Nouvelle demande.', 'Indiquez l’objet, puis ajoutez chaque élément : les kilomètres parcourus, ou une dépense avec son reçu.', 'Joignez un reçu pour toute dépense au-delà de la limite de votre organisation. Le kilométrage n’en demande pas.', 'Soumettez-la. Votre superviseur l’approuve, et vous recevez une notification.', 'Les demandes approuvées s’ajoutent à la paie suivante comme remboursements : non imposables et non comptées pour le RPC ou l’AE.'],
      tip: 'Le kilométrage est payé au taux par kilomètre de votre organisation, avec un taux plus bas au-delà d’un seuil annuel, comme celui de l’ARC. Votre page indique combien de kilomètres vous avez réclamés cette année.',
    },
  },
  {
    slug: 'time-in-lieu',
    audience: 'staff',
    en: {
      title: 'Banking overtime as time in lieu',
      summary: 'Where your organization allows it, choose to bank overtime as paid time off instead of being paid for it.',
      steps: ['Open My pay. Under Banked overtime (time in lieu), tap Bank my overtime instead of being paid, then I agree, bank my overtime.', 'From the next pay, overtime banks at its premium: an hour at time and a half banks 1.5 hours. Overtime beyond your organization’s cap is paid.', 'To use it, request time off and choose Time in lieu (banked overtime). You can ask for up to what you have banked.', 'Changed your mind? Tap Pay my overtime instead. It applies from the next pay.'],
      tip: 'Banked time older than your organization’s limit is flagged to be taken or paid out, so book it as time off before then.',
    },
    fr: {
      title: 'Accumuler ses heures supplémentaires en congé compensatoire',
      summary: 'Là où votre organisation le permet, choisissez d’accumuler vos heures supplémentaires en congé payé au lieu de vous les faire payer.',
      steps: ['Ouvrez Ma paie. Sous Heures accumulées (congé compensatoire), touchez Accumuler mes heures supplémentaires au lieu d’être payé, puis J’accepte, accumuler mes heures.', 'Dès la paie suivante, les heures s’accumulent avec leur majoration : une heure à taux et demi donne 1,5 heure. Les heures au-delà du plafond de votre organisation sont payées.', 'Pour les utiliser, demandez un congé et choisissez Congé compensatoire (heures accumulées). Vous pouvez demander jusqu’à ce que vous avez accumulé.', 'Vous changez d’idée? Touchez Payer mes heures supplémentaires à la place. Le changement s’applique dès la paie suivante.'],
      tip: 'Le temps accumulé plus ancien que la limite de votre organisation est signalé pour être pris ou payé : planifiez-le en congé avant.',
    },
  },
  {
    slug: 'emergency-contacts-and-text-alerts',
    audience: 'staff',
    en: {
      title: 'Emergency contacts and text alerts',
      summary: 'Say who to call if something happens to you at work, and get urgent alerts by text and phone call.',
      steps: ['Go to your profile and, under Emergency contacts, tap Add contacts. Add a name, relationship and phone for each, and mark who to call first.', 'Only HR sees them, and whoever responds if your working-alone session escalates. Each look is recorded.', 'If your organization has turned on text alerts, open Text and phone alerts on your profile, enter your mobile number and tap Text me a code.', 'Enter the 6-digit code to confirm your number. You can also choose to be texted about open shifts starting within a day.', 'To stop, tap Stop texts and calls.'],
      tip: 'Texts are for urgent alerts only, such as a missed working-alone check-in or a call-out, and never contain links. Don’t tap a link in a text that claims to be from FlexcityHeadquarters.',
    },
    fr: {
      title: 'Personnes à joindre en cas d’urgence et alertes par texto',
      summary: 'Indiquez qui appeler s’il vous arrive quelque chose au travail, et recevez les alertes urgentes par texto et par appel.',
      steps: ['Allez à votre profil et, sous Personnes à joindre en cas d’urgence, touchez Ajouter des personnes. Indiquez le nom, le lien et le téléphone de chacune, et qui appeler en premier.', 'Seuls les RH les voient, et la personne qui intervient si votre séance de travail seul est escaladée. Chaque consultation est consignée.', 'Si votre organisation a activé les alertes par texto, ouvrez Alertes par texto et téléphone à votre profil, entrez votre numéro de cellulaire et touchez M’envoyer un code.', 'Entrez le code à 6 chiffres pour confirmer votre numéro. Vous pouvez aussi choisir de recevoir un texto pour les quarts libres qui commencent dans la journée.', 'Pour arrêter, touchez Arrêter les textos et appels.'],
      tip: 'Les textos servent seulement aux alertes urgentes, comme une vérification de travail seul manquée ou un rappel au travail, et ne contiennent jamais de lien. Ne touchez pas un lien dans un texto qui prétend venir de FlexcityHeadquarters.',
    },
  },
  {
    slug: 'import-staff',
    audience: 'admin',
    en: {
      title: 'Importing staff from a spreadsheet',
      summary: 'Upload a CSV, check every row, then import.',
      steps: ['Add your positions first so they can be matched.', 'Download the template, or export your HR list as CSV. The manager column (their manager’s email) is optional.', 'Upload it: every row is checked and problems are explained line by line.', 'Import the ready rows, with or without invitation emails. Fix the rest and upload again; nobody is added twice.'],
    },
    fr: {
      title: 'Importer le personnel d’un chiffrier',
      summary: 'Téléversez un CSV, vérifiez chaque ligne, puis importez.',
      steps: ['Ajoutez d’abord vos postes pour qu’ils soient reconnus.', 'Téléchargez le modèle, ou exportez votre liste RH en CSV. La colonne manager (le courriel du gestionnaire) est facultative.', 'Téléversez-le : chaque ligne est vérifiée et les problèmes expliqués.', 'Importez les lignes prêtes, avec ou sans courriel d’invitation. Corrigez les autres et téléversez de nouveau; personne n’est ajouté deux fois.'],
    },
  },
  {
    slug: 'managers-and-org-chart',
    audience: 'admin',
    en: {
      title: 'Setting a person’s manager and the org chart',
      summary: 'Choose who each person reports to, so their requests reach the right manager first.',
      steps: ['Open Staff and choose a person. Next to Reports to, tap Change.', 'Pick their manager, or leave it on their department’s manager (the default) so they follow the department.', 'For several people at once, tap Set manager on Staff, choose the people and who they report to. Importing staff? Fill in the manager column.', 'Open Org chart to see who reports to whom. Search by name, position or department, and open or close each team.', 'When someone leaves, offboarding asks who their people report to now.'],
      tip: 'Time off, expenses, trades and overtime claims go to the manager first, and My team in Approvals shows only their people. Setting a manager never gives them access they didn’t already have. Nobody can report to someone on their own team.',
    },
    fr: {
      title: 'Désigner le gestionnaire d’une personne et l’organigramme',
      summary: 'Choisissez de qui relève chaque personne, pour que ses demandes aillent d’abord au bon gestionnaire.',
      steps: ['Ouvrez Personnel et choisissez une personne. À côté de Relève de, touchez Modifier.', 'Choisissez son gestionnaire, ou laissez le gestionnaire de son service (par défaut) pour qu’elle suive le service.', 'Pour plusieurs personnes à la fois, touchez Désigner un gestionnaire dans Personnel, puis choisissez les personnes et de qui elles relèvent. Vous importez du personnel? Remplissez la colonne manager.', 'Ouvrez Organigramme pour voir qui relève de qui. Cherchez par nom, poste ou service, et dépliez ou repliez chaque équipe.', 'Quand une personne part, le départ demande de qui relèvent maintenant les membres de son équipe.'],
      tip: 'Les congés, les dépenses, les échanges et les heures supplémentaires vont d’abord au gestionnaire, et Mon équipe dans Approbations n’affiche que son équipe. Désigner un gestionnaire ne lui donne jamais d’accès qu’il n’avait pas déjà. Personne ne peut relever d’une personne de sa propre équipe.',
    },
  },
  {
    slug: 'api-keys-and-webhooks',
    audience: 'admin',
    en: {
      title: 'API keys and webhooks for IT',
      summary: 'Let your ERP, HRIS or GIS read your data with its own key, send in changes if you allow it, and be told when something changes.',
      steps: ['Open Settings › Integrations. It needs the API and webhooks option, standard in Multi-complex and Enterprise.', 'Under API keys, tap New key. Name it after the system that will use it, choose what it can read, and if you like limit it to your addresses or give it an expiry date.', 'Copy the key when it’s shown: it appears only once. Your IT team keeps it in their secret store and sends it as a bearer token.', 'For a system that sends changes in (new hires, name changes, departments, positions, time off), tick what it can change under Can change data and confirm. You can only give access you hold yourself for the whole organization, and the key shows a Write badge.', 'To replace a key, tap Rotate: the old one keeps working for one more day. Revoke stops a key at once.', 'Under Webhooks, tap New webhook, enter an https address and the events to send, and copy the signing secret. Send test event checks your system answers.', 'Recent deliveries shows what was sent and how your system answered. Failed messages are retried for about two days; Send again resends one.'],
      tip: 'Keys read only, unless you give them write access. Changes follow the same rules as in the app, are in your audit log under the key’s name, never delete anything and never include SINs, banking, pay or health details; ending someone’s employment starts their offboarding, and time off waits for their manager unless the key may send it approved. The API is described at /api/v1/openapi.json. Webhook messages hold ids only and carry an FH-Signature header (HMAC-SHA256): check it before trusting a message. A webhook that keeps failing is turned off and administrators are told. Every request is in your audit log.',
    },
    fr: {
      title: 'Clés d’API et webhooks pour les TI',
      summary: 'Permettez à votre ERP, SIRH ou SIG de lire vos données avec sa propre clé, d’y envoyer des modifications si vous le permettez, et d’être avisé quand quelque chose change.',
      steps: ['Ouvrez Paramètres › Intégrations. Il faut l’option API et webhooks, incluse dans Multicomplexe et Entreprise.', 'Sous Clés d’API, touchez Nouvelle clé. Nommez-la d’après le système qui l’utilisera, choisissez ce qu’elle peut lire et, au besoin, limitez-la à vos adresses ou donnez-lui une date d’expiration.', 'Copiez la clé quand elle s’affiche : elle n’apparaît qu’une fois. Votre équipe des TI la garde dans son coffre à secrets et l’envoie comme jeton porteur (bearer).', 'Pour un système qui envoie des modifications (embauches, changements de nom, services, postes, congés), cochez ce qu’il peut modifier sous Peut modifier les données et confirmez. Vous ne pouvez donner qu’un accès que vous détenez vous-même pour toute l’organisation, et la clé affiche un badge Écriture.', 'Pour remplacer une clé, touchez Remplacer : l’ancienne fonctionne encore une journée. Révoquer arrête une clé sur-le-champ.', 'Sous Webhooks, touchez Nouveau webhook, entrez une adresse https et les événements à envoyer, et copiez le secret de signature. Envoyer un événement test vérifie que votre système répond.', 'Livraisons récentes montre ce qui a été envoyé et la réponse de votre système. Les messages en échec sont réessayés pendant environ deux jours; Renvoyer en envoie un de nouveau.'],
      tip: 'Les clés ne font que lire, sauf si vous leur donnez un accès en écriture. Les modifications suivent les mêmes règles que dans l’application, figurent à votre journal d’audit sous le nom de la clé, ne suppriment jamais rien et n’incluent jamais NAS, coordonnées bancaires, salaire ou santé; mettre fin à l’emploi d’une personne lance son départ, et un congé attend son gestionnaire sauf si la clé peut l’envoyer approuvé. L’API est décrite à /api/v1/openapi.json. Les messages des webhooks ne contiennent que des identifiants et portent un en-tête FH-Signature (HMAC-SHA256) : vérifiez-le avant de vous fier à un message. Un webhook qui échoue sans cesse est désactivé et les administrateurs en sont avisés. Chaque requête figure à votre journal d’audit.',
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
    slug: 'holidays-on-a-weekend',
    audience: 'admin',
    en: {
      title: 'Statutory holidays on a weekend',
      summary: 'Choose which day you close for a weekend holiday, and see what each province gives someone whose day off it falls on.',
      steps: [
        'Holidays keep their own date. Where the law moves one, FH uses the moved day for everyone: Canada Day on a Sunday is Monday, July 2 (not in Nova Scotia or Newfoundland and Labrador). In Quebec, the Fête nationale on a Sunday is June 25 for people who don’t usually work Sundays; those who do keep June 24.',
        'In Settings › Pay codes, under When a holiday falls on a weekend, choose the day you close: the statutory day, or the next weekday as most municipal collective agreements do (Christmas on a Saturday on Monday, Boxing Day on the Sunday on Tuesday). Hours worked on the observed day are paid at the holiday rate, and so are hours on the holiday itself.',
        'Under A holiday on someone’s day off, follow each province’s rule or choose another day off with holiday pay, or holiday pay alone. Your choice applies only where the province lets the employer choose; the card explains each of your provinces’ rules.',
        'Whether a holiday is someone’s day off follows their own pattern of work (the weekday they worked in at least 5 of the 9 weeks before), not the calendar weekend. When a substitute day is owed, the pay run says so: give them that day off.',
      ],
      tip: 'Everyone sees the coming holidays and the day off for each on their Time off page. The rules are our reading of each statute and are being reviewed by employment counsel.',
    },
    fr: {
      title: 'Les jours fériés la fin de semaine',
      summary: 'Choisissez le jour de fermeture pour un jour férié la fin de semaine, et voyez ce que chaque province accorde à une personne dont c’est le jour de congé.',
      steps: [
        'Les jours fériés gardent leur propre date. Quand la loi en déplace un, FH utilise le jour où il est déplacé pour tout le monde : la fête du Canada un dimanche est le lundi 2 juillet (sauf en Nouvelle-Écosse et à Terre-Neuve-et-Labrador). Au Québec, la Fête nationale un dimanche est le 25 juin pour les personnes qui ne travaillent pas habituellement le dimanche; les autres gardent le 24 juin.',
        'Dans Paramètres › Codes de paie, sous Quand un jour férié tombe la fin de semaine, choisissez le jour de fermeture : le jour prévu par la loi, ou le jour de semaine suivant comme la plupart des conventions collectives municipales (Noël un samedi le lundi, le lendemain de Noël le dimanche, le mardi). Les heures travaillées le jour observé sont payées au taux du jour férié, tout comme celles du jour férié lui-même.',
        'Sous Un jour férié pendant un jour de congé, suivez la règle de chaque province ou choisissez un autre jour de congé avec l’indemnité, ou l’indemnité seule. Votre choix s’applique seulement là où la province laisse le choix à l’employeur; la carte explique la règle de chacune de vos provinces.',
        'Le jour de congé dépend de l’horaire habituel de la personne (le jour de semaine travaillé au moins 5 des 9 semaines précédentes), et non de la fin de semaine du calendrier. Quand un jour de remplacement est dû, la paie l’indique : accordez-lui ce congé.',
      ],
      tip: 'Chacun voit les prochains jours fériés et le jour de congé pour chacun à sa page Congés. Les règles sont notre lecture de chaque loi et sont en cours de révision par un avocat en droit du travail.',
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
