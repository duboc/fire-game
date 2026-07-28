// UI chrome in the visitor's own language, for the same six languages the
// player names use (src/locales/animals.js and friends).
//
// Two rules hold for every value in this file, and the tests enforce both:
//
//  1. Plain text only, never markup. Each one is assigned with `textContent`,
//     so a stray `<` in a translation can never become an element. The one
//     string that used to carry an <a> (the host's hint) was reworded instead.
//  2. `en` is the reference. Any key it has, every other language must have,
//     with the same {placeholders} — a translator who drops {rank} ships
//     "Você ficou em" with a hole in it, and that must fail at boot rather
//     than on the projector.
//
// Values are either a string, or {one, other} for anything counted. Plurals go
// through Intl.PluralRules rather than `n === 1`: all six languages are
// one/other, but French puts 0 in `one`, which the naive check gets wrong.

export const UI_LOCALES = ['pt', 'es', 'en', 'fr', 'it', 'de'];
export const UI_FALLBACK = 'en';

/**
 * Each language written in itself, for the phone's picker. Never translated:
 * someone hunting for their own language scans for the word they know, and
 * "Alemão" is invisible to the German speaker looking for "Deutsch".
 */
export const UI_LANG_NAMES = {
  pt: 'Português', es: 'Español', en: 'English',
  fr: 'Français', it: 'Italiano', de: 'Deutsch',
};

/** The surface each page is injected with; see buildI18nTag in src/i18n-inject.js. */
export const UI = {
  // ---------------------------------------------------------------- phone (/)
  phone: {
    pt: {
      langLabel: 'Idioma',
      whoLabel: 'Você é',
      connecting: 'Conectando…',
      statRank: 'Posição',
      statTaps: 'Toques',
      statPlayers: 'Jogadores',
      btnAria: 'Botão de toque',
      btnWait: 'AGUARDE',
      btnTap: 'TOCA!',
      btnOver: 'ACABOU!',
      btnSoon: 'JÁ JÁ…',
      statusLobby: 'Aguardando o host iniciar…',
      statusGo: 'VAI VAI VAI! 🔥',
      statusReady: 'Prepare-se!',
      statusSettling: 'Apurando os últimos toques… ⏳',
      statusRanked: 'Você ficou em {rank} • Olhe para a tela! 🏆',
      statusEnded: 'Fim de jogo! Olhe para a tela 🏆',
      cdSub: 'Prepare o dedo…',
      go: 'VAI!',
      offline: 'Sem conexão… tentando de novo',
    },
    es: {
      langLabel: 'Idioma',
      whoLabel: 'Eres',
      connecting: 'Conectando…',
      statRank: 'Posición',
      statTaps: 'Toques',
      statPlayers: 'Jugadores',
      btnAria: 'Botón de toque',
      btnWait: 'ESPERA',
      btnTap: '¡TOCA!',
      btnOver: '¡SE ACABÓ!',
      btnSoon: 'YA CASI…',
      statusLobby: 'Esperando a que el host empiece…',
      statusGo: '¡DALE DALE DALE! 🔥',
      statusReady: '¡Prepárate!',
      statusSettling: 'Contando los últimos toques… ⏳',
      statusRanked: 'Quedaste {rank} • ¡Mira la pantalla! 🏆',
      statusEnded: '¡Fin del juego! Mira la pantalla 🏆',
      cdSub: 'Prepara el dedo…',
      go: '¡YA!',
      offline: 'Sin conexión… reintentando',
    },
    en: {
      langLabel: 'Language',
      whoLabel: 'You are',
      connecting: 'Connecting…',
      statRank: 'Rank',
      statTaps: 'Taps',
      statPlayers: 'Players',
      btnAria: 'Tap button',
      btnWait: 'WAIT',
      btnTap: 'TAP!',
      btnOver: "TIME'S UP!",
      btnSoon: 'ALMOST…',
      statusLobby: 'Waiting for the host to start…',
      statusGo: 'GO GO GO! 🔥',
      statusReady: 'Get ready!',
      statusSettling: 'Counting the last taps… ⏳',
      statusRanked: 'You finished {rank} • Look at the screen! 🏆',
      statusEnded: 'Game over! Look at the screen 🏆',
      cdSub: 'Finger ready…',
      go: 'GO!',
      offline: 'No connection… retrying',
    },
    fr: {
      langLabel: 'Langue',
      whoLabel: 'Tu es',
      connecting: 'Connexion…',
      statRank: 'Rang',
      statTaps: 'Touches',
      statPlayers: 'Joueurs',
      btnAria: 'Bouton de tap',
      btnWait: 'ATTENDS',
      btnTap: 'TAPE !',
      btnOver: 'FINI !',
      btnSoon: 'BIENTÔT…',
      statusLobby: "En attente du lancement par l'hôte…",
      statusGo: 'ALLEZ ALLEZ ALLEZ ! 🔥',
      statusReady: 'Prépare-toi !',
      statusSettling: 'Comptage des derniers appuis… ⏳',
      statusRanked: "Tu finis {rank} • Regarde l'écran ! 🏆",
      statusEnded: "Partie terminée ! Regarde l'écran 🏆",
      cdSub: 'Prépare ton doigt…',
      go: 'PARTEZ !',
      offline: 'Pas de connexion… nouvelle tentative',
    },
    it: {
      langLabel: 'Lingua',
      whoLabel: 'Sei',
      connecting: 'Connessione…',
      statRank: 'Posizione',
      statTaps: 'Tocchi',
      statPlayers: 'Giocatori',
      btnAria: 'Pulsante di tocco',
      btnWait: 'ASPETTA',
      btnTap: 'TOCCA!',
      btnOver: 'FINITO!',
      btnSoon: 'TRA POCO…',
      statusLobby: "In attesa che l'host inizi…",
      statusGo: 'VAI VAI VAI! 🔥',
      statusReady: 'Preparati!',
      statusSettling: 'Conteggio degli ultimi tocchi… ⏳',
      statusRanked: 'Sei arrivato {rank} • Guarda lo schermo! 🏆',
      statusEnded: 'Fine del gioco! Guarda lo schermo 🏆',
      cdSub: 'Prepara il dito…',
      go: 'VIA!',
      offline: 'Nessuna connessione… riprovo',
    },
    de: {
      langLabel: 'Sprache',
      whoLabel: 'Du bist',
      connecting: 'Verbinde…',
      statRank: 'Platz',
      statTaps: 'Taps',
      statPlayers: 'Spieler',
      btnAria: 'Tipp-Taste',
      btnWait: 'WARTEN',
      btnTap: 'TIPPEN!',
      btnOver: 'VORBEI!',
      btnSoon: 'GLEICH…',
      statusLobby: 'Warten auf den Start…',
      statusGo: 'LOS LOS LOS! 🔥',
      statusReady: 'Mach dich bereit!',
      statusSettling: 'Letzte Taps werden gezählt… ⏳',
      statusRanked: 'Du bist auf {rank} • Schau auf die Leinwand! 🏆',
      statusEnded: 'Spiel vorbei! Schau auf die Leinwand 🏆',
      cdSub: 'Finger bereit…',
      go: 'LOS!',
      offline: 'Keine Verbindung… neuer Versuch',
    },
  },

  // -------------------------------------------------------- projector (/screen)
  screen: {
    pt: {
      title: 'Tap Race — Telão',
      tagline: 'Pegue o celular. Aponte a câmera. Toque sem parar.',
      joinAt: 'Entre em',
      playersReady: { one: '{n} jogador pronto', other: '{n} jogadores prontos' },
      chipPlayers: 'Jogadores',
      chipTaps: 'Toques',
      chipTime: 'Tempo',
      champLabel: '🏆 Campeão 🏆',
      waitingHost: 'Aguardando o host… (pode iniciar uma nova rodada)',
      settling: '⏳ Apurando…',
      countingLast: 'Contando os últimos toques',
      nobody: 'Ninguém tocou 😴',
      tapsCount: { one: '{n} toque', other: '{n} toques' },
      go: 'VAI!',
    },
    es: {
      title: 'Tap Race — Pantalla',
      tagline: 'Coge el móvil. Apunta la cámara. Toca sin parar.',
      joinAt: 'Entra en',
      playersReady: { one: '{n} jugador listo', other: '{n} jugadores listos' },
      chipPlayers: 'Jugadores',
      chipTaps: 'Toques',
      chipTime: 'Tiempo',
      champLabel: '🏆 Campeón 🏆',
      waitingHost: 'Esperando al host… (puede empezar otra ronda)',
      settling: '⏳ Contando…',
      countingLast: 'Contando los últimos toques',
      nobody: 'Nadie tocó 😴',
      tapsCount: { one: '{n} toque', other: '{n} toques' },
      go: '¡YA!',
    },
    en: {
      title: 'Tap Race — Screen',
      tagline: 'Grab your phone. Point the camera. Tap non-stop.',
      joinAt: 'Join at',
      playersReady: { one: '{n} player ready', other: '{n} players ready' },
      chipPlayers: 'Players',
      chipTaps: 'Taps',
      chipTime: 'Time',
      champLabel: '🏆 Champion 🏆',
      waitingHost: 'Waiting for the host… (a new round can start any time)',
      settling: '⏳ Counting…',
      countingLast: 'Counting the last taps',
      nobody: 'Nobody tapped 😴',
      tapsCount: { one: '{n} tap', other: '{n} taps' },
      go: 'GO!',
    },
    fr: {
      title: 'Tap Race — Écran',
      tagline: "Prends ton téléphone. Vise avec la caméra. Tape sans t'arrêter.",
      joinAt: 'Rejoins sur',
      playersReady: { one: '{n} joueur prêt', other: '{n} joueurs prêts' },
      chipPlayers: 'Joueurs',
      chipTaps: 'Touches',
      chipTime: 'Temps',
      champLabel: '🏆 Champion 🏆',
      waitingHost: "En attente de l'hôte… (une nouvelle manche peut démarrer)",
      settling: '⏳ Comptage…',
      countingLast: 'Comptage des derniers appuis',
      nobody: "Personne n'a tapé 😴",
      tapsCount: { one: '{n} touche', other: '{n} touches' },
      go: 'PARTEZ !',
    },
    it: {
      title: 'Tap Race — Schermo',
      tagline: 'Prendi il telefono. Inquadra il codice. Tocca senza sosta.',
      playersReady: { one: '{n} giocatore pronto', other: '{n} giocatori pronti' },
      joinAt: 'Entra su',
      chipPlayers: 'Giocatori',
      chipTaps: 'Tocchi',
      chipTime: 'Tempo',
      champLabel: '🏆 Campione 🏆',
      waitingHost: "In attesa dell'host… (può iniziare un nuovo turno)",
      settling: '⏳ Conteggio…',
      countingLast: 'Conteggio degli ultimi tocchi',
      nobody: 'Nessuno ha toccato 😴',
      tapsCount: { one: '{n} tocco', other: '{n} tocchi' },
      go: 'VIA!',
    },
    de: {
      title: 'Tap Race — Leinwand',
      tagline: 'Handy raus. Kamera drauf. Ohne Pause tippen.',
      joinAt: 'Mitmachen unter',
      playersReady: { one: '{n} Spieler bereit', other: '{n} Spieler bereit' },
      chipPlayers: 'Spieler',
      chipTaps: 'Taps',
      chipTime: 'Zeit',
      champLabel: '🏆 Sieger 🏆',
      waitingHost: 'Warten auf den Host… (eine neue Runde kann starten)',
      settling: '⏳ Auswertung…',
      countingLast: 'Die letzten Taps werden gezählt',
      nobody: 'Niemand hat getippt 😴',
      tapsCount: { one: '{n} Tap', other: '{n} Taps' },
      go: 'LOS!',
    },
  },

  // ------------------------------------------------------------- host (/host)
  host: {
    pt: {
      title: 'Tap Race — Host',
      tag: '· Host',
      pwLabel: 'Senha admin',
      pwPlaceholder: 'senha admin',
      peekTitle: 'Mostrar/ocultar',
      sessionLabel: 'Sessão',
      authed: '🔓 autenticado',
      logout: 'sair',
      durLabel: 'Duração',
      btnStart: '▶ Iniciar (3 · 2 · 1 · VAI)',
      btnReset: '↺ Resetar p/ lobby',
      hint: 'Dica: deixe o telão em /screen. Iniciar zera os contadores e dispara a contagem.',
      stateLabel: 'Estado:',
      statPlayers: 'Jogadores',
      statTaps: 'Toques',
      statTime: 'Tempo',
      rankHeading: '🏆 Ranking ao vivo',
      rankEmpty: 'Sem jogadores ainda…',
      linkPlayer: 'Link do jogador',
      linkScreen: 'Telão',
      msgNeedPw: 'Informe a senha admin.',
      msgBadPw: 'Senha admin incorreta.',
      msgAuthed: 'Autenticado.',
      msgNetFail: 'Falha de rede.',
      msgLoggedOut: 'Sessão encerrada.',
      msgExpired: 'Sessão expirou — informe a senha novamente.',
      msgStarted: 'Rodada iniciada! 🚀',
      msgReset: 'Resetado para lobby.',
      phaseLobby: 'LOBBY',
      phaseCountdown: 'CONTAGEM',
      phaseRunning: 'RODANDO',
      phaseEnded: 'FIM',
    },
    es: {
      title: 'Tap Race — Host',
      tag: '· Host',
      pwLabel: 'Contraseña admin',
      pwPlaceholder: 'contraseña admin',
      peekTitle: 'Mostrar/ocultar',
      sessionLabel: 'Sesión',
      authed: '🔓 autenticado',
      logout: 'salir',
      durLabel: 'Duración',
      btnStart: '▶ Empezar (3 · 2 · 1 · ¡YA!)',
      btnReset: '↺ Volver al lobby',
      hint: 'Consejo: deja la pantalla grande en /screen. Empezar pone los contadores a cero y lanza la cuenta atrás.',
      stateLabel: 'Estado:',
      statPlayers: 'Jugadores',
      statTaps: 'Toques',
      statTime: 'Tiempo',
      rankHeading: '🏆 Ranking en vivo',
      rankEmpty: 'Aún no hay jugadores…',
      linkPlayer: 'Enlace del jugador',
      linkScreen: 'Pantalla',
      msgNeedPw: 'Introduce la contraseña admin.',
      msgBadPw: 'Contraseña admin incorrecta.',
      msgAuthed: 'Autenticado.',
      msgNetFail: 'Fallo de red.',
      msgLoggedOut: 'Sesión cerrada.',
      msgExpired: 'La sesión expiró — introduce la contraseña otra vez.',
      msgStarted: '¡Ronda empezada! 🚀',
      msgReset: 'Reiniciado al lobby.',
      phaseLobby: 'LOBBY',
      phaseCountdown: 'CUENTA ATRÁS',
      phaseRunning: 'EN JUEGO',
      phaseEnded: 'FIN',
    },
    en: {
      title: 'Tap Race — Host',
      tag: '· Host',
      pwLabel: 'Admin password',
      pwPlaceholder: 'admin password',
      peekTitle: 'Show/hide',
      sessionLabel: 'Session',
      authed: '🔓 signed in',
      logout: 'sign out',
      durLabel: 'Duration',
      btnStart: '▶ Start (3 · 2 · 1 · GO)',
      btnReset: '↺ Reset to lobby',
      hint: 'Tip: leave /screen up on the projector. Starting zeroes the counters and fires the countdown.',
      stateLabel: 'State:',
      statPlayers: 'Players',
      statTaps: 'Taps',
      statTime: 'Time',
      rankHeading: '🏆 Live ranking',
      rankEmpty: 'No players yet…',
      linkPlayer: 'Player link',
      linkScreen: 'Screen',
      msgNeedPw: 'Enter the admin password.',
      msgBadPw: 'Wrong admin password.',
      msgAuthed: 'Signed in.',
      msgNetFail: 'Network error.',
      msgLoggedOut: 'Session ended.',
      msgExpired: 'Session expired — enter the password again.',
      msgStarted: 'Round started! 🚀',
      msgReset: 'Reset to lobby.',
      phaseLobby: 'LOBBY',
      phaseCountdown: 'COUNTDOWN',
      phaseRunning: 'RUNNING',
      phaseEnded: 'ENDED',
    },
    fr: {
      title: 'Tap Race — Hôte',
      tag: '· Hôte',
      pwLabel: 'Mot de passe admin',
      pwPlaceholder: 'mot de passe admin',
      peekTitle: 'Afficher/masquer',
      sessionLabel: 'Session',
      authed: '🔓 authentifié',
      logout: 'déconnexion',
      durLabel: 'Durée',
      btnStart: '▶ Démarrer (3 · 2 · 1 · PARTEZ)',
      btnReset: '↺ Retour au lobby',
      hint: "Astuce : laisse /screen sur le vidéoprojecteur. Démarrer remet les compteurs à zéro et lance le décompte.",
      stateLabel: 'État :',
      statPlayers: 'Joueurs',
      statTaps: 'Touches',
      statTime: 'Temps',
      rankHeading: '🏆 Classement en direct',
      rankEmpty: 'Pas encore de joueurs…',
      linkPlayer: 'Lien joueur',
      linkScreen: 'Écran',
      msgNeedPw: 'Saisis le mot de passe admin.',
      msgBadPw: 'Mot de passe admin incorrect.',
      msgAuthed: 'Authentifié.',
      msgNetFail: 'Erreur réseau.',
      msgLoggedOut: 'Session terminée.',
      msgExpired: 'Session expirée — saisis à nouveau le mot de passe.',
      msgStarted: 'Manche démarrée ! 🚀',
      msgReset: 'Retour au lobby.',
      phaseLobby: 'LOBBY',
      phaseCountdown: 'DÉCOMPTE',
      phaseRunning: 'EN COURS',
      phaseEnded: 'TERMINÉ',
    },
    it: {
      title: 'Tap Race — Host',
      tag: '· Host',
      pwLabel: 'Password admin',
      pwPlaceholder: 'password admin',
      peekTitle: 'Mostra/nascondi',
      sessionLabel: 'Sessione',
      authed: '🔓 autenticato',
      logout: 'esci',
      durLabel: 'Durata',
      btnStart: '▶ Avvia (3 · 2 · 1 · VIA)',
      btnReset: '↺ Torna al lobby',
      hint: 'Consiglio: lascia /screen sul maxischermo. Avviare azzera i contatori e lancia il conto alla rovescia.',
      stateLabel: 'Stato:',
      statPlayers: 'Giocatori',
      statTaps: 'Tocchi',
      statTime: 'Tempo',
      rankHeading: '🏆 Classifica in diretta',
      rankEmpty: 'Ancora nessun giocatore…',
      linkPlayer: 'Link giocatore',
      linkScreen: 'Schermo',
      msgNeedPw: 'Inserisci la password admin.',
      msgBadPw: 'Password admin errata.',
      msgAuthed: 'Autenticato.',
      msgNetFail: 'Errore di rete.',
      msgLoggedOut: 'Sessione chiusa.',
      msgExpired: 'Sessione scaduta — inserisci di nuovo la password.',
      msgStarted: 'Turno avviato! 🚀',
      msgReset: 'Tornato al lobby.',
      phaseLobby: 'LOBBY',
      phaseCountdown: 'CONTO ALLA ROVESCIA',
      phaseRunning: 'IN CORSO',
      phaseEnded: 'FINE',
    },
    de: {
      title: 'Tap Race — Host',
      tag: '· Host',
      pwLabel: 'Admin-Passwort',
      pwPlaceholder: 'Admin-Passwort',
      peekTitle: 'Anzeigen/verbergen',
      sessionLabel: 'Sitzung',
      authed: '🔓 angemeldet',
      logout: 'abmelden',
      durLabel: 'Dauer',
      btnStart: '▶ Starten (3 · 2 · 1 · LOS)',
      btnReset: '↺ Zurück zum Lobby',
      hint: 'Tipp: /screen auf der Leinwand lassen. Starten setzt die Zähler zurück und löst den Countdown aus.',
      stateLabel: 'Status:',
      statPlayers: 'Spieler',
      statTaps: 'Taps',
      statTime: 'Zeit',
      rankHeading: '🏆 Live-Rangliste',
      rankEmpty: 'Noch keine Spieler…',
      linkPlayer: 'Spieler-Link',
      linkScreen: 'Leinwand',
      msgNeedPw: 'Admin-Passwort eingeben.',
      msgBadPw: 'Falsches Admin-Passwort.',
      msgAuthed: 'Angemeldet.',
      msgNetFail: 'Netzwerkfehler.',
      msgLoggedOut: 'Sitzung beendet.',
      msgExpired: 'Sitzung abgelaufen — Passwort erneut eingeben.',
      msgStarted: 'Runde gestartet! 🚀',
      msgReset: 'Zurück zum Lobby.',
      phaseLobby: 'LOBBY',
      phaseCountdown: 'COUNTDOWN',
      phaseRunning: 'LÄUFT',
      phaseEnded: 'ENDE',
    },
  },
};

const PLACEHOLDER = /\{(\w+)\}/g;
const placeholdersOf = (v) =>
  (typeof v === 'string' ? [v] : Object.values(v))
    .flatMap((s) => [...String(s).matchAll(PLACEHOLDER)].map((m) => m[0]))
    .sort()
    .join(',');

/**
 * Fail on deploy, not on the projector. Mirrors the roster check in
 * src/names.js: a language that is missing a key, has one too many, or has
 * quietly lost a {placeholder} is a bug we want to hear about at boot.
 * @param {typeof UI} catalogue
 */
export function validateUi(catalogue = UI) {
  for (const [surface, langs] of Object.entries(catalogue)) {
    const ref = langs[UI_FALLBACK];
    if (!ref) throw new Error(`ui: surface "${surface}" has no "${UI_FALLBACK}" reference`);

    for (const code of UI_LOCALES) {
      const got = langs[code];
      if (!got) throw new Error(`ui: surface "${surface}" is missing the language "${code}"`);

      for (const key of Object.keys(ref)) {
        if (!(key in got)) throw new Error(`ui: ${surface}.${code} is missing the key "${key}"`);

        // A plural in the reference must be a plural everywhere, or
        // Intl.PluralRules picks a branch off a bare string and renders
        // "undefined" in front of the whole room.
        const refPlural = typeof ref[key] === 'object';
        if (refPlural !== (typeof got[key] === 'object')) {
          throw new Error(`ui: ${surface}.${code}."${key}" should ${refPlural ? '' : 'not '}be a {one,other} plural`);
        }
        if (refPlural) {
          for (const form of ['one', 'other']) {
            if (typeof got[key][form] !== 'string') {
              throw new Error(`ui: ${surface}.${code}."${key}" is missing the "${form}" plural form`);
            }
          }
        }
        if (placeholdersOf(ref[key]) !== placeholdersOf(got[key])) {
          throw new Error(`ui: ${surface}.${code}."${key}" does not use the same placeholders as ${UI_FALLBACK}`);
        }
      }
      for (const key of Object.keys(got)) {
        if (!(key in ref)) throw new Error(`ui: ${surface}.${code} has an extra key "${key}"`);
      }
    }
  }
  return catalogue;
}

validateUi();
