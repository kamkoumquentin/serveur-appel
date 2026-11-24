/* =========================================================
   CallManager — une seule classe : HTML + CSS + WebRTC + UI
========================================================= */

class CallManager {
  // static SIGNALING_SERVER_URL = 'wss://api.furthermarket.com:8088';
  static SIGNALING_SERVER_URL = "wss://app-appel.onrender.com";
  static HTTP_SERVER_URL = "https://app-appel.onrender.com";
  static RECONNECT_DELAY = 5000;

  static RTC_CONFIG = {
    // iceServers seront récupérés dynamiquement depuis le serveur (message "get-ice-servers")
    // pour éviter d'exposer les credentials TURN en clair dans le client
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" }, // STUN public fallback
    ],
    iceTransportPolicy: "relay",
    bundlePolicy: "max-bundle"
  };
  
// ajouter icônes et labels pour les routes audio (écouteur, haut-parleur, bluetooth)
 static ROUTE_LABELS = {
  earpiece: "Écouteur",         // son bas (comme WhatsApp)
  speaker: "Haut-parleur",      // main libre (son fort)
  bluetooth: "Bluetooth",
};

static ROUTE_ICONS = {
  earpiece: "fa-solid fa-mobile-screen-button",  // icône téléphone
  speaker: "fa-solid fa-volume-high",            // haut-parleur
  bluetooth: "fa-brands fa-bluetooth-b",
};
// fin

  static get CSS() {
    return `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}


/* STYLE DE CONSOLE */

#log-debug-box {
    position: fixed;
    bottom: 10px;
    left: 10px;
    right: 10px;
    max-height: 35vh;
    overflow-y: auto;
    background: rgba(0, 0, 0, 0.85);
    color: #0f0;
    font-size: 12px;
    font-family: monospace;
    padding: 8px;
    border-radius: 8px;
    z-index: 9999;
    white-space: pre-wrap;
    display: none;
}
#log-debug-box.show { display: block; }
#log-toggle-btn {
    position: fixed;
    top: 10px;
    right: 10px;
    z-index: 10000;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: rgba(17, 27, 33, 0.9);
    color: #0f0;
    border: 1px solid rgba(0, 255, 0, 0.4);
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
}


/* Barre de sélection des interfaces */
.switcher-bar {
    background-color: #111b21;
    padding: 10px;
    display: flex;
    justify-content: center;
    gap: 10px;
    z-index: 100;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.switch-btn {
    background-color: #222d34;
    color: #8696a0;
    border: none;
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
}

.switch-btn.active {
    background-color: #00a884;
    color: #ffffff;
}

/* Modal Overlay fixe pour chaque vue */
.view-container {   
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(11, 20, 26, 0.95);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 999;
    padding: 0;
}

.view-container.active {
    display: flex;
}

/* Application Container */
.app-container {
    width: 100%;
    max-width: 480px;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: center;
    padding: max(20px, 4vh) 16px 20px 16px;
    background-color: #0b141a;
    color: #ffffff;
}

/* En-têtes */
.header {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 5px;
    z-index: 10;
}

.icon-btn-top {
    flex: initial;
    background: none;
    border: none;
    color: #ffffff;
    font-size: 20px;
    cursor: pointer;
    padding: 8px;
}

.contact-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    flex-grow: 1;
}

.contact-name {
    font-size: clamp(16px, 4.5vw, 20px);
    font-weight: 500;
}

.encryption-status, .phone-number, .call-status {
    font-size: clamp(11px, 3vw, 13px);
    color: #8696a0;
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 2px;
}

/* Centre Avatar */
.center-avatar {
    display: flex;
    justify-content: center;
    align-items: center;
    flex-grow: 1;
    width: 100%;
    padding: 20px 0;
}

.avatar-container {
    width: clamp(160px, 45vw, 240px);
    height: clamp(160px, 45vw, 240px);
    border-radius: 50%;
    overflow: hidden;
    background: linear-gradient(160deg, #2a3942, #1f2c33);
    display: flex;
    justify-content: center;
    align-items: center;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}

/* Panels & Boutons d'Appel */
.control-panel {
    background-color: #111b21;
    width: 100%;
    border-radius: 28px;
    padding: clamp(20px, 4vh, 28px) 15px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: clamp(12px, 3vh, 20px) 10px;
    justify-items: center;
    align-items: center;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
}

.btn-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
}

.control-btn {
    flex: initial;
    background-color: #222d34;
    border: none;
    width: clamp(50px, 14vw, 64px);
    height: clamp(50px, 14vw, 64px);
    border-radius: 50%;
    color: #ffffff;
    font-size: clamp(18px, 5vw, 22px);
    display: flex;
    justify-content: center;
    align-items: center;
    cursor: pointer;
    transition: background-color 0.2s, transform 0.1s;
}

.control-btn:active {
    transform: scale(0.95);
}

.control-btn.hangup {
    background-color: #ea0038;
    color: #ffffff;
}

.btn-label {
    font-size: clamp(10px, 2.8vw, 12px);
    color: #8696a0;
    margin-top: 6px;
    text-align: center;
    width: 100%;
}

.incoming-actions {
    width: 100%;
    display: flex;
    justify-content: space-around;
    align-items: center;
    padding: 10px 0;
}

.incoming-btn-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    position: relative;
}

.incoming-btn {
    border: none;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    color: #ffffff;
    font-size: 22px;
    display: flex;
    justify-content: center;
    align-items: center;
    cursor: pointer;
    box-shadow: 0 5px 15px rgba(0,0,0,0.3);
}

.incoming-btn.refuse {
    background-color: #ea0038;
}

.incoming-btn.accept {
    background-color: #00a884;
    position: relative;
    z-index: 5;
    touch-action: none; /* Empêche le défilement tactile pendant le swipe */
    transition: transform 0.3s ease;
}

.incoming-btn.accept:active {
    cursor: grabbing;
}

.incoming-btn.message {
    background-color: #222d34;
    color: #8696a0;
}

.incoming-label {
    font-size: 12px;
    color: #8696a0;
    text-align: center;
    max-width: 100px;
}

/* Flèches de swipe vers le haut */
.swipe-arrows {
    position: absolute;
    top: -55px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    pointer-events: none;
}

.swipe-arrows i {
    font-size: 13px;
    color: #00a884;
    opacity: 0;
    animation: slideUpArrows 1.5s infinite ease-in-out;
}

.swipe-arrows i:nth-child(1) { animation-delay: 0s; }
.swipe-arrows i:nth-child(2) { animation-delay: 0.3s; }
.swipe-arrows i:nth-child(3) { animation-delay: 0.6s; }

/* Animations */
@keyframes slideUpArrows {
    0% { transform: translateY(12px); opacity: 0; }
    50% { opacity: 1; }
    100% { transform: translateY(-12px); opacity: 0; }
}

@keyframes vibrate {
    0% { transform: translate(0, 0) rotate(0deg); }
    20% { transform: translate(-3px, 2px) rotate(-1deg); }
    40% { transform: translate(3px, -2px) rotate(1deg); }
    60% { transform: translate(-2px, -2px) rotate(0deg); }
    80% { transform: translate(2px, 3px) rotate(1deg); }
    100% { transform: translate(0, 0) rotate(0deg); }
}

.vibrating {
    animation: vibrate 0.3s infinite ease-in-out;
}

/* =========================================================
   INTERFACE 3 : APPEL VIDEO
========================================================= */
/* =========================================================
   INTERFACE APPEL VIDEO
========================================================= */

.video-call-view {
    background: #000;
    padding: 0;
    z-index: 2000;
}

.video-call-container {
    position: relative;
    width: 100%;
    height: 100%;
    max-width: 900px;
    background: #000;
    overflow: hidden;
}

/* =========================================================
   ÉTATS DU CONTAINER D'APPEL VIDÉO
========================================================= */

/* État calling : selfie pas en plein écran, afficher avatar centré */
.video-call-container.calling .remote-video {
    display: none;
}

.video-call-container.calling .local-video-wrapper {
    position: absolute;
    top: 75px;
    right: 15px;
    width: clamp(110px, 28vw, 180px);
    height: clamp(150px, 35vw, 240px);
    border-radius: 15px;
    border: 2px solid rgba(255,255,255,.8);
    z-index: 5;
    touch-action: none; /* pas de drag en état calling */
}

.video-call-container.calling .local-video {
    transform: scaleX(-1); /* effet miroir pour caméra frontale */
}

/* État calling : afficher le placeholder (avatar) */
.video-call-container.calling .remote-video-placeholder {
    display: flex;
    z-index: 3;
}

/* État calling : header et panel visibles pour les contrôles */
.video-call-container.calling .video-header {
    opacity: 1;
    pointer-events: auto;
    z-index: 10; /* Au-dessus de la vidéo */
}

.video-call-container.calling .video-control-panel {
    opacity: 1;
    pointer-events: auto;
    z-index: 10; /* Au-dessus de la vidéo */
}

/* État incoming : placeholder avatar centré (comme WhatsApp) */
.video-call-container.incoming .local-video-wrapper {
    position: absolute;
    top: 75px;
    right: 15px;
    width: clamp(110px, 28vw, 180px);
    height: clamp(150px, 35vw, 240px);
    border-radius: 15px;
    border: 2px solid rgba(255,255,255,.8);
    z-index: 5;
}

.video-call-container.incoming .local-video {
    transform: scaleX(-1);
}

.video-call-container.incoming .remote-video-placeholder {
    display: flex; /* Afficher l'avatar au centre */
    z-index: 3;
}

/* État incoming : boutons Accepter/Refuser et toggle caméra */
.video-call-container.incoming .video-incoming-actions {
    display: flex;
    z-index: 30; /* Au-dessus de tout */
}

.video-call-container.incoming .video-incoming-camera-toggle {
    display: block;
    z-index: 30; /* Au-dessus de tout */
}

.video-call-container.incoming .video-control-panel {
    display: none;
}

/* État incoming : header visible pour montrer le nom de l'appelant */
.video-call-container.incoming .video-header {
    opacity: 1;
    pointer-events: auto;
    z-index: 20; /* Au-dessus du placeholder */
}

/* Overlay sombre pendant calling/incoming pour améliorer la lisibilité */
.video-call-container.calling::before,
.video-call-container.incoming::before {
    content: "";
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 2;
    pointer-events: none;
}

/* État controls-hidden : header et panel masqués en fondu */
.video-call-container.controls-hidden .video-header {
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
}

.video-call-container.controls-hidden .video-control-panel {
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
}

.video-call-container:not(.controls-hidden) .video-header {
    opacity: 1;
    pointer-events: auto;
    transition: opacity 0.3s ease;
}

.video-call-container:not(.controls-hidden) .video-control-panel {
    opacity: 1;
    pointer-events: auto;
    transition: opacity 0.3s ease;
}

/* =========================================================
   BOUTONS ACCEPTER/REFUSER (ÉTAT INCOMING)
========================================================= */

.video-incoming-actions {
    position: absolute;
    bottom: 40px;
    left: 50%;
    transform: translateX(-50%);
    display: none;
    gap: 40px;
    z-index: 40;
}

.video-incoming-btn {
    width: 70px;
    height: 70px;
    border-radius: 50%;
    border: none;
    color: white;
    font-size: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 5px 20px rgba(0, 0, 0, 0.5);
}

.video-incoming-btn.accept {
    background: #00a884;
}

.video-incoming-btn.refuse {
    background: #ea0038;
}

/* =========================================================
   TOGGLE CAMÉRA (ÉTAT INCOMING)
========================================================= */

.video-incoming-camera-toggle {
    position: absolute;
    bottom: 130px;
    left: 50%;
    transform: translateX(-50%);
    display: none;
    z-index: 40;
}

.video-incoming-camera-toggle button {
    background: rgba(17, 27, 33, 0.9);
    border: none;
    border-radius: 20px;
    padding: 10px 20px;
    color: white;
    font-size: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    backdrop-filter: blur(10px);
}

.video-incoming-camera-toggle button i {
    font-size: 16px;
}


/* =========================================================
   VIDEO DISTANTE
========================================================= */

.remote-video {
    position: absolute;
    inset: 0;

    width: 100%;
    height: 100%;

    object-fit: cover;

    background: #111;

    z-index: 4; /* Au-dessus du placeholder pour s'afficher quand la vidéo arrive */
}


/* =========================================================
   PLACEHOLDER VIDEO DISTANTE
========================================================= */

.remote-video-placeholder {
    position: absolute;
    inset: 0;

    z-index: 6; /* Au-dessus de la vidéo mais sous les contrôles */

    display: none; /* Caché par défaut */

    flex-direction: column;

    justify-content: center;
    align-items: center;

    background:
        radial-gradient(
            circle at center,
            #26343d 0%,
            #111b21 45%,
            #05090c 100%
        );

    color: white;
}

.remote-video-placeholder.hidden {
    display: none;
}

/* État incoming : afficher le placeholder (avatar) */
.video-call-container.incoming .remote-video-placeholder {
    display: flex;
}

/* État calling : afficher le placeholder (avatar) */
.video-call-container.calling .remote-video-placeholder {
    display: flex;
}

.video-avatar {
    width: 140px;
    height: 140px;

    border-radius: 50%;

    background: linear-gradient(
        145deg,
        #354650,
        #1f2c33
    );

    display: flex;
    justify-content: center;
    align-items: center;

    box-shadow:
        0 10px 40px rgba(0, 0, 0, .5);
}

.video-avatar span {
    font-size: 60px;
    font-weight: 600;
    color: #d8e0e4;
}

.video-contact-name {
    margin-top: 25px;

    font-size: 22px;
    font-weight: 500;
}

.video-call-status {
    margin-top: 8px;

    color: #aebbc2;
    font-size: 14px;
}


/* =========================================================
   HEADER
========================================================= */

.video-header {
    position: absolute;

    top: 0;
    left: 0;
    right: 0;

    z-index: 15; /* Au-dessus de la vidéo et du placeholder */

    display: flex;
    align-items: center;

    padding: 18px 15px 35px;

    background: linear-gradient(
        to bottom,
        rgba(0, 0, 0, .75),
        transparent
    );
}

/* Overlay transparent pour capturer les clics sur la vidéo */
.video-click-overlay {
    position: absolute;
    inset: 0;
    z-index: 5;
    pointer-events: auto;
}

.video-header-btn {
    width: 42px;
    height: 42px;

    flex: none;

    border: none;
    border-radius: 50%;

    background: rgba(0, 0, 0, .4);

    color: white;

    display: flex;
    align-items: center;
    justify-content: center;

    font-size: 18px;

    cursor: pointer;
}

.video-header-info {
    margin-left: 12px;
}

.video-header-name {
    color: white;

    font-size: 17px;
    font-weight: 600;
}

.video-header-status {
    margin-top: 3px;

    color: #d2d9dd;

    font-size: 12px;
}


/* =========================================================
   MA VIDEO
========================================================= */

.local-video-wrapper {
    position: absolute;

    top: 75px;
    right: 15px;

    width: clamp(110px, 28vw, 180px);
    height: clamp(150px, 35vw, 240px);

    z-index: 20;

    border-radius: 15px;

    overflow: hidden;

    background: #1a242a;

    border: 2px solid rgba(255,255,255,.8);

    box-shadow:
        0 5px 20px rgba(0,0,0,.5);
}

.local-video {
    width: 100%;
    height: 100%;

    object-fit: cover;

    background: #111;
}

.local-video-placeholder {
    position: absolute;

    inset: 0;

    display: none;

    align-items: center;
    justify-content: center;

    background: #26343d;

    color: #d5dde1;

    font-size: 35px;
}

.local-video-placeholder.active {
    display: flex;
}


/* =========================================================
   INFORMATIONS APPEL
========================================================= */

.video-call-info {
    position: absolute;

    top: 125px;
    left: 0;
    right: 0;

    z-index: 5;

    text-align: center;

    pointer-events: none;
}

#video-timer {
    display: inline-block;

    padding: 6px 12px;

    border-radius: 15px;

    background: rgba(0,0,0,.45);

    color: white;

    font-size: 13px;
}


/* =========================================================
   PANNEAU DE CONTROLE
========================================================= */

.video-control-panel {
    position: absolute;

    left: 50%;
    bottom: 20px;

    transform: translateX(-50%);

    z-index: 25; /* Au-dessus de la vidéo et du placeholder */

    width: calc(100% - 25px);

    max-width: 560px;

    padding: 15px 10px;

    border-radius: 28px;

    background: rgba(17,27,33,.92);

    backdrop-filter: blur(12px);

    display: grid;

    grid-template-columns:
        repeat(3, 1fr);

    gap: 15px 8px;

    justify-items: center;

    box-shadow:
        0 10px 35px rgba(0,0,0,.5);
}

.video-control-wrapper {
    display: flex;

    flex-direction: column;

    align-items: center;

    gap: 5px;
}

.video-control-wrapper span {
    color: #c6d0d5;

    font-size: 10px;

    text-align: center;
}

.video-control-btn {
    width: 52px;
    height: 52px;

    border: none;

    border-radius: 50%;

    background: #26343b;

    color: white;

    display: flex;

    align-items: center;
    justify-content: center;

    font-size: 19px;

    cursor: pointer;

    transition:
        transform .15s,
        background-color .2s;
}

.video-control-btn:active {
    transform: scale(.92);
}

.video-control-btn.active {
    background: #00a884;
}

.video-control-btn.disabled {
    background: #59666d;
}

.video-hangup {
    background: #ea0038;
}

.video-hangup:hover {
    background: #ff174f;
}


/* =========================================================
   RÉUNIONS PLANIFIÉES - MEETING UI
========================================================= */

/* Boutons de type de réunion (audio/vidéo) */
.meeting-type-btn {
  flex: 1;
  padding: 16px;
  background: #222d34;
  border: 2px solid transparent;
  border-radius: 12px;
  color: #8696a0;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
}

.meeting-type-btn i {
  font-size: 24px;
}

.meeting-type-btn.active {
  background: rgba(0, 168, 132, 0.15);
  border-color: #00a884;
  color: #00a884;
}

.meeting-type-btn:active {
  transform: scale(0.95);
}

/* Input datetime-local style */
input[type="datetime-local"]::-webkit-calendar-picker-indicator {
  filter: invert(1);
  cursor: pointer;
}

input[type="datetime-local"]::-webkit-calendar-picker-indicator:hover {
  filter: invert(1) brightness(1.2);
}

/* =========================================================
   MODE PAYSAGE
========================================================= */

@media (orientation: landscape) {

    .local-video-wrapper {
        top: 70px;
        right: 18px;

        width: 150px;
        height: 100px;
    }

    .video-control-panel {
        bottom: 10px;

        grid-template-columns:
            repeat(6, 1fr);

        max-width: 650px;

        padding: 10px;
    }

    .video-control-btn {
        width: 48px;
        height: 48px;
    }

    .video-call-info {
        top: 75px;
    }
}


/* =========================================================
   PETITS ECRANS
========================================================= */

@media (max-width: 380px) {

    .local-video-wrapper {
        width: 105px;
        height: 145px;

        top: 70px;
        right: 10px;
    }

    .video-control-panel {
        gap: 10px 4px;
        padding: 12px 6px;
    }

    .video-control-btn {
        width: 46px;
        height: 46px;

        font-size: 17px;
    }

    .video-control-wrapper span {
        font-size: 9px;
    }

    .video-avatar {
        width: 110px;
        height: 110px;
    }

    .video-avatar span {
        font-size: 48px;
    }
}

html, body {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #0b141a;
    color: #ffffff;
}
button, [role="button"] { cursor: pointer; }
.remote-status-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
    margin-top: 6px;
}
.remote-status-badge {
    display: none;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(234, 0, 56, 0.18);
    color: #ff8da3;
    font-size: 11px;
    font-weight: 600;
}
.remote-status-badge.show { display: inline-flex; }

/* =========================================================
   PARTAGE D'ÉCRAN — comportement type WhatsApp
   - Récepteur : l'écran partagé s'affiche en entier (contain) + bandeau « X partage son écran »
   - Émetteur  : plus d'aperçu de sa propre capture, bandeau « Vous partagez votre écran » + Arrêter
========================================================= */
.share-banner {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    top: calc(env(safe-area-inset-top, 0px) + 75px);
    z-index: 30;
    display: none;
    align-items: center;
    gap: 10px;
    max-width: 92%;
    padding: 7px 8px 7px 14px;
    border-radius: 999px;
    background: rgba(17, 27, 33, 0.92);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    box-shadow: 0 4px 16px rgba(0, 0, 0, .45);
}
.share-banner.show { display: flex; }
.share-banner > i { color: #25d366; }
.share-banner .share-banner-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Récepteur 1-à-1 : bandeau à gauche pour ne pas passer sous la miniature locale */
.share-banner.left {
    left: 15px;
    transform: none;
    max-width: calc(100% - clamp(110px, 28vw, 180px) - 45px);
}
.share-banner-btn {
    border: 0;
    border-radius: 999px;
    padding: 7px 14px;
    font-size: 12px;
    font-weight: 700;
    color: #fff;
    background: #ea0038;
    flex-shrink: 0;
}
.share-banner-btn.ghost { background: rgba(255, 255, 255, .18); padding: 7px 10px; }

/* Récepteur 1-à-1 : écran partagé en entier, fond noir */
.video-call-container.remote-sharing .remote-video { object-fit: contain; background: #000; }
.video-call-container.remote-sharing.share-fill .remote-video { object-fit: cover; }
.video-call-container.remote-sharing .js-remote-camera-badge { display: none !important; }
/* Émetteur 1-à-1 : on ne montre pas sa propre capture (effet miroir infini) */
.video-call-container.local-sharing .local-video-wrapper { display: none; }

/* Groupe : bandeau sous l'en-tête + grand cadre en « contain » pour le récepteur */
.group-share-banner {
    display: none;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 8px 14px;
    background: #1f2c34;
    color: #fff;
    font-size: 13px;
    font-weight: 600;
}
.group-share-banner.show { display: flex; }
.group-share-banner > i { color: #25d366; }
.group-grid.screen-share-mode .group-tile:first-child .group-video { object-fit: contain; transform: none; background: #000; }
#call-toast {
    position: fixed;
    left: 50%;
    bottom: 110px;
    transform: translateX(-50%) translateY(12px);
    z-index: 4000;
    padding: 10px 16px;
    border-radius: 999px;
    background: rgba(17, 27, 33, 0.94);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease, transform 0.2s ease;
}
#call-toast.show {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
}
.control-btn.active-mute,
.video-control-btn.active-mute { background-color: #ea0038; }
.control-btn:disabled,
.video-control-btn:disabled { opacity: 0.45; pointer-events: none; }

/* Bouton Audio actif (speaker / bluetooth) — style WhatsApp */
.control-btn.audio-active {
    background-color: #ffffff !important;
    color: #111b21 !important;
}
.control-btn.audio-active i {
    color: #111b21 !important;
}

/* Menu routes audio — style WhatsApp */
.audio-route-menu {
    display: none;
    position: absolute;
    bottom: 100px;
    left: 16px;
    min-width: 200px;
    background: #1f2c34;
    border-radius: 16px;
    padding: 6px;
    z-index: 50;
    box-shadow: 0 8px 24px rgba(0,0,0,0.45);
}
.audio-route-menu.open { display: block; }
.audio-route-item {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 14px;
    color: #fff;
    border-radius: 12px;
    font-size: 15px;
    cursor: pointer;
    transition: background 0.15s;
}
.audio-route-item:active { background: rgba(255,255,255,0.08); }
.audio-route-item i:first-child {
    width: 22px;
    text-align: center;
    font-size: 18px;
    color: #e9edef;
}
.audio-route-item .route-check {
    margin-left: auto;
    color: #00a884;
    font-size: 14px;
}
/* PAS de fond vert sur l'item actif — uniquement la coche (comme WhatsApp) */
.audio-route-item.active { background: transparent; }

/* =========================================================
   APPEL DE GROUPE — STYLES (interface-4)
   Préfixe "group-" : aucun risque de conflit avec le 1-à-1.
   Réutilise .video-control-btn / .video-control-wrapper existants.
========================================================= */

/* ----- Écran plein format (même niveau que l'appel vidéo) ----- */
.group-call-view {
    background: #0b141a;
    padding: 0;
    z-index: 2000;
}

.group-call-container {
    position: relative;
    width: 100%;
    height: 100%;
    max-width: 900px;
    display: flex;
    flex-direction: column;
    background: #0b141a;
    overflow: hidden;
}

/* ----- Zone 1 : en-tête ----- */
.group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 8px;
    color: #fff;
}
.group-title { font-size: 18px; font-weight: 600; }
.group-header-sub { margin-top: 2px; font-size: 13px; color: #aebbc2; }
.group-dot { margin: 0 4px; }
.group-header-btn {
    width: 42px; height: 42px;
    border: none; border-radius: 50%;
    background: #1f2c34; color: #fff;
    font-size: 17px; cursor: pointer;
}
.group-header-btn:active { transform: scale(.92); }

/* ----- Zone 2 : grille adaptative selon le nombre de tuiles -----
   1 = plein écran | 2 = 2 lignes | 3-4 = 2x2 | 5-6 = 2 colonnes x 3 lignes */
.group-grid {
    flex: 1;
    min-height: 0;
    display: grid;
    gap: 6px;
    padding: 6px;
    grid-template-columns: 1fr;
    grid-auto-rows: 1fr;
}
.group-grid.count-2 { grid-template-rows: 1fr 1fr; }
.group-grid.count-3,
.group-grid.count-4 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
.group-grid.count-5,
.group-grid.count-6 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr 1fr; }
/* Tuile impaire en dernière position : occupe toute la largeur */
.group-grid.count-3 .group-tile:last-child,
.group-grid.count-5 .group-tile:last-child { grid-column: span 2; }

/* ----- Mode partage d'écran (style WhatsApp) -----
   Le premier participant (celui qui partage) prend le grand cadre en haut (80%)
   Les autres participants s'affichent en petits carreaux en bas (20%) */
.group-grid.screen-share-mode {
    /* Ligne 1 = tout l'espace restant ; ligne 2 = bande de vignettes à hauteur fixe
       (les pourcentages ne se résolvaient pas : la tuile restait petite et le reste noir) */
    grid-template-rows: minmax(0, 1fr) clamp(96px, 17vh, 150px) !important;
    grid-auto-rows: clamp(96px, 17vh, 150px) !important;
    grid-template-columns: 1fr !important;
    display: grid !important;
}
/* Le partage d'écran occupe TOUTE la largeur de la première ligne (toutes les colonnes) */
.group-grid.screen-share-mode .group-tile:first-child {
    grid-row: 1 !important;
    grid-column: 1 / -1 !important;
    width: 100%;
    height: 100%;
}
/* Les autres participants partagent la deuxième ligne */
.group-grid.screen-share-mode .group-tile:not(:first-child) {
    grid-row: 2 !important;
}
/* Reset des règles de span pour le mode partage d'écran */
.group-grid.screen-share-mode .group-tile:last-child {
    grid-column: auto !important;
}
/* Layout horizontal des participants en bas selon le nombre */
.group-grid.screen-share-mode.count-2 { grid-template-columns: 1fr !important; }
.group-grid.screen-share-mode.count-3 { grid-template-columns: 1fr 1fr !important; }
.group-grid.screen-share-mode.count-4 { grid-template-columns: 1fr 1fr 1fr !important; }
.group-grid.screen-share-mode.count-5 { grid-template-columns: 1fr 1fr 1fr 1fr !important; }
.group-grid.screen-share-mode.count-6 { grid-template-columns: 1fr 1fr 1fr 1fr 1fr !important; }

/* ----- Tuile d'un participant ----- */
.group-tile {
    position: relative;
    min-height: 0;
    overflow: hidden;
    border-radius: 14px;
    background: #1f2c34;
    border: 3px solid transparent;
    transition: border-color .2s, opacity .3s;
}
.group-video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: none;
    background: #000;
}
.group-tile.has-video .group-video { display: block; }
.group-tile.is-self .group-video { transform: scaleX(-1); } /* effet miroir pour soi */

/* Avatar (initiale) quand il n'y a pas de vidéo */
.group-avatar {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
}
.group-avatar::before {
    content: "";
    position: absolute;
    width: 84px; height: 84px;
    border-radius: 50%;
    background: #374248;
}
.group-initial {
    position: relative;
    font-size: 36px;
    font-weight: 600;
    color: #d8e0e4;
}
.group-tile.has-video .group-avatar { display: none; }

/* Texte en bas à gauche : nom + statut */
.group-tile-info {
    position: absolute;
    left: 8px; bottom: 8px; right: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: #fff;
    text-shadow: 0 1px 3px rgba(0,0,0,.7);
}
.group-tile-name { font-size: 13px; font-weight: 600; }
.group-tile-status { font-size: 11px; color: #d0d8dc; }

/* Pastille "micro coupé" en haut à droite */
.group-badge-mute {
    position: absolute;
    top: 8px; right: 8px;
    width: 26px; height: 26px;
    border-radius: 50%;
    background: rgba(17, 27, 33, 0.85);
    color: #fff;
    font-size: 12px;
    display: none;
    align-items: center;
    justify-content: center;
}
.group-tile.is-muted .group-badge-mute { display: flex; }

/* États d'un participant */
.group-tile.is-ringing { opacity: .75; }
.group-tile.is-ringing .group-avatar::before { animation: groupPulse 1.4s ease-in-out infinite; }
.group-tile.is-speaking { border-color: #00a884; } /* orateur actif */
.group-tile.is-screen-sharing { border-color: #25d366; } /* partage d'écran actif */

@keyframes groupPulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.12); }
}

/* ----- Zone 3 : barre de contrôles ----- */
.group-controls {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 8px 22px;
}
/* Les boutons caméra sont maintenant toujours visibles (peut activer caméra même en appel audio) */

/* ----- Zone 4 : feuille d'ajout de participants ----- */
.group-sheet-overlay {
    position: fixed;
    inset: 0;
    display: none;
    align-items: flex-end;
    background: rgba(0, 0, 0, 0.55);
    z-index: 3000; /* au-dessus des écrans d'appel (999 / 2000) */
}
.group-sheet-overlay.show { display: flex; }
.group-sheet {
    width: 100%;
    padding: 18px 16px 24px;
    border-radius: 18px 18px 0 0;
    background: #1f2c34;
    color: #fff;
}
.group-sheet-title { font-size: 16px; font-weight: 600; margin-bottom: 12px; }
.group-sheet-row { display: flex; gap: 8px; }
.group-sheet-row input {
    flex: 1;
    min-width: 0;
    padding: 12px;
    border: none;
    border-radius: 10px;
    background: #2a3942;
    color: #fff;
    font-size: 15px;
}
.group-sheet-plus {
    width: 46px;
    border: none;
    border-radius: 10px;
    background: #00a884;
    color: #fff;
    font-size: 16px;
}
.group-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.group-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 999px;
    background: #2a3942;
    font-size: 13px;
}
.group-chip button { border: none; background: none; color: #aebbc2; font-size: 14px; }
.group-sheet-hint { min-height: 18px; margin-top: 8px; font-size: 12px; color: #f2b84b; }
.group-sheet-actions { display: flex; gap: 10px; margin-top: 8px; }
.group-sheet-cancel,
.group-sheet-confirm {
    flex: 1;
    padding: 12px;
    border: none;
    border-radius: 10px;
    font-size: 15px;
    font-weight: 600;
}
.group-sheet-cancel { background: #2a3942; color: #fff; }
.group-sheet-confirm { background: #00a884; color: #fff; }

/* Bouton Like flottant sur l'écran (style TikTok) */
.group-float-like {
  position: absolute;
  bottom: 120px;
  right: 20px;
  width: 60px;
  height: 60px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  color: #fff;
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.2s, background 0.2s;
  z-index: 50;
}
.group-float-like:active {
  transform: scale(0.9);
}
.group-float-like.liked {
  background: #ea0038;
}
`;
  }

  static get HTML() {
    return `<div class="container" id="call-manager-root">
  <audio id="remoteAudio" autoplay playsinline webkit-playsinline></audio>
  <audio id="remote-audio" autoplay playsinline webkit-playsinline></audio>
  <div id="call-toast"></div>

  <button id="log-toggle-btn" type="button" onclick="toggleScreenLog()" aria-label="Logs">🐞</button>
  <div id="log-debug-box"></div>

  <div id="interface-1" class="view-container">
    <div class="app-container">
      <div class="header">
        <button class="icon-btn-top" type="button" onclick="closeInterface()" aria-label="Retour">
          <i class="fa-solid fa-arrow-left"></i>
        </button>
        <div class="contact-info">
          <span class="contact-name js-contact-name">GHOMSI</span>
          <div class="status-bar">Hors ligne</div>
          <div class="remote-status-badge js-remote-mute-badge">
            <i class="fa-solid fa-microphone-slash"></i> Micro coupé
          </div>
        </div>
        <button class="icon-btn-top" type="button" onclick="openGroupAddSheet()" aria-label="Ajouter un participant">
          <i class="fa-solid fa-user-plus"></i>
        </button>
      </div>
      <div class="center" id="timer">00:00:00</div>
      <div class="center-avatar">
        <div class="avatar-container">
          <span class="js-contact-initial" style="font-size: 80px; color: #8696a0; font-weight: 600">G</span>
        </div>
      </div>
      <div class="control-panel">
        <div class="btn-wrapper">
          <button class="control-btn" type="button" id="btn-audio-route" onclick="toggleAudioRouteMenu()">
            <i class="fa-brands fa-bluetooth-b" id="audio-route-icon"></i>
          </button>
          <span class="btn-label">Audio</span>
        </div>
        <div class="btn-wrapper">
          <button class="control-btn" type="button" onclick="upgradeToVideo()">
            <i class="fa-solid fa-video"></i>
          </button>
          <span class="btn-label">Vidéo</span>
        </div>
        <div class="btn-wrapper">
          <button class="control-btn js-mic-btn" type="button" onclick="toggleMicrophone()" aria-label="Micro">
            <i class="fa-solid fa-microphone js-mic-icon"></i>
          </button>
          <span class="btn-label js-mic-label">Désactiver le micro</span>
        </div>
        <div class="btn-wrapper">
          <button class="control-btn" type="button" id="btn-screen-share-audio" onclick="toggleScreenShare()">
            <i class="fa-solid fa-desktop" id="screen-share-icon-audio"></i>
          </button>
          <span class="btn-label" id="screen-share-label-audio">Écran</span>
        </div>
        <div class="btn-wrapper">
          <button class="control-btn" type="button">
            <i class="fa-solid fa-ellipsis"></i>
          </button>
          <span class="btn-label">Plus</span>
        </div>
        <div class="btn-wrapper">
          <button class="control-btn" type="button">
            <i class="fa-solid fa-arrow-up-from-bracket"></i>
          </button>
          <span class="btn-label">Partager</span>
        </div>
        <div class="btn-wrapper">
          <button class="control-btn hangup" type="button" onclick="hangUp()">
            <i class="fa-solid fa-phone-slash"></i>
          </button>
          <span class="btn-label">Terminer</span>
        </div>
      </div>
      <div id="audio-route-menu" class="audio-route-menu"></div>
    </div>
  </div>

  <div id="interface-2" class="view-container">
    <div class="app-container">
      <div class="header" style="justify-content: center">
        <div class="contact-info">
          <span class="contact-name js-contact-name">GHOMSI</span>
          <div class="status-bar">Hors ligne</div>
        </div>
      </div>
      <div class="center-avatar">
        <div class="avatar-container">
          <span class="js-contact-initial" style="font-size: 80px; color: #8696a0; font-weight: 600">G</span>
        </div>
      </div>
      <div class="incoming-actions">
        <div class="incoming-btn-wrapper">
          <button class="incoming-btn refuse" type="button" onclick="rejectCall()">
            <i class="fa-solid fa-phone-slash"></i>
          </button>
          <span class="incoming-label">Refuser</span>
        </div>
        <div class="incoming-btn-wrapper">
          <div class="swipe-arrows">
            <i class="fa-solid fa-chevron-up"></i>
            <i class="fa-solid fa-chevron-up"></i>
            <i class="fa-solid fa-chevron-up"></i>
          </div>
          <button class="incoming-btn accept" type="button" id="swipeAcceptBtn">
            <i class="fa-solid fa-phone"></i>
          </button>
          <span class="incoming-label">Balayer vers le haut pour accepter</span>
        </div>
        <div class="incoming-btn-wrapper">
          <button class="incoming-btn message" type="button">
            <i class="fa-solid fa-message"></i>
          </button>
          <span class="incoming-label">Message</span>
        </div>
      </div>
    </div>
  </div>

  <div id="interface-3" class="view-container video-call-view">
    <div class="video-call-container">
      <video id="remote-video" class="remote-video" autoplay playsinline webkit-playsinline muted disablePictureInPicture disableRemotePlayback controlsList="nofullscreen nodownload noremoteplayback noplaybackrate"></video>
      <div class="remote-video-placeholder">
        <div class="video-avatar">
          <span class="js-contact-initial">G</span>
        </div>
        <div class="video-contact-name js-contact-name">GHOMSI</div>
        <div class="video-call-status status-bar">Appel vidéo...</div>
      </div>
      <div class="video-click-overlay"></div>
      <!-- Partage d'écran : bandeau côté récepteur (mode plein écran/ajusté) et côté émetteur -->
      <div id="remote-share-banner" class="share-banner left">
        <i class="fa-solid fa-desktop"></i>
        <span class="share-banner-text js-remote-share-text">Partage d'écran</span>
        <button class="share-banner-btn ghost" type="button" onclick="toggleShareFit()" aria-label="Agrandir / ajuster l'écran partagé">
          <i class="fa-solid fa-expand" id="share-fit-icon"></i>
        </button>
      </div>
      <div id="local-share-banner" class="share-banner">
        <i class="fa-solid fa-desktop"></i>
        <span class="share-banner-text">Vous partagez votre écran</span>
        <button class="share-banner-btn" type="button" onclick="toggleScreenShare()">Arrêter</button>
      </div>
      <div class="video-header">
        <div class="video-header-info">
          <div class="video-header-name js-contact-name">GHOMSI</div>
          <div class="video-header-status status-bar">Connexion...</div>
          <div class="remote-status-row">
            <span class="remote-status-badge js-remote-mute-badge"><i class="fa-solid fa-microphone-slash"></i> Micro coupé</span>
            <span class="remote-status-badge js-remote-camera-badge"><i class="fa-solid fa-video-slash"></i> Caméra coupée</span>
          </div>
        </div>
        <!-- Ajouter un participant : transforme l'appel 1-à-1 en appel de groupe -->
        <button class="video-header-btn" type="button" style="margin-left:auto" onclick="openGroupAddSheet()" aria-label="Ajouter un participant">
          <i class="fa-solid fa-user-plus"></i>
        </button>
      </div>
      <div class="video-call-info">
        <span id="timer-video">00:00:00</span>
      </div>
      <div class="local-video-wrapper">
        <video id="local-video" class="local-video" autoplay playsinline webkit-playsinline muted disablePictureInPicture disableRemotePlayback controlsList="nofullscreen nodownload noremoteplayback noplaybackrate"></video>
        <div id="local-video-placeholder" class="local-video-placeholder">
          <i class="fa-solid fa-video-slash"></i>
        </div>
      </div>
      <!-- Boutons Accepter/Refuser pour état incoming -->
      <div class="video-incoming-actions">
        <button class="video-incoming-btn refuse" type="button" onclick="rejectCall()">
          <i class="fa-solid fa-phone-slash"></i>
        </button>
        <button class="video-incoming-btn accept" type="button" onclick="acceptCall()">
          <i class="fa-solid fa-phone"></i>
        </button>
      </div>
      <!-- Bouton toggle caméra pour état incoming -->
      <div class="video-incoming-camera-toggle">
        <button id="btn-incoming-camera-toggle" type="button" onclick="toggleIncomingCamera()">
          <i class="fa-solid fa-video" id="incoming-camera-icon"></i>
          <span id="incoming-camera-text">Désactiver votre vidéo</span>
        </button>
      </div>
      <div class="video-control-panel">
        <div class="video-control-wrapper">
          <button class="video-control-btn" type="button" id="btn-toggle-camera" onclick="toggleCamera()">
            <i class="fa-solid fa-video" id="camera-icon"></i>
          </button>
          <span>Caméra</span>
        </div>
        <div class="video-control-wrapper">
          <button class="video-control-btn" type="button" id="btn-switch-camera" onclick="switchCamera()" aria-label="Changer de caméra">
            <i class="fa-solid fa-camera-rotate"></i>
          </button>
          <span>Retourner</span>
        </div>
        <div class="video-control-wrapper">
          <button class="video-control-btn" type="button" id="btn-toggle-speaker" onclick="toggleSpeaker()">
            <i class="fa-solid fa-volume-high" id="speaker-icon"></i>
          </button>
          <span>Haut-parleur</span>
        </div>
        <div class="video-control-wrapper">
          <button class="video-control-btn js-mic-btn" type="button" id="btn-toggle-mic" onclick="toggleMicrophone()" aria-label="Micro">
            <i class="fa-solid fa-microphone js-mic-icon"></i>
          </button>
          <span class="js-mic-label" data-label-on="Micro" data-label-muted="Muet">Micro</span>
        </div>
        <div class="video-control-wrapper">
          <button class="video-control-btn btn-like" type="button" id="btn-like" onclick="sendVideoLike()" aria-label="Like">
            <i class="fa-solid fa-heart"></i>
          </button>
          <span>Like</span>
        </div>
        <div class="video-control-wrapper">
          <button class="video-control-btn" type="button" id="btn-screen-share" onclick="toggleScreenShare()">
            <i class="fa-solid fa-desktop" id="screen-share-icon"></i>
          </button>
          <span id="screen-share-label">Écran</span>
        </div>
        <div class="video-control-wrapper">
          <button class="video-control-btn video-hangup" type="button" onclick="hangUp(true)">
            <i class="fa-solid fa-phone-slash"></i>
          </button>
          <span>Terminer</span>
        </div>
      </div>
    </div>
  </div>

  <!-- =========================================================
       APPEL DE GROUPE — ÉCRAN PRINCIPAL (interface-4)
       Style WhatsApp : en-tête, grille de tuiles, barre de contrôles.
       - La grille #group-grid est remplie par renderGroupGrid() (JS).
       - data-video="true|false" sert à masquer les boutons caméra
         (classe .group-only-video) quand l'appel est audio seulement.
       - Les ids/classes sont préfixés "group-" pour ne JAMAIS entrer en
         conflit avec les écrans 1-à-1 (interface-1/2/3).
       ========================================================= -->
  <div id="interface-4" class="view-container group-call-view" data-video="false">
    <div class="group-call-container">

      <!-- ===== ZONE 1 : EN-TÊTE (titre, statut, chrono, bouton Ajouter) ===== -->
      <div class="group-header">
        <div class="group-header-info">
          <div id="group-title" class="group-title">Appel de groupe</div>
          <div class="group-header-sub">
            <span id="group-status" class="group-status">Connexion...</span>
            <span class="group-dot">·</span>
            <span id="timer-group">00:00:00</span>
          </div>
        </div>
        <!-- Ouvre la feuille "Ajouter des participants" -->
        <button class="group-header-btn" type="button" onclick="openGroupAddSheet()" aria-label="Ajouter un participant">
          <i class="fa-solid fa-user-plus"></i>
        </button>
      </div>

      <!-- Bandeau de partage d'écran (rempli par applyScreenShareUI) -->
      <div id="group-share-banner" class="group-share-banner">
        <i class="fa-solid fa-desktop"></i>
        <span id="group-share-text">Partage d'écran</span>
        <button id="group-share-stop" class="share-banner-btn" type="button" onclick="toggleScreenShare()" style="display:none">Arrêter</button>
      </div>

      <!-- ===== ZONE 2 : GRILLE DES PARTICIPANTS (tuiles créées en JS) ===== -->
      <div id="group-grid" class="group-grid count-1"></div>

      <!-- Conteneur invisible : un <audio> par participant distant (le son
           passe par ces éléments, les <video> des tuiles restent muets) -->
      <div id="group-audio-container" style="display:none"></div>

      <!-- ===== ZONE 3 : BARRE DE CONTRÔLES ===== -->
      <div class="group-controls">
        <div class="video-control-wrapper">
          <button class="video-control-btn js-group-speaker-btn" type="button" onclick="toggleGroupSpeaker()" aria-label="Haut-parleur">
            <i class="fa-solid fa-volume-high js-group-speaker-icon"></i>
          </button>
          <span>Haut-parleur</span>
        </div>
        <div class="video-control-wrapper">
          <button class="video-control-btn js-group-cam-btn" type="button" onclick="toggleGroupCamera()" aria-label="Caméra">
            <i class="fa-solid fa-video js-group-cam-icon"></i>
          </button>
          <span>Caméra</span>
        </div>
        <div class="video-control-wrapper">
          <button class="video-control-btn" type="button" onclick="switchGroupCamera()" aria-label="Changer de caméra">
            <i class="fa-solid fa-camera-rotate"></i>
          </button>
          <span>Retourner</span>
        </div>
        <div class="video-control-wrapper">
          <button class="video-control-btn js-group-screen-btn" id="btn-screen-share-group" type="button" onclick="toggleScreenShare()" aria-label="Partager l'écran">
            <i class="fa-solid fa-desktop"></i>
          </button>
          <span>Écran</span>
        </div>
        <div class="video-control-wrapper">
          <button class="video-control-btn js-group-mic-btn" type="button" onclick="toggleGroupMic()" aria-label="Micro">
            <i class="fa-solid fa-microphone js-group-mic-icon"></i>
          </button>
          <span>Micro</span>
        </div>
        <div class="video-control-wrapper">
          <button class="video-control-btn video-hangup" type="button" onclick="leaveGroupCall()" aria-label="Quitter l'appel">
            <i class="fa-solid fa-phone-slash"></i>
          </button>
          <span>Quitter</span>
        </div>
      </div>

      <!-- Bouton Like flottant sur l'écran (style TikTok) -->
      <button class="group-float-like" type="button" id="btn-group-like" onclick="sendGroupLike()" aria-label="Like">
        <i class="fa-solid fa-heart"></i>
      </button>
      </div>

    </div>
  </div>

  <!-- ===== ZONE 4 : FEUILLE "AJOUTER DES PARTICIPANTS" =====
       (n'est PAS un .view-container : showInterface() ne la masque pas) -->
  <div id="group-add-sheet" class="group-sheet-overlay" onclick="if (event.target === this) closeGroupAddSheet()">
    <div class="group-sheet">
      <div class="group-sheet-title">Ajouter des participants</div>
      <div class="group-sheet-row">
        <input id="group-add-input" type="text" placeholder="ID du contact (ex: ID-482910)" autocomplete="off" autocapitalize="off" autocorrect="off" />
        <button class="group-sheet-plus" type="button" onclick="addGroupInviteeFromInput()" aria-label="Ajouter à la liste">
          <i class="fa-solid fa-plus"></i>
        </button>
      </div>
      <div id="group-chips" class="group-chips"></div>
      <div id="group-sheet-hint" class="group-sheet-hint"></div>
      <div class="group-sheet-actions">
        <button class="group-sheet-cancel" type="button" onclick="closeGroupAddSheet()">Annuler</button>
        <button class="group-sheet-confirm" type="button" onclick="confirmGroupAdd()">Appeler</button>
      </div>
    </div>
  </div>
</div>`;
  }

  constructor() {
    this.myId = null;
    this.authToken = null; // Token d'authentification pour register-user
    this.targetUserId = null;
    // Référence de connexion cordova-plugin-advanced-websocket (remplace
    // l'ancien objet natif WebSocket de cordova-plugin-websocket). Le plugin
    // n'exposant pas de .readyState, on le suit nous-mêmes dans wsReadyState
    // en réutilisant les constantes standard WebSocket.OPEN/CONNECTING/CLOSED
    // (toujours disponibles nativement dans la WebView, indépendamment du plugin).
    this.wsId = null;
    this.ws = null; // WebSocket natif pour le navigateur (fallback)
    this.wsReadyState = WebSocket.CLOSED;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.manuallyClosed = false;
    this.deviceToken = null;
    this.voipToken = null;
    this.push = null;
    this.peerConnection = null;
    this.localStream = null;
    this.pendingCandidates = [];
    this.pendingOffer = null;
    this.currentCallId = null;
    this.currentNotId = null;
    this.autoAcceptOnOffer = false;
    this.activeRTC = null;
    this.isMuted = false;
    this.isRestartingIce = false;
    this.timerInterval = null;
    this.vibrationTimer = null;
    this.isVibrating = false;
    this.isVideoCall = false;
    this.isCameraOff = false;
    this.isFrontCamera = true;
    this.isSwitchingCamera = false;
    this.isSpeakerOn = false; // Par défaut: écouteur (comme WhatsApp)
    this.isRenegotiating = false;
    this.appReady = false;
    this.pendingNativeCall = null;
    this.callToastTimer = null;
    this.currentAudioRoute = "earpiece";
    this.isScreenSharing = false;
    this.screenStream = null;
    this._cameraTrackBackup = null;
      // Swap PiP : sources stables (évite mélange caméra locale / remote)
    this.remoteStreamRef = null;   // MediaStream distant reçu via ontrack
    this.videosSwapped = false;    // true si PiP a échangé local/remote
    this.wasSwappedBeforeShare = false; // swap mémorisé pendant screen share
    this._groupScreenTrack = null;
    this._groupScreenBackups = new Map();
    this._pendingCameraRestore = false; // caméra à remettre au prochain « resume »
    this.remoteScreenSharing = false; // l'interlocuteur (1-à-1) partage son écran
    this.shareFillMode = false;       // récepteur : false = écran entier (contain), true = remplir (cover)

    this.mountUI();
    this.interfaceReceiver = document.getElementById("interface-2");
    this.interfaceSender = document.getElementById("interface-1");
    this.interfaceVideo = document.getElementById("interface-3");

    document.addEventListener("deviceready", this.onDeviceReady, false);

    // Écouter les deep links (Android & iOS)
    document.addEventListener("deviceready", () => {
      this.setupDeepLinkListeners();
    }, false);

    // Écran noir au retour au premier plan (écran verrouillé/déverrouillé pendant un appel) :
    // le WebView Android peut garder une frame vidéo figée (surface matérielle) tant qu'aucun
    // repaint n'est forcé après une pause. On force ce repaint + on relance la lecture des
    // <video> dès la reprise de l'app.
    document.addEventListener("resume", this.onAppResume, false);

    // iOS : initialisation spécifique (iosrtc)
    document.addEventListener(
      "deviceready",
      () => {
        // iOS: Configuration iosrtc
        if (this.isIOS() && cordova.plugins && cordova.plugins.iosrtc) {
          cordova.plugins.iosrtc.registerGlobals();
          console.log("✅ [iOS] iosrtc activé - WebRTC natif iOS");
        } else if (this.isIOS()) {
          console.error("❌ [iOS] iosrtc non disponible");
        }
      },
      false,
    );

    // Active le glisser-déposer de la mini-vidéo locale (appel vidéo)
    this.setupDraggableVideo();
  }

  /* =========================================================
     HTML + CSS : montés par la classe
  ========================================================= */

  mountUI = () => {
    this.ensureFontAwesome();
    this.injectStyles();
    this.injectMarkup();
    this.bindIncomingSwipe();
  };

  ensureFontAwesome = () => {
    if (document.getElementById("call-manager-fa")) return;
    const link = document.createElement("link");
    link.id = "call-manager-fa";
    link.rel = "stylesheet";
    link.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css";
    document.head.appendChild(link);
  };

  injectStyles = () => {
    if (document.getElementById("call-manager-styles")) return;
    const style = document.createElement("style");
    style.id = "call-manager-styles";
    style.textContent = CallManager.CSS;
    document.head.appendChild(style);
  };

  injectMarkup = () => {
    if (document.getElementById("call-manager-root") || document.getElementById("interface-2")) {
      if (!document.getElementById("call-toast")) {
        const toast = document.createElement("div");
        toast.id = "call-toast";
        document.body.appendChild(toast);
      }
      // S'assurer que interface-3 existe même si le HTML complet n'est pas réinjecté
      if (!document.getElementById("interface-3")) {
        console.log("⚠️ interface-3 manquant, réinjection partielle...");
        const host = document.createElement("div");
        host.innerHTML = CallManager.HTML;
        const interface3 = host.querySelector("#interface-3");
        if (interface3) {
          document.body.appendChild(interface3);
        }
      }
      this.injectLogPanel();
      return;
    }
    const host = document.createElement("div");
    host.innerHTML = CallManager.HTML;
    document.body.appendChild(host.firstElementChild);
    this.injectLogPanel();
  };

  // Ajoute le bouton 🐞 + le panneau de logs indépendamment du reste du
  // markup (utile si l'HTML de la page est statique et que injectMarkup
  // s'arrête plus haut avant d'insérer CallManager.HTML).
  injectLogPanel = () => {
    if (!document.getElementById("log-toggle-btn")) {
      const btn = document.createElement("button");
      btn.id = "log-toggle-btn";
      btn.type = "button";
      btn.setAttribute("aria-label", "Logs");
      btn.textContent = "🐞";
      btn.onclick = () => this.toggleScreenLog();
      document.body.appendChild(btn);
    }
    if (!document.getElementById("log-debug-box")) {
      const box = document.createElement("div");
      box.id = "log-debug-box";
      document.body.appendChild(box);
    }
    this.setupConsoleCapture();
  };

  setContactName = (name) => {
    const label = name || "GHOMSI";
    document.querySelectorAll(".js-contact-name").forEach((el) => {
      el.textContent = label;
    });
    const initial = label.trim().charAt(0).toUpperCase() || "J";
    document.querySelectorAll(".js-contact-initial").forEach((el) => {
      el.textContent = initial;
    });
  };

  bindIncomingSwipe = () => {
    const acceptBtn = document.getElementById("swipeAcceptBtn");
    if (!acceptBtn || acceptBtn.dataset.swipeBound === "1") return;
    acceptBtn.dataset.swipeBound = "1";

    // Animation visuelle uniquement (swipe) — une seule porte d'entrée réelle :
    // le click. Sur WebView Android, un touchend synthétise souvent un click
    // juste après ; si endDrag appelait aussi acceptCall(), on décrochait 2x
    // → 2e answer-call → setRemoteDescription échoue côté appelant → hangUp.
    let startY = 0;
    let currentY = 0;
    let isDragging = false;
    const threshold = -80;

    const startDrag = (y) => {
      isDragging = true;
      startY = y;
      acceptBtn.style.transition = "none";
    };
    const moveDrag = (y) => {
      if (!isDragging) return;
      currentY = y - startY;
      if (currentY > 10) currentY = 10;
      if (currentY < -150) currentY = -150;
      acceptBtn.style.transform = "translateY(" + currentY + "px)";
    };
    const endDrag = () => {
      if (!isDragging) return;
      isDragging = false;
      acceptBtn.style.transition = "transform 0.3s ease";
      acceptBtn.style.transform = "translateY(0px)";
      // Si le seuil est atteint, on déclenche un click programmatique unique
      // (évite le double acceptCall swipe + click synthétique).
      if (currentY <= threshold) {
        acceptBtn.click();
      }
      currentY = 0;
    };

    acceptBtn.addEventListener("touchstart", (e) => startDrag(e.touches[0].clientY), { passive: true });
    window.addEventListener("touchmove", (e) => { if (isDragging) moveDrag(e.touches[0].clientY); }, { passive: true });
    window.addEventListener("touchend", endDrag);
    // Pas de listeners mouse : inutiles sur mobile et source de doublons.

    acceptBtn.addEventListener("click", (e) => {
      e.preventDefault();
      this.acceptCall();
    });
  };


  getPlatform = () => {
    if (!window.cordova) return "web";
    return cordova.platformId || "web";
  };

  isIOS = () => {
    return this.getPlatform() === "ios";
  };

  isAndroid = () => {
    return this.getPlatform() === "android";
  };

  /* =========================================================
   INITIALISATION ET AUTORISATIONS
========================================================= */

  onDeviceReady = async () => {
    console.log("🚀 Initialisation de l'application WebRTC...");
    console.log("📱 Plateforme détectée:", this.getPlatform());
    console.log("🔍 isIOS():", this.isIOS());
    console.log("🔍 isAndroid():", this.isAndroid());

    try {
      // Permissions communes
      await this.requestMicrophonePermission();
      await this.requestCameraPermission();

      // Permissions spécifiques Android
      if (this.isAndroid()) {
        await this.requestBluetoothPermission();
        await this.requestNotificationPermission();
  // ⬇️ AJOUTE CETTE LIGNE ICI

        this.startAudioRouteListening();
      }

      // Permissions spécifiques iOS
      if (this.isIOS()) {
        await this.ensureMediaAuthorizedIOS();
      }

      // Identifiant local + push (comme index1.js). Sur certaines builds Cordova
      // l'ID / le token peuvent être fournis par le native — on initialise quand même
      // si myId n'est pas déjà défini.
      if (!this.myId) this.initializeUserId();
      this.initPushNotifications();

      const idElement = document.getElementById("my-id-display");
      if (idElement) idElement.innerText = this.myId;

      await this.connectWebSocket();

      // Gestion des deep links pour les réunions
      this.handleDeepLinks();

      this.appReady = true;
      if (this.pendingNativeCall) {
        const call = this.pendingNativeCall;
        this.pendingNativeCall = null;
        this.processIncomingCall(
          call.callId,
          call.from,
          call.isVideo,
          call.autoAnswer,
        );
      }
    } catch (error) {
      console.error("❌ Erreur au démarrage :", error);
      this.updateStatus("Erreur d'initialisation");
    }
  };

  // Appelé à chaque retour au premier plan (déverrouillage de l'écran, retour depuis une
  // autre app...). Corrige le "écran noir au raccrochage quand l'écran était éteint" : sans
  // repaint forcé, le WebView Android peut rester figé sur la dernière frame vidéo (surface
  // matérielle) même après que le DOM a été correctement nettoyé côté JS.
  onAppResume = () => {
    console.log("🔄 onAppResume() — repaint forcé du WebView");

    // Partage arrêté pendant que l'app était en arrière-plan (ex. bouton « Arrêter » de la notification) :
    // la caméra n'avait pas pu être rouverte, on la remet maintenant que l'app est au premier plan.
    if (this._pendingCameraRestore) {
      this._pendingCameraRestore = false;
      setTimeout(() => {
        this._restoreCameraAfterShare().then((ok) => {
          if (!ok) this._pendingCameraRestore = true;
        });
      }, 300);
    }

    // 1) Relancer la lecture des <video> encore actives (cas : appel toujours en cours)
    ["local-video", "remote-video"].forEach((id) => {
      const v = document.getElementById(id);
      if (v && v.srcObject) {
        v.play().catch((e) => console.warn("⚠️ re-play vidéo au resume :", e));
      }
    });

    // 2) Forcer un reflow/repaint complet (contourne la frame figée noire)
    requestAnimationFrame(() => {
      document.body.style.display = "none";
      // Lire une propriété layout force le navigateur à appliquer le changement
      // avant de le défaire — sans ce "void", le double changement de style
      // pourrait être fusionné/ignoré par le moteur de rendu.
      void document.body.offsetHeight;
      document.body.style.display = "";
    });

    // 3) Le reset du hardware layer côté natif (MainActivity.onResume()) se déclenche
    // automatiquement via le cycle de vie de l'Activity Android — rien à appeler ici.
  };

  // Gestion des deep links pour les réunions
  handleDeepLinks = () => {
    console.log("🔗 Vérification des deep links...");

    // Vérifier l'URL courante pour les deep links HTTP
    const url = new URL(window.location.href);
    const pathParts = url.pathname.split('/').filter(part => part);

    // Format: /join/ABC-123-XYZ
    if (pathParts[0] === 'join' && pathParts[1]) {
      const code = pathParts[1];
      console.log("🔗 Deep link détecté pour rejoindre une réunion:", code);

      // Attendre que l'app soit prête avant d'ouvrir l'écran
      setTimeout(() => {
        if (window.callManager && window.callManager.showMeetingJoinView) {
          window.callManager.showMeetingJoinView(code);
        }
      }, 1000);
    }
  };

  // Configuration des écouteurs de deep links (Android & iOS)
  setupDeepLinkListeners = () => {
    console.log("🔗 Configuration des écouteurs de deep links...");

    // Plugin customurlscheme pour Android & iOS
    if (window.cordova && window.cordova.plugins && window.cordova.plugins.customurlscheme) {
      console.log("🔗 Plugin customurlscheme détecté");

      // Écouter les deep links quand l'app est ouverte
      window.cordova.plugins.customurlscheme.onNewIntent(
        (url) => {
          console.log("🔗 Deep link reçu (onNewIntent):", url);
          this.processDeepLink(url);
        },
        (error) => {
          console.error("❌ Erreur onNewIntent:", error);
        }
      );

      // Vérifier si l'app a été ouverte via un deep link
      window.cordova.plugins.customurlscheme.getIntent(
        (url) => {
          if (url) {
            console.log("🔗 Deep link initial (getIntent):", url);
            this.processDeepLink(url);
          }
        },
        (error) => {
          console.log("🔗 Pas de deep link initial:", error);
        }
      );
    }

    // Fallback: handleOpenURL (ancienne méthode)
    if (window.handleOpenURL) {
      console.log("🔗 handleOpenURL détecté (fallback)");
      window.handleOpenURL = (url) => {
        console.log("🔗 handleOpenURL appelé avec:", url);
        this.processDeepLink(url);
      };
    }
  };

  // Traiter un deep link
  processDeepLink = (url) => {
    console.log("🔗 Traitement du deep link:", url);

    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(part => part);

      // Format: callapp://join/ABC-123-XYZ ou https://app-appel.onrender.com/join/ABC-123-XYZ
      if (pathParts[0] === 'join' && pathParts[1]) {
        const code = pathParts[1];
        console.log("🔗 Code de réunion extrait:", code);

        // Attendre que l'app soit prête
        setTimeout(() => {
          if (window.callManager && window.callManager.showMeetingJoinView) {
            window.callManager.showMeetingJoinView(code);
          }
        }, 500);
      }
    } catch (error) {
      console.error("❌ Erreur traitement deep link:", error);
    }
  };

  // Permissions Android
  requestCameraPermission = () => {
    return new Promise((resolve) => {
      if (window.cordova && cordova.plugins && cordova.plugins.permissions) {
        const permissions = cordova.plugins.permissions;
        permissions.requestPermission(
          permissions.CAMERA,
          (status) => resolve(!!status?.hasPermission),
          () => resolve(false),
        );
      } else {
        resolve();
      }
    });
  };

  requestNotificationPermission = () => {
    return new Promise((resolve) => {
      if (window.cordova && cordova.plugins && cordova.plugins.permissions) {
        const permissions = cordova.plugins.permissions;
        const perm =
          permissions.POST_NOTIFICATIONS ||
          "android.permission.POST_NOTIFICATIONS";
        permissions.requestPermission(
          perm,
          () => resolve(),
          () => resolve(),
        );
      } else {
        resolve();
      }
    });
  };

  requestMicrophonePermission = () => {
    return new Promise((resolve) => {
      if (window.cordova && cordova.plugins && cordova.plugins.permissions) {
        const permissions = cordova.plugins.permissions;
        permissions.requestPermission(
          permissions.RECORD_AUDIO,
          (status) => resolve(!!status?.hasPermission),
          () => resolve(false),
        );
      } else {
        resolve();
      }
    });
  };

  requestBluetoothPermission = () => {
    return new Promise((resolve) => {
      if (window.cordova && cordova.plugins && cordova.plugins.permissions) {
        const permissions = cordova.plugins.permissions;
        const perm =
          permissions.BLUETOOTH_CONNECT ||
          "android.permission.BLUETOOTH_CONNECT";
        permissions.requestPermission(
          perm,
          () => resolve(),
          () => resolve(),
        );
      } else {
        resolve();
      }
    });
  };

  // Permissions iOS spécifiques
  waitForAppActive = () => {
    return new Promise((resolve) => {
      if (document.visibilityState === "visible" && !document.hidden) {
        resolve();
        return;
      }

      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        document.removeEventListener("visibilitychange", onVisibilityChange);
        document.removeEventListener("resume", finish);
        resolve();
      };
      const onVisibilityChange = () => {
        if (document.visibilityState === "visible") finish();
      };

      document.addEventListener("visibilitychange", onVisibilityChange);
      document.addEventListener("resume", finish, false);
      setTimeout(finish, 3000);
    });
  };

  ensureMediaAuthorizedIOS = () => {
    if (
      !this.isIOS() ||
      !(window.cordova && cordova.plugins && cordova.plugins.diagnostic)
    ) {
      return Promise.resolve();
    }
    const diagnostic = cordova.plugins.diagnostic;

    function ensureAuthorized(getStatus, requestAuth, label) {
      return new Promise((resolve) => {
        getStatus(
          async (status) => {
            console.log(`🔎 [iOS] Statut ${label} :`, status);

            if (status !== diagnostic.permissionStatus.NOT_REQUESTED) {
              resolve();
              return;
            }

            console.log(
              `⏳ [iOS] ${label} jamais demandé, attente du premier plan...`,
            );
            await this.waitForAppActive();

            requestAuth(
              (newStatus) => {
                console.log(`✅ [iOS] ${label} ->`, newStatus);
                resolve();
              },
              (error) => {
                console.warn(`⚠️ [iOS] Erreur demande ${label} :`, error);
                resolve();
              },
            );
          },
          (error) => {
            console.warn(`⚠️ [iOS] Erreur lecture statut ${label} :`, error);
            resolve();
          },
        );
      });
    }

    return Promise.all([
      ensureAuthorized(
        diagnostic.getMicrophoneAuthorizationStatus,
        diagnostic.requestMicrophoneAuthorization,
        "microphone",
      ),
      ensureAuthorized(
        diagnostic.getCameraAuthorizationStatus,
        diagnostic.requestCameraAuthorization,
        "caméra",
      ),
    ]);
  };

  initializeUserId = () => {
    this.myId = localStorage.getItem("app_user_id");
    if (!this.myId) {
      this.myId = "ID-" + Math.floor(100000 + Math.random() * 900000);
      localStorage.setItem("app_user_id", this.myId);
    }
    
    // Charger le token d'authentification existant
    this.authToken = localStorage.getItem("app_auth_token");
    
    console.log("👤 Mon ID local :", this.myId);
    console.log("🔐 Token d'authentification :", this.authToken ? "existant" : "aucun");
  };

  /* =========================================================
   GESTION PUSH NOTIFICATIONS
========================================================= */

  initPushNotifications = () => {
    if (window.cordova?.platformId === "browser" || typeof PushNotification === "undefined") {
      console.debug("🔔 PushNotification ignoré (plateforme browser ou plugin absent)");
      return;
    }
    console.log("🔔 ===== INITIALISATION PUSH =====");

    try {
      this.push = PushNotification.init({
        android: {
          channelDescription: "Notifications d'appels",
          forceShow: true,
        },
        ios: {
          alert: "true",
          badge: "true",
          sound: "true",
          void: "true",
        },
      });

      // ✅ FIX CRITIQUE : arrow functions pour conserver this → CallManager
      this.push.on("registration", (data) => {
        console.log("✅ ENREGISTREMENT PUSH RÉUSSI :", data.registrationId);
        this.deviceToken = data.registrationId;

        if (this.wsReadyState === WebSocket.OPEN) {
          this.sendSignal({
            action: "register-push-token",
            userId: this.myId,
            pushToken: this.deviceToken,
          });
        }
      });

      // Action: Accepter depuis notification
      this.push.on("accept", async (data) => {
        console.log("📞 ACCEPTER DEPUIS PUSH");
        const additionalData = data.additionalData || {};

        // GROUPE : notification d'invitation de groupe
        if (additionalData.type === "group-invite") {
          await this.handleGroupPush(additionalData, "accept");
          return;
        }

        this.extractPushData(additionalData);
        this.autoAcceptOnOffer = true;

        if (this.peerConnection) {
          console.log("Appel déjà en cours, acceptation ignorée");
          return;
        }
        this.showInterface(
          this.isVideoCall ? this.interfaceVideo : this.interfaceSender,
        );
        this.updateStatus("Connexion à l'appel...");

        if (this.isVideoCall) {
          this.setCallingState(true);
          this.startLocalPreview(true);
        }

        await this.ensureConnectedAndFetchOffer();
      });

      // Action: Refuser
      this.push.on("reject", async (data) => {
        console.log("📵 REFUSER APPEL");
        const additionalData = data.additionalData || {};

        // GROUPE : refus d'une invitation de groupe depuis la notification
        if (additionalData.type === "group-invite") {
          await this.handleGroupPush(additionalData, "reject");
          return;
        }

        this.extractPushData(additionalData);

        await this.ensureSocketReady();
        this.rejectCall();

        if (this.push && additionalData.notId) {
          this.push.finish(() =>
            console.log("✅ Notification refusée terminée"),
          );
        }
      });

      // Action: Clic sur notification
      this.push.on("notification", async (data) => {
        console.log("🔔 Notification cliquée :", JSON.stringify(data));
        const additionalData = data.additionalData || {};

        if (additionalData.type === "group-invite") {
          // GROUPE : clic sur la notification -> écran d'appel entrant de groupe
          await this.handleGroupPush(additionalData, "open");
        } else if (additionalData.type === "incoming-call") {
          this.extractPushData(additionalData);
          this.autoAcceptOnOffer = false;

          if (this.isVideoCall) {
            this.showInterface(this.interfaceVideo);
            this.setCallingState(true);
            this.setIncomingVideoState(true);
            this.startLocalPreview(true);
            this.updateStatus("Appel vidéo entrant...");
            this.startVibration();
          } else {
            this.showInterface(this.interfaceReceiver);
            this.updateStatus("Appel entrant...");
            this.startVibration();
          }

          await this.ensureConnectedAndFetchOffer();
        }

        this.push.finish(() => console.log("✅ Notification terminée"));
      });

      this.push.on("error", (error) =>
        console.error("❌ ERREUR PUSH :", error),
      );
    } catch (error) {
      console.error("❌ Exception Push :", error);
    }
  };

  extractPushData = (data) => {
    if (data.callerId) this.targetUserId = data.callerId;
    if (data.callId) {
      this.currentCallId = data.callId;
      localStorage.setItem("pending_call_id", data.callId);
    }
    if (data.isVideo !== undefined) {
      this.isVideoCall = data.isVideo === "true" || data.isVideo === true;
    }
    if (data.notId) this.currentNotId = data.notId;
  };

  ensureConnectedAndFetchOffer = async () => {
    if (!this.currentCallId) {
      this.currentCallId = localStorage.getItem("pending_call_id");
    }

    await this.ensureSocketReady();

    if (this.currentCallId) {
      console.log(
        "📩 Demande de l'offre SDP pour callId :",
        this.currentCallId,
      );
      this.sendSignal({
        type: "get-offer",
        callId: this.currentCallId,
      });
    }
  };

  ensureSocketReady = () => {
    return new Promise((resolve) => {
      const enregistrerEtValider = () => {
        this.sendRegistration();
        if (this.isIOS() && this.voipToken) {
          this.sendSignal({
            type: "register-voip-token",
            userId: this.myId,
            voipToken: this.voipToken,
          });
        }
        setTimeout(resolve, 400);
      };

      if (this.wsReadyState === WebSocket.OPEN) {
        enregistrerEtValider();
        return;
      }

      this.connectWebSocket().then(() => {
        let settled = false;
        const checkInterval = setInterval(() => {
          if (this.wsReadyState === WebSocket.OPEN) {
            if (settled) return;
            settled = true;
            clearInterval(checkInterval);
            enregistrerEtValider();
          }
        }, 100);
        setTimeout(() => {
          if (settled) return;
          settled = true;
          clearInterval(checkInterval);
          resolve();
        }, 10000);
      });
    });
  };

  /* =========================================================
   SIGNALISATION WEBSOCKET
========================================================= */

  connectWebSocket = async () => {
    if (
      this.wsReadyState === WebSocket.OPEN ||
      this.wsReadyState === WebSocket.CONNECTING ||
      this._isConnectingSocket
    ) {
      return;
    }

    this._isConnectingSocket = true;
    this.wsReadyState = WebSocket.CONNECTING;
    this.manuallyClosed = false;
    this.updateStatus("Connexion au serveur...");

    try {
      await fetch(CallManager.HTTP_SERVER_URL, { method: "GET", cache: "no-cache" });
      console.log("✅ HTTP Ping réussi");
    } catch (err) {
      console.warn("⚠️ HTTP Ping échoué :", err);
    }

    return new Promise((resolve) => {
      let settled = false;
      const settleOnce = () => {
        if (settled) return;
        settled = true;
        this._isConnectingSocket = false;
        resolve();
      };
      setTimeout(settleOnce, 15000);
      this.createWebSocket(settleOnce);
    });
  };

  createWebSocket = (onSettle) => {
    // Fallback pour le navigateur : utiliser WebSocket natif
    const wsPlugin = window.CordovaWebsocketPlugin || cordova?.plugins?.CordovaWebsocketPlugin;
    if (!window.cordova || !wsPlugin) {
      console.log("🌐 Mode navigateur : utilisation du WebSocket natif");
      console.log("  - window.CordovaWebsocketPlugin:", !!window.CordovaWebsocketPlugin);
      console.log("  - cordova.plugins.CordovaWebsocketPlugin:", !!cordova?.plugins?.CordovaWebsocketPlugin);
      this.createNativeWebSocket(onSettle);
      return;
    }

    if (this.wsId != null) {
      try {
        CordovaWebsocketPlugin.wsClose(this.wsId, 1000, "Reconnecting");
      } catch (e) {}
      this.wsId = null;
    }
    this.wsReadyState = WebSocket.CONNECTING;

    const wsOptions = {
      url: CallManager.SIGNALING_SERVER_URL,
      // Ping/pong au niveau protocole (OkHttp/SocketRocket) pour détecter une
      // connexion morte même quand aucune frame de fermeture n'est reçue —
      // en plus du ping/pong applicatif JSON déjà géré par handleSignalMessage.
      pingInterval: 30000,
    };

    // receiveCallback : appelé pour chaque message reçu, et aussi à la
    // fermeture/échec de la connexion (différencié par callbackMethod).
    const onReceive = (recvEvent) => {
      switch (recvEvent.callbackMethod) {
        case "onMessage":
          this.handleSignalMessage(recvEvent.message);
          break;

        case "onClose":
          console.log(
            "🔌 WebSocket fermé :",
            recvEvent.reason || recvEvent.exception || recvEvent.code,
          );
          this.stopHeartbeat();
          this.wsId = null;
          this.wsReadyState = WebSocket.CLOSED;
          // ✅ Annuler le timer de requête de groupe pour éviter le timeout faux positif
          if (this.groupCreating || this.groupJoinPending) {
            console.log("⏱️ [GROUPE] WebSocket fermé pendant la création/jonction - timer annulé, réessai après reconnexion");
            this._groupRequestRetryNeeded = true;
            this._groupRequestRetryData = {
              creating: this.groupCreating,
              roomId: this.groupRoomId,
              isVideo: this.groupIsVideo,
              invitees: this.groupRoster.filter(r => r.state === "RINGING").map(r => r.userId),
            };
          }
          clearTimeout(this.groupRequestTimer);
          if (!this.manuallyClosed) {
            this.updateStatus("Hors ligne");
            this.scheduleReconnect();
          }
          break;

        case "onFail":
          console.error(
            "❌ Erreur WebSocket :",
            recvEvent.exception || recvEvent.reason,
          );
          this.updateStatus("Erreur réseau WebSocket");
          this.stopHeartbeat();
          this.wsId = null;
          this.wsReadyState = WebSocket.CLOSED;
          // ✅ Annuler le timer de requête de groupe pour éviter le timeout faux positif
          if (this.groupCreating || this.groupJoinPending) {
            console.log("⏱️ [GROUPE] WebSocket en erreur pendant la création/jonction - timer annulé, réessai après reconnexion");
            this._groupRequestRetryNeeded = true;
            this._groupRequestRetryData = {
              creating: this.groupCreating,
              roomId: this.groupRoomId,
              isVideo: this.groupIsVideo,
              invitees: this.groupRoster.filter(r => r.state === "RINGING").map(r => r.userId),
            };
          }
          clearTimeout(this.groupRequestTimer);
          if (!this.manuallyClosed) {
            this.scheduleReconnect();
          }
          break;
      }
    };

    // successCallback : connexion établie
    const onSuccess = (success) => {
      console.log("✅ WebSocket Connecté");
      this.wsId = success.webSocketId;
      // Le transport natif était bien connecté, mais son état restait
      // CONNECTING : les écrans de réunion refusaient alors d'envoyer leurs messages.
      this.wsReadyState = WebSocket.OPEN;
      this.isReconnecting = false;
      this.reconnectAttempts = 0; // Réinitialiser les tentatives de reconnexion
      clearTimeout(this.reconnectTimer);

      // Le serveur coupe la connexion après ~30 s d'inactivité → ping JSON
      // toutes les 20 s.
      this.startHeartbeat();
      this.sendRegistration();

      if (this.isIOS() && this.voipToken) {
        this.sendSignal({
          type: "register-voip-token",
          userId: this.myId,
          voipToken: this.voipToken,
        });
      }
      if (typeof onSettle === "function") onSettle();
    };

    // failureCallback : échec de la connexion initiale
    const onFailure = (error) => {
      console.error("❌ Erreur création WebSocket :", error);
      this.stopHeartbeat();
      this.wsId = null;
      this.wsReadyState = WebSocket.CLOSED;
      if (!this.manuallyClosed) {
        this.scheduleReconnect();
      }
      if (typeof onSettle === "function") onSettle();
    };

    try {
      wsPlugin.wsConnect(wsOptions, onReceive, onSuccess, onFailure);
    } catch (error) {
      onFailure(error);
    }
  };

  // WebSocket natif pour le navigateur (fallback)
  createNativeWebSocket = (onSettle) => {
    try {
      this.ws = new WebSocket(CallManager.SIGNALING_SERVER_URL);
      this.wsReadyState = WebSocket.CONNECTING;

      this.ws.onopen = () => {
        console.log("✅ WebSocket natif connecté");
        this.wsReadyState = WebSocket.OPEN;
        this.isReconnecting = false;
        this.reconnectAttempts = 0; // Réinitialiser les tentatives de reconnexion
        clearTimeout(this.reconnectTimer);
        this.startHeartbeat();
        this.sendRegistration();
        if (typeof onSettle === "function") onSettle();
      };

      this.ws.onmessage = (event) => {
        this.handleSignalMessage(event.data);
      };

      this.ws.onerror = (error) => {
        console.error("❌ Erreur WebSocket natif :", error);
        this.updateStatus("Erreur réseau WebSocket");
        this.wsReadyState = WebSocket.CLOSED;
        this.stopHeartbeat();
        if (typeof onSettle === "function") onSettle();
      };

      this.ws.onclose = (event) => {
        console.log("🔌 WebSocket natif fermé (code:", event?.code, ")");
        this.wsReadyState = WebSocket.CLOSED;
        this.stopHeartbeat();
        if (!this.manuallyClosed) {
          this.updateStatus("Hors ligne");
          this.scheduleReconnect();
        }
        if (typeof onSettle === "function") onSettle();
      };
    } catch (error) {
      console.error("❌ Erreur création WebSocket natif :", error);
      this.wsReadyState = WebSocket.CLOSED;
      if (!this.manuallyClosed) {
        this.scheduleReconnect();
      }
      if (typeof onSettle === "function") onSettle();
    }
  };

  // ---
  sendRegistration = () => {
    let sessionKey = window.localStorage.getItem("mySessionKey");
    let userId = window.localStorage.getItem("myUserID");
    let holderName = window.localStorage.getItem("myHoldername");

    if (!sessionKey) {
      sessionKey =
        "sess-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      window.localStorage.setItem("mySessionKey", sessionKey);
    }
    if (!userId) {
      userId = this.myId;
      window.localStorage.setItem("myUserID", userId);
    }
    if (!holderName) {
      holderName = this.myId;
      window.localStorage.setItem("myHoldername", holderName);
    }

    console.log("📝 Inscription :", { sessionKey, userId, holderName });

    const wsPlugin = window.CordovaWebsocketPlugin || cordova?.plugins?.CordovaWebsocketPlugin;

    // Fallback pour le navigateur
    if (!window.cordova || !wsPlugin) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: "register-user",
          userId: userId,
          pushToken: "browser",
          displayName: holderName,
          authToken: this.authToken || null,
        }));
      }
    } else {
      // Utiliser le plugin Cordova
      if (this.wsId != null) {
        // Format compatible avec le serveur Render
        wsPlugin.wsSend(
          this.wsId,
          JSON.stringify({
            type: "register-user",
            userId: userId,
            pushToken: this.deviceToken || "android",
            displayName: holderName,
            authToken: this.authToken || null,
          }),
        );
      }
    }
  };

  startHeartbeat = () => {
    this.stopHeartbeat();
    const wsPlugin = window.CordovaWebsocketPlugin || cordova?.plugins?.CordovaWebsocketPlugin;

    this.heartbeatTimer = setInterval(() => {
      // Fallback pour le navigateur
      if (!window.cordova || !wsPlugin) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: "ping", action: "ping" }));
        }
      } else {
        // Utiliser le plugin Cordova
        if (this.wsId != null) {
          wsPlugin.wsSend(
            this.wsId,
            JSON.stringify({ type: "ping", action: "ping" }),
          );
        }
      }
    }, 20000);
  };

  stopHeartbeat = () => {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  };

  requestIceServers = () => {
    const wsPlugin = window.CordovaWebsocketPlugin || cordova?.plugins?.CordovaWebsocketPlugin;
    
    if (!window.cordova || !wsPlugin) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "get-ice-servers" }));
      }
    } else {
      if (this.wsId != null) {
        wsPlugin.wsSend(this.wsId, JSON.stringify({ type: "get-ice-servers" }));
      }
    }
  };

  handleIceServers = (data) => {
    if (data.iceServers && Array.isArray(data.iceServers)) {
      CallManager.RTC_CONFIG.iceServers = data.iceServers;
      console.log("🧊 IceServers TURN reçus et configurés :", data.iceServers.length, "serveurs");
    }
  };

  handleRegistered = (data) => {
    const status = (data && data.status) || "";
    if (status.startsWith("failed")) {
      console.error("❌ Inscription refusée par le serveur :", data);
      this.updateStatus("Inscription refusée par le serveur");
      return;
    }
    
    // Stocker le token d'authentification reçu du serveur
    if (data.authToken) {
      this.authToken = data.authToken;
      localStorage.setItem("app_auth_token", data.authToken);
      console.log("🔐 Token d'authentification stocké");
    }
    
    this.wsReadyState = WebSocket.OPEN;
    this.updateStatus("En ligne");
    console.log("✅ Inscription acceptée :", data);
    
    // Demander les iceServers TURN sécurisés au serveur
    this.requestIceServers();
    
    // Pour le navigateur, on marque comme connecté immédiatement
    if (!window.cordova || !window.CordovaWebsocketPlugin) {
      console.log("🌐 Mode navigateur : inscription réussie");
    }
  };

  // Traite un message JSON reçu du serveur de signalisation (extrait de
  // createWebSocket pour être appelable depuis le receiveCallback du plugin).
  handleSignalMessage = (rawMessage) => {
    let data;
    try {
      data = JSON.parse(rawMessage);
    } catch (e) {
      return;
    }

    const action = data.action || data.type;

    if (action === "ping") {
      this.sendSignal(data.action ? { action: "pong" } : { type: "pong" });
      console.log("🏓 Pong envoyé");
      return;
    }

    console.log("📦 Signal reçu :", action);

    switch (action) {
      case "registered":
        this.handleRegistered(data);
        this.onGroupSocketRegistered(); // GROUPE : re-jonction éventuelle de la salle
        break;

      case "registration-error":
        console.error("❌ Erreur d'inscription :", data.reason);
        this.showCallToast("Erreur d'inscription: " + data.reason);
        break;

      case "ice-servers":
        this.handleIceServers(data);
        break;

      case "incoming-call":
        this.handleIncomingCall(data);
        break;

      case "call-offer-details":
        this.handleCallOfferDetails(data);
        break;

      case "call-expired":
        alert("L'appel a expiré ou a été annulé.");
        this.hangUp(false);
        break;

      case "restart-offer":
        console.log("📹 restart-offer reçu - isVideoUpgrade:", data.isVideoUpgrade, "isVideo:", data.isVideo);
        if (data.isVideoUpgrade) {
          this.handleVideoUpgradeOffer(data);
        } else {
          this.handleRestartOffer(data);
        }
        break;

      case "call-answered":
        this.handleCallAnswered(data);
        break;

      case "ice-candidate":
        this.handleNewICECandidate(data);
        break;

      case "peer-mic-state":
        this.handleRemoteMicState(data);
        break;

      case "peer-camera-state":
        this.handleRemoteCameraState(data);
        break;

      case "screen-share-state":
        this.handleRemoteScreenShare(data);
        break;

      case "call-like":
        this.handleCallLike(data);
        break;

      case "call-refused":
      case "call-end":
        // GROUPE : un message 1-à-1 ne doit jamais fermer un appel de groupe
        if (this.groupRoomId || this.groupCreating || this.groupPendingInvite) break;
        this.hangUp(false);
        break;

      // ===== APPEL DE GROUPE : tous les messages "group-*" du serveur =====
      case "group-created":
      case "group-invite":
      case "group-info":
      case "group-joined":
      case "group-roster":
      case "group-signal":
      case "group-ended":
      case "group-error":
      case "group-busy":
      case "group-like":
        this.handleGroupMessage(action, data);
        break;

      // ===== RÉUNIONS PLANIFIÉES : tous les messages "meeting-*" du serveur =====
      case "meeting-created":
        this.handleMeetingCreated(data);
        break;

      case "meeting-joined":
        this.handleMeetingJoined(data);
        break;

      case "meeting-waiting":
        this.handleMeetingWaiting(data);
        break;

      case "meeting-waiting-music-set":
      case "meeting-waiting-music-stop":
        if (window.callManager && window.callManager.handleWaitingMusicMessage) {
          window.callManager.handleWaitingMusicMessage(data);
        }
        break;

      case "meeting-error":
        this.handleMeetingError(data);
        break;

      case "meeting-cancelled":
        this.handleMeetingCancelled(data);
        break;

      case "meeting-ended":
        this.handleMeetingEnded(data);
        break;

      case "meeting-host-started":
        // Handler défini dans Meetings.js
        if (window.callManager && window.callManager.handleMeetingHostStarted) {
          window.callManager.handleMeetingHostStarted(data);
        }
        break;

      case "meeting-list":
        this.handleMeetingList(data);
        break;

      case "meeting-participant-joined":
        if (window.callManager && window.callManager.handleMeetingParticipantJoined) {
          window.callManager.handleMeetingParticipantJoined(data);
        }
        break;

      case "meeting-participant-left":
        if (window.callManager && window.callManager.handleMeetingParticipantLeft) {
          window.callManager.handleMeetingParticipantLeft(data);
        }
        break;

      case "meeting-participant-state":
        if (window.callManager && window.callManager.handleMeetingParticipantState) {
          window.callManager.handleMeetingParticipantState(data);
        }
        break;

      case "meeting-pending-request":
        if (window.callManager && window.callManager.handleMeetingPendingRequest) {
          window.callManager.handleMeetingPendingRequest(data);
        }
        break;

      case "whiteboard-state":
        if (window.callManager && window.callManager.handleWhiteboardState) {
          window.callManager.handleWhiteboardState(data);
        }
        break;

      case "whiteboard-draw":
        if (window.callManager && window.callManager.handleWhiteboardDraw) {
          window.callManager.handleWhiteboardDraw(data);
        }
        break;

      case "whiteboard-cleared":
        if (window.callManager && window.callManager.handleWhiteboardCleared) {
          window.callManager.handleWhiteboardCleared(data);
        }
        break;

      case "meeting-kicked":
        if (window.callManager && window.callManager.handleMeetingKicked) {
          window.callManager.handleMeetingKicked(data);
        }
        break;

      case "meeting-approval-granted":
        if (window.callManager && window.callManager.handleMeetingApprovalGranted) {
          window.callManager.handleMeetingApprovalGranted(data);
        }
        break;

      case "meeting-approval-denied":
        if (window.callManager && window.callManager.handleMeetingApprovalDenied) {
          window.callManager.handleMeetingApprovalDenied(data);
        }
        break;

      case "meeting-hand-raised":
        if (window.callManager && window.callManager.handleMeetingHandRaised) {
          window.callManager.handleMeetingHandRaised(data);
        }
        break;

      case "meeting-hand-lowered":
        if (window.callManager && window.callManager.handleMeetingHandLowered) {
          window.callManager.handleMeetingHandLowered(data);
        }
        break;

      case "meeting-reaction":
        if (window.callManager && window.callManager.handleMeetingReaction) {
          window.callManager.handleMeetingReaction(data);
        }
        break;

      case "meeting-force-mute":
        if (window.callManager && window.callManager.handleMeetingForceMute) {
          window.callManager.handleMeetingForceMute(data);
        }
        break;

      case "meeting-chat-message":
        if (window.callManager && window.callManager.handleMeetingChatMessage) {
          window.callManager.handleMeetingChatMessage(data);
        }
        break;

      case "meeting-chat":
        if (window.meetingChat && data.message) {
          window.meetingChat.receiveMessage({
            ...data.message,
            meetingId: data.meetingId,
          });
        }
        break;

      case "meeting-chat-error":
        window.meetingChat?.handleSendError(data);
        this.showCallToast(data.reason || "Le message n'a pas pu être envoyé.");
        break;

      case "meeting-pending-approval":
        if (window.callManager && window.callManager.handleMeetingPendingApproval) {
          window.callManager.handleMeetingPendingApproval(data);
        }
        break;

      case "meeting-reconnect":
        if (window.callManager && window.callManager.handleMeetingReconnect) {
          window.callManager.handleMeetingReconnect(data);
        }
        break;
      case "video-upgrade-offer":
        this.handleVideoUpgradeOffer(data);
        break;

      case "video-upgrade-request":
        this.handleVideoUpgradeRequest(data);
        break;

      case "video-upgrade-response":
        this.handleVideoUpgradeResponse(data);
        break;
    }
  };

  scheduleReconnect = () => {
    if (this.manuallyClosed || this.isReconnecting) {
      return;
    }
    this.isReconnecting = true;
    clearTimeout(this.reconnectTimer);

    // Backoff exponentiel: 1s, 2s, 4s, 8s, max 15s
    if (!this.reconnectAttempts) {
      this.reconnectAttempts = 0;
    }
    this.reconnectAttempts++;

    const delay = Math.min(
      Math.pow(2, this.reconnectAttempts - 1) * 1000,
      15000
    );

    console.log(`🔄 Reconnexion WebSocket dans ${delay}ms (tentative ${this.reconnectAttempts})`);

    // Afficher indicateur visuel de reconnexion
    this.updateStatus(`Reconnexion en cours... (${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.isReconnecting = false;
      this.connectWebSocket();
    }, delay);
  };

  sendSignal = (data, _retries = 0) => {
    const wsPlugin = window.CordovaWebsocketPlugin || cordova?.plugins?.CordovaWebsocketPlugin;

    // Fallback pour le navigateur : utiliser WebSocket natif
    if (!window.cordova || !wsPlugin) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(data));
        return true;
      }
      // ✅ FIX : limite à 10 tentatives (5s max) pour éviter la boucle infinie
      if (_retries >= 10) {
        console.warn("⚠️ sendSignal abandonné après 10 tentatives :", data.type);
        return false;
      }
      console.warn(
        `⚠️ WebSocket natif non prêt, tentative ${_retries + 1}/10 dans 500ms :`,
        data.type,
      );
      setTimeout(() => this.sendSignal(data, _retries + 1), 500);
      return false;
    }

    // Utiliser le plugin Cordova
    if (this.wsReadyState === WebSocket.OPEN && this.wsId != null) {
      wsPlugin.wsSend(this.wsId, JSON.stringify(data));
      return true;
    }
    // ✅ FIX : limite à 10 tentatives (5s max) pour éviter la boucle infinie
    if (_retries >= 10) {
      console.warn("⚠️ sendSignal abandonné après 10 tentatives :", data.type);
      return false;
    }
    console.warn(
      `⚠️ Socket non prêt, tentative ${_retries + 1}/10 dans 500ms :`,
      data.type,
    );
    setTimeout(() => this.sendSignal(data, _retries + 1), 500);
    return false;
  };

  /* =========================================================
   1. PARTIE ÉMETTEUR (OUTGOING CALL)
========================================================= */

  makeCall = async (video = false) => {
    if (this.wsReadyState !== WebSocket.OPEN) {
      alert("Vous n'êtes pas connecté au serveur.");
      return;
    }

    const input = document.getElementById("target-id-input");
    const targetId = input ? input.value.trim() : "";

    // GROUPE : déjà dans un appel de groupe ?
    if (this.groupRoomId || this.groupPendingInvite || this.groupCreating) {
      alert("Un appel de groupe est déjà en cours.");
      return;
    }
    // GROUPE : plusieurs IDs saisis (séparés par virgule/espace) -> appel de groupe
    const groupIds = this.parseGroupIds(targetId);
    if (groupIds.length > 1) {
      return this.startGroupCall(groupIds, video);
    }

    if (!targetId || targetId === this.myId) {
      alert("Veuillez saisir un ID valide.");
      return;
    }

    this.cleanCallState();
    this.targetUserId = targetId;
    this.isVideoCall = video;

    this.updateStatus("Initialisation média...");

    try {
      await this.initMediaAndPeer();

      console.log("📞 Création de l'offer - isVideoCall:", this.isVideoCall);
      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: this.isVideoCall,
      });
      console.log("✅ Offer créée avec offerToReceiveVideo:", this.isVideoCall);
      await this.peerConnection.setLocalDescription(offer);

      this.sendSignal({
        type: "call-user",
        targetId: this.targetUserId,
        offer: offer,
        isVideo: this.isVideoCall,
      });

      this.updateStatus("Appel en cours...");
      this.toggleCallButtons(true);
      this.toggleCallControlButtons(false);
      this.showInterface(
        this.isVideoCall ? this.interfaceVideo : this.interfaceSender,
      );

      if (this.isVideoCall) {
        this.setCallingState(true);
        // Afficher les contrôles dès le début de l'appel (pas seulement quand la vidéo distante arrive)
        this.showControls();
      }
    } catch (error) {
      console.error("❌ Erreur lancement appel :", error);
      this.hangUp(false);
    }
  };

  makeVideoCall = () => {
    this.makeCall(true);
  };

  handleCallAnswered = async (data) => {
    console.log("📞 Appel accepté par le destinataire - signalingState:", this.peerConnection?.signalingState);
    if (!this.peerConnection) return;
    if (!data.answer) {
      console.error("❌ Erreur : data.answer est manquant !");
      this.hangUp(false);
      return;
    }

    // Ignorer une 2e réponse (answer dupliquée) si on a déjà quitté
    // Pour les renégociations, l'état sera "have-remote-offer" ou "stable"
    const isRenegotiation = this.peerConnection.signalingState === "have-remote-offer" ||
                            this.peerConnection.signalingState === "stable";

    if (!isRenegotiation && this.peerConnection.signalingState !== "have-local-offer") {
      console.warn(
        "⚠️ call-answered ignoré (état déjà avancé) :",
        this.peerConnection.signalingState,
      );
      return;
    }

    try {
      const SessionDescription = this.activeRTC
        ? this.activeRTC.SessionDescription
        : RTCSessionDescription;
      await this.peerConnection.setRemoteDescription(
        new SessionDescription(data.answer),
      );
      console.log("✅ setRemoteDescription(answer) OK");
      await this.processPendingCandidates();

      if (isRenegotiation) {
        console.log("📹 Réponse de renégociation traitée");
        // Pour les renégociations, s'assurer que l'interface vidéo est active
        if (this.isVideoCall) {
          this.showInterface(this.interfaceVideo);
          const localVideo = document.getElementById("local-video");
          const remoteVideo = document.getElementById("remote-video");

          // Réattacher selon le swap (ne force pas toujours local=caméra)
          this.applyVideoLayout(this.videosSwapped);
          console.log("✅ Layout vidéo réappliqué après renégociation (swapped="+this.videosSwapped+")");

          // S'assurer que l'élément vidéo distante est prêt (la vidéo arrive via ontrack)
          if (remoteVideo) {
            console.log("✅ Élément vidéo distante prêt après renégociation");
          }
        }
        return;
      }

      // Réponse initiale
      this.startTimer();
      this.updateStatus("Appel connecté");
      this.toggleCallControlButtons(true);

      // Basculer l'appelant vers l'interface d'appel en cours
      this.showInterface(
        this.isVideoCall ? this.interfaceVideo : this.interfaceSender,
      );
      this.setContactName(this.targetUserId);

      // IMPORTANT : Pour les appels vidéo, s'assurer que les vidéos sont correctement attachées
      if (this.isVideoCall) {
        const localVideo = document.getElementById("local-video");
        const remoteVideo = document.getElementById("remote-video");

        console.log("📹 Configuration vidéos après answer - localStream:", !!this.localStream);

        // Attacher selon le swap
        this.applyVideoLayout(this.videosSwapped);
        console.log("✅ Layout vidéo après answer (swapped="+this.videosSwapped+")");

        // La vidéo distante sera attachée via ontrack, mais on s'assure que l'élément est prêt
        if (remoteVideo) {
          console.log("✅ Élément vidéo distante prêt, en attente du stream via ontrack");
        }

        // Sortir de l'état calling
        this.setCallingState(false);
        this.setIncomingVideoState(false);
        this.placePipAtBottomRight();
        this.showControls();

        // Masquer le placeholder
        const placeholder = document.querySelector(".remote-video-placeholder");
        if (placeholder) placeholder.classList.add("hidden");
      }
    } catch (error) {
      console.error("❌ Erreur réponse :", error);
      this.hangUp(false);
    } finally {
      this.isRenegotiating = false;
    }
  };

  /* =========================================================
   TRANSFORMER UN APPEL AUDIO EN APPEL VIDÉO
========================================================= */

  upgradeToVideo = async () => {
    if (!this.peerConnection || !this.localStream || this.isVideoCall) {
      console.log("⛔ upgradeToVideo() annulé");
      return;
    }

    const confirmed = window.confirm("Voulez-vous passer en appel vidéo ?");
    if (!confirmed) {
      console.log("📹 Passage en vidéo annulé par l'appelant");
      return;
    }

    console.log("📹 upgradeToVideo() démarré");

    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
      });
      const videoTrack = videoStream.getVideoTracks()[0];
      if (!videoTrack) return;

      this.isRenegotiating = true;

      // Réutiliser un sender/transceiver vidéo existant évite les pistes dupliquées.
      const existingVideoSender = this.peerConnection.getSenders().find(
        (sender) => sender.track && sender.track.kind === "video"
      );
      if (existingVideoSender) {
        await existingVideoSender.replaceTrack(videoTrack);
      } else {
        const videoTransceiver = this.peerConnection.getTransceivers().find(
          (transceiver) => transceiver.receiver && transceiver.receiver.track && transceiver.receiver.track.kind === "video"
        );
        if (videoTransceiver) {
          await videoTransceiver.sender.replaceTrack(videoTrack);
          videoTransceiver.direction = "sendrecv";
        } else {
          this.peerConnection.addTrack(videoTrack, this.localStream);
        }
      }
      if (!this.localStream.getVideoTracks().includes(videoTrack)) this.localStream.addTrack(videoTrack);

      this.isVideoCall = true;

      this.applyVideoLayout(this.videosSwapped);
      this.showInterface(this.interfaceVideo);
      this.showLocalVideoPlaceholder(false);

      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      this.sendSignal({
        type: "restart-offer",
        targetId: this.targetUserId,
        offer: offer,
        isVideo: true,
        isVideoUpgrade: true,
      });
      console.log("📹 upgradeToVideo: Message restart-offer envoyé avec isVideoUpgrade: true");
      this.updateStatus("Passage en appel vidéo...");
    } catch (error) {
      this.isRenegotiating = false;
      console.error("❌ Erreur passage en vidéo :", error);
    }
  };

  performVideoUpgrade = async () => {
    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
      });
      const videoTrack = videoStream.getVideoTracks()[0];
      if (!videoTrack) return;

      this.isRenegotiating = true;

      // Réutiliser un sender/transceiver vidéo existant évite les pistes dupliquées.
      const existingVideoSender = this.peerConnection.getSenders().find(
        (sender) => sender.track && sender.track.kind === "video"
      );
      if (existingVideoSender) {
        await existingVideoSender.replaceTrack(videoTrack);
      } else {
        const videoTransceiver = this.peerConnection.getTransceivers().find(
          (transceiver) => transceiver.receiver && transceiver.receiver.track && transceiver.receiver.track.kind === "video"
        );
        if (videoTransceiver) {
          await videoTransceiver.sender.replaceTrack(videoTrack);
          videoTransceiver.direction = "sendrecv";
        } else {
          this.peerConnection.addTrack(videoTrack, this.localStream);
        }
      }
      if (!this.localStream.getVideoTracks().includes(videoTrack)) this.localStream.addTrack(videoTrack);

      this.isVideoCall = true;

      this.applyVideoLayout(this.videosSwapped);
      this.showInterface(this.interfaceVideo);
      this.showLocalVideoPlaceholder(false);

      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      this.sendSignal({
        type: "restart-offer",
        targetId: this.targetUserId,
        offer: offer,
        isVideo: true,
        isVideoUpgrade: true,
      });
      this.updateStatus("Passage en appel vidéo...");
    } catch (error) {
      this.isRenegotiating = false;
      console.error("❌ Erreur passage en vidéo :", error);
    }
  };

  handleVideoUpgradeRequest = (data) => {
    console.log("📹 Demande de passage en vidéo reçue de :", data.from);

    const accept = window.confirm("Voulez-vous passer en appel vidéo ?");

    this.sendSignal({
      type: "video-upgrade-response",
      targetId: this.targetUserId,
      accepted: accept,
    });

    if (!accept) {
      console.log("📹 Passage en vidéo refusé");
    }
  };

  handleVideoUpgradeResponse = (data) => {
    if (data.accepted) {
      console.log("📹 Passage en vidéo accepté par le destinataire");
      this.performVideoUpgrade();
    } else {
      console.log("📹 Passage en vidéo refusé par le destinataire");
      this.updateStatus("Appel connecté");
      alert("L'autre personne a refusé de passer en appel vidéo.");
    }
  };

  handleVideoUpgradeOffer = async (data) => {
    if (!this.peerConnection) {
      console.log(
        "⛔ handleVideoUpgradeOffer() ignoré — pas de peerConnection",
      );
      return;
    }
    console.log(
      "📹 handleVideoUpgradeOffer() reçu — isVideoCall avant:",
      this.isVideoCall,
    );
    this.isRenegotiating = true;

    try {
      if (!this.isVideoCall) {
        this.isVideoCall = true;
        console.log("📹 Passage en mode vidéo - changement d'interface");
        this.showInterface(this.interfaceVideo);
        console.log("📹 Interface vidéo affichée");
        this.showLocalVideoPlaceholder(true);
        this.isCameraOff = true;
        this.updateCameraIcon();
        this.sendCameraState();

        // Préparer les éléments vidéo
        const localVideo = document.getElementById("local-video");
        const remoteVideo = document.getElementById("remote-video");
        if (localVideo) {
          console.log("📹 Élément local-video prêt");
        }
        if (remoteVideo) {
          console.log("📹 Élément remote-video prêt");
        }
      } else {
        console.log("📹 Déjà en mode vidéo - pas de changement d'interface");
      }

      const SessionDescription = this.activeRTC
        ? this.activeRTC.SessionDescription
        : RTCSessionDescription;
      await this.peerConnection.setRemoteDescription(
        new SessionDescription(data.offer),
      );
      console.log("📹 setRemoteDescription(offer) OK, signalingState:", this.peerConnection.signalingState);
      await this.processPendingCandidates();

      const videoTransceiver = this.peerConnection
        .getTransceivers()
        .find(
          (t) =>
            t.receiver && t.receiver.track && t.receiver.track.kind === "video",
        );

      // IMPORTANT : Toujours utiliser sendrecv pour permettre au récepteur d'activer sa caméra plus tard
      // Style WhatsApp : les deux participants peuvent activer/désactiver leur caméra librement
      if (videoTransceiver) {
        videoTransceiver.direction = "sendrecv";
        console.log("📹 Transceiver direction fixée à sendrecv (style WhatsApp)");
      }

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      console.log("📹 Réponse créée avec sendrecv, signalingState:", this.peerConnection.signalingState);

      this.sendSignal({
        type: "answer-call",
        targetId: this.targetUserId,
        answer: answer,
      });
      console.log("📹 Réponse envoyée à l'émetteur");
      this.updateStatus("Appel vidéo connecté");
    } catch (error) {
      console.error("❌ Erreur réception passage vidéo :", error);
    } finally {
      this.isRenegotiating = false;
    }
  };

  /* =========================================================
   2. PARTIE RÉCEPTEUR (INCOMING CALL)
========================================================= */

  handleIncomingCall = (data) => {
    console.log("📞 Appel entrant reçu de :", data.from);

    // GROUPE : déjà dans un appel de groupe -> on refuse l'appel 1-à-1
    if (this.groupRoomId || this.groupCreating || this.groupPendingInvite) {
      this.sendSignal({ type: "call-refused", targetId: data.from });
      return;
    }

    this.cleanCallState();
    this.targetUserId = data.from;
    this.pendingOffer = data.offer;
    this.currentCallId = data.callId;
    this.isVideoCall = data.isVideo === "true" || data.isVideo === true;
    if (data.notId) this.currentNotId = data.notId;

    // ✅ FIX : afficher le nom de l'appelant dans toutes les interfaces
    this.setContactName(data.from);

    this.updateStatus(
      this.isVideoCall ? "Appel vidéo entrant..." : "Appel entrant...",
    );

    if (this.isVideoCall) {
      console.log("🎬 Appel vidéo entrant - interfaceVideo:", this.interfaceVideo);
      this.showInterface(this.interfaceVideo);
      this.setCallingState(true);
      this.setIncomingVideoState(true);
      this.startLocalPreview(true);
      this.startVibration();
      // Afficher les contrôles pendant l'état incoming (boutons accepter/refuser)
      this.showControls();
    } else {
      this.showInterface(this.interfaceReceiver);
      this.startVibration();
    }
  };

  handleCallOfferDetails = async (data) => {
    console.log("📦 Offre SDP reçue du serveur pour :", data.callId);

    this.targetUserId = data.from;
    this.pendingOffer = data.offer;
    this.isVideoCall = data.isVideo === "true" || data.isVideo === true;

    if (this.autoAcceptOnOffer && this.pendingOffer) {
      this.autoAcceptOnOffer = false;
      await this.acceptCall();
    }
  };

  acceptCall = async () => {
    // GROUPE : invitation de groupe en attente -> on rejoint la salle
    if (this.groupPendingInvite) return this.acceptGroupInvite();

    // Anti double-décroche (swipe + click synthétique WebView, ou 2 taps rapides)
    if (this.peerConnection) {
      console.warn("⚠️ acceptCall() ignoré — appel déjà en cours de traitement");
      return;
    }
    if (this._acceptInProgress) {
      console.warn("⚠️ acceptCall() ignoré — acceptation déjà en cours");
      return;
    }
    this._acceptInProgress = true;

    // iOS: réponse forcée via CallKit
    if (this.isIOS()) {
      console.log("ℹ️ [iOS] Réponse forcée via l'écran d'appel natif CallKit.");
      this.updateStatus("Décrochez depuis l'écran d'appel");
      this._acceptInProgress = false;
      return this.answerIncomingCall();
    }

    this.stopVibration();

    if (!this.pendingOffer) {
      if (this.currentCallId) {
        this.autoAcceptOnOffer = true;
        this._acceptInProgress = false;
        await this.ensureConnectedAndFetchOffer();
        return;
      }
      console.warn("⚠️ Aucune offre SDP disponible pour répondre.");
      this._acceptInProgress = false;
      return;
    }

    try {
      this.updateStatus("Connexion à l'appel...");

      console.log("📞 acceptCall - isVideoCall:", this.isVideoCall, "localStream existe:", !!this.localStream);

      // Pour les appels vidéo, TOUJOURS créer un nouveau stream avec vidéo
      // pour éviter les problèmes de réutilisation de stream sans piste vidéo
      if (this.isVideoCall) {
        // Forcer la création d'un nouveau stream vidéo
        this.localStream = null; // Nettoyer l'ancien stream
        await this.initMediaAndPeer(true); // true: créer un nouveau stream avec vidéo
      } else {
        await this.initMediaAndPeer();
      }

      const SessionDescription = this.activeRTC
        ? this.activeRTC.SessionDescription
        : RTCSessionDescription;
      await this.peerConnection.setRemoteDescription(
        new SessionDescription(this.pendingOffer),
      );
      await this.processPendingCandidates();

      console.log("📞 Création de l'answer - isVideoCall:", this.isVideoCall);
      const answer = await this.peerConnection.createAnswer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: this.isVideoCall,
      });
      console.log("✅ Answer créée avec offerToReceiveVideo:", this.isVideoCall);
      await this.peerConnection.setLocalDescription(answer);

      this.sendSignal({
        type: "answer-call",
        targetId: this.targetUserId,
        answer: answer,
      });

      this.startTimer();
      this.pendingOffer = null;

      this.showInterface(
        this.isVideoCall ? this.interfaceVideo : this.interfaceSender,
      );
      this.updateStatus("Appel connecté");

      // Pour les appels vidéo, on reste en état calling jusqu'à l'arrivée de la vidéo distante
      if (this.isVideoCall) {
        this.setIncomingVideoState(false);
        // calling state est déjà true, on le garde
      }
    } catch (error) {
      console.error("❌ Erreur acceptation appel :", error);
      this.hangUp(); // prévenir l'appelant, sinon il continue de sonner
    } finally {
      this._acceptInProgress = false;
    }
  };

  // iOS: Version spécifique pour answerIncomingCall
  answerIncomingCall = async () => {
    console.log("🚀 [iOS] answerIncomingCall() démarre");
    this.stopVibration();

    if (!this.pendingOffer) {
      if (this.currentCallId) {
        console.log("⏳ [iOS] Pas encore d'offre — nouvelle demande get-offer");
        this.autoAcceptOnOffer = true;
        await this.ensureConnectedAndFetchOffer();
        return;
      }
      console.warn("⚠️ [iOS] Aucune offre SDP disponible");
      return;
    }

    try {
      this.updateStatus("Connexion à l'appel...");

      // iOS: Activation audio AVANT getUserMedia
      if (this.isIOS() && cordova.plugins && cordova.plugins.CordovaCall) {
        console.log("🔊 [iOS] activateAudio() natif démarre...");
        await new Promise((resolve) => {
          try {
            cordova.plugins.CordovaCall.activateAudio(
              () => {
                console.log("✅ [iOS] AVAudioSession activée.");
                resolve();
              },
              (err) => {
                console.warn("⚠️ [iOS] activateAudio erreur:", err);
                resolve();
              },
            );
          } catch (e) {
            console.warn("⚠️ [iOS] activateAudio exception:", e);
            resolve();
          }
        });
      }

      // Pour les appels vidéo, TOUJOURS créer un nouveau stream avec vidéo
      // pour éviter les problèmes de réutilisation de stream sans piste vidéo
      if (this.isVideoCall) {
        console.log("📞 [iOS] answerIncomingCall - isVideoCall:", this.isVideoCall, "localStream existe:", !!this.localStream);
        // Forcer la création d'un nouveau stream vidéo
        this.localStream = null; // Nettoyer l'ancien stream
        await this.initMediaAndPeer(true); // true: créer un nouveau stream avec vidéo
      } else {
        await this.initMediaAndPeer(false); // false: attacher pistes après setRemoteDescription
      }

      if (this.isVideoCall) {
        this.showInterface(this.interfaceVideo);
        this.setCallingState(true);
      }

      const SessionDescription = this.activeRTC
        ? this.activeRTC.SessionDescription
        : RTCSessionDescription;
      await this.peerConnection.setRemoteDescription(
        new SessionDescription(this.pendingOffer),
      );

      this.attachLocalTracksToPeer();

      await this.processPendingCandidates();

      console.log("📞 [iOS] Création de l'answer - isVideoCall:", this.isVideoCall);
      const answer = await this.peerConnection.createAnswer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: this.isVideoCall,
      });
      console.log("✅ [iOS] Answer créée avec offerToReceiveVideo:", this.isVideoCall);
      await this.peerConnection.setLocalDescription(answer);

      this.sendSignal({
        type: "answer-call",
        targetId: this.targetUserId,
        answer: answer,
      });

      this.startTimer();
      this.pendingOffer = null;

      this.showInterface(
        this.isVideoCall ? this.interfaceVideo : this.interfaceSender,
      );
      this.updateStatus("Appel connecté");

      // Pour les appels vidéo, on reste en état calling jusqu'à l'arrivée de la vidéo distante
      if (this.isVideoCall) {
        // calling state est déjà true, on le garde
      }
    } catch (error) {
      console.error("❌ [iOS] Erreur acceptation appel :", error);
      this.hangUp(); // prévenir l'appelant, sinon il continue de sonner
    }
  };

  rejectCall = () => {
    // GROUPE : invitation de groupe en attente -> refus de groupe
    if (this.groupPendingInvite) return this.declineGroupInvite();

    // iOS: Terminer appel CallKit
    if (this.isIOS() && cordova.plugins && cordova.plugins.CordovaCall) {
      try {
        cordova.plugins.CordovaCall.endCall();
      } catch (e) {}
    }

    if (this.targetUserId) {
      this.sendSignal({
        type: "call-refused",
        targetId: this.targetUserId,
      });
    }
    this.stopVibration();
    this.cleanCallState();
    this.closeInterfaces();
    this.updateStatus("En ligne");
    this.closeNativeIncomingCallScreenIfNeeded();
  };

  // ✅ FIX écran noir : quand l'appel entrant s'affiche par-dessus l'écran de
  // verrouillage (IncomingCallActivity, voir CallMessagingService/appel_entrant.html),
  // le natif applique FLAG_SHOW_WHEN_LOCKED / FLAG_TURN_SCREEN_ON / FLAG_KEEP_SCREEN_ON
  // à la création de l'Activity et ne les retire QUE via le pont JS "AndroidCall"
  // (voir IncomingCallActivity.JsBridge.closeCallScreen()). Comme rien ne l'appelait
  // jamais depuis CallManager.js, l'Activity restait figée par-dessus le verrouillage
  // (WebView vide, fond sombre) après un raccroché ou un refus depuis cette écran-là —
  // d'où l'"écran noir" constaté. window.AndroidCall n'existe que dans ce contexte
  // précis (absent dans MainActivity) : l'appel est donc sans effet ailleurs.
  closeNativeIncomingCallScreenIfNeeded = () => {
    if (window.AndroidCall && typeof AndroidCall.closeCallScreen === "function") {
      try {
        AndroidCall.closeCallScreen();
      } catch (e) {
        console.warn("⚠️ AndroidCall.closeCallScreen() a échoué :", e);
      }
    }
  };

  /* =========================================================
   3. FLUX MEDIA & WEBRTC
========================================================= */

  attachLocalTracksToPeer = () => {
    if (!this.peerConnection || !this.localStream) return;
    // Idempotent : re-ajouter une piste déjà envoyée lève InvalidAccessError (WebKit/iOS),
    // ce qui faisait raccrocher les appels vidéo entrants sur iOS.
    const sentTracks = this.peerConnection.getSenders().map((s) => s.track).filter(Boolean);
    this.localStream.getTracks().forEach((track) => {
      if (sentTracks.includes(track)) return;
      this.peerConnection.addTrack(track, this.localStream);
    });
    console.log("✅ Pistes locales attachées au peerConnection");
  };

  initMediaAndPeer = async (attachTracksNow = true) => {
    try {
      // Configuration de l'implémentation WebRTC
      this.activeRTC = {
        getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
        PeerConnection: window.RTCPeerConnection,
        SessionDescription: window.RTCSessionDescription,
        IceCandidate: window.RTCIceCandidate,
      };

      // iOS: Vérifier autorisations médias
      if (this.isIOS()) {
        await this.ensureMediaAuthorizedIOS();
      }

      // Réutiliser localStream s'il existe déjà (créé par startLocalPreview)
      if (!this.localStream) {
        this.localStream = await this.activeRTC.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: this.isVideoCall ? { facingMode: "user" } : false,
        });
      }

      if (this.isVideoCall) {
        this.applyVideoLayout(this.videosSwapped);
      }

      // iOS: Activer haut-parleur par défaut
      if (this.isIOS() && typeof activerAudioSessionIOS === "function") {
        activerAudioSessionIOS(this.isSpeakerOn ? "speaker" : "receiver");
      }

      // Android: Toujours forcer l'écouteur par défaut (comme WhatsApp)
      if (this.isAndroid()) {
        try {
          const initialRoute = await this.setAudioRoute("earpiece");
          // setAudioRoute met déjà à jour currentAudioRoute avec la route réelle
          this.isSpeakerOn = this.currentAudioRoute === "speaker";
          this.updateAudioRouteIcon();
          console.log("🔊 Route audio initialisée: " + this.currentAudioRoute + " (écouteur par défaut)");
        } catch (audioError) {
          console.warn("⚠️ Erreur initialisation route audio (poursuite quand même):", audioError);
          // Valeurs par défaut si le plugin échoue
          this.currentAudioRoute = "earpiece";
          this.isSpeakerOn = false;
        }
      }

      this.peerConnection = new this.activeRTC.PeerConnection(CallManager.RTC_CONFIG);

      if (attachTracksNow) {
        this.attachLocalTracksToPeer();
      }

      this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.targetUserId) {
        this.logToScreen(`🧊 ICE envoyé: ${event.candidate.type ?? "?"} ${event.candidate.protocol ?? ""}`);
        this.sendSignal({
          type: "ice-candidate",
          targetId: this.targetUserId,
          candidate: event.candidate,
        });
      } else if (!event.candidate) {
        this.logToScreen("🧊 Fin de collecte ICE locale");
      }
    };

      // Gestion des erreurs de connexion ICE
      this.peerConnection.oniceconnectionstatechange = () => {
        const state = this.peerConnection.iceConnectionState;
        console.log(`🧊 ICE connection state: ${state}`);
        this.logToScreen(`🧊 ICE state: ${state}`);

        if (state === "failed" || state === "disconnected") {
          console.error(`❌ ICE connection ${state}`);
          this.updateStatus(`Connexion ICE ${state}`);
          this.logToScreen(`❌ ICE ${state} - tentative de renégociation`);

          // Tenter de renégocier la connexion
          if (state === "failed" && !this.isRestartingIce) {
            this.isRestartingIce = true;
            this.restartIceSession().catch((error) => {
              console.error("❌ Échec du restart ICE:", error);
              this.isRestartingIce = false;
              // Proposer de quitter si la renégociation échoue
              if (confirm("Connexion réseau défaillante. Voulez-vous quitter l'appel ?")) {
                this.hangUp(false);
              }
            });
          }
        } else if (state === "connected" || state === "completed") {
          console.log("✅ ICE connection établie");
          this.updateStatus("Connecté");
          this.isRestartingIce = false;
        }
      };

      // Gestion des erreurs de connexion globale
      this.peerConnection.onconnectionstatechange = () => {
        const state = this.peerConnection.connectionState;
        console.log(`🔗 Connection state: ${state}`);
        this.logToScreen(`🔗 Connection state: ${state}`);

        if (state === "failed") {
          console.error("❌ Connection failed");
          this.updateStatus("Connexion échouée");
          this.logToScreen("❌ Connection failed");
          if (confirm("La connexion a échoué. Voulez-vous quitter ?")) {
            this.hangUp(false);
          }
        } else if (state === "connected") {
          console.log("✅ Connection établie");
          this.updateStatus("Connecté");
        }
      };

      this.peerConnection.ontrack = async (event) => {
        console.log("🔊/📹 ontrack déclenché — kind:", event.track.kind);

        const stream =
          event.streams && event.streams[0]
            ? event.streams[0]
            : new MediaStream([event.track]);

        const playRemoteAudio = (audioStream) => {
          const remoteAudio =
            document.getElementById("remoteAudio") ||
            document.getElementById("remote-audio");
          if (!remoteAudio) {
            console.error("❌ #remoteAudio introuvable");
            return;
          }
          remoteAudio.muted = false;
          remoteAudio.volume = 1;
          if (remoteAudio.srcObject !== audioStream) {
            remoteAudio.srcObject = audioStream;
          }
          audioStream.getAudioTracks().forEach((t) => {
            t.enabled = true;
            console.log(
              "🔊 piste audio:",
              t.id,
              "enabled=",
              t.enabled,
              "muted=",
              t.muted,
              "readyState=",
              t.readyState,
            );
          });
          const tryPlay = (n) => {
            remoteAudio
              .play()
              .then(() => console.log("✅ remoteAudio.play() OK"))
              .catch((e) => {
                console.warn("⚠️ remoteAudio.play() try", n, e);
                if (n < 3) setTimeout(() => tryPlay(n + 1), 400 * (n + 1));
              });
          };
          tryPlay(0);
        };

        if (event.track.kind === "video") {
          const remoteVideo = document.getElementById("remote-video");
          const localVideo = document.getElementById("local-video");

          console.log("📹 Track vidéo reçu - remoteVideo element:", !!remoteVideo, "stream:", !!stream, "video tracks:", stream.getVideoTracks().length);

          if (remoteVideo) {
            // IMPORTANT : Ne pas détacher le stream si on arrête le partage d'écran
            // Vérifier si le stream contient réellement une piste vidéo active
            const hasActiveVideoTrack = stream.getVideoTracks().some(track => track.readyState === "live" && track.enabled);

            if (hasActiveVideoTrack) {
              remoteVideo.muted = true;

              // Attacher le stream distant directement (sans nettoyage forcé)
              // Mémoriser le flux distant (source de vérité pour le swap)
              this.remoteStreamRef = stream;

              // Appliquer selon l'état swap (ne force PAS toujours local=caméra)
              this.applyVideoLayout(this.videosSwapped);

              try {
                await remoteVideo.play();
                console.log("✅ Vidéo distante jouée correctement");
              } catch (e) {
                console.error("❌ Erreur play remote-video :", e);
              }
              if (localVideo) {
                localVideo.play().catch(e => console.warn("⚠️ Erreur play local-video:", e));
              }

              // Sortir de l'état calling quand la vidéo distante arrive
              this.setCallingState(false);
              this.setIncomingVideoState(false);
              this.placePipAtBottomRight();
              this.showControls(); // Afficher les contrôles
              this.resetIncomingCameraToggleUI();

              // Masquer le placeholder de la vidéo distante
              const placeholder = document.querySelector(".remote-video-placeholder");
              if (placeholder) placeholder.classList.add("hidden");
            } else {
              console.log("📹 Track vidéo reçu mais inactive/ended - pas d'attachement");
              // Ne pas détacher le stream existant si la piste n'est pas active
              // Cela évite l'écran noir quand on arrête le partage d'application
            }
          }
          if (stream.getAudioTracks().length > 0) {
            playRemoteAudio(stream);
          }
        } else {
          playRemoteAudio(stream);
        }
      };

      // iOS: Utiliser oniceconnectionstatechange au lieu de onconnectionstatechange
      const stateChangeEvent = this.isIOS()
        ? "oniceconnectionstatechange"
        : "onconnectionstatechange";
      const stateProperty = this.isIOS()
        ? "iceConnectionState"
        : "connectionState";

      this.peerConnection[stateChangeEvent] = async () => {
        const state = this.peerConnection[stateProperty];
        console.log("🔗 État WebRTC :", state);

        if (
          (state === "failed" || state === "disconnected") &&
          !this.isRestartingIce &&
          !this.isRenegotiating
        ) {
          console.warn("⚠️ Déclenchement restartIceSession() - État:", state);
          this.showCallToast("Problème de connexion, tentative de reconnexion...");
          this.restartIceSession();
        }

        if (state === "connected" || state === "completed") {
          this.isRestartingIce = false;
          this.updateStatus("Appel connecté");

          // iOS: Activer haut-parleur à la connexion
          if (this.isIOS() && typeof activerAudioSessionIOS === "function") {
            activerAudioSessionIOS(this.isSpeakerOn ? "speaker" : "receiver");
          }

          // Android: Réappliquer la route audio actuelle (ne pas changer automatiquement)
          if (this.isAndroid()) {
            try {
              const confirmedRoute = await this.setAudioRoute(this.currentAudioRoute);
              console.log("🔊 [WEBRTC] Route réappliquée après connexion: " + confirmedRoute);
              this.updateAudioRouteIcon();
            } catch (audioError) {
              console.warn("⚠️ Erreur réapplication route audio (poursuite quand même):", audioError);
            }
          }

          // Re-play audio distant (autoplay parfois bloqué au 1er ontrack)
          const remoteAudio =
            document.getElementById("remoteAudio") ||
            document.getElementById("remote-audio");
          if (remoteAudio && remoteAudio.srcObject) {
            remoteAudio.muted = false;
            remoteAudio.volume = 1;
            remoteAudio.play().catch((e) =>
              console.warn("⚠️ re-play remoteAudio:", e),
            );
          }
        }
      };
    } catch (error) {
      console.error("❌ Erreur dans initMediaAndPeer() :", error);
      throw error; // ✅ FIX : propager l'erreur pour que l'appelant (makeCall, acceptCall) annule proprement
    }
  };


  /* =========================================================
   ZONE DE LOG ÉCRAN — ICE + erreurs + localStorage
========================================================= */

// Ajoute une ligne dans le panneau (toujours en mémoire, visible seulement si
// le bouton 🐞 a été activé — voir toggleScreenLog).
logToScreen = (message) => {
  const box = document.getElementById("log-debug-box");
  if (!box) return;
  const line = document.createElement("div");
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
};

// Bouton 🐞 : bascule l'affichage du panneau, sans jamais effacer son contenu.
toggleScreenLog = () => {
  const box = document.getElementById("log-debug-box");
  if (!box) return;
  box.classList.toggle("show");
};

clearScreenLog = () => {
  const box = document.getElementById("log-debug-box");
  if (!box) return;
  box.innerHTML = "";
  box.classList.remove("show");
};

// Capture tous les console.log/warn/error de l'app (une seule fois) et les
// répercute dans le panneau, en plus de la console habituelle du navigateur.
setupConsoleCapture = () => {
  if (CallManager._consoleCaptured) return;
  CallManager._consoleCaptured = true;

  const format = (args) =>
    args
      .map((a) => {
        if (typeof a === "string") return a;
        try {
          return JSON.stringify(a);
        } catch (e) {
          return String(a);
        }
      })
      .join(" ");

  ["log", "warn", "error"].forEach((level) => {
    const original = console[level].bind(console);
    const prefix = { log: "", warn: "⚠️ ", error: "❌ " }[level];
    console[level] = (...args) => {
      original(...args);
      this.logToScreen(`${prefix}${format(args)}`);
    };
  });
};

serializeError = (error) => {
  const data = {};
  Object.getOwnPropertyNames(error).forEach((key) => { data[key] = error[key]; });
  data.name = data.name ?? error.name;
  data.message = data.message ?? error.message;
  data.code = data.code ?? error.code;
  return data;
};

showLocalStorageOnScreen = () => {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
  if (keys.length === 0) {
    this.logToScreen("📦 localStorage: (vide)");
    return;
  }
  keys.forEach((key) => this.logToScreen(`📦 ${key} = ${localStorage.getItem(key)}`));
};



  handleNewICECandidate = async (data) => {
    if (!data.candidate) return;

    this.logToScreen(`🧊 ICE reçu: ${data.candidate.candidate ?? "?"}`);

    if (!this.peerConnection || !this.peerConnection.remoteDescription) {
      this.pendingCandidates.push(data.candidate);
      return;
    }

    try {
      const IceCandidate = this.activeRTC ? this.activeRTC.IceCandidate : RTCIceCandidate;
      await this.peerConnection.addIceCandidate(new IceCandidate(data.candidate));
    } catch (error) {
      const errData = this.serializeError(error);
      this.logToScreen(`❌ ${errData.name} (code:${errData.code}) — ${errData.message}`);
    }
  };

  processPendingCandidates = async () => {
    if (this.pendingCandidates.length > 0) {
      const IceCandidate = this.activeRTC
        ? this.activeRTC.IceCandidate
        : RTCIceCandidate;
      for (const candidate of this.pendingCandidates) {
        try {
          await this.peerConnection.addIceCandidate(
            new IceCandidate(candidate),
          );
        } catch (e) {}
      }
      this.pendingCandidates = [];
    }
  };


    /* =========================================================
   DEBUG — Affichage du localStorage à l'écran
========================================================= */

  showLocalStorageOnScreen = () => {
    // 1. Récupération de toutes les données du localStorage
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      data[key] = localStorage.getItem(key);
    }

    // 2. Création du panneau d'affichage s'il n'existe pas déjà
    let box = document.getElementById("storage-debug-box");
    if (!box) {
      box = document.createElement("div");
      box.id = "storage-debug-box";
      box.style.cssText =
        "position:fixed;bottom:10px;left:10px;right:10px;max-height:35vh;overflow-y:auto;" +
        "background:rgba(0,0,0,0.85);color:#0f0;font-size:12px;font-family:monospace;" +
        "padding:8px;border-radius:8px;z-index:9999;white-space:pre-wrap;";
      document.body.appendChild(box);
    }

    // 3. Construction du texte à afficher
    let text = `📦 localStorage [${new Date().toLocaleTimeString()}]\n`;
    const keys = Object.keys(data);
    if (keys.length === 0) {
      text += "(vide)";
    } else {
      keys.forEach((key) => {
        text += `${key} = ${data[key]}\n`;
      });
    }

    box.textContent = text; // remplace le contenu à chaque appel
  };

  /* =========================================================
   4. RECONNEXION ICE
========================================================= */

  restartIceSession = async () => {
    if (!this.peerConnection || !this.targetUserId) return;

    try {
      this.isRestartingIce = true;
      if (typeof this.peerConnection.restartIce === "function") {
        this.peerConnection.restartIce();
      }

      const offer = await this.peerConnection.createOffer({ iceRestart: true });
      await this.peerConnection.setLocalDescription(offer);

      this.sendSignal({
        type: "restart-offer",
        targetId: this.targetUserId,
        offer: offer,
      });
    } catch (error) {
      this.isRestartingIce = false;
    }
  };

  handleRestartOffer = async (data) => {
    if (!this.peerConnection) return;

    try {
      const SessionDescription = this.activeRTC
        ? this.activeRTC.SessionDescription
        : RTCSessionDescription;
      await this.peerConnection.setRemoteDescription(
        new SessionDescription(data.offer),
      );
      await this.processPendingCandidates();

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      this.sendSignal({
        type: "answer-call",
        targetId: this.targetUserId,
        answer: answer,
      });
    } catch (e) {}
  };

  /* =========================================================
   5. NETTOYAGE
========================================================= */

  clearNativeCallNotification = () => {
    if (!this.currentNotId) return;
    if (!(
      this.isIOS() &&
      this.push &&
      typeof this.push.clearNotification === "function"
    )) {
      return;
    }
    const notIdToClear = this.currentNotId;
    this.push.clearNotification(
      Number(notIdToClear),
      () => console.log("✅ Notification native supprimée"),
      (err) => console.warn("⚠️ Échec suppression notification native :", err),
    );
  };

  hangUp = (sendSignalToPeer = true) => {
    // iOS: Terminer appel CallKit (auparavant seulement dans this.rejectCall,
    // ce qui laissait l'interface native ouverte quand on raccrochait
    // un appel déjà accepté au lieu de le refuser)
    if (this.isIOS() && cordova.plugins && cordova.plugins.CordovaCall) {
      try {
        cordova.plugins.CordovaCall.endCall();
      } catch (e) {}
    }

    // IMPORTANT : Si on est dans un appel de groupe basculé vers 1-à-1,
    // il faut quitter l'appel de groupe proprement pour nettoyer tous les états
    if (this.groupRoomId && this.groupDowngradingToOneToOne) {
      console.log("🔄 [HANGUP] Appel de groupe basculé vers 1-à-1 : quitter l'appel de groupe");
      this.groupDowngradingToOneToOne = false;
      this.leaveGroupCall("Appel terminé");
      return;
    }

    // Arrêter le partage d'écran avant de nettoyer
    if (this.isScreenSharing) {
      console.log("[SCREEN] hangUp: arrêt du partage d'écran");
      if (this.screenStream) {
        this.screenStream.getTracks().forEach((track) => track.stop());
        this.screenStream = null;
      }
      this.isScreenSharing = false;
      this._cameraTrackBackup = null;
    }

    if (sendSignalToPeer && this.targetUserId) {
      this.sendSignal({
        type: "call-end",
        targetId: this.targetUserId,
      });
    }

    // Android: Libérer le périphérique audio de communication
    if (this.isAndroid() && window.cordova && cordova.exec) {
      cordova.exec(
        () => console.log("✅ [HANGUP] clearRoute OK"),
        (err) => console.warn("⚠️ [HANGUP] clearRoute error:", err),
        "AudioRoutePlugin",
        "clearRoute",
        [],
      );
    }

    // Masquer l'UI d'abord (évite flash / écran noir), puis libérer les médias
    this.closeInterfaces();
    this.cleanCallState();
    
    // IMPORTANT : S'assurer que le bouton d'appel est désactivé
    this.toggleCallButtons(false);
    this.targetUserId = null;
    this.peerConnection = null;
    this.localStream = null;
    this.isVideoCall = false;
    this.toggleCallButtons(false);
    this.updateStatus("En ligne");
    this.closeNativeIncomingCallScreenIfNeeded();
  };

  // Alias attendu par le bouton flèche-retour de interface-1 :
  // pendant un appel, "retour" doit raccrocher, pas juste masquer l'écran.
  closeInterface = () => {
    this.hangUp();
  };

  cleanCallState = () => {
    this.clearNativeCallNotification();

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    const localVideo = document.getElementById("local-video");
    const remoteVideo = document.getElementById("remote-video");
    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;
    this.remoteStreamRef = null;
    this.videosSwapped = false;
    this.wasSwappedBeforeShare = false;
    ["remoteAudio", "remote-audio"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        try {
          el.pause();
        } catch (e) {}
        el.srcObject = null;
      }
    });

    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch (e) {}
      this.peerConnection = null;
    }
    // Nettoyer aussi l'ancien peerConnection de transition s'il existe
    if (this._oldPeerConnection) {
      this.closePeerConnectionSilently(this._oldPeerConnection);
      this._oldPeerConnection = null;
    }
    this.activeRTC = null;

    this.stopTimer();
    this.stopVibration();

    this.pendingOffer = null;
    this.currentCallId = null;
    this.currentNotId = null;
    this.targetUserId = null;
    this.pendingCandidates = [];
    this.autoAcceptOnOffer = false;
    this._acceptInProgress = false;
    this.isRestartingIce = false;
    this.isVideoCall = false;
    this.isCameraOff = false;
    this.isMuted = false;
    this.isScreenSharing = false;
    this.screenStream = null;
    this._cameraTrackBackup = null;
    this.remoteScreenSharing = false;
    this.shareFillMode = false;
    this.applyScreenShareUI();
    this.updateMicUI();
    document
      .querySelectorAll(".js-remote-mute-badge")
      .forEach((badge) => badge.classList.remove("show"));
    document
      .querySelectorAll(".js-remote-camera-badge")
      .forEach((badge) => badge.classList.remove("show"));

    // Reset video call states
    this.setCallingState(false);
    this.setIncomingVideoState(false);
    this.resetControlsVisibility();
    this.resetPipPosition();
    this.resetIncomingCameraToggleUI();
    this.cancelControlsAutoHide();

    // Réafficher le placeholder de la vidéo distante
    const placeholder = document.querySelector(".remote-video-placeholder");
    if (placeholder) placeholder.classList.remove("hidden");
    this.hideCallToast();
    this.isFrontCamera = true;
    this.isSwitchingCamera = false;
    this.isRenegotiating = false;
    this.isSpeakerOn = true;
    this.toggleCallControlButtons(true);

    const switchCameraBtn = document.getElementById("btn-switch-camera");
    if (switchCameraBtn) switchCameraBtn.disabled = false;

    localStorage.removeItem("pending_call_id");
  };

  // Confirmation locale brève d'une action sur SON PROPRE micro/caméra (ex: "Micro coupé") —
  // à ne pas confondre avec les badges .remote-status-badge, qui signalent l'état du
  // CORRESPONDANT. Réinitialisé un appel plus tôt, un déclenchement rapproché (ex: micro puis
  // caméra coupés coup sur coup) remplace simplement le message affiché.
  showCallToast = (message) => {
    const toast = document.getElementById("call-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(this.callToastTimer);
    this.callToastTimer = setTimeout(
      () => toast.classList.remove("show"),
      1800,
    );
  };

  hideCallToast = () => {
    clearTimeout(this.callToastTimer);
    const toast = document.getElementById("call-toast");
    if (toast) toast.classList.remove("show");
  };

  toggleMicrophone = () => {
    if (!this.localStream) return;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (!audioTrack) return;

    this.isMuted = !this.isMuted;
    audioTrack.enabled = !this.isMuted;
    this.updateMicUI();
    if (this.isMuted) this.showCallToast("Micro coupé");

    if (this.targetUserId) {
      this.sendSignal({
        type: "peer-mic-state",
        targetId: this.targetUserId,
        muted: this.isMuted,
      });
    }
  };

  // Avertit l'autre partie d'une coupure/réactivation du micro (relais "peer-mic-state" côté
  // serveur, voir serveurios.js). Chaque camp affiche un badge quand SON correspondant est
  // coupé — indépendant de son propre état de micro.
  handleRemoteMicState = (data) => {
    document.querySelectorAll(".js-remote-mute-badge").forEach((badge) => {
      badge.classList.toggle("show", !!data.muted);
    });
  };

  handleRemoteCameraState = (data) => {
    document.querySelectorAll(".js-remote-camera-badge").forEach((badge) => {
      badge.classList.toggle("show", !!data.cameraOff);
    });
  };

  // Avertit l'autre partie d'une coupure/réactivation de SA caméra (même mécanisme que
  // sendCameraState -> peer-camera-state, symétrique de peer-mic-state pour le micro).
  sendCameraState = () => {
    if (this.targetUserId) {
      this.sendSignal({
        type: "peer-camera-state",
        targetId: this.targetUserId,
        cameraOff: this.isCameraOff,
      });
    }
  };

  // Le micro existe dans deux interfaces (appel audio et appel vidéo) : on met à jour toutes
  // les copies (un id HTML ne peut désigner qu'un seul élément, d'où les classes js-mic-*).
  updateMicUI = () => {
    document
      .querySelectorAll(".js-mic-btn")
      .forEach((btn) => btn.classList.toggle("active-mute", this.isMuted));
    document.querySelectorAll(".js-mic-icon").forEach((icon) => {
      icon.className = this.isMuted
        ? "fa-solid fa-microphone-slash js-mic-icon"
        : "fa-solid fa-microphone js-mic-icon";
    });
    document.querySelectorAll(".js-mic-label").forEach((label) => {
      label.textContent = this.isMuted
        ? label.dataset.labelMuted || "Activer le micro"
        : label.dataset.labelOn || "Désactiver le micro";
    });
  };

  // Android: Gestion AudioRoute

  // =========================================================
// Android: Gestion AudioRoute (style WhatsApp)
// =========================================================

  getAudioRoutes = () => {
    return new Promise((resolve) => {
      if (!window.cordova || !cordova.exec) {
        console.warn("⚠️ getAudioRoutes: pas de cordova");
        resolve({ routes: ["earpiece", "speaker"], current: this.currentAudioRoute || "earpiece" });
        return;
      }
      cordova.exec(
        (result) => {
          console.log("✅ getAudioRoutes:", result);
          resolve(result);
        },
        (err) => {
          console.error("❌ getAudioRoutes FAILED (plugin non chargé?):", err);
          resolve({ routes: ["earpiece", "speaker"], current: this.currentAudioRoute || "earpiece" });
        },
        "AudioRoutePlugin",
        "getRoutes",
        [],
      );
    });
  };

  setAudioRoute = (route) => {
    return new Promise((resolve) => {
      console.log("🔊 [JS] setAudioRoute demandé:", route);
      if (!window.cordova || !cordova.exec) {
        // Mode navigateur : simuler le changement
        this.currentAudioRoute = route;
        this.isSpeakerOn = route === "speaker";
        this.updateAudioRouteIcon();
        resolve(route);
        return;
      }

      // Vérifier si le plugin existe
      if (!cordova.plugins || !cordova.plugins.AudioRoutePlugin) {
        console.warn("⚠️ [JS] AudioRoutePlugin non disponible, simulation locale");
        this.currentAudioRoute = route;
        this.isSpeakerOn = route === "speaker";
        this.updateAudioRouteIcon();
        resolve(route);
        return;
      }

      cordova.exec(
        (realRoute) => {
          // Android retourne la route RÉELLEMENT active (pas la route demandée)
          console.log("✅ [JS] setAudioRoute - route réelle confirmée par Android:", realRoute);
          this.currentAudioRoute = realRoute || route;
          this.isSpeakerOn = this.currentAudioRoute === "speaker";
          this.updateAudioRouteIcon();

          // Si la route demandée != route réelle, c'est un problème
          if (realRoute !== route) {
            console.warn("⚠️ [JS] Incohérence: demandé=" + route + " réel=" + realRoute);
          }

          resolve(realRoute);
        },
        (err) => {
          console.error("❌ [JS] setAudioRoute FAILED:", err);
          // En cas d'erreur, on continue quand même avec une simulation locale
          console.warn("⚠️ [JS] Utilisation de fallback local pour la route audio");
          this.currentAudioRoute = route;
          this.isSpeakerOn = route === "speaker";
          this.updateAudioRouteIcon();
          resolve(route);
        },
        "AudioRoutePlugin",
        "setRoute",
        [route],
      );
    });
  };

  // Écoute les changements automatiques (Bluetooth connecté/déconnecté)
  startAudioRouteListening = () => {
    if (!window.cordova || cordova.platformId === "browser" || !cordova.exec) {
      return;
    }

    console.log("🎧 Démarrage écoute AudioRoutePlugin...");
    cordova.exec(
      (data) => {
        // data = { route, bluetoothAvailable, event }
        console.log("🔄 AudioRoute event:", data);
        if (!data) return;

        if (data.route) {
          this.currentAudioRoute = data.route;
          this.isSpeakerOn = data.route === "speaker";
          this.updateAudioRouteIcon();
        }

        // Si le menu est ouvert et que Bluetooth apparaît/disparaît → rafraîchir la liste
        const menu = document.getElementById("audio-route-menu");
        if (
          menu &&
          menu.classList.contains("open") &&
          (data.event === "bluetooth_added" || data.event === "bluetooth_removed")
        ) {
          menu.classList.remove("open");
          this.toggleAudioRouteMenu();
        }
      },
      (err) => console.warn("⚠️ AudioRoute listening error:", err),
      "AudioRoutePlugin",
      "startListening",
      [],
    );
  };

  

  // Ferme le menu audio si on clique ailleurs
  _closeAudioRouteMenuOnOutside = (e) => {
    const menu = document.getElementById("audio-route-menu");
    const btn = document.getElementById("btn-audio-route");
    if (!menu || !menu.classList.contains("open")) return;
    if (menu.contains(e.target) || (btn && btn.contains(e.target))) return;
    menu.classList.remove("open");
    document.removeEventListener("click", this._closeAudioRouteMenuOnOutside, true);
  };

  toggleAudioRouteMenu = async () => {
    const menu = document.getElementById("audio-route-menu");
    if (!menu) return;

    // Si déjà ouvert → fermer
    if (menu.classList.contains("open")) {
      menu.classList.remove("open");
      document.removeEventListener("click", this._closeAudioRouteMenuOnOutside, true);
      return;
    }

    const { routes, current } = await this.getAudioRoutes();
    this.currentAudioRoute = current || "earpiece";
    this.updateAudioRouteIcon();

    menu.innerHTML = "";

    (routes || ["earpiece", "speaker"]).forEach((route) => {
      const item = document.createElement("div");
      const isActive = route === this.currentAudioRoute;
      item.className = "audio-route-item" + (isActive ? " active" : "");

      item.innerHTML = `
        <i class="${CallManager.ROUTE_ICONS[route] || "fa-solid fa-volume-high"}"></i>
        <span>${CallManager.ROUTE_LABELS[route] || route}</span>
        ${isActive ? '<i class="fa-solid fa-check route-check"></i>' : ""}
      `;

      item.onclick = async (ev) => {
        ev.stopPropagation();
        const realRoute = await this.setAudioRoute(route);
        // this.currentAudioRoute est déjà mis à jour par setAudioRoute avec la route réelle
        this.isSpeakerOn = this.currentAudioRoute === "speaker";
        this.updateAudioRouteIcon();
        menu.classList.remove("open");
        document.removeEventListener("click", this._closeAudioRouteMenuOnOutside, true);
      };

      menu.appendChild(item);
    });

    menu.classList.add("open");

    // Fermer au clic extérieur (après un micro-délai pour ne pas fermer immédiatement)
    setTimeout(() => {
      document.addEventListener("click", this._closeAudioRouteMenuOnOutside, true);
    }, 50);
  };

  updateAudioRouteIcon = () => {
    const icon = document.getElementById("audio-route-icon");
    const btn = document.getElementById("btn-audio-route");
    const route = this.currentAudioRoute || "earpiece";

    if (icon) {
      icon.className =
        CallManager.ROUTE_ICONS[route] || "fa-brands fa-bluetooth-b";
    }

    // Style WhatsApp : bouton blanc quand ce n'est pas l'écouteur
    if (btn) {
      if (route === "earpiece") {
        btn.classList.remove("audio-active");
      } else {
        btn.classList.add("audio-active");
      }
    }
  };

  // Gestion haut-parleur (Android + iOS)
  toggleSpeaker = async () => {
    this.isSpeakerOn = !this.isSpeakerOn;

    if (this.isAndroid()) {
      // Android: Utiliser AudioRoutePlugin
      const newRoute = this.isSpeakerOn ? "speaker" : "earpiece";
      await this.setAudioRoute(newRoute);
      this.currentAudioRoute = newRoute;
    } else if (this.isIOS() && typeof activerAudioSessionIOS === "function") {
      // iOS: Utiliser activerAudioSessionIOS
      activerAudioSessionIOS(this.isSpeakerOn ? "speaker" : "receiver");
    }

    const speakerIcon = document.getElementById("speaker-icon");
    const btn = document.getElementById("btn-toggle-speaker");

    if (this.isSpeakerOn) {
      if (speakerIcon) speakerIcon.className = "fa-solid fa-volume-high";
      if (btn) btn.classList.remove("disabled");
    } else {
      if (speakerIcon) speakerIcon.className = "fa-solid fa-volume-low";
      if (btn) btn.classList.add("disabled");
    }
  };

  /* =========================================================
   6. UI & TIMERS
========================================================= */

  updateStatus = (message) => {
    const statusElement = document.querySelectorAll(".status-bar");
    for (let i = 0; i < statusElement.length; i++) {
      statusElement[i].innerText = message;
    }
    const homeStatus = document.getElementById("status");
    if (homeStatus) {
      const label = homeStatus.querySelector(".status-label");
      if (label) label.textContent = message;
      homeStatus.classList.toggle("is-connected", /^(en ligne|connecté)$/i.test(message.trim()));
    }
  };

  // Active/désactive les boutons de contrôle d'appel (micro, caméra, switch caméra,
  // haut-parleur) côté appelant. Utilisé pour les garder désactivés tant que
  // l'appelé n'a pas encore accepté l'appel (bouton raccrocher non concerné,
  // il doit rester utilisable pour annuler l'appel en cours).
  toggleCallControlButtons = (enabled) => {
    // Boutons vidéo (ids stables dans interface-3)
    const ids = [
      "btn-toggle-mic",
      "btn-toggle-camera",
      "btn-switch-camera",
      "btn-toggle-speaker",
    ];
    ids.forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.disabled = !enabled;
      if (enabled) {
        btn.classList.remove("disabled");
      } else {
        btn.classList.add("disabled");
      }
    });

    // Tous les boutons micro (classes js-mic-btn : audio + vidéo)
    document.querySelectorAll(".js-mic-btn").forEach((btn) => {
      btn.disabled = !enabled;
      if (enabled) {
        btn.classList.remove("disabled");
      } else {
        btn.classList.add("disabled");
      }
    });

    // Interface d'appel audio (interface-1) : les boutons "Audio", "Vidéo",
    // "Plus" et "Partager" n'ont pas d'id dans le HTML de référence (qu'on ne
    // modifie pas), donc on les cible par leur position dans le panneau de
    // contrôle. Le bouton "Terminer" (classe .hangup) est explicitement exclu
    // pour rester utilisable et permettre d'annuler l'appel en cours.
    if (this.interfaceSender) {
      const audioPanelButtons = this.interfaceSender.querySelectorAll(
        ".control-panel button:not(.hangup)",
      );
      audioPanelButtons.forEach((btn) => {
        btn.disabled = !enabled;
        if (enabled) {
          btn.classList.remove("disabled");
        } else {
          btn.classList.add("disabled");
        }
      });
    }
  };

  toggleCallButtons = (inCall) => {
    const callButton = document.getElementById("btn-call");
    if (callButton) callButton.disabled = inCall;

    const hangupButton = document.getElementById("btn-hangup");
    if (hangupButton) hangupButton.disabled = !inCall;
  };

  // Empêche l'écran de se verrouiller le temps d'un appel (audio ou vidéo), via
  // cordova-plugin-insomnia (fonctionne sur iOS et Android). Activé/désactivé depuis
  // showInterface()/closeInterfaces(), seuls points de passage communs à l'ouverture et à la
  // fermeture de toute interface d'appel (entrant, sortant, audio, vidéo).
  setScreenKeptAwake = (enabled) => {
    const insomnia = window.plugins && window.plugins.insomnia;
    if (!insomnia) return;

    const onError = (err) =>
      console.warn("⚠️ [setScreenKeptAwake] erreur:", err);
    if (enabled) {
      insomnia.keepAwake(() => {}, onError);
    } else {
      insomnia.allowSleepAgain(() => {}, onError);
    }
  };

  showInterface = (activeInterface) => {
    // ✅ FIX "aucune image ne s'affiche" : on ne bascule QUE l'affichage des
    // écrans ici (hideAllInterfaces), on ne touche plus aux <video>. Avant ce
    // correctif, showInterface() appelait closeInterfaces() — qui remet
    // systématiquement local-video/remote-video.srcObject à null et les passe
    // en display:none — À CHAQUE changement d'écran, y compris celui qui bascule
    // VERS l'appel vidéo lui-même. Résultat : initMediaAndPeer() attachait bien
    // le flux caméra local à <video id="local-video">, mais l'appel à
    // showInterface(this.interfaceVideo) qui suit immédiatement (dans makeCall,
    // acceptCall, handleCallAnswered...) l'effaçait aussitôt. closeInterfaces()
    // reste utilisé tel quel — mais uniquement au raccrochage (hangUp/rejectCall),
    // où ce nettoyage complet des flux est réellement voulu.
    this.hideAllInterfaces();
    if (activeInterface) activeInterface.classList.add("active");
    this.setScreenKeptAwake(!!activeInterface);

    if (activeInterface === this.interfaceVideo) {
      const localV = document.getElementById("local-video");
      const remoteV = document.getElementById("remote-video");
      if (localV) localV.style.display = "";
      if (remoteV) remoteV.style.display = "";
      document.body.classList.add("video-call-active");

      // fixed uniquement pendant l'appel vidéo (évite rectangle noir après hangUp)
      const localWrap = document.querySelector(".local-video-wrapper");
      if (localWrap) {
        localWrap.style.position = "fixed";
        localWrap.style.zIndex = "9999";
        localWrap.style.touchAction = "none";
      }

      // Initialiser le toggle des contrôles pour l'appel vidéo
      this.initControlsToggle();
    } else {
      document.body.classList.remove("video-call-active");
      // Repart d'un style propre si jamais on quitte l'écran vidéo sans
      // raccrocher (closeInterfaces() ne le fait plus pour nous ici).
      const localWrap = document.querySelector(".local-video-wrapper");
      if (localWrap) localWrap.style.cssText = "";
    }

    if (
      activeInterface === this.interfaceVideo &&
      this.isIOS() &&
      cordova.plugins &&
      cordova.plugins.iosrtc
    ) {
      cordova.plugins.iosrtc.refreshVideos();
      setTimeout(() => cordova.plugins.iosrtc.refreshVideos(), 300);
    }
  };

  // Ferme uniquement les écrans (retire .active) — sans toucher aux flux vidéo.
  // Utilisé par showInterface() à chaque changement d'écran normal.
  hideAllInterfaces = () => {
    document.querySelectorAll(".view-container").forEach((el) => {
      el.classList.remove("active");
    });
  };

  // Nettoyage COMPLET (écrans + flux vidéo) : réservé à la fin d'appel réelle
  // (hangUp/rejectCall) — ne plus appeler depuis showInterface().

  closeInterfaces = () => {
    this.interfaceReceiver =
      this.interfaceReceiver || document.getElementById("interface-2");
    this.interfaceSender =
      this.interfaceSender || document.getElementById("interface-1");
    this.interfaceVideo =
      this.interfaceVideo || document.getElementById("interface-3");

    // 1) Masquer les <video> AVANT de retirer .active (iosrtc + flash noir)
    ["local-video", "remote-video"].forEach((id) => {
      const v = document.getElementById(id);
      if (!v) return;
      try {
        v.pause();
      } catch (e) {}
      v.srcObject = null;
      v.removeAttribute("src");
      v.style.display = "none";
      try {
        v.load();
      } catch (e) {}
    });

    // 2) Reset complet des styles inline de la mini-vidéo (fixed / z-index)
    const localWrap = document.querySelector(".local-video-wrapper");
    if (localWrap) {
      localWrap.style.cssText = "";
    }

    // 3) Fermer tous les overlays
    document.querySelectorAll(".view-container").forEach((el) => {
      el.classList.remove("active");
    });
    document.body.classList.remove("video-call-active");
    this.setScreenKeptAwake(false);

    // 4) iosrtc : refresh après masquage
    if (
      this.isIOS() &&
      window.cordova &&
      cordova.plugins &&
      cordova.plugins.iosrtc
    ) {
      try {
        cordova.plugins.iosrtc.refreshVideos();
      } catch (e) {}
      setTimeout(() => {
        try {
          cordova.plugins.iosrtc.refreshVideos();
        } catch (e) {}
      }, 120);
    }
  };

  startTimer = () => {
    let secondes = 0;
    if (this.timerInterval) return;

    this.timerInterval = setInterval(() => {
      secondes++;
      const h = String(Math.floor(secondes / 3600)).padStart(2, "0");
      const m = String(Math.floor((secondes % 3600) / 60)).padStart(2, "0");
      const s = String(secondes % 60).padStart(2, "0");

      const timerElement = document.getElementById("timer");
      const timerVideo = document.getElementById("timer-video");
      if (timerElement) timerElement.textContent = `${h}:${m}:${s}`;
      if (timerVideo) timerVideo.textContent = `${h}:${m}:${s}`;
    }, 1000);
  };

  stopTimer = () => {
    clearInterval(this.timerInterval);
    this.timerInterval = null;
    const timerElement = document.getElementById("timer");
    const timerVideo = document.getElementById("timer-video");
    if (timerElement) timerElement.textContent = "00:00:00";
    if (timerVideo) timerVideo.textContent = "00:00:00";
  };

  toggleCamera = async () => {
    // Cas 1: on a déjà une piste vidéo locale
    if (this.localStream && this.localStream.getVideoTracks().length > 0) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      this.isCameraOff = !this.isCameraOff;
      videoTrack.enabled = !this.isCameraOff;
      this.updateCameraIcon();
      this.sendCameraState();
      if (this.isCameraOff) this.showCallToast("Caméra coupée");

      // ⚠️ Contrairement à Android/Chromium, iosrtc n'affiche pas d'écran noir sur une piste
      // vidéo désactivée (track.enabled = false) : la vue native continue de peindre la
      // dernière image reçue, figée. On détache/réattache donc le flux de la miniature locale
      // pour forcer l'équivalent — ça n'a aucun effet sur ce qui est envoyé à l'interlocuteur
      // (la piste réellement transmise reste celle du this.peerConnection, gérée séparément).
      this.applyVideoLayout(this.videosSwapped);
      this.showLocalVideoPlaceholder(this.isCameraOff);
      return;
    }

    // Cas 2: pas encore de caméra locale
    if (!this.peerConnection || !this.localStream) return;

    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
      });
      const videoTrack = videoStream.getVideoTracks()[0];
      if (!videoTrack) return;

      console.log("📹 Piste vidéo obtenue, readyState:", videoTrack.readyState);

      this.localStream.addTrack(videoTrack);

      const videoTransceiver = this.peerConnection
        .getTransceivers()
        .find(
          (t) =>
            t.receiver && t.receiver.track && t.receiver.track.kind === "video",
        );

      if (videoTransceiver) {
        await videoTransceiver.sender.replaceTrack(videoTrack);
        // IMPORTANT : passer la direction à sendrecv pour envoyer aussi la vidéo
        videoTransceiver.direction = "sendrecv";
        console.log("📹 Transceiver direction changée en sendrecv");
      } else {
        this.peerConnection.addTrack(videoTrack, this.localStream);
        console.log("📹 Piste vidéo ajoutée au peerConnection");
      }

      this.applyVideoLayout(this.videosSwapped);

      this.showLocalVideoPlaceholder(false);
      this.isRenegotiating = true;
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      console.log("📹 Offre créée avec piste vidéo, signalingState:", this.peerConnection.signalingState);
      this.sendSignal({
        type: "restart-offer",
        targetId: this.targetUserId,
        offer: offer,
        isVideo: true,
        isVideoUpgrade: true,
      });
      console.log("📹 Caméra activée manuellement, renégociation envoyée");

      this.isCameraOff = false;
      this.isVideoCall = true; // S'assurer que isVideoCall est true
      this.updateCameraIcon();
      this.sendCameraState();
    } catch (error) {
      console.error("❌ Erreur activation caméra :", error);
      this.isRenegotiating = false;
    }
  };

  // Bascule caméra avant <-> arrière. Le capteur précédent est libéré AVANT d'ouvrir le
  // suivant (Android n'autorise pas deux caméras ouvertes), puis la piste envoyée à
  // l'interlocuteur est remplacée à chaud (replaceTrack) : pas de renégociation SDP.
  switchCamera = async () => {
    if (this.isSwitchingCamera || !this.localStream) return;
    const oldTrack = this.localStream.getVideoTracks()[0];
    if (!oldTrack) return;

    const button = document.getElementById("btn-switch-camera");
    this.isSwitchingCamera = true;
    if (button) button.disabled = true;

    const openCamera = async (front) => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: front ? "user" : "environment" } },
      });
      return stream.getVideoTracks()[0];
    };

    const wasFront = this.isFrontCamera;
    const videoSender = this.peerConnection
      ? this.peerConnection
          .getSenders()
          .find((s) => s.track && s.track.kind === "video")
      : null;
    oldTrack.stop();
    this.localStream.removeTrack(oldTrack);

    let newTrack = null;
    try {
      newTrack = await openCamera(!wasFront);
      this.isFrontCamera = !wasFront;
    } catch (error) {
      console.error(
        "❌ Caméra " + (wasFront ? "arrière" : "avant") + " indisponible :",
        error,
      );
      try {
        newTrack = await openCamera(wasFront);
      } catch (restoreError) {
        console.error(
          "❌ Impossible de rouvrir la caméra d'origine :",
          restoreError,
        );
      }
    }

    try {
      if (newTrack) {
        newTrack.enabled = !this.isCameraOff;
        this.localStream.addTrack(newTrack);

        if (videoSender) await videoSender.replaceTrack(newTrack);
      }
    } catch (error) {
      console.error("❌ Erreur remplacement piste vidéo :", error);
    }

    this.applyVideoLayout(this.videosSwapped);
    const localVideo = document.getElementById("local-video");
    if (localVideo) {
      localVideo.play().catch(() => {});
    }
    if (this.isIOS() && cordova.plugins && cordova.plugins.iosrtc) {
      cordova.plugins.iosrtc.refreshVideos();
    }

    this.isSwitchingCamera = false;
    if (button) button.disabled = false;
  };

  updateCameraIcon = () => {
    const cameraIcon = document.getElementById("camera-icon");
    const btn = document.getElementById("btn-toggle-camera");

    if (this.isCameraOff) {
      if (cameraIcon) cameraIcon.className = "fa-solid fa-video-slash";
      if (btn) btn.classList.add("disabled");
    } else {
      if (cameraIcon) cameraIcon.className = "fa-solid fa-video";
      if (btn) btn.classList.remove("disabled");
    }
  };

  showLocalVideoPlaceholder = (show) => {
    const placeholder = document.getElementById("local-video-placeholder");
    if (placeholder) placeholder.style.display = show ? "flex" : "none";
  };

  /* =========================================================
     PARTAGE D'ÉCRAN (1-à-1 et groupe)
  ========================================================= */

  isScreenShareSupported = () => {
    const hasGetDisplayMedia =
      !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function");
    // Android Cordova : getDisplayMedia absent dans la WebView -> plugin natif MediaProjection
    // iOS Cordova : même principe avec ReplayKit
    const hasNativePlugin =
      !!(window.ScreenShareLive &&
         window.cordova &&
         (window.cordova.platformId === "android" || window.cordova.platformId === "ios"));
    console.log("[SCREEN] getDisplayMedia =", hasGetDisplayMedia, "| plugin natif =", hasNativePlugin);
    return hasGetDisplayMedia || hasNativePlugin;
  };

  /**
   * ==========================================================================
   * _useNativeScreenShare - Détermine si on doit utiliser le plugin natif
   * ==========================================================================
   *
   * Vérifie si l'application tourne sur Android ou iOS avec le plugin ScreenShareLive.
   *
   * POURQUOI PAS UTILISER getDisplayMedia ?
   * ----------------------------------------
   * • ANDROID : La WebView Cordova n'expose pas getDisplayMedia (API navigateur)
   * • iOS : WKWebView peut exposer getDisplayMedia mais le rejette (restriction Apple)
   * • Le plugin natif est donc nécessaire sur mobile
   *
   * @returns {boolean} true si on doit utiliser le plugin natif
   */
  _useNativeScreenShare = () =>
    !!(window.ScreenShareLive &&
       window.cordova &&
       (window.cordova.platformId === "android" || window.cordova.platformId === "ios"));

  /**
   * ==========================================================================
   * _startNativeScreenCapture - Démarre la capture d'écran native
   * ==========================================================================
   *
   * Démarre la capture d'écran via le plugin natif (Android MediaProjection ou iOS ReplayKit)
   * et renvoie un MediaStream prêt pour WebRTC.
   *
   * PROCESSUS :
   * ----------
   * 1. Créer un canvas stream via ScreenShareLive.createCanvasStream()
   * 2. Démarrer la capture native via ScreenShareLive.start()
   * 3. Attendre le message "started" (iOS : après choix dans le sélecteur système)
   * 4. Chaque frame JPEG reçue est dessinée sur le canvas
   * 5. Le canvas captureStream crée un MediaStream
   * 6. Renvoyer le MediaStream pour WebRTC replaceTrack()
   *
   * GESTION DES MESSAGES :
   * ---------------------
   * • "started" - La capture a démarré (résoudre la Promise)
   * • "stopped" - La capture a été arrêtée (appeler stopScreenShare)
   * • {type: "frame", jpeg: "..."} - Nouvelle frame disponible (dessiner sur canvas)
   *
   * SPÉCIFICITÉS iOS :
   * -----------------
   * • "started" n'arrive qu'à la PREMIÈRE frame de l'extension Broadcast
   * • Cela se produit APRÈS que l'utilisateur a choisi dans le sélecteur système
   * • Timeout de 60 secondes si aucune frame n'est reçue (utilisateur a annulé)
   * • Message toast guide l'utilisateur ("Choisissez CallApp Screen Share...")
   *
   * CONFIGURATION :
   * --------------
   * • maxWidth: 720 - Réduire la résolution pour réduire la bande passante
   * • maxFps: 10 - Limiter à 10 FPS pour réduire la charge CPU
   * • jpegQuality: 60 - Qualité JPEG 60% (bon compromis qualité/taille)
   *
   * @returns {Promise<MediaStream>} MediaStream alimenté par les frames d'écran
   * @throws {Error} Si la capture échoue ou est annulée
   */
  _startNativeScreenCapture = async () => {
    // Créer un canvas stream (10 FPS)
    const cs = ScreenShareLive.createCanvasStream(10);
    this._screenCanvasStream = cs;

    // iOS : guider l'utilisateur dans le sélecteur système
    if (window.cordova.platformId === "ios") {
      this.showCallToast("Choisissez « CallApp Screen Share » puis « Démarrer la diffusion »");
    }

    try {
      // Démarrer la capture native et attendre "started"
      await new Promise((resolve, reject) => {
        let started = false;

        // Fonction d'annulation (timeout ou erreur)
        const cancel = (reason) => {
          clearTimeout(timer);
          try { ScreenShareLive.stop(() => {}, () => {}); } catch (e) {}
          const err = new Error(reason);
          err.name = "NotAllowedError";
          reject(err);
        };

        // Timeout de 60 secondes (iOS : utilisateur n'a pas choisi dans le sélecteur)
        const timer = setTimeout(() => {
          if (!started) cancel("Aucune diffusion démarrée");
        }, 60000);

        // Démarrer la capture native
        ScreenShareLive.start(
          { maxWidth: 720, maxFps: 10, jpegQuality: 60 }, // Configuration
          (msg) => {
            // Callback pour les messages du plugin natif
            if (msg === "started") {
              started = true;
              clearTimeout(timer);
              resolve();  // La capture a démarré avec succès
              return;
            }
            if (msg === "stopped") {
              // La capture a été arrêtée (par l'utilisateur ou le système)
              if (!started) {
                cancel("Diffusion arrêtée avant démarrage");
                return;
              }
              if (this.isScreenSharing) {
                this.stopScreenShare();  // Arrêt depuis la notification/barre rouge
              }
              return;
            }
            if (msg && msg.type === "frame") {
              // Nouvelle frame disponible : dessiner sur le canvas
              cs.pushJpegBase64(msg.jpeg);
            }
          },
          (err) => {
            // Erreur du plugin natif
            if (!started) {
              clearTimeout(timer);
              reject(err);
            }
          }
        );
      });
    } catch (error) {
      // En cas d'erreur, nettoyer le canvas stream
      try { cs.destroy(); } catch (e) {}
      this._screenCanvasStream = null;
      throw error;
    }

    // Renvoyer le MediaStream pour WebRTC
    return cs.stream;
  };

  canStartScreenShare = () => {
    if (this.groupRoomId || this.groupCreating) {
      if (!this.groupPeers || this.groupPeers.size === 0) {
        this.showCallToast("Aucun participant connecté dans le groupe");
        return false;
      }
      if (this.isScreenSharing) {
        this.showCallToast("Partage d'écran déjà actif");
        return false;
      }
      if (!this.isScreenShareSupported()) {
        this.showCallToast("Partage d'écran non supporté sur cet appareil");
        return false;
      }
      return true;
    }
    if (!this.peerConnection) {
      this.showCallToast("Aucun appel en cours");
      return false;
    }
    if (this.isScreenSharing) {
      this.showCallToast("Partage d'écran déjà actif");
      return false;
    }
    if (!this.isScreenShareSupported()) {
      this.showCallToast("Partage d'écran non supporté sur cet appareil");
      return false;
    }
    return true;
  };

  ensureVideoBeforeScreenShare = async () => {
    console.log("[SCREEN] ensureVideoBeforeScreenShare()");
    if (this.isVideoCall && this.localStream && this.localStream.getVideoTracks().length > 0) {
      console.log("[SCREEN] Caméra déjà active, pas besoin d'upgrade");
      return true;
    }

    try {
      console.log("[SCREEN] Upgrade audio vers vidéo pour partage d'écran");
      this.showCallToast("Activation de la caméra...");
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
      });
      const videoTrack = videoStream.getVideoTracks()[0];
      if (!videoTrack) {
        this.showCallToast("Impossible d'activer la caméra");
        return false;
      }

      const videoTransceiver = this.peerConnection.getTransceivers().find(
        (t) => t.receiver && t.receiver.track && t.receiver.track.kind === "video"
      );
      const videoSender = this.peerConnection.getSenders().find(
        (sender) => sender.track && sender.track.kind === "video"
      );
      if (videoSender) {
        await videoSender.replaceTrack(videoTrack);
      } else if (videoTransceiver) {
        await videoTransceiver.sender.replaceTrack(videoTrack);
        videoTransceiver.direction = "sendrecv";
      } else {
        this.peerConnection.addTrack(videoTrack, this.localStream);
      }
      if (!this.localStream.getVideoTracks().includes(videoTrack)) this.localStream.addTrack(videoTrack);

      this.applyVideoLayout(this.videosSwapped);

      this.showLocalVideoPlaceholder(false);
      this.isRenegotiating = true;
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      this.sendSignal({
        type: "restart-offer",
        targetId: this.targetUserId,
        offer: offer,
        isVideo: true,
        isVideoUpgrade: true,
      });

      this.isCameraOff = false;
      this.isVideoCall = true;
      this.updateCameraIcon();
      this.sendCameraState();

      await new Promise((resolve) => setTimeout(resolve, 500));
      this.isRenegotiating = false;
      console.log("[SCREEN] Upgrade vidéo terminé avec succès");
      return true;
    } catch (error) {
      console.error("[SCREEN] Erreur activation caméra pour partage :", error);
      this.showCallToast("Caméra refusée ou indisponible");
      this.isRenegotiating = false;
      return false;
    }
  };

  startGroupScreenShare = async () => {
    if (!this.canStartScreenShare()) return;
    try {
      // Le passage audio -> vidéo est explicite : demander la caméra avant le partage.
      if (!this.groupLocalStream || !this.groupLocalStream.getVideoTracks().length) {
        const confirmed = window.confirm("Pour partager votre écran, souhaitez-vous aussi activer votre caméra ?");
        if (!confirmed) return;
        await this.toggleGroupCamera();
        if (!this.groupLocalStream || !this.groupLocalStream.getVideoTracks().length) {
          this.showCallToast("La caméra doit être activée avant le partage");
          return;
        }
      }
      let stream = null;
      if (this._useNativeScreenShare()) {
        const available = await new Promise((resolve) => ScreenShareLive.isAvailable(resolve, () => resolve(false)));
        if (!available) {
          this.showCallToast("Partage d'écran non supporté sur cet appareil");
          return;
        }
        stream = await this._startNativeScreenCapture();
      } else if (navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function") {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      } else {
        throw new Error("Capture d'écran indisponible");
      }
      const track = stream && stream.getVideoTracks()[0];
      if (!track) { if (stream) stream.getTracks().forEach((t) => t.stop()); this.showCallToast("Aucune piste d'écran disponible"); return; }
      this._groupScreenBackups.clear();
      for (const [peerId, peer] of this.groupPeers.entries()) {
        if (!peer || !peer.pc) continue;
        let sender = peer.pc.getSenders().find((item) => item.track && item.track.kind === "video");
        if (!sender) sender = peer.pc.getSenders().find((item) => item.track === null && item.kind === "video");
        if (sender) {
          this._groupScreenBackups.set(peerId, sender.track || null);
          await sender.replaceTrack(track);
        } else {
          sender = peer.pc.addTrack(track, stream);
          this._groupScreenBackups.set(peerId, null);
          await this.renegotiateWithPeer(peerId);
        }
      }
      this.screenStream = stream;
      this._groupScreenTrack = track;
      this.isScreenSharing = true;
        // Pendant le partage : disposition canonique (mémoriser le swap pour la restauration)
        this.wasSwappedBeforeShare = this.videosSwapped;
        this.applyVideoLayout(false);
      // Mettre à jour mon propre état de partage d'écran
      this.groupPeerStates.set(this.myId, {
        micMuted: this.groupIsMuted,
        camOff: this.groupIsCamOff,
        screenSharing: true
      });
      this.sendGroupSignalToAll({ kind: "state", micMuted: this.groupIsMuted, camOff: this.groupIsCamOff, screenSharing: true });
      this.updateScreenShareUI(true);
      this.renderGroupGrid(); // Recharger la grille pour appliquer le layout
      this.showCallToast("Partage d'écran de groupe activé");
      track.onended = () => this.stopScreenShare();
    } catch (error) {
      console.error("[SCREEN][GROUP] Erreur partage d'écran :", error);
      this.showCallToast(error && error.name === "NotAllowedError" ? "Partage d'écran annulé" : "Impossible de partager l'écran en groupe");
    }
  };

  startScreenShare = async () => {
    console.log("[SCREEN] startScreenShare()");
    if (this.groupRoomId || this.groupCreating) return this.startGroupScreenShare();
    if (!this.canStartScreenShare()) return;

    // ====================================================================
    // CHEMIN 1 : NAVIGATEUR (getDisplayMedia natif)
    // ====================================================================
    // Sur PC Chrome/Firefox/Edge, getDisplayMedia fonctionne nativement
    // On utilise le chemin standard sans plugin
    if (!this._useNativeScreenShare() && navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function") {
      console.log("[SCREEN] path=browser (getDisplayMedia natif)");

      const videoReady = await this.ensureVideoBeforeScreenShare();
      if (!videoReady) return;

      try {
        console.log("[SCREEN] Appel getDisplayMedia...");
        this.screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });

        const screenTrack = this.screenStream.getVideoTracks()[0];
        if (!screenTrack) {
          this.showCallToast("Aucune piste vidéo d'écran");
          return;
        }

        const videoSender = this.peerConnection
          .getSenders()
          .find((s) => s.track && s.track.kind === "video");

        if (videoSender && videoSender.track) {
          this._cameraTrackBackup = videoSender.track;
          await videoSender.replaceTrack(screenTrack);
          console.log("[SCREEN] replaceTrack OK");
        } else {
          this.peerConnection.addTrack(screenTrack, this.screenStream);
          console.log("[SCREEN] addTrack OK (pas de sender vidéo existant)");
        }

        this.isScreenSharing = true;
        // Pendant le partage : disposition canonique (mémoriser le swap pour la restauration)
        this.wasSwappedBeforeShare = this.videosSwapped;
        this.applyVideoLayout(false);
        // Pas d'aperçu de sa propre capture (comme WhatsApp) : bandeau « Vous partagez » via applyScreenShareUI.

        this.sendScreenShareState(true);
        this.updateScreenShareUI(true);
        this.showCallToast("Partage d'écran activé");

        screenTrack.onended = () => {
          console.log("[SCREEN] Track écran terminée (OS) - isScreenSharing:", this.isScreenSharing);
          // Délai pour éviter les conflits si stopScreenShare est déjà en cours
          if (this.isScreenSharing) {
            console.log("[SCREEN] Appel de stopScreenShare depuis onended");
            this.stopScreenShare();
          } else {
            console.log("[SCREEN] Partage déjà arrêté, on ignore");
          }
        };

        // Écouter aussi les changements d'état de la track (readyState)
        const checkTrackState = () => {
          if (screenTrack.readyState === 'ended' && this.isScreenSharing) {
            console.log("[SCREEN] Track ended détecté via readyState check");
            this.stopScreenShare();
          }
        };

        // Polling pour détecter l'arrêt du partage ( Chrome ne déclenche pas toujours onended )
        const stateCheckInterval = setInterval(() => {
          if (!this.isScreenSharing) {
            clearInterval(stateCheckInterval);
            return;
          }
          if (screenTrack.readyState === 'ended') {
            console.log("[SCREEN] Track ended détecté via polling");
            clearInterval(stateCheckInterval);
            this.stopScreenShare();
          }
        }, 500);
      } catch (error) {
        console.error("[SCREEN] getDisplayMedia error:", error.name, error.message);
        if (error.name === "NotAllowedError" || error.name === "abort") {
          this.showCallToast("Partage d'écran annulé");
        } else if (error.name === "NotSupportedError" || !this.isScreenShareSupported()) {
          this.showCallToast("Non supporté sur cet appareil");
        } else {
          this.showCallToast("Impossible de partager l'écran");
        }
      }
      return;
    }

    // ====================================================================
    // CHEMIN 2 : ANDROID/iOS CORDOVA (plugin natif ScreenShareLive)
    // ====================================================================
    // Sur Android Cordova, getDisplayMedia est absent dans la WebView
    // Sur iOS Cordova, ReplayKit nécessite un plugin natif
    // On utilise le plugin cordova-plugin-screenshare-live (MediaProjection Android / ReplayKit iOS)
    console.log("[SCREEN] DEBUG: window.cordova =", !!window.cordova);
    console.log("[SCREEN] DEBUG: window.ScreenShareLive =", !!window.ScreenShareLive);
    console.log("[SCREEN] DEBUG: cordova.platformId =", window.cordova ? window.cordova.platformId : 'N/A');

    if (window.ScreenShareLive) {
      console.log("[SCREEN] path=native (plugin ScreenShareLive -", window.cordova.platformId, ")");

      // Vérifier la disponibilité du plugin
      const pluginAvailable = await new Promise((resolve) => {
        ScreenShareLive.isAvailable(
          (isAvailable) => resolve(isAvailable),
          () => resolve(false)
        );
      });

      if (!pluginAvailable) {
        console.log("[SCREEN] Plugin non disponible sur cet appareil");
        this.showCallToast("Partage d'écran non supporté sur cet appareil");
        return;
      }

      // ensureVideoBeforeScreenShare (logique existante : audio → caméra d'abord)
      const videoReady = await this.ensureVideoBeforeScreenShare();
      if (!videoReady) return;

      try {
        console.log("[SCREEN] Démarrage capture natif...");

        // MediaStream WebRTC issu du canvas alimenté par les frames natives
        const screenStream = await this._startNativeScreenCapture();
        console.log("[SCREEN] Capture natif démarrée");
        const screenTrack = screenStream.getVideoTracks()[0];

        if (!screenTrack) {
          this.showCallToast("Aucune piste vidéo d'écran");
          return;
        }

        console.log("[SCREEN] MediaStream créé depuis canvas - track enabled:", screenTrack.enabled, "readyState:", screenTrack.readyState);

        // Attendre que la piste soit prête (readyState = 'live')
        if (screenTrack.readyState !== 'live') {
          console.log("[SCREEN] Attente que la piste soit live...");
          await new Promise((resolve) => {
            const checkInterval = setInterval(() => {
              if (screenTrack.readyState === 'live') {
                clearInterval(checkInterval);
                resolve();
              }
            }, 50);
            // Timeout après 2 secondes
            setTimeout(() => {
              clearInterval(checkInterval);
              resolve();
            }, 2000);
          });
          console.log("[SCREEN] Piste readyState après attente:", screenTrack.readyState);
        }

        // replaceTrack (logique existante)
        const videoSender = this.peerConnection
          .getSenders()
          .find((s) => s.track && s.track.kind === "video");

        if (videoSender && videoSender.track) {
          this._cameraTrackBackup = videoSender.track;
          await videoSender.replaceTrack(screenTrack);
          console.log("[SCREEN] replaceTrack OK (chemin natif)");
        } else {
          this.peerConnection.addTrack(screenTrack, screenStream);
          console.log("[SCREEN] addTrack OK (pas de sender vidéo existant)");
        }

        this.isScreenSharing = true;
        // Pendant le partage : disposition canonique (mémoriser le swap pour la restauration)
        this.wasSwappedBeforeShare = this.videosSwapped;
        this.applyVideoLayout(false);
        this.screenStream = screenStream;

        // Pas d'aperçu de sa propre capture (comme WhatsApp) : bandeau « Vous partagez » via applyScreenShareUI.

        this.sendScreenShareState(true);
        this.updateScreenShareUI(true);
        this.showCallToast("Partage d'écran activé");

        screenTrack.onended = () => {
          console.log("[SCREEN] Track écran terminée (OS ou natif)");
          this.stopScreenShare();
        };

      } catch (error) {
        console.error("[SCREEN] Erreur chemin natif:", error);
        this.showCallToast(error && error.name === "NotAllowedError" ? "Partage d'écran annulé" : "Impossible de partager l'écran");
      }
      return;
    }

    // ====================================================================
    // CHEMIN 3 : NON SUPPORTÉ
    // ====================================================================
    // Ni getDisplayMedia ni plugin natif disponibles
    console.log("[SCREEN] path=unsupported");
    this.showCallToast("Partage d'écran non supporté sur cet appareil");
  };

  // Après un partage d'une AUTRE application, notre app est passée en arrière-plan : Android
  // coupe alors la caméra (la piste devient « ended » ou reste « muted »). Au retour, la
  // piste de sauvegarde est donc morte et replaceTrack(piste morte) laisse l'envoi en noir.
  // Cette fonction renvoie une piste caméra vivante dans `stream` (en la rouvrant si besoin).
  _ensureLiveCameraTrack = async (stream, { camOff = false } = {}) => {
    if (!stream) return null;
    const isUsable = (t) => t && t.readyState === "live" && !t.muted;

    let track = stream.getVideoTracks()[0] || null;

    // Une piste « muted » peut se réveiller toute seule juste après le retour au premier plan.
    if (track && track.readyState === "live" && track.muted) {
      await new Promise((resolve) => {
        const done = () => { track.removeEventListener("unmute", done); resolve(); };
        track.addEventListener("unmute", done);
        setTimeout(done, 800);
      });
    }
    if (isUsable(track)) {
      track.enabled = !camOff;
      return track;
    }

    // Piste morte → on rouvre la caméra (2 essais : l'app peut ne pas être encore au premier plan).
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const cam = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: this.isFrontCamera === false ? "environment" : "user" },
        });
        const fresh = cam.getVideoTracks()[0];
        if (!fresh) continue;
        stream.getVideoTracks().forEach((t) => { try { t.stop(); } catch (e) {} stream.removeTrack(t); });
        fresh.enabled = !camOff;
        stream.addTrack(fresh);
        console.log("[SCREEN] Caméra rouverte après partage (piste précédente morte)");
        return fresh;
      } catch (err) {
        console.warn("[SCREEN] Réouverture caméra échouée (essai " + (attempt + 1) + ") :", err);
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    return null;
  };

  // Remet la caméra dans l'appel après un partage d'écran (1-à-1 ou groupe). Renvoie false si la
  // caméra n'a pas pu être rouverte (ex. l'app est encore en arrière-plan) : on réessaiera au « resume ».
  _restoreCameraAfterShare = async () => {
    const inGroup = !!(this.groupRoomId || this.groupCreating);

    if (inGroup) {
      const cam = await this._ensureLiveCameraTrack(this.groupLocalStream, { camOff: !!this.groupIsCamOff });
      if (!cam) return false;
      for (const [peerId, peer] of this.groupPeers.entries()) {
        const sender = peer && peer.pc ? this._getVideoSender(peer.pc) : null;
        if (!sender) continue;
        try { await sender.replaceTrack(cam); } catch (e) { console.warn("[SCREEN][GROUP] Restauration caméra impossible", peerId, e); }
      }
      this.renderGroupGrid();
      return true;
    }

    const cameraTrack = await this._ensureLiveCameraTrack(this.localStream, { camOff: !!this.isCameraOff });
    const videoSender = this._getVideoSender(this.peerConnection);
    if (!cameraTrack || !videoSender) {
      console.warn("[SCREEN] Impossible de restaurer la caméra (sender:", !!videoSender, "piste:", !!cameraTrack, ")");
      return false;
    }
    try {
      await videoSender.replaceTrack(cameraTrack);
      console.log("[SCREEN] replaceTrack caméra restaurée");
    } catch (e) {
      console.error("[SCREEN] replaceTrack caméra a échoué :", e);
      return false;
    }

    const localVideo = document.getElementById("local-video");
    // Respecte le swap ; ré-attache pour sortir du noir figé
    if (localVideo && this.localStream) {
      this.applyVideoLayout(this.videosSwapped); // ré-attache selon swap
      localVideo.play().catch(() => {});
    }
    this.showLocalVideoPlaceholder(!!this.isCameraOff);
    if (this.isIOS() && window.cordova && cordova.plugins && cordova.plugins.iosrtc) {
      cordova.plugins.iosrtc.refreshVideos();
    }
    return true;
  };

  // Sender vidéo même si sa piste actuelle est null/terminée.
  _getVideoSender = (pc) => {
    if (!pc) return null;
    const t = pc.getTransceivers().find(
      (tr) =>
        (tr.sender && tr.sender.track && tr.sender.track.kind === "video") ||
        (tr.receiver && tr.receiver.track && tr.receiver.track.kind === "video"),
    );
    return t ? t.sender : null;
  };

  stopScreenShare = async () => {
    console.log("[SCREEN] stopScreenShare() - isScreenSharing:", this.isScreenSharing);
    if (!this.isScreenSharing) {
      console.log("[SCREEN] stopScreenShare() - Partage non actif, retour");
      return;
    }

    // Arrêt spécifique au maillage de groupe : restaurer la piste vidéo de chaque pair.
    if (this.groupRoomId || this.groupCreating) {
      // isScreenSharing à false d'abord : le bandeau disparaît tout de suite et un « stopped » natif ne relance rien.
      this.isScreenSharing = false;
      this.applyScreenShareUI();
      if (window.ScreenShareLive && this._screenCanvasStream) {
        try { ScreenShareLive.stop(() => {}, () => {}); } catch (e) {}
        try { this._screenCanvasStream.destroy(); } catch (e) {}
        this._screenCanvasStream = null;
      }
      if (this.screenStream) this.screenStream.getTracks().forEach((track) => track.stop());
      this.screenStream = null;
      // Caméra vivante remise dans l'appel (rouverte si Android l'a coupée pendant l'arrière-plan)
      if (!(await this._restoreCameraAfterShare())) this._pendingCameraRestore = true;
      this._groupScreenTrack = null;
      this._groupScreenBackups.clear();
      this.isScreenSharing = false;
      // Restaurer le swap éventuel d'avant le partage (localStream / remoteStreamRef)
      this.applyVideoLayout(this.wasSwappedBeforeShare);
      this.wasSwappedBeforeShare = false;
      // Mettre à jour mon propre état de partage d'écran
      this.groupPeerStates.set(this.myId, {
        micMuted: this.groupIsMuted,
        camOff: this.groupIsCamOff,
        screenSharing: false
      });
      this.sendGroupSignalToAll({ kind: "state", micMuted: this.groupIsMuted, camOff: this.groupIsCamOff, screenSharing: false });
      this.updateScreenShareUI(false);
      this.renderGroupGrid(); // Recharger la grille pour revenir au layout normal
      this.showCallToast("Partage d'écran de groupe arrêté");
      return;
    }

    // ====================================================================
    // Arrêter le plugin natif si actif (chemin Android Cordova)
    // ====================================================================
    if (window.ScreenShareLive) {
      console.log("[SCREEN] Arrêt plugin natif...");
      ScreenShareLive.stop(
        () => console.log("[SCREEN] Plugin natif arrêté avec succès"),
        (err) => console.error("[SCREEN] Erreur arrêt plugin natif:", err)
      );
      if (this._screenCanvasStream) {
        this._screenCanvasStream.destroy();
        this._screenCanvasStream = null;
      }
    }

    // ====================================================================
    // Arrêter les tracks du stream (chemin navigateur ou natif)
    // ====================================================================
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((track) => track.stop());
      this.screenStream = null;
    }

    // ====================================================================
    // Restaurer la caméra (piste vivante, replaceTrack, aperçu local)
    // ====================================================================
    // isScreenSharing passe à false d'abord (évite qu'un onended / « stopped » natif relance l'arrêt).
    this.isScreenSharing = false;
    this.applyScreenShareUI(); // le bandeau « Vous partagez » disparaît tout de suite
    if (!(await this._restoreCameraAfterShare())) this._pendingCameraRestore = true;
    this._cameraTrackBackup = null;

    // Restaurer le swap éventuel d'avant le partage (localStream / remoteStreamRef)
    this.applyVideoLayout(this.wasSwappedBeforeShare);
    this.wasSwappedBeforeShare = false;

    // ====================================================================
    // Restaurer l'affichage de la vidéo distante
    // ====================================================================
    const remoteVideo = document.getElementById("remote-video");
    const placeholder = document.querySelector(".remote-video-placeholder");
    if (remoteVideo) {
      // S'assurer que la vidéo distante est visible
      remoteVideo.style.display = "";
      // Si la vidéo distante avait un stream, s'assurer qu'il est toujours attaché
      // (le stream distant ne change pas, mais on vérifie qu'il est toujours là)
      if (remoteVideo.srcObject) {
        remoteVideo.play().catch(() => {});
        // La <video> distante reste souvent noire/figée après le passage en arrière-plan : on la relance aussi un peu plus tard.
        setTimeout(() => {
          const rv = document.getElementById("remote-video");
          if (rv && rv.srcObject) rv.play().catch(() => {});
          if (this.isIOS() && window.cordova && cordova.plugins && cordova.plugins.iosrtc) {
            cordova.plugins.iosrtc.refreshVideos();
          }
        }, 400);
      }
    }
    // Masquer le placeholder si la vidéo distante est active
    if (placeholder && remoteVideo && remoteVideo.srcObject) {
      placeholder.classList.add("hidden");
    } else if (placeholder) {
      placeholder.classList.remove("hidden");
    }

    this.sendScreenShareState(false);
    this.updateScreenShareUI(false);
    this.showCallToast("Partage d'écran arrêté");
  };

  toggleScreenShare = () => {
    if (this.isScreenSharing) {
      this.stopScreenShare();
    } else {
      this.startScreenShare();
    }
  };

  sendScreenShareState = (active) => {
    if (this.targetUserId) {
      this.sendSignal({
        type: "screen-share-state",
        targetId: this.targetUserId,
        active: !!active,
      });
    }
  };

  updateScreenShareUI = (active) => {
    const btn = document.getElementById("btn-screen-share");
    const icon = document.getElementById("screen-share-icon");
    const label = document.getElementById("screen-share-label");

    const btnAudio = document.getElementById("btn-screen-share-audio");
    const iconAudio = document.getElementById("screen-share-icon-audio");
    const labelAudio = document.getElementById("screen-share-label-audio");
    const btnGroup = document.getElementById("btn-screen-share-group");

    if (active) {
      if (btnGroup) btnGroup.classList.add("active");
      if (btn) btn.classList.add("active");
      if (icon) icon.className = "fa-solid fa-desktop";
      if (label) label.textContent = "Arrêter";
      if (btnAudio) btnAudio.classList.add("active");
      if (iconAudio) iconAudio.className = "fa-solid fa-desktop";
      if (labelAudio) labelAudio.textContent = "Arrêter";
    } else {
      if (btnGroup) btnGroup.classList.remove("active");
      if (btn) btn.classList.remove("active");
      if (icon) icon.className = "fa-solid fa-desktop";
      if (label) label.textContent = "Écran";
      if (btnAudio) btnAudio.classList.remove("active");
      if (iconAudio) iconAudio.className = "fa-solid fa-desktop";
      if (labelAudio) labelAudio.textContent = "Écran";
    }
    this.applyScreenShareUI();
  };

  // Centralise l'affichage du partage d'écran (1-à-1 et groupe) selon l'état courant.
  applyScreenShareUI = () => {
    const inGroup = !!(this.groupRoomId || this.groupCreating);
    const localSharing = !!this.isScreenSharing;
    const remoteSharing = !inGroup && !!this.remoteScreenSharing;

    // ----- 1-à-1 -----
    const container = document.querySelector(".video-call-container");
    if (container) {
      container.classList.toggle("remote-sharing", remoteSharing);
      container.classList.toggle("share-fill", remoteSharing && !!this.shareFillMode);
      container.classList.toggle("local-sharing", !inGroup && localSharing);
    }
    const remoteBanner = document.getElementById("remote-share-banner");
    if (remoteBanner) {
      remoteBanner.classList.toggle("show", remoteSharing);
      const nameEl = document.querySelector(".js-contact-name");
      const name = (nameEl && nameEl.textContent.trim()) || "Votre interlocuteur";
      const txt = remoteBanner.querySelector(".js-remote-share-text");
      if (txt) txt.textContent = `${name} partage son écran`;
    }
    const fitIcon = document.getElementById("share-fit-icon");
    if (fitIcon) fitIcon.className = this.shareFillMode ? "fa-solid fa-compress" : "fa-solid fa-expand";
    const localBanner = document.getElementById("local-share-banner");
    if (localBanner) localBanner.classList.toggle("show", !inGroup && localSharing);

    // ----- Groupe -----
    const groupBanner = document.getElementById("group-share-banner");
    if (groupBanner) {
      let sharerId = null;
      if (inGroup) {
        if (localSharing) {
          sharerId = this.myId;
        } else {
          const visible = this.getGroupDisplayIds ? this.getGroupDisplayIds() : [];
          sharerId = visible.find((id) => id !== this.myId && (this.groupPeerStates.get(id) || {}).screenSharing) || null;
        }
      }
      groupBanner.classList.toggle("show", !!sharerId);
      const text = document.getElementById("group-share-text");
      if (text && sharerId) text.textContent = sharerId === this.myId ? "Vous partagez votre écran" : `${sharerId} partage son écran`;
      const stopBtn = document.getElementById("group-share-stop");
      if (stopBtn) stopBtn.style.display = sharerId && sharerId === this.myId ? "" : "none";
    }
  };

  // Récepteur : alterne entre « écran entier » (contain) et « remplir » (cover).
  toggleShareFit = () => {
    this.shareFillMode = !this.shareFillMode;
    this.applyScreenShareUI();
  };

  handleRemoteScreenShare = (data) => {
    this.remoteScreenSharing = !!data.active;
    if (!data.active) this.shareFillMode = false;
    this.applyScreenShareUI();

    const remoteVideo = document.getElementById("remote-video");
    const placeholder = document.querySelector(".remote-video-placeholder");
    if (remoteVideo) {
      remoteVideo.style.display = "";
      if (remoteVideo.srcObject) {
        remoteVideo.play().catch(() => {});
        // Le changement de piste (caméra <-> écran) peut laisser la <video> figée : on relance un peu plus tard.
        setTimeout(() => {
          const rv = document.getElementById("remote-video");
          if (rv && rv.srcObject) rv.play().catch(() => {});
        }, 400);
      }
    }
    // L'écran partagé remplace l'avatar « caméra coupée »
    if (placeholder && remoteVideo && remoteVideo.srcObject) {
      placeholder.classList.add("hidden");
    }
  };

  /* =========================================================
   GESTION DES ÉTATS D'APPEL VIDÉO
========================================================= */

  static CONTROLS_AUTO_HIDE_DELAY = 5000;

  setCallingState = (isCalling) => {
    const container = document.querySelector(".video-call-container");
    if (container) {
      container.classList.toggle("calling", isCalling);
    }
  };

  setIncomingVideoState = (isIncoming) => {
    const container = document.querySelector(".video-call-container");
    console.log("🎬 setIncomingVideoState:", isIncoming, "container trouvé:", !!container);
    if (container) {
      container.classList.toggle("incoming", isIncoming);
      console.log("🎬 Classes après toggle:", container.className);
    }
  };

  startLocalPreview = async (withVideo) => {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: withVideo ? { facingMode: "user" } : false,
      });

      // Preview local avant appel : layout non swappé
      if (withVideo) {
        this.applyVideoLayout(false);
      }
      const localVideo = document.getElementById("local-video");
      if (localVideo && withVideo) {
        localVideo.play().catch(() => {});
      }

      this.isCameraOff = !withVideo;
      this.updateCameraIcon();
      this.showLocalVideoPlaceholder(!withVideo);
    } catch (error) {
      console.error("❌ Erreur startLocalPreview :", error);
      throw error;
    }
  };

  setLocalCameraEnabled = (enabled) => {
    if (!this.localStream) return;

    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = enabled;
      this.isCameraOff = !enabled;
      this.updateCameraIcon();
      this.showLocalVideoPlaceholder(!enabled);

      // Respecte le swap PiP
      this.applyVideoLayout(this.videosSwapped);
    }
  };

  toggleIncomingCamera = () => {
    if (!this.localStream) return;

    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      const newState = !videoTrack.enabled;
      this.setLocalCameraEnabled(newState);
      this.updateIncomingCameraToggleUI(newState);
    }
  };

  updateIncomingCameraToggleUI = (isEnabled) => {
    const icon = document.getElementById("incoming-camera-icon");
    const text = document.getElementById("incoming-camera-text");

    if (icon) {
      icon.className = isEnabled ? "fa-solid fa-video" : "fa-solid fa-video-slash";
    }
    if (text) {
      text.textContent = isEnabled ? "Désactiver votre vidéo" : "Activer votre vidéo";
    }
  };

  resetIncomingCameraToggleUI = () => {
    const icon = document.getElementById("incoming-camera-icon");
    const text = document.getElementById("incoming-camera-text");

    if (icon) icon.className = "fa-solid fa-video";
    if (text) text.textContent = "Désactiver votre vidéo";
  };

  /* =========================================================
   GESTION DE LA VISIBILITÉ DES CONTRÔLES
========================================================= */

  initControlsToggle = () => {
    const container = document.querySelector(".video-call-container");
    if (!container) return;

    // Créer l'overlay si n'existe pas
    let overlay = container.querySelector(".video-click-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "video-click-overlay";
      container.appendChild(overlay);
    }

    // IMPORTANT : Supprimer les anciens event listeners pour éviter les doublons
    // En clonant l'élément, on supprime tous les event listeners
    const newOverlay = overlay.cloneNode(true);
    overlay.parentNode.replaceChild(newOverlay, overlay);
    overlay = newOverlay;

    // Tap sur l'overlay = toggle contrôles
    overlay.addEventListener("click", (e) => {
      console.log("👆 Tap sur overlay détecté");
      if (this.isControlsHiddenLocked) return;
      this.toggleControls();
    });

    // Tap sur le fond (hors boutons, panel, local-video-wrapper) = toggle contrôles
    // Utiliser pointerdown pour meilleure réactivité sur mobile
    container.addEventListener("pointerdown", (e) => {
      if (this.isControlsHiddenLocked) return;

      const isButton = e.target.closest("button") || e.target.closest(".video-control-btn");
      const isPanel = e.target.closest(".video-control-panel");
      const isLocalWrapper = e.target.closest(".local-video-wrapper");
      const isOverlay = e.target.closest(".video-click-overlay");

      console.log("👆 Tap sur container détecté, target:", e.target.className);
      
      if (!isButton && !isPanel && !isLocalWrapper && !isOverlay) {
        this.toggleControls();
      }
    });

    // Tout pointerdown sur un bouton réaffiche + relance le timer
    const buttons = container.querySelectorAll("button");
    buttons.forEach((btn) => {
      btn.addEventListener("pointerdown", () => {
        this.showControls();
        this.startControlsAutoHide();
      });
    });
    
    console.log("✅ initControlsToggle() terminé");
  };

  showControls = () => {
    const container = document.querySelector(".video-call-container");
    if (container) {
      container.classList.remove("controls-hidden");
      this.snapPipToNearestCorner();
    }
  };

  hideControls = () => {
    const container = document.querySelector(".video-call-container");
    if (container) {
      container.classList.add("controls-hidden");
      this.snapPipToNearestCorner();
    }
  };

  toggleControls = () => {
    const container = document.querySelector(".video-call-container");
    if (container) {
      if (container.classList.contains("controls-hidden")) {
        this.showControls();
        this.startControlsAutoHide();
      } else {
        this.hideControls();
        this.cancelControlsAutoHide();
      }
    }
  };

  startControlsAutoHide = () => {
    this.cancelControlsAutoHide();
    this.controlsAutoHideTimer = setTimeout(() => {
      this.hideControls();
    }, CallManager.CONTROLS_AUTO_HIDE_DELAY);
  };

  cancelControlsAutoHide = () => {
    if (this.controlsAutoHideTimer) {
      clearTimeout(this.controlsAutoHideTimer);
      this.controlsAutoHideTimer = null;
    }
  };

  resetControlsVisibility = () => {
    this.cancelControlsAutoHide();
    this.showControls();
    this.isControlsHiddenLocked = false;
  };

  /* =========================================================
   POSITIONNEMENT PIP (PICTURE-IN-PICTURE)
========================================================= */

  placePipAtBottomRight = () => {
    const wrapper = document.querySelector(".local-video-wrapper");
    const panel = document.querySelector(".video-control-panel");
    if (!wrapper) return;

    const panelHeight = panel ? panel.offsetHeight : 0;
    const clearance = 20 + panelHeight + 12;
    const margin = 12;

    wrapper.style.transition = "left 0.3s ease, top 0.3s ease";
    wrapper.style.left = "auto";
    wrapper.style.top = "auto";
    wrapper.style.right = margin + "px";
    wrapper.style.bottom = clearance + "px";

    // iOS: refresh native video after positioning
    if (this.isIOS() && window.cordova && cordova.plugins && cordova.plugins.iosrtc) {
      setTimeout(() => cordova.plugins.iosrtc.refreshVideos(), 350);
    }
  };

  resetPipPosition = () => {
    const wrapper = document.querySelector(".local-video-wrapper");
    if (!wrapper) return;

    wrapper.style.left = "";
    wrapper.style.top = "";
    wrapper.style.right = "";
    wrapper.style.bottom = "";
    wrapper.style.transition = "";
  };

  snapPipToNearestCorner = () => {
    const wrapper = document.querySelector(".local-video-wrapper");
    if (!wrapper) return;

    const container = document.querySelector(".video-call-container");
    const isControlsHidden = container && container.classList.contains("controls-hidden");

    const header = document.querySelector(".video-header");
    const panel = document.querySelector(".video-control-panel");

    const headerHeight = header ? header.offsetHeight : 0;
    const panelHeight = panel ? panel.offsetHeight : 0;

    const margin = 12;
    const headerClearance = isControlsHidden ? margin : headerHeight + margin;
    const panelClearance = isControlsHidden ? margin : panelHeight + margin;

    const rect = wrapper.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const snapLeft = centerX < window.innerWidth / 2;
    const snapTop = centerY < window.innerHeight / 2;

    wrapper.style.transition = "left 0.3s ease, top 0.3s ease";

    if (snapLeft && snapTop) {
      wrapper.style.left = margin + "px";
      wrapper.style.top = headerClearance + "px";
      wrapper.style.right = "auto";
      wrapper.style.bottom = "auto";
    } else if (!snapLeft && snapTop) {
      wrapper.style.left = "auto";
      wrapper.style.top = headerClearance + "px";
      wrapper.style.right = margin + "px";
      wrapper.style.bottom = "auto";
    } else if (snapLeft && !snapTop) {
      wrapper.style.left = margin + "px";
      wrapper.style.top = "auto";
      wrapper.style.right = "auto";
      wrapper.style.bottom = panelClearance + "px";
    } else {
      wrapper.style.left = "auto";
      wrapper.style.top = "auto";
      wrapper.style.right = margin + "px";
      wrapper.style.bottom = panelClearance + "px";
    }

    // iOS: refresh native video after positioning
    if (this.isIOS() && window.cordova && cordova.plugins && cordova.plugins.iosrtc) {
      setTimeout(() => cordova.plugins.iosrtc.refreshVideos(), 350);
    }
  };

  /* =========================================================
   APPEL ENTRANT DÉCLENCHÉ NATIVEMENT
========================================================= */

  onNativeIncomingCall = (callId, from, isVideo, autoAnswer = false) => {
    console.log(
      "📲 Appel entrant natif :",
      callId,
      from,
      isVideo,
      "autoAnswer:",
      autoAnswer,
    );

    if (!this.appReady) {
      console.log("⏳ App pas encore prête, appel natif mis en attente");
      this.pendingNativeCall = { callId, from, isVideo, autoAnswer };
      return;
    }

    this.processIncomingCall(callId, from, isVideo, autoAnswer);
  };

  processIncomingCall = (callId, from, isVideo, autoAnswer = false) => {
    if (this.peerConnection) {
      console.log("Appel déjà en cours, appel natif ignoré");
      return;
    }

    if (!this.interfaceReceiver)
      this.interfaceReceiver = document.getElementById("interface-2");
    if (!this.interfaceSender)
      this.interfaceSender = document.getElementById("interface-1");
    if (!this.interfaceVideo)
      this.interfaceVideo = document.getElementById("interface-3");

    this.currentCallId = callId;
    this.targetUserId = from;
    this.isVideoCall = !!isVideo;
    this.autoAcceptOnOffer = !!autoAnswer;

    if (this.autoAcceptOnOffer) {
      this.showInterface(
        this.isVideoCall ? this.interfaceVideo : this.interfaceSender,
      );
      this.updateStatus("Connexion à l'appel...");
      if (this.isVideoCall) {
        this.setCallingState(true);
        this.startLocalPreview(true);
      }
    } else {
      if (this.isVideoCall) {
        this.showInterface(this.interfaceVideo);
        this.setCallingState(true);
        this.setIncomingVideoState(true);
        this.startLocalPreview(true);
        this.updateStatus("Appel vidéo entrant...");
        this.startVibration();
      } else {
        this.showInterface(this.interfaceReceiver);
        this.updateStatus("Appel entrant...");
        this.startVibration();
      }
    }

    this.ensureConnectedAndFetchOffer();
  };

  /* =========================================================
   VIBRATION
    =========================================================
 */

  startVibration = () => {
    if (!("vibrate" in navigator)) return;

    this.isVibrating = true;
    const triggerContinuousVibration = () => {
      if (!this.isVibrating) return;
      navigator.vibrate([1000, 1000]);
      this.vibrationTimer = setTimeout(triggerContinuousVibration, 2000);
    };
    triggerContinuousVibration();
  };

  stopVibration = () => {
    this.isVibrating = false;
    if (this.vibrationTimer) {
      clearTimeout(this.vibrationTimer);
      this.vibrationTimer = null;
    }
    if ("vibrate" in navigator) {
      navigator.vibrate(0);
    }
  };

  /* =========================================================
   OPTION INTERFACE APPEL (VIDÉO DÉPLAÇABLE)
========================================================= */

  /**
   * Place les bons MediaStream sur #local-video et #remote-video.
   * @param {boolean} swapped
   *   false (défaut) : #local-video ← localStream,  #remote-video ← remoteStreamRef
   *   true  (tap PiP) : #local-video ← remoteStreamRef, #remote-video ← localStream
   * Évite le mélange caméra locale / flux distant après screen share ou ontrack.
   */
  applyVideoLayout = (swapped) => {
    const localVideo = document.getElementById("local-video");
    const remoteVideo = document.getElementById("remote-video");
    const local = this.localStream || null;
    const remote = this.remoteStreamRef || null;

    this.videosSwapped = !!swapped;

    if (swapped) {
      // #local-video ← remoteStreamRef | #remote-video ← localStream
      if (localVideo) {
        localVideo.srcObject = remote;
        // Pas de miroir : c'est le flux distant dans la PiP
        localVideo.style.transform = "none";
        if (remote) localVideo.play().catch(() => {});
      }
      if (remoteVideo) {
        // Caméra locale en grand : miroir si frontale
        remoteVideo.srcObject = local;
        if (local && this.isFrontCamera && !this.isCameraOff) {
          remoteVideo.style.transform = "scaleX(-1)";
        } else {
          remoteVideo.style.transform = "none";
        }
        if (local) remoteVideo.play().catch(() => {});
      }
    } else {
      if (localVideo) {
        // Caméra coupée : pas de flux sur la PiP (placeholder local géré ailleurs)
        if (this.isCameraOff && !this.isScreenSharing) {
          localVideo.srcObject = null;
        } else {
          localVideo.srcObject = local;
          if (local) localVideo.play().catch(() => {});
        }
        // Miroir uniquement pour la caméra frontale locale
        if (this.isFrontCamera && !this.isCameraOff) {
          localVideo.style.transform = "scaleX(-1)";
        } else {
          localVideo.style.transform = "none";
        }
      }
      if (remoteVideo) {
        remoteVideo.srcObject = remote;
        remoteVideo.style.transform = "none";
        if (remote) remoteVideo.play().catch(() => {});
      }
    }

    console.log("[LAYOUT] applyVideoLayout(swapped=" + !!swapped + ") local=", !!local, "remote=", !!remote);

    // iosrtc : recalcul position native après changement de srcObject
    if (this.isIOS() && window.cordova && cordova.plugins && cordova.plugins.iosrtc) {
      try {
        cordova.plugins.iosrtc.refreshVideos();
      } catch (e) {}
    }
  };

  setupDraggableVideo = () => {
    const self = this; // pour swapVideos / applyVideoLayout
    const wrapper = document.querySelector(".local-video-wrapper");
    const localVideo = document.getElementById("local-video");
    const remoteVideo = document.getElementById("remote-video");
    if (!wrapper) return;

    // position:fixed uniquement dans showInterface(vidéo) — pas au load
    // sinon rectangle / écran noir après hangUp
    wrapper.style.touchAction = "none";

    // ⚠️ iosrtc rend <video> via une vue native placée par-dessus/derrière la WebView, dont la
    // position/taille ne sont recalculées QUE sur appel explicite à refreshVideos() (aucun
    // observateur interne ne suit un déplacement du wrapper par simple style.left/top — voir
    // this.showInterface() plus haut). Sans ça, ce bloc ne fait bouger que le fond/la bordure CSS du
    // wrapper : la vidéo elle-même reste figée à sa position d'origine.
    let refreshScheduled = false;
    // ✅ FIX : arrow function pour que this → CallManager (function classique = this → window → crash)
    const refreshLocalVideoNative = () => {
      if (
        this.isIOS() &&
        window.cordova &&
        cordova.plugins &&
        cordova.plugins.iosrtc
      ) {
        cordova.plugins.iosrtc.refreshVideos();
      }
    };
    const scheduleNativeRefresh = () => {
      if (refreshScheduled) return;
      refreshScheduled = true;
      requestAnimationFrame(() => {
        refreshScheduled = false;
        refreshLocalVideoNative();
      });
    };

    let offsetX = 0,
      offsetY = 0,
      isDragging = false;
    let startX = 0,
      startY = 0,
      moved = 0,
      startTime = 0;
    let activePointerId = null;

    function start(x, y) {
      isDragging = true;
      moved = 0;
      startTime = Date.now();
      startX = x;
      startY = y;
      const rect = wrapper.getBoundingClientRect();
      offsetX = x - rect.left;
      offsetY = y - rect.top;
      wrapper.style.transition = "none";
    }

    function move(x, y) {
      if (!isDragging) return;
      moved += Math.abs(x - startX) + Math.abs(y - startY);
      startX = x;
      startY = y;

      let newX = x - offsetX;
      let newY = y - offsetY;
      const maxX = window.innerWidth - wrapper.offsetWidth;
      const maxY = window.innerHeight - wrapper.offsetHeight;
      newX = Math.max(0, Math.min(newX, maxX));
      newY = Math.max(0, Math.min(newY, maxY));

      wrapper.style.left = newX + "px";
      wrapper.style.top = newY + "px";
      wrapper.style.right = "auto";
      wrapper.style.bottom = "auto";

      scheduleNativeRefresh();
    }

    function end() {
      if (!isDragging) return;
      isDragging = false;
      wrapper.style.transition = "left 0.2s ease, top 0.2s ease";

      const elapsed = Date.now() - startTime;

      if (moved < 15 && elapsed < 300) {
        swapVideos();
        return;
      }

      const container = document.querySelector(".video-call-container");
      const isControlsHidden = container && container.classList.contains("controls-hidden");

      const header = document.querySelector(".video-header");
      const panel = document.querySelector(".video-control-panel");

      const headerHeight = header ? header.offsetHeight : 0;
      const panelHeight = panel ? panel.offsetHeight : 0;

      const margin = 12;
      const headerClearance = isControlsHidden ? margin : headerHeight + margin;
      const panelClearance = isControlsHidden ? margin : panelHeight + margin;

      const rect = wrapper.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const snapLeft = centerX < window.innerWidth / 2;
      const snapTop = centerY < window.innerHeight / 2;

      // Snap au coin le plus proche (4 coins)
      if (snapLeft && snapTop) {
        // Coin haut-gauche
        wrapper.style.left = margin + "px";
        wrapper.style.top = headerClearance + "px";
        wrapper.style.right = "auto";
        wrapper.style.bottom = "auto";
      } else if (!snapLeft && snapTop) {
        // Coin haut-droite
        wrapper.style.left = "auto";
        wrapper.style.top = headerClearance + "px";
        wrapper.style.right = margin + "px";
        wrapper.style.bottom = "auto";
      } else if (snapLeft && !snapTop) {
        // Coin bas-gauche
        wrapper.style.left = margin + "px";
        wrapper.style.top = "auto";
        wrapper.style.right = "auto";
        wrapper.style.bottom = panelClearance + "px";
      } else {
        // Coin bas-droite
        wrapper.style.left = "auto";
        wrapper.style.top = "auto";
        wrapper.style.right = margin + "px";
        wrapper.style.bottom = panelClearance + "px";
      }

      // Le snap est animé (transition CSS) : la vidéo native doit suivre à l'arrivée, pas au
      // point de départ. transitionend est le signal fiable ; le setTimeout couvre le cas où il
      // ne se déclenche pas (ex. prefers-reduced-motion).
      wrapper.addEventListener("transitionend", refreshLocalVideoNative, {
        once: true,
      });
      setTimeout(refreshLocalVideoNative, 250);
    }

    function swapVideos() {
      // Interdit pendant le partage d'écran (layout fixe)
      if (self.isScreenSharing || self.remoteScreenSharing) return;
      // Caméra locale coupée : pas de swap (éviter null sur le grand écran)
      if (!localVideo || !remoteVideo) return;
      if (self.isCameraOff && !self.videosSwapped) return;
      // Bascule via applyVideoLayout (sources = localStream / remoteStreamRef)
      self.applyVideoLayout(!self.videosSwapped);
      refreshLocalVideoNative();
    }

    wrapper.addEventListener("pointerdown", (e) => {
      activePointerId = e.pointerId;
      wrapper.setPointerCapture(e.pointerId);
      start(e.clientX, e.clientY);
    });

    wrapper.addEventListener("pointermove", (e) => {
      if (e.pointerId !== activePointerId) return;
      move(e.clientX, e.clientY);
    });

    wrapper.addEventListener("pointerup", (e) => {
      if (e.pointerId !== activePointerId) return;
      activePointerId = null;
      end();
    });

    wrapper.addEventListener("pointercancel", (e) => {
      if (e.pointerId !== activePointerId) return;
      activePointerId = null;
      isDragging = false;
    });
  };

  /* #########################################################################
     #                                                                       #
     #   APPEL DE GROUPE (style WhatsApp, maillage WebRTC)                   #
     #                                                                       #
     #   PRINCIPE ARCHITECTURAL :                                           #
     #   - Pas d'hôte : l'appel vit tant qu'une personne est dedans.         #
     #   - Tous les invités sonnent en même temps (états du serveur :        #
     #     RINGING / JOINED / DECLINED / MISSED / LEFT).                     #
     #   - Maillage WebRTC : chaque participant a UNE connexion directe     #
     #     avec chacun des autres (max 6 personnes, vous inclus).            #
     #   - Pas de serveur de médias : les flux circulent directement entre    #
     #     pairs (peer-to-peer).                                             #
     #   - Signalisation via serveur : tous les messages WebRTC passent     #
     #     par le message "group-signal" { roomId, targetId, payload }.     #
     #   - Le payload contient : offer | answer | candidate | state         #
     #     (micro/caméra).                                                   #
     #   - Code isolé : aucune modification du code 1-à-1, hormis quelques    #
     #     gardes (acceptCall, rejectCall, makeCall, handleIncomingCall,      #
     #     handleSignalMessage, notifications push).                         #
     #                                                                       #
     ######################################################################## */

  /* =========================================================
     GROUPE — SECTION 1 : CONSTANTES
  ========================================================= 
     
     Définit les constantes utilisées pour la gestion des appels de groupe.
     Ces valeurs doivent correspondre à celles du serveur pour un bon
     fonctionnement.  
  ========================================================= */

  static GROUP_MAX_PARTICIPANTS = 6; // Maximum de participants (vous inclus) - limite du maillage WebRTC
  static GROUP_INVITE_TIMEOUT_MS = 45000; // Délai d'expiration d'une invitation (45s) - identique au serveur
  static GROUP_ALONE_GRACE_MS = 6000; // Délai de grâce avant de quitter un appel où l'on est seul (6s)
  static GROUP_REQUEST_TIMEOUT_MS = 12000; // Délai maximum pour créer ou rejoindre une salle (12s)

  // Libellés affichés sous le nom, selon l'état du participant
  static GROUP_STATE_LABELS = {
    RINGING: "Sonne…",
    DECLINED: "A refusé",
    MISSED: "Sans réponse",
    LEFT: "A quitté",
    JOINED: "",
  };

  /* =========================================================
     GROUPE — SECTION 2 : ÉTAT (propriétés de classe)
     
     IMPORTANT : Tout l'état de groupe est séparé de l'état 1-à-1
     (peerConnection / localStream / targetUserId ne sont jamais utilisés ici).
     
     Chaque propriété gère un aspect spécifique de l'appel de groupe.
  ========================================================= */

  groupRoomId = null; // Identifiant unique de la salle en cours (null = pas en appel de groupe)
  groupIsVideo = false; // Type d'appel : true = vidéo, false = audio uniquement
  groupRoster = []; // Liste officielle des participants envoyée par le serveur : [{ userId, state }]
  groupPeers = new Map(); // Connexions WebRTC : userId -> { pc, stream, pendingCandidates, remoteSet, connState, audioEl, isInitiator }
  groupPeerStates = new Map(); // États annoncés par les autres participants : userId -> { micMuted, camOff }
  groupRetryCount = new Map(); // Compteur de tentatives de reconnexion : userId -> nombre de relances
  groupTiles = new Map(); // Éléments DOM de l'interface : userId -> élément <div> de la tuile
  groupLocalStream = null; // MON flux média (micro + caméra) partagé avec tous les pairs
  groupPendingInvite = null; // Invitation reçue en attente de réponse : { roomId, from, isVideo, roster }
  groupSelectedIds = []; // IDs choisis dans la feuille "Ajouter des participants"
  groupIsMuted = false; // Mon micro est coupé
  groupIsCamOff = false; // Ma caméra est coupée
  groupIsFrontCamera = true; // Caméra avant activée (true) ou arrière (false)
  groupSpeakerOn = false; // Haut-parleur activé
  groupActiveSpeakerId = null; // ID du participant qui parle en ce moment (détection d'orateur)
  groupCreating = false; // true entre l'envoi de group-create et la réception de group-created
  groupRejoining = false; // true pendant une reconnexion à la salle après une déconnexion
  groupEverHadPeer = false; // Quelqu'un d'autre a-t-il déjà rejoint l'appel ?
  groupAcceptInProgress = false; // Anti double-clic sur le bouton "Accepter"
  groupJoinPending = false; // true entre l'envoi de group-join et la réception de group-joined
  groupMigratingIds = new Set(); // IDs des personnes déjà en ligne avant transformation 1-à-1 -> groupe
  groupMigrateTimer = null; // Timer pour l'affichage "Connexion…" des personnes en migration
  groupIsLeaving = false; // true quand l'utilisateur est en train de quitter l'appel
  groupDowngradingToOneToOne = false; // true pendant la bascule automatique vers interface 1-à-1
  groupIsMeeting = false; // true quand la salle vient d'une réunion planifiée ; on ne doit pas descendre en 1-à-1

  // Minuteries (toutes nettoyées dans cleanGroupState)
  groupTimerInterval = null; // chrono de l'appel
  groupAloneTimer = null; // quitte l'appel si on reste seul
  groupInviteTimer = null; // expiration d'une invitation reçue
  groupRequestTimer = null; // surveille la création / l'arrivée dans la salle
  groupSpeakerTimer = null; // détection de l'orateur actif
  groupAudioCtx = null; // AudioContext pour mesurer le volume
  groupAnalysers = new Map(); // userId -> { analyser, stream, buffer }

  // Raccourci vers l'écran de groupe (interface-4)
  get interfaceGroup() {
    return document.getElementById("interface-4");
  }

  /* =========================================================
     GROUPE — SECTION 3 : OUTILS
  ========================================================= */

  // Découpe un texte "ID-1, ID-2 ID-3" en tableau d'IDs uniques.
  parseGroupIds = (text) => {
    const ids = String(text || "")
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return Array.from(new Set(ids));
  };

  // Règle anti-collision : pour chaque paire, SEUL l'ID le plus petit envoie l'offre.
  // Les deux téléphones appliquent la même règle -> jamais deux offres croisées.
  isGroupInitiator = (peerId) => String(this.myId) < String(peerId);

  // Nombre de personnes "actives" (qui sont dans l'appel ou qui sonnent).
  countActiveGroupMembers = () =>
    this.groupRoster.filter((r) => r.state === "JOINED" || r.state === "RINGING").length;

  // Envoie un message de signalisation WebRTC à UN participant de la salle.
  sendGroupSignal = (targetId, payload) => {
    if (!this.groupRoomId) return;
    this.sendSignal({
      type: "group-signal",
      roomId: this.groupRoomId,
      targetId,
      payload,
    });
  };

  // Envoie à tous les participants déjà dans l'appel (JOINED).
  sendGroupSignalToAll = (payload) => {
    this.groupRoster.forEach((r) => {
      if (r.userId !== this.myId && r.state === "JOINED") {
        this.sendGroupSignal(r.userId, payload);
      }
    });
  };

  /* =========================================================
     GROUPE — SECTION 4 : MÉDIA LOCAL (micro / caméra / audio)
  ========================================================= */

  // Ouvre le micro (et la caméra si appel vidéo). Résolution volontairement
  // modeste (640x480, 24 fps) : en maillage, chaque flux est envoyé N-1 fois.
  // Vérifie si groupLocalStream existe et possède des pistes actives (non "ended").
  hasLiveGroupMedia = (needVideo = false) => {
    const s = this.groupLocalStream;
    if (!s) return false;
    const hasLiveAudio = s.getAudioTracks().some((t) => t.readyState === "live");
    if (!hasLiveAudio) return false;
    if (needVideo) {
      return s.getVideoTracks().some((t) => t.readyState === "live");
    }
    return true;
  };

  // `options` (optionnel, module Meeting) : { cameraDeviceId, microphoneDeviceId }
  // permet d'ouvrir les périphériques choisis dans l'écran de prévisualisation.
  // Sans options, le comportement historique (facingMode "user") est conservé.
  acquireGroupMedia = async (video, options = {}) => {
    this.groupIsLeaving = false;

    // Libérer proprement un éventuel flux précédent avant d'en ouvrir un nouveau
    if (this.groupLocalStream) {
      this.groupLocalStream.getTracks().forEach((t) => {
        try { t.stop(); } catch (e) {}
      });
      this.groupLocalStream = null;
    }
    if (this.localStream && this.localStream !== this.groupLocalStream) {
      this.localStream = null;
    }

    if (this.isIOS()) {
      await this.ensureMediaAuthorizedIOS();
    }

    const cameraDeviceId = options.cameraDeviceId || null;
    const microphoneDeviceId = options.microphoneDeviceId || null;

    this.groupLocalStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(microphoneDeviceId ? { deviceId: { exact: microphoneDeviceId } } : {}),
      },
      video: video
        ? {
            ...(cameraDeviceId
              ? { deviceId: { exact: cameraDeviceId } }
              : { facingMode: "user" }),
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 24 },
          }
        : false,
    });

    this.groupIsMuted = false;
    this.groupIsCamOff = false;
    this.groupIsFrontCamera = true;
    this.isScreenSharing = false;

    // Initialiser mon propre état de partage d'écran
    this.groupPeerStates.set(this.myId, {
      micMuted: this.groupIsMuted,
      camOff: this.groupIsCamOff,
      screenSharing: false
    });

    // Route audio par défaut : haut-parleur en vidéo, écouteur en audio.
    if (this.isAndroid()) {
      try {
        await this.setAudioRoute(video ? "speaker" : "earpiece");
        this.groupSpeakerOn = this.currentAudioRoute === "speaker";
      } catch (audioError) {
        console.warn("⚠️ Erreur initialisation route audio groupe (poursuite quand même):", audioError);
        this.groupSpeakerOn = !!video;
        this.currentAudioRoute = video ? "speaker" : "earpiece";
      }
    } else {
      this.groupSpeakerOn = !!video;
      if (this.isIOS() && typeof activerAudioSessionIOS === "function") {
        activerAudioSessionIOS(this.groupSpeakerOn ? "speaker" : "receiver");
      }
    }
  };

  // Coupe / réactive MON micro et prévient les autres.
  toggleGroupMic = () => {
    if (!this.groupLocalStream) return;
    const track = this.groupLocalStream.getAudioTracks()[0];
    if (!track) return;

    this.groupIsMuted = !this.groupIsMuted;
    track.enabled = !this.groupIsMuted;
    this.updateGroupMicUI();
    this.updateGroupTile(this.myId);
    if (this.groupIsMuted) this.showCallToast("Micro coupé");
    this.sendGroupSignalToAll({
      kind: "state",
      micMuted: this.groupIsMuted,
      camOff: this.groupIsCamOff,
    });
  };

  // Coupe / réactive MA caméra et prévient les autres.
  // Permet maintenant d'activer la caméra même dans un appel audio.
  toggleGroupCamera = async () => {
    if (!this.groupLocalStream) return;

    const videoTrack = this.groupLocalStream.getVideoTracks()[0];

    // Si pas de piste vidéo (appel audio), l'ajouter
    if (!videoTrack) {
      try {
        if (this.isIOS()) {
          await this.ensureMediaAuthorizedIOS();
        }

        console.log("📹 [GROUPE] Activation caméra - Obtention du stream vidéo...");
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: this.groupIsFrontCamera ? "user" : "environment",
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
        });

        const newVideoTrack = videoStream.getVideoTracks()[0];
        newVideoTrack.enabled = true;
        console.log("📹 [GROUPE] Nouvelle piste vidéo créée:", newVideoTrack.id);

        // Ajouter la piste vidéo au stream existant
        this.groupLocalStream.addTrack(newVideoTrack);
        console.log("📹 [GROUPE] Piste vidéo ajoutée au groupLocalStream");

        // Ajouter la piste à toutes les connexions WebRTC existantes et renégocier
        console.log(`📹 [GROUPE] Renégociation avec ${this.groupPeers.size} pairs...`);
        for (const [peerId, peer] of this.groupPeers.entries()) {
          if (peer.pc) {
            console.log(`📹 [GROUPE] Ajout piste vidéo à ${peerId}...`);
            peer.pc.addTrack(newVideoTrack, this.groupLocalStream);
            // Renégocier pour que l'autre côté reçoive la nouvelle piste vidéo
            await this.renegotiateWithPeer(peerId);
            console.log(`📹 [GROUPE] Renégociation terminée avec ${peerId}`);
          }
        }

        // Marquer comme vidéo activée
        this.groupIsVideo = true;
        this.groupIsCamOff = false;

        // Mettre à jour l'interface
        const ui = this.interfaceGroup;
        if (ui) ui.dataset.video = "true";

        this.updateGroupCamUI();
        this.updateGroupTile(this.myId);
        this.sendGroupSignalToAll({
          kind: "state",
          micMuted: this.groupIsMuted,
          camOff: this.groupIsCamOff,
        });

        this.showCallToast("Caméra activée");
        console.log("✅ [GROUPE] Caméra activée avec succès");
      } catch (error) {
        console.error("❌ [GROUPE] Erreur activation caméra :", error);
        this.showCallToast("Impossible d'activer la caméra");
      }
      return;
    }

    // Caméra déjà présente : toggle on/off
    this.groupIsCamOff = !this.groupIsCamOff;
    videoTrack.enabled = !this.groupIsCamOff;

    // Si on active la caméra et groupIsVideo était false, le mettre à true
    if (!this.groupIsCamOff && !this.groupIsVideo) {
      this.groupIsVideo = true;
      const ui = this.interfaceGroup;
      if (ui) ui.dataset.video = "true";
    }

    this.updateGroupCamUI();
    this.updateGroupTile(this.myId);
    this.sendGroupSignalToAll({
      kind: "state",
      micMuted: this.groupIsMuted,
      camOff: this.groupIsCamOff,
    });
  };

  // Bascule caméra avant / arrière : la nouvelle piste remplace l'ancienne
  // dans CHAQUE connexion (replaceTrack), sans renégociation.
  switchGroupCamera = async () => {
    if (!this.groupLocalStream || this._groupSwitching) return;

    // Si pas de piste vidéo, activer d'abord la caméra
    const oldTrack = this.groupLocalStream.getVideoTracks()[0];
    if (!oldTrack) {
      await this.toggleGroupCamera();
      return;
    }

    this._groupSwitching = true;
    const nextFacing = this.groupIsFrontCamera ? "environment" : "user";

    try {
      // Android : il faut libérer l'ancienne caméra avant d'ouvrir l'autre.
      oldTrack.stop();

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: nextFacing },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24 },
        },
      });
      const newTrack = newStream.getVideoTracks()[0];
      newTrack.enabled = !this.groupIsCamOff;

      for (const peer of this.groupPeers.values()) {
        const sender = peer.pc.getSenders().find((s) => s.track && s.track.kind === "video");
        if (sender) await sender.replaceTrack(newTrack);
      }

      this.groupLocalStream.removeTrack(oldTrack);
      this.groupLocalStream.addTrack(newTrack);
      this.groupIsFrontCamera = !this.groupIsFrontCamera;
      this.updateGroupTile(this.myId);
    } catch (e) {
      console.error("❌ [GROUPE] switchGroupCamera :", e);
      this.showCallToast("Impossible de changer de caméra");
    } finally {
      this._groupSwitching = false;
    }
  };

  // Haut-parleur <-> écouteur.
  toggleGroupSpeaker = async () => {
    this.groupSpeakerOn = !this.groupSpeakerOn;
    if (this.isAndroid()) {
      await this.setAudioRoute(this.groupSpeakerOn ? "speaker" : "earpiece");
      this.groupSpeakerOn = this.currentAudioRoute === "speaker";
    } else if (this.isIOS() && typeof activerAudioSessionIOS === "function") {
      activerAudioSessionIOS(this.groupSpeakerOn ? "speaker" : "receiver");
    }
    this.updateGroupSpeakerUI();
  };

  // ===== SYSTÈME DE LIKE =====
  // Envoyer un like à tous les participants de l'appel de groupe
  sendGroupLike = () => {
    if (!this.groupRoomId) return;
    const likeEmoji = "❤️";
    this.sendSignal({
      type: "group-like",
      roomId: this.groupRoomId,
      emoji: likeEmoji,
      userId: this.myId,
    });
    // Animation locale sur notre propre tuile
    this.showLikeAnimation(this.myId, likeEmoji);
  };

  // Envoyer un like pour l'appel vidéo 1-à-1
  sendVideoLike = () => {
    if (!this.targetUserId) {
      console.warn("⚠️ [LIKE-1TO1] targetUserId est null, impossible d'envoyer le like");
      return;
    }
    const likeEmoji = "❤️";
    this.sendSignal({
      type: "call-like",
      targetId: this.targetUserId,
      emoji: likeEmoji,
      userId: this.myId,
    });
    // Animation locale
    this.showVideoLikeAnimation("local", likeEmoji);
  };

  // Animation de like sur la tuile d'un participant (groupe)
  // NB : les tuiles sont stockées dans this.groupTiles (Map), elles n'ont pas d'id DOM.
  showLikeAnimation = (userId, emoji) => {
    const tile = this.groupTiles && this.groupTiles.get(userId);
    if (!tile) {
      console.warn(`⚠️ [LIKE] Tuile non trouvée pour ${userId}`);
      return;
    }
    const like = document.createElement("div");
    like.className = "like-animation";
    like.textContent = emoji;
    tile.appendChild(like);
    setTimeout(() => like.remove(), 3000);
  };

  // Animation de like sur la vidéo (1-à-1) : "local" ou "remote"
  showVideoLikeAnimation = (videoType, emoji) => {
    const videoElement = document.getElementById(videoType === "local" ? "local-video" : "remote-video");
    const host = videoElement && videoElement.closest(".video-call-container");
    if (!host) {
      console.warn(`⚠️ [LIKE-1TO1] Conteneur vidéo non trouvé pour ${videoType}`);
      return;
    }
    const like = document.createElement("div");
    like.className = "like-animation like-animation-video";
    like.textContent = emoji;
    host.appendChild(like);
    setTimeout(() => like.remove(), 3000);
  };

  // Réception d'un like (groupe)
  handleGroupLike = (data) => {
    if (!data.userId || !data.emoji) return;
    this.showLikeAnimation(data.userId, data.emoji);
  };

  // Réception d'un like (1-à-1)
  handleCallLike = (data) => {
    if (!data.userId || !data.emoji) return;
    this.showVideoLikeAnimation("remote", data.emoji);
  };

  // --- Mises à jour visuelles des boutons de la barre de contrôles ---
  updateGroupMicUI = () => {
    document
      .querySelectorAll(".js-group-mic-btn")
      .forEach((b) => b.classList.toggle("active-mute", this.groupIsMuted));
    document.querySelectorAll(".js-group-mic-icon").forEach((i) => {
      i.className = this.groupIsMuted
        ? "fa-solid fa-microphone-slash js-group-mic-icon"
        : "fa-solid fa-microphone js-group-mic-icon";
    });
  };

  updateGroupCamUI = () => {
    document
      .querySelectorAll(".js-group-cam-btn")
      .forEach((b) => b.classList.toggle("active-mute", this.groupIsCamOff));
    document.querySelectorAll(".js-group-cam-icon").forEach((i) => {
      i.className = this.groupIsCamOff
        ? "fa-solid fa-video-slash js-group-cam-icon"
        : "fa-solid fa-video js-group-cam-icon";
    });
  };

  updateGroupSpeakerUI = () => {
    document
      .querySelectorAll(".js-group-speaker-btn")
      .forEach((b) => b.classList.toggle("active", this.groupSpeakerOn));
    document.querySelectorAll(".js-group-speaker-icon").forEach((i) => {
      i.className = this.groupSpeakerOn
        ? "fa-solid fa-volume-high js-group-speaker-icon"
        : "fa-solid fa-phone-volume js-group-speaker-icon";
    });
  };

  /* =========================================================
     GROUPE — SECTION 5 : LANCER UN APPEL DE GROUPE
     Déclenché depuis l'accueil quand le champ ID contient
     plusieurs identifiants (voir makeCall).
  ========================================================= */

  startGroupCall = async (ids, video = false) => {
    if (this.wsReadyState !== WebSocket.OPEN) {
      alert("Vous n'êtes pas connecté au serveur.");
      return;
    }
    if (this.peerConnection || this.groupRoomId || this.groupPendingInvite || this.groupCreating) {
      alert("Un appel est déjà en cours.");
      return;
    }

    const invitees = (ids || []).filter((id) => id && id !== this.myId);
    if (invitees.length < 1) {
      alert("Veuillez saisir au moins un ID valide.");
      return;
    }
    if (invitees.length + 1 > CallManager.GROUP_MAX_PARTICIPANTS) {
      alert(`Maximum ${CallManager.GROUP_MAX_PARTICIPANTS} participants (vous inclus).`);
      return;
    }

    this.groupIsVideo = !!video;
    this.groupIsMeeting = false;
    this.groupCreating = true;
    this.groupIsLeaving = false;
    this.updateStatus("Initialisation média...");

    try {
      // 1) Média prêt AVANT d'annoncer quoi que ce soit au serveur :
      //    ainsi une offre WebRTC reçue très tôt trouve déjà mon flux.
      await this.acquireGroupMedia(this.groupIsVideo);

      // 2) Écran de groupe + création de la salle (voir sendGroupCreate).
      this.sendGroupCreate(invitees);
    } catch (error) {
      console.error("❌ [GROUPE] startGroupCall :", error);
      alert("Impossible de démarrer l'appel de groupe (micro/caméra ?).");
      this.finishGroupCall();
    }
  };

  // Partie commune "créer la salle" : utilisée par startGroupCall (nouvel appel)
  // ET par convertCallToGroup (transformation d'un appel 1-à-1).
  // Prérequis : groupLocalStream et groupIsVideo sont déjà renseignés.
  //   invitees       : IDs à faire sonner / à rappeler dans la salle
  //   elapsedSeconds : temps déjà écoulé (on garde le chrono d'un appel 1-à-1)
  sendGroupCreate = (invitees, elapsedSeconds = 0) => {
    // 1) Vérifier wsReadyState === OPEN et myId défini
    if (this.wsReadyState !== WebSocket.OPEN) {
      console.error("[GROUPE] WebSocket non connecté, impossible d'envoyer group-create");
      this.finishGroupCall("Pas de connexion serveur");
      return;
    }

    if (!this.myId) {
      console.error("[GROUPE] myId non défini, impossible d'envoyer group-create");
      this.finishGroupCall("Identifiant utilisateur manquant");
      return;
    }

    // 2) Log explicite
    console.log("[GROUPE] envoi group-create", { invitedIds: invitees, isVideo: this.groupIsVideo, myId: this.myId });

    this.groupCreating = true;

    // Liste provisoire (le vrai roster arrive du serveur juste après).
    this.groupRoster = [
      { userId: this.myId, state: "JOINED" },
      ...invitees.map((id) => ({ userId: id, state: "RINGING" })),
    ];
    this.showGroupScreen(elapsedSeconds);

    // Création de la salle : le serveur fait sonner tout le monde.
    const sent = this.sendSignal({
      type: "group-create",
      isVideo: this.groupIsVideo,
      invitedIds: invitees,
    });

    // 3) Si sendSignal retourne false → finishGroupCall immédiatement
    if (!sent) {
      console.error("[GROUPE] sendSignal a échoué, impossible d'envoyer group-create");
      this.finishGroupCall("Pas de connexion serveur");
      return;
    }

    // Garde-fou : si le serveur ne répond pas, on annule proprement.
    clearTimeout(this.groupRequestTimer);
    this.groupRequestTimer = setTimeout(() => {
      if (this.groupCreating) {
        console.error("[GROUPE] TIMEOUT group-created non reçu — vérifier serveur / réseau / register-user");
        console.error("[GROUPE] SIGNALING_SERVER_URL utilisé :", CallManager.SIGNALING_SERVER_URL);
        this.finishGroupCall("Impossible de créer l'appel de groupe");
      }
    }, CallManager.GROUP_REQUEST_TIMEOUT_MS);
  };

  /* =========================================================
     GROUPE — SECTION 6 : APPEL ENTRANT DE GROUPE
     (réutilise l'écran interface-2 ; acceptCall / rejectCall
      redirigent ici quand groupPendingInvite existe)
  ========================================================= */

  // Le serveur nous invite : on affiche l'écran d'appel entrant.
  handleGroupInvite = (data) => {
    // 1-à-1 -> groupe : la personne avec qui JE SUIS EN APPEL m'ajoute à sa salle.
    // Pas de sonnerie : on bascule automatiquement (voir joinGroupFromCall).
    // FIX: Accepter même si l'état de connexion est transient (disconnected, connecting, etc.)
    // tant qu'on a un peerConnection actif avec l'appelant
    if (this.peerConnection && this.targetUserId === data.from && !this.groupRoomId) {
      console.log("🔀 [GROUPE] Transformation automatique - peerConnection existe avec", data.from, ", état:", this.peerConnection.connectionState || this.peerConnection.iceConnectionState);
      this.joinGroupFromCall(data);
      return;
    }

    // Déjà occupé (appel 1-à-1 ou autre salle) -> refus automatique.
    if (this.peerConnection || (this.groupRoomId && this.groupRoomId !== data.roomId)) {
      this.sendSignal({ type: "group-decline", roomId: data.roomId });
      return;
    }

    // Si on a le même groupRoomId mais qu'on a déjà quitté (pas de localStream ni de peers), accepter la réinvitation
    if (this.groupRoomId === data.roomId) {
      if (!this.groupLocalStream && this.groupPeers.size === 0) {
        console.log(`🔄 [GROUPE] Réinvitation acceptée pour la salle ${data.roomId} (avions quitté)`);
        // Nettoyer l'ancien roomId pour accepter comme nouvelle invitation
        this.groupRoomId = null;
      } else {
        return; // déjà actif dans cette salle
      }
    }

    this.groupPendingInvite = {
      roomId: data.roomId,
      from: data.from,
      isVideo: data.isVideo === true || data.isVideo === "true",
      roster: Array.isArray(data.roster) ? data.roster : [],
    };
    this.showGroupIncoming();

    // Si personne ne répond, l'invitation disparaît (le serveur la marque MISSED).
    clearTimeout(this.groupInviteTimer);
    this.groupInviteTimer = setTimeout(
      () => this.dismissGroupInvite("Appel de groupe manqué"),
      CallManager.GROUP_INVITE_TIMEOUT_MS + 2000,
    );
  };

  // Affiche "X vous appelle avec Y, Z" sur l'écran d'appel entrant.
  showGroupIncoming = () => {
    const inv = this.groupPendingInvite;
    if (!inv) return;

    // Compter le nombre de participants JOINED (déjà dans l'appel)
    const joinedCount = inv.roster.filter((r) => r.state === "JOINED").length;
    const type = inv.isVideo ? "vidéo" : "audio";
    
    // Afficher le nombre de participants comme WhatsApp
    // Ex: "Appel de groupe vidéo (3 participants)" ou "Appel de groupe audio"
    const participantText = joinedCount > 1 ? ` (${joinedCount} participants)` : "";

    this.setContactName(inv.from);
    this.updateStatus(`Appel de groupe ${type}${participantText}`);
    this.showInterface(this.interfaceReceiver);
    this.startVibration();
  };

  // L'utilisateur accepte (bouton vert ou notification) : on rejoint la salle.
  acceptGroupInvite = async () => {
    const inv = this.groupPendingInvite;
    if (!inv || this.groupAcceptInProgress) return;
    this.groupAcceptInProgress = true;

    this.stopVibration();
    clearTimeout(this.groupInviteTimer);

    try {
      this.updateStatus("Connexion à l'appel...");
      this.groupRoomId = inv.roomId;
      this.groupIsVideo = inv.isVideo;
      this.groupIsLeaving = false;

      // Média prêt AVANT de rejoindre (voir startGroupCall).
      await this.acquireGroupMedia(this.groupIsVideo);

      // Liste provisoire : moi + ce que l'invitation contenait.
      const known = inv.roster.filter((r) => r.userId !== this.myId);
      if (!known.some((r) => r.userId === inv.from)) {
        known.unshift({ userId: inv.from, state: "JOINED" });
      }
      this.groupRoster = [{ userId: this.myId, state: "JOINED" }, ...known];
      this.groupPendingInvite = null;

      this.showGroupScreen();
      this.sendSignal({ type: "group-join", roomId: inv.roomId });

      // Garde-fou : si le serveur ne confirme pas, on abandonne.
      this.groupJoinPending = true;
      clearTimeout(this.groupRequestTimer);
      this.groupRequestTimer = setTimeout(() => {
        if (this.groupJoinPending) {
          this.finishGroupCall("Impossible de rejoindre l'appel");
        }
      }, CallManager.GROUP_REQUEST_TIMEOUT_MS);
    } catch (error) {
      console.error("❌ [GROUPE] acceptGroupInvite :", error);
      this.sendSignal({ type: "group-decline", roomId: inv.roomId });
      this.groupPendingInvite = null;
      this.finishGroupCall("Impossible de rejoindre l'appel");
    } finally {
      this.groupAcceptInProgress = false;
    }
  };

  // L'utilisateur refuse : le serveur passe son état à DECLINED.
  declineGroupInvite = () => {
    const inv = this.groupPendingInvite;
    if (inv) this.sendSignal({ type: "group-decline", roomId: inv.roomId });
    this.dismissGroupInvite();
  };

  // Ferme l'écran d'appel entrant de groupe (refus, expiration, salle fermée).
  dismissGroupInvite = (message) => {
    clearTimeout(this.groupInviteTimer);
    this.groupPendingInvite = null;
    this.stopVibration();
    this.closeInterfaces();
    this.updateStatus("En ligne");
    this.closeNativeIncomingCallScreenIfNeeded();
    if (message) this.showCallToast(message);
  };

  // Notification push (application fermée / en arrière-plan).
  // action : "accept" | "reject" | "open" (clic sur la notification).
  handleGroupPush = async (data, action) => {
    const roomId = data.roomId;
    if (!roomId) return;

    if (action === "reject") {
      await this.ensureSocketReady();
      this.sendSignal({ type: "group-decline", roomId });
      return;
    }
    if (this.groupRoomId || this.peerConnection) return;

    this.groupPendingInvite = {
      roomId,
      from: data.from || data.callerId || "Inconnu",
      isVideo: data.isVideo === true || data.isVideo === "true",
      roster: [],
    };
    await this.ensureSocketReady();

    if (action === "accept") {
      await this.acceptGroupInvite();
    } else {
      this.showGroupIncoming();
      // On vérifie que la salle existe encore (réponse : group-info / group-ended).
      this.sendSignal({ type: "group-get-info", roomId });
    }
  };

  /* =========================================================
     GROUPE — SECTION 7 : MESSAGES REÇUS DU SERVEUR
     (aiguillés depuis handleSignalMessage)
  ========================================================= */

  handleGroupMessage = (action, data) => {
    switch (action) {
      // Le serveur confirme la création de la salle (nous = créateur).
      case "group-created":
        console.log("[GROUPE] group-created reçu", data);
        if (!this.groupCreating) {
          // Annulé entre-temps : on quitte la salle fantôme.
          this.sendSignal({ type: "group-leave", roomId: data.roomId });
          return;
        }
        this.groupCreating = false;
        this.groupRoomId = data.roomId;
        clearTimeout(this.groupRequestTimer);

        // ✅ Appliquer le roster reçu s'il est un tableau non vide
        if (Array.isArray(data.roster) && data.roster.length > 0) {
          console.log("[GROUPE] Application du roster reçu dans group-created :", data.roster);
          this.applyGroupRoster(data.roster, true);
        }

        // ✅ Fermer l'ancien peerConnection 1-à-1 maintenant que le groupe est créé
        // Cela permet une transition fluide sans coupure
        this.closePeerConnectionSilently(this._oldPeerConnection);
        this._oldPeerConnection = null;
        break;

      // On nous invite.
      case "group-invite":
        this.handleGroupInvite(data);
        break;

      // Réponse à group-get-info (ouverture via notification).
      case "group-info":
        if (this.groupPendingInvite && this.groupPendingInvite.roomId === data.roomId) {
          this.groupPendingInvite.isVideo = data.isVideo === true || data.isVideo === "true";
          this.groupPendingInvite.roster = data.roster || [];
          this.showGroupIncoming();
        }
        break;

      // Le serveur confirme que nous avons rejoint la salle.
      case "group-joined":
        if (data.roomId !== this.groupRoomId) return;
        this.groupJoinPending = false;
        clearTimeout(this.groupRequestTimer);
        if (this.groupRejoining) {
          // Reconnexion : on repart de connexions WebRTC neuves.
          this.groupRejoining = false;
          this.closeAllGroupPeers();
        }
        this.applyGroupRoster(data.roster, true);
        break;

      // Liste des participants mise à jour (diffusée à chaque changement).
      case "group-roster":
        if (data.roomId !== this.groupRoomId) return;
        this.groupJoinPending = false;
        clearTimeout(this.groupRequestTimer);
        // Pendant une reconnexion on attend "group-joined" pour toucher aux pairs.
        this.applyGroupRoster(data.roster, !this.groupRejoining);
        break;

      // Signalisation WebRTC d'un autre participant.
      case "group-signal":
        this.handleGroupSignal(data);
        break;

      // La salle est fermée (plus personne dedans).
      case "group-ended":
        if (this.groupPendingInvite && this.groupPendingInvite.roomId === data.roomId) {
          this.dismissGroupInvite("Appel de groupe terminé");
        } else if (data.roomId === this.groupRoomId) {
          this.finishGroupCall("Appel de groupe terminé");
        }
        break;

      // Erreur (salle pleine, introuvable, non autorisé...).
      case "group-error":
        console.warn("⚠️ [GROUPE] erreur serveur :", data.reason);
        if (this.groupPendingInvite && this.groupPendingInvite.roomId === data.roomId) {
          this.dismissGroupInvite(data.reason || "Appel de groupe indisponible");
        } else if (data.roomId === this.groupRoomId && (this.groupJoinPending || this.groupCreating)) {
          // Sur réception group-error pendant groupCreating : finishGroupCall immédiatement
          this.finishGroupCall(data.reason || "Impossible de rejoindre l'appel");
        } else {
          this.showCallToast(data.reason || "Erreur d'appel de groupe");
        }
        break;

      // Un invité est déjà dans un autre appel.
      case "group-busy":
        console.log(`[GROUPE] group-busy reçu : ${data.userId} est déjà en appel`);
        this.showCallToast(`${data.userId} est déjà en appel`);
        // NE PAS annuler toute la création si d'autres invités sont OK (la salle existe déjà)
        break;

      // ===== SYSTÈME DE LIKE =====
      case "group-like":
        this.handleGroupLike(data);
        break;
    }
  };

  // Après une (re)connexion WebSocket : si on est dans une salle, on la rejoint
  // à nouveau (le serveur nous avait marqué LEFT à la coupure).
  onGroupSocketRegistered = () => {
    // ✅ Réessayer la création/jonction de groupe si elle était en cours
    if (this._groupRequestRetryNeeded && this._groupRequestRetryData) {
      console.log("🔄 [GROUPE] Réessai de la création/jonction après reconnexion");
      const retryData = this._groupRequestRetryData;
      this._groupRequestRetryNeeded = false;
      this._groupRequestRetryData = null;

      if (retryData.creating) {
        // Réessayer la création
        this.groupCreating = true;
        this.groupIsVideo = retryData.isVideo;
        this.sendGroupCreate(retryData.invitees);
      } else if (retryData.roomId) {
        // Réessayer la jonction
        this.groupJoinPending = true;
        this.groupRoomId = retryData.roomId;
        this.groupIsVideo = retryData.isVideo;
        this.sendSignal({ type: "group-join", roomId: retryData.roomId });
      }
      return;
    }

    if (!this.groupRoomId || this.groupCreating || this.groupIsLeaving || !this.groupLocalStream) return;
    console.log("🔄 [GROUPE] re-jonction de la salle après reconnexion");
    this.groupRejoining = true;
    this.sendSignal({ type: "group-join", roomId: this.groupRoomId });
  };

  // Applique la liste officielle du serveur : met à jour les pairs WebRTC et la grille.
  // syncPeers = false : on met seulement l'affichage à jour (reconnexion en cours).
    // Nom à afficher pour un participant (nom envoyé par le serveur, sinon l'identifiant)
  getGroupDisplayName = (userId) => {
    if (userId === this.myId) return "Vous";
    const r = Array.isArray(this.groupRoster)
      ? this.groupRoster.find((x) => x.userId === userId)
      : null;
    return (r && r.name) || userId;
  };
  applyGroupRoster = (roster, syncPeers = true) => {
    if (!Array.isArray(roster)) return;
    this.groupRoster = roster;

    console.log(`📋 [GROUPE] Roster reçu:`, roster.map(r => `${r.userId}(${r.state})`).join(", "));

    // Dès que le serveur ne la voit plus "RINGING", la personne n'est plus "en migration".
    this.groupMigratingIds.forEach((id) => {
      const r = roster.find((x) => x.userId === id);
      if (!r || r.state !== "RINGING") this.groupMigratingIds.delete(id);
    });

    const me = roster.find((r) => r.userId === this.myId);
    if (syncPeers && me && me.state === "JOINED" && this.groupLocalStream) {
      const joinedOthers = roster
        .filter((r) => r.userId !== this.myId && r.state === "JOINED")
        .map((r) => r.userId);

      if (joinedOthers.length) this.groupEverHadPeer = true;

      // 1) Ceux qui ne sont plus dans l'appel : on ferme leur connexion.
      Array.from(this.groupPeers.keys()).forEach((id) => {
        if (!joinedOthers.includes(id)) {
          console.log(`🔌 [GROUPE] Fermeture connexion avec: ${id}`);
          this.closeGroupPeer(id);
          this.groupPeerStates.delete(id);
          this.groupRetryCount.delete(id);
        }
      });

      // 2) Identifier les nouveaux participants AVANT de créer les connexions
      const existingPeersBefore = Array.from(this.groupPeers.keys());
      const newParticipants = joinedOthers.filter(id => !existingPeersBefore.includes(id));

      // 3) Nouveaux arrivants : SEUL l'initiateur (ID le plus petit) crée la
      //    connexion et envoie l'offre ; l'autre attend l'offre (handleGroupOffer).
      joinedOthers.forEach((id) => {
        if (!this.groupPeers.has(id) && this.isGroupInitiator(id)) {
          console.log(`🔗 [GROUPE] Nouveau participant ${id} - création de connexion`);
          this.createGroupPeer(id);
          this.sendGroupOffer(id);
        }
      });

      // 4) IMPORTANT : Si on est participant existant et un nouveau arrive,
      //    on doit renégocier pour lui envoyer nos pistes vidéo actuelles
      //    (pour qu'il puisse voir les caméras déjà actives ET le partage d'écran)
      if (newParticipants.length > 0 && existingPeersBefore.length > 0) {
        console.log(`📹 [GROUPE] Nouveaux participants: ${newParticipants.join(", ")} - envoi des pistes vidéo actuelles`);
        // Pour chaque nouveau participant, renégocier pour envoyer nos pistes (asynchrone)
        newParticipants.forEach((newId) => {
          // Attendre un peu que la connexion soit créée avant de renégocier
          setTimeout(() => {
            if (this.groupPeers.has(newId)) {
              this.renegotiateWithPeer(newId).catch(err => {
                console.warn(`⚠️ [GROUPE] Erreur renégociation avec ${newId}:`, err);
              });
            }
          }, 100);
        });

        // 5) Envoi de l'état actuel (micro, caméra, partage d'écran) aux nouveaux participants
        //    pour qu'ils soient synchronisés immédiatement
        const myState = this.groupPeerStates.get(this.myId) || {
          micMuted: this.groupIsMuted,
          camOff: this.groupIsCamOff,
          screenSharing: this.isScreenSharing
        };
        console.log(`📤 [GROUPE] Envoi de MON état aux nouveaux participants:`, myState);
        newParticipants.forEach((newId) => {
          this.sendGroupSignal(newId, {
            kind: "state",
            micMuted: myState.micMuted,
            camOff: myState.camOff,
            screenSharing: myState.screenSharing
          });
        });

        // 6) CRITIQUE : Demander aux participants existants d'envoyer leur état aux nouveaux
        //    afin que le nouveau participant sache QUI partage son écran
        console.log(`🔄 [GROUPE] Demande aux participants existants d'envoyer leur état aux nouveaux`);
        existingPeersBefore.forEach((existingId) => {
          const existingState = this.groupPeerStates.get(existingId);
          if (existingState) {
            console.log(`📤 [GROUPE] Participant ${existingId} partage son écran: ${existingState.screenSharing}`);
            // Envoyer un message de demande de mise à jour d'état au participant existant
            // Le participant recevra ce message et renverra son état aux nouveaux
            this.sendGroupSignal(existingId, {
              kind: "request-state-broadcast",
              targetIds: newParticipants
            });
          }
        });
      }
    }

    this.renderGroupGrid();
    this.checkGroupAlone();
    if (this.groupIsMeeting && typeof this.updateMeetingParticipantCount === "function") {
      this.updateMeetingParticipantCount();
    }
    if (this.groupIsMeeting && typeof this.maybeStartMeetingTimer === "function") {
      this.maybeStartMeetingTimer();
    }
  };

  // Si on est le dernier dans l'appel (plus personne ne sonne), on quitte
  // après un court délai, comme WhatsApp.
  checkGroupAlone = () => {
    const others = this.groupRoster.filter(
      (r) => r.userId !== this.myId && (r.state === "JOINED" || r.state === "RINGING"),
    );
    if (this.groupRoomId && this.groupRoster.length && others.length === 0 && !this.groupIsMeeting) {
      if (!this.groupAloneTimer) {
        this.groupAloneTimer = setTimeout(() => {
          this.groupAloneTimer = null;
          this.leaveGroupCall(
            this.groupEverHadPeer ? "Appel de groupe terminé" : "Personne n'a répondu",
          );
        }, CallManager.GROUP_ALONE_GRACE_MS);
      }
    } else if (this.groupAloneTimer) {
      clearTimeout(this.groupAloneTimer);
      this.groupAloneTimer = null;
    }

    // Si on passe de 3+ participants à 2 participants (moi + 1 autre),
    // basculer vers l'interface 1-à-1 normale (audio ou vidéo selon le type d'appel)
    if (this.groupRoomId && others.length === 1 && !this.groupIsMeeting) {
      const otherId = others[0].userId;
      if (!this.groupDowngradingToOneToOne) {
        this.groupDowngradingToOneToOne = true;
        console.log(`🔄 [GROUPE] Bascule vers appel 1-à-1 ${this.groupIsVideo ? 'vidéo' : 'audio'} avec ${otherId}`);
        this.downgradeGroupToOneToOne(otherId);
      }
    }

    // Si on passe de 2 participants à 3+ participants,
    // rebasculer vers l'interface de groupe
    if (this.groupRoomId && others.length >= 2) {
      if (this.groupDowngradingToOneToOne) {
        this.groupDowngradingToOneToOne = false;
        console.log(`🔄 [GROUPE] Bascule vers appel de groupe (${others.length} autres participants)`);
        this.upgradeToGroupInterface();
      }
    }
  };

  // Bascule de l'interface de groupe vers l'interface 1-à-1 (audio ou vidéo)
  downgradeGroupToOneToOne = (otherId) => {
    if (this.groupIsMeeting) {
      console.log("📅 [MEETING] Bascule 1-à-1 désactivée dans une réunion planifiée");
      this.groupDowngradingToOneToOne = false;
      return;
    }

    try {
      // Récupérer le peer WebRTC existant avec l'autre participant
      const peer = this.groupPeers.get(otherId);
      if (!peer || !peer.stream) {
        console.warn("⚠️ Pas de connexion avec l'autre participant, reste en mode groupe");
        this.groupDowngradingToOneToOne = false;
        return;
      }

      // Déterminer l'interface à afficher selon le type d'appel
      const targetInterface = this.groupIsVideo ? this.interfaceVideo : this.interfaceSender;
      
      // Afficher l'interface 1-à-1 appropriée
      this.showInterface(targetInterface);
      
      // Pour les appels vidéo : gérer les états vidéo
      if (this.groupIsVideo) {
        this.setCallingState(false);
        this.setIncomingVideoState(false);

        // Attacher la vidéo distante au <video> remote-video
        const remoteVideo = document.getElementById("remote-video");
        if (remoteVideo && peer.stream) {
          remoteVideo.srcObject = peer.stream;
          remoteVideo.play().catch(e => console.warn("⚠️ Erreur play remote-video:", e));
        }

        // Afficher la vidéo locale
        const localVideo = document.getElementById("local-video");
        if (localVideo && this.groupLocalStream) {
          localVideo.srcObject = this.groupLocalStream;
          localVideo.play().catch(e => console.warn("⚠️ Erreur play local-video:", e));
        }

        // Masquer le placeholder
        const placeholder = document.querySelector(".remote-video-placeholder");
        if (placeholder) placeholder.classList.add("hidden");

        // Afficher les contrôles vidéo
        this.showControls();
        this.startControlsAutoHide();

        // Positionner la vidéo locale en bas à droite
        this.placePipAtBottomRight();
      } else {
        // Pour les appels audio : afficher les contrôles audio
        this.toggleCallButtons(true);
        // S'assurer que les boutons de l'interface audio sont activés
        this.toggleCallControlButtons(true);
      }

      // Mettre à jour le nom du contact
      this.setContactName(otherId);

      // IMPORTANT : Maintenir la connexion WebRTC active pour le raccrochage
      // Ne pas fermer le peer, car on doit continuer à communiquer
      this.targetUserId = otherId;
      this.peerConnection = peer.pc;
      this.localStream = this.groupLocalStream;
      
      // Mettre à jour le type d'appel pour le 1-à-1
      this.isVideoCall = this.groupIsVideo;

      console.log(`✅ Bascule vers interface 1-à-1 ${this.groupIsVideo ? 'vidéo' : 'audio'} réussie`);
    } catch (error) {
      console.error("❌ Erreur bascule vers 1-à-1:", error);
      this.groupDowngradingToOneToOne = false;
    }
  };

  // Bascule de l'interface 1-à-1 vers l'interface de groupe
  upgradeToGroupInterface = () => {
    try {
      // Réafficher l'interface de groupe
      this.showInterface(this.interfaceGroup);
      this.interfaceGroup.dataset.video = String(this.groupIsVideo);

      // Réinitialiser la grille de groupe
      this.renderGroupGrid();

      // Mettre à jour les contrôles de groupe
      this.updateGroupMicUI();
      this.updateGroupCamUI();
      this.updateGroupSpeakerUI();

      // Démarrer/continuer le timer de groupe
      if (!this.groupTimerInterval) {
        this.startGroupTimer();
      }

      // Démarrer/continuer la détection de l'orateur
      this.startGroupSpeakerDetection();

      console.log("✅ Bascule vers interface de groupe réussie");
    } catch (error) {
      console.error("❌ Erreur bascule vers groupe:", error);
    }
  };

  /* =========================================================
     GROUPE — SECTION 8 : CONNEXIONS WEBRTC (UNE PAR PARTICIPANT)
  ========================================================= */

  // Renégocie avec un participant (quand on ajoute une piste vidéo)
  renegotiateWithPeer = async (peerId) => {
    const peer = this.groupPeers.get(peerId);
    if (!peer || !peer.pc) {
      console.warn(`⚠️ [GROUPE] renegotiateWithPeer - peer ou pc introuvable pour ${peerId}`);
      return;
    }

    try {
      console.log(`🔄 [GROUPE] Début renégociation avec ${peerId}...`);
      console.log(`🔄 [GROUPE] État signaling avant: ${peer.pc.signalingState}`);

      // Créer une nouvelle offre avec la nouvelle piste vidéo
      const offer = await peer.pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      console.log(`🔄 [GROUPE] Offre créée pour ${peerId}, tracks: ${offer.sdp.match(/m=/g)?.length || 0}`);

      await peer.pc.setLocalDescription(offer);
      console.log(`🔄 [GROUPE] setLocalDescription OK pour ${peerId}`);

      // Envoyer l'offre au participant
      this.sendGroupSignal(peerId, {
        kind: "offer",
        sdp: { type: offer.type, sdp: offer.sdp },
      });

      console.log(`🔄 [GROUPE] Renégociation envoyée à ${peerId} (ajout piste vidéo)`);
    } catch (error) {
      console.error("❌ [GROUPE] Erreur renégociation avec", peerId, error);
    }
  };

  // Crée la connexion WebRTC avec UN participant et y branche mes pistes.
  createGroupPeer = (peerId) => {
    const pc = new RTCPeerConnection(CallManager.RTC_CONFIG);
    const peer = {
      pc,
      stream: null, // flux reçu de ce participant
      pendingCandidates: [], // candidats ICE reçus avant setRemoteDescription
      remoteSet: false,
      connState: "new",
      audioEl: null,
      isInitiator: this.isGroupInitiator(peerId),
    };
    this.groupPeers.set(peerId, peer);

    // Mes pistes (micro, caméra) vers ce participant. Si je partage mon écran, le nouveau
    // venu reçoit directement l'écran à la place de la caméra (restaurée à l'arrêt du partage
    // par _restoreCameraAfterShare, comme pour les autres participants).
    const screenTrack = this.isScreenSharing && this._groupScreenTrack && this._groupScreenTrack.readyState === "live"
      ? this._groupScreenTrack
      : null;
    this.groupLocalStream.getTracks().forEach((t) => {
      pc.addTrack(screenTrack && t.kind === "video" ? screenTrack : t, this.groupLocalStream);
    });
    if (screenTrack && !this.groupLocalStream.getVideoTracks().length) {
      pc.addTrack(screenTrack, this.groupLocalStream);
    }

    // Mes candidats ICE -> ce participant (via le serveur).
    pc.onicecandidate = (event) => {
      if (event.candidate && this.groupPeers.get(peerId) === peer) {
        this.sendGroupSignal(peerId, { kind: "candidate", candidate: event.candidate });
      }
    };

    // Flux reçu de ce participant.
    pc.ontrack = (event) => this.handleGroupTrack(peerId, event);

    // Suivi de l'état (iOS : iceConnectionState, comme le 1-à-1).
    const stateEvent = this.isIOS() ? "oniceconnectionstatechange" : "onconnectionstatechange";
    pc[stateEvent] = () => {
      if (this.groupPeers.get(peerId) === peer) this.handleGroupPeerState(peerId, peer);
    };

    return peer;
  };

  // Initiateur : crée l'offre SDP et l'envoie au participant.
  sendGroupOffer = async (peerId) => {
    const peer = this.groupPeers.get(peerId);
    if (!peer) return;
    try {
      console.log(`📡 [GROUPE] Création offre pour ${peerId} - groupIsVideo: ${this.groupIsVideo}`);
      const offer = await peer.pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true, // TOUJOURS accepter vidéo (peut venir plus tard)
      });
      await peer.pc.setLocalDescription(offer);
      this.sendGroupSignal(peerId, {
        kind: "offer",
        sdp: { type: offer.type, sdp: offer.sdp },
      });
      this.capGroupVideoBitrate(peer.pc);
      console.log(`✅ [GROUPE] Offre envoyée à ${peerId}`);
    } catch (error) {
      console.error("❌ [GROUPE] sendGroupOffer :", peerId, error);
    }
  };

  // Réception d'une offre : nouvelle connexion OU renégociation (ajout piste vidéo).
  handleGroupOffer = async (from, sdp) => {
    if (!this.groupLocalStream) return; // pas encore prêt

    const existingPeer = this.groupPeers.get(from);

    // Détecter si l'offre contient de la vidéo (m=video dans le SDP)
    const offerHasVideo = sdp.sdp && sdp.sdp.includes('m=video');
    console.log(`📡 [GROUPE] Offre reçue de ${from} - contient vidéo: ${offerHasVideo}, groupIsVideo: ${this.groupIsVideo}`);

    // NE PAS activer groupIsVideo automatiquement si l'offre contient de la vidéo
    // Si l'appel a démarré en audio, il doit rester en audio
    // L'utilisateur peut activer la vidéo manuellement via le bouton caméra

    // Si une ancienne connexion existe pour ce pair (ex: reconnexion rapide après départ),
    // vérifier si c'est une nouvelle session SDP ou une connexion morte, et la remplacer proprement.
    if (existingPeer) {
      const connState = this.isIOS()
        ? existingPeer.pc.iceConnectionState
        : (existingPeer.pc.connectionState || existingPeer.pc.iceConnectionState);
      const isDeadPeer = ["closed", "failed", "disconnected"].includes(connState);
      const getSdpSessionId = (sdpStr) => {
        const m = typeof sdpStr === "string" ? sdpStr.match(/^o=\S+\s+(\S+)/m) : null;
        return m ? m[1] : null;
      };
      const prevSessionId = getSdpSessionId(existingPeer.pc.remoteDescription?.sdp);
      const nextSessionId = getSdpSessionId(sdp?.sdp);
      const isNewPeerSession = !!(prevSessionId && nextSessionId && prevSessionId !== nextSessionId);

      if (isDeadPeer || isNewPeerSession) {
        console.log(`🔄 [GROUPE] Remplacement de l'ancien pair ${from} (state=${connState}, newSession=${isNewPeerSession})`);
        this.closeGroupPeer(from);
      }
    }

    const activePeer = this.groupPeers.get(from);

    // Si pas de connexion existante : nouvelle connexion
    if (!activePeer) {
      console.log(`🔗 [GROUPE] Nouvelle connexion avec ${from}`);
      // Création synchrone : les candidats ICE qui suivent seront mis en file d'attente.
      const peer = this.createGroupPeer(from);
      try {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
        peer.remoteSet = true;
        await this.flushGroupCandidates(peer);

        const answer = await peer.pc.createAnswer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true, // TOUJOURS accepter vidéo (peut venir plus tard)
        });
        await peer.pc.setLocalDescription(answer);
        this.sendGroupSignal(from, {
          kind: "answer",
          sdp: { type: answer.type, sdp: answer.sdp },
        });
        this.capGroupVideoBitrate(peer.pc);
        console.log(`✅ [GROUPE] Nouvelle connexion réussie avec ${from}`);
      } catch (error) {
        console.error("❌ [GROUPE] handleGroupOffer (nouvelle connexion) :", from, error);
        this.closeGroupPeer(from);
      }
      return;
    }

    // Renégociation : connexion existe déjà (ajout de piste vidéo par exemple)
    console.log(`🔄 [GROUPE] Renégociation reçue de ${from}`);
    try {
      await activePeer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
      activePeer.remoteSet = true;
      await this.flushGroupCandidates(activePeer);

      const answer = await activePeer.pc.createAnswer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true, // TOUJOURS accepter vidéo
      });
      await activePeer.pc.setLocalDescription(answer);
      this.sendGroupSignal(from, {
        kind: "answer",
        sdp: { type: answer.type, sdp: answer.sdp },
      });
      this.capGroupVideoBitrate(activePeer.pc);

      console.log(`✅ [GROUPE] Renégociation réussie avec ${from}`);
    } catch (error) {
      console.error("❌ [GROUPE] handleGroupOffer (renégociation) :", from, error);
    }
  };

  // Réception de la réponse SDP (nous = initiateur).
  handleGroupAnswer = async (from, sdp) => {
    const peer = this.groupPeers.get(from);
    if (!peer || peer.pc.signalingState !== "have-local-offer") return;
    try {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
      peer.remoteSet = true;
      await this.flushGroupCandidates(peer);
    } catch (error) {
      console.error("❌ [GROUPE] handleGroupAnswer :", from, error);
    }
  };

  // Réception d'un candidat ICE : appliqué tout de suite, ou mis en attente.
  handleGroupCandidate = async (from, candidate) => {
    const peer = this.groupPeers.get(from);
    if (!peer || !candidate) return;
    if (!peer.remoteSet) {
      peer.pendingCandidates.push(candidate);
      return;
    }
    try {
      await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      /* candidat périmé : sans gravité */
    }
  };

  // Applique les candidats arrivés avant la description distante.
  flushGroupCandidates = async (peer) => {
    const list = peer.pendingCandidates;
    peer.pendingCandidates = [];
    for (const c of list) {
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (e) {
        /* ignoré */
      }
    }
  };

  // Aiguille un "group-signal" selon son type (offer / answer / candidate / state).
  handleGroupSignal = (data) => {
    if (data.roomId !== this.groupRoomId || !data.payload) return;
    const from = data.from;
    const p = data.payload;

    switch (p.kind) {
      case "offer":
        this.handleGroupOffer(from, p.sdp);
        break;
      case "answer":
        this.handleGroupAnswer(from, p.sdp);
        break;
      case "candidate":
        this.handleGroupCandidate(from, p.candidate);
        break;
      case "state":
        // Micro / caméra coupés chez l'autre : badge + avatar sur sa tuile.
        const oldState = this.groupPeerStates.get(from) || {};
        const newCamOff = !!p.camOff;
        const newScreenSharing = !!p.screenSharing;
        this.groupPeerStates.set(from, { micMuted: !!p.micMuted, camOff: newCamOff, screenSharing: newScreenSharing });
        this.updateGroupTile(from);

        // Si la caméra vient d'être activée (camOff passe de true à false),
        // demander une renégociation pour recevoir la vidéo
        if (oldState.camOff === true && newCamOff === false) {
          console.log(`📹 [GROUPE] Caméra activée par ${from} - demande de renégociation`);
          const peer = this.groupPeers.get(from);
          if (peer && peer.pc) {
            this.renegotiateWithPeer(from).catch(err => {
              console.warn(`⚠️ [GROUPE] Erreur renégociation avec ${from}:`, err);
            });
          }
        }

        // Si le partage d'écran change, recharger la grille pour appliquer le layout WhatsApp
        if (oldState.screenSharing !== newScreenSharing) {
          console.log(`🖥️ [GROUPE] Partage d'écran ${newScreenSharing ? 'activé' : 'désactivé'} par ${from}`);
          this.renderGroupGrid();
        }
        break;
      case "request-state-broadcast":
        // Demande d'envoyer mon état aux nouveaux participants
        if (p.targetIds && Array.isArray(p.targetIds)) {
          console.log(`📢 [GROUPE] Demande d'envoi d'état aux participants: ${p.targetIds.join(", ")}`);
          const myState = this.groupPeerStates.get(this.myId) || {
            micMuted: this.groupIsMuted,
            camOff: this.groupIsCamOff,
            screenSharing: this.isScreenSharing
          };
          p.targetIds.forEach((targetId) => {
            this.sendGroupSignal(targetId, {
              kind: "state",
              micMuted: myState.micMuted,
              camOff: myState.camOff,
              screenSharing: myState.screenSharing
            });
          });
        }
        break;
    }
  };

  // Un flux (audio ou vidéo) arrive d'un participant.
  handleGroupTrack = (peerId, event) => {
    const peer = this.groupPeers.get(peerId);
    if (!peer) {
      console.warn(`⚠️ [GROUPE] handleGroupTrack - peer introuvable pour ${peerId}`);
      return;
    }

    console.log(`📹/🔊 [GROUPE] Track reçu de ${peerId} - kind: ${event.track.kind}, id: ${event.track.id}`);

    // Un seul MediaStream par participant (audio + vidéo ensemble).
    if (event.streams && event.streams[0]) {
      peer.stream = event.streams[0];
      console.log(`✅ [GROUPE] Stream attaché pour ${peerId} - audio: ${peer.stream.getAudioTracks().length}, video: ${peer.stream.getVideoTracks().length}`);
    } else {
      const existingTracks = peer.stream
        ? peer.stream.getTracks().filter((t) => t.id !== event.track.id && t.readyState !== "ended")
        : [];
      peer.stream = new MediaStream([...existingTracks, event.track]);
      console.log(`✅ [GROUPE] Track ajouté au stream pour ${peerId}`);
    }

    // Le son passe par un <audio> dédié ; l'image par le <video> (muet) de la tuile.
    if (event.track.kind === "audio") this.attachGroupAudio(peerId, peer);
    this.updateGroupTile(peerId);

    // Force la réassignation/lecture sur la balise <video> si le track vidéo vient d'arriver
    if (event.track.kind === "video") {
      const tile = this.groupTiles.get(peerId);
      const video = tile ? tile.querySelector("video") : null;
      if (video && peer.stream) {
        video.muted = true;
        if (video.srcObject !== peer.stream) {
          video.srcObject = peer.stream;
        }
        video.play().catch(() => {});
      }
    }
  };

  // Branche le son d'un participant sur un élément <audio> caché.
  attachGroupAudio = (peerId, peer) => {
    const container = document.getElementById("group-audio-container");
    if (!container || !peer.stream) return;

    if (!peer.audioEl) {
      peer.audioEl = document.createElement("audio");
      peer.audioEl.autoplay = true;
      peer.audioEl.setAttribute("playsinline", "");
      container.appendChild(peer.audioEl);
    }
    peer.audioEl.muted = false;
    peer.audioEl.volume = 1;
    if (peer.audioEl.srcObject !== peer.stream) peer.audioEl.srcObject = peer.stream;

    const tryPlay = (n) => {
      peer.audioEl.play().catch((e) => {
        console.warn("⚠️ [GROUPE] audio.play() tentative", n, e);
        if (n < 3) setTimeout(() => tryPlay(n + 1), 400 * (n + 1));
      });
    };
    tryPlay(0);
  };

  // Suivi de l'état de la connexion avec un participant.
  handleGroupPeerState = (peerId, peer) => {
    const raw = this.isIOS() ? peer.pc.iceConnectionState : peer.pc.connectionState;
    peer.connState = raw === "completed" ? "connected" : raw;
    console.log(`📡 [GROUPE] ${peerId} -> ${peer.connState}`);

    if (peer.connState === "connected") {
      this.groupRetryCount.set(peerId, 0);
      // On annonce notre état micro/caméra/partage au nouveau venu (sinon il affiche
      // notre écran partagé comme une simple tuile caméra, voire masquée si camOff).
      this.sendGroupSignal(peerId, {
        kind: "state",
        micMuted: this.groupIsMuted,
        camOff: this.groupIsCamOff,
        screenSharing: !!this.isScreenSharing,
      });
      this.capGroupVideoBitrate(peer.pc);
      if (this.groupIsMeeting && typeof this.maybeStartMeetingTimer === "function") {
        this.maybeStartMeetingTimer();
      }
    } else if (peer.connState === "failed" || peer.connState === "disconnected") {
      console.warn(`⚠️ [GROUPE] Connexion échouée avec ${peerId}: ${peer.connState}`);
      this.retryGroupPeer(peerId);
    }
    this.updateGroupTile(peerId);
  };

  // Connexion en échec : l'initiateur recrée la connexion (2 essais max).
  retryGroupPeer = (peerId) => {
    const peer = this.groupPeers.get(peerId);
    if (!peer || !peer.isInitiator) return; // l'autre côté attend notre nouvelle offre
    const tries = this.groupRetryCount.get(peerId) || 0;
    if (tries >= 2) {
      console.warn("⚠️ [GROUPE] abandon de la connexion avec", peerId);
      this.showCallToast(`Impossible de se connecter à ${peerId}`);
      return;
    }
    console.log(`🔄 [GROUPE] Retry connexion avec ${peerId} (tentative ${tries + 1}/2)`);
    this.groupRetryCount.set(peerId, tries + 1);
    this.closeGroupPeer(peerId);
    this.createGroupPeer(peerId);
    this.sendGroupOffer(peerId);
  };

  // En maillage, la bande passante montante est partagée entre tous les pairs :
  // on plafonne le débit vidéo envoyé à chacun (ex. 1 pair = 800 kb/s, 5 pairs = 240 kb/s).
  capGroupVideoBitrate = (pc) => {
    if (!this.groupIsVideo) return;
    const bitrate = Math.min(800000, Math.floor(1200000 / Math.max(1, this.groupPeers.size)));
    pc.getSenders().forEach((sender) => {
      if (!sender.track || sender.track.kind !== "video") return;
      try {
        const params = sender.getParameters();
        if (!params.encodings || !params.encodings.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = bitrate;
        sender.setParameters(params).catch(() => {});
      } catch (e) {
        /* non supporté : sans gravité */
      }
    });
  };

  // Ferme la connexion avec UN participant et libère son son.
  closeGroupPeer = (peerId) => {
    const peer = this.groupPeers.get(peerId);
    if (!peer) return;
    this.groupPeers.delete(peerId);

    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.oniceconnectionstatechange = null;
    try {
      peer.pc.close();
    } catch (e) {}

    peer.pendingCandidates = [];
    peer.remoteSet = false;
    peer.stream = null;

    const tile = this.groupTiles.get(peerId);
    if (tile) {
      const v = tile.querySelector("video");
      if (v) v.srcObject = null;
    }

    if (peer.audioEl) {
      try {
        peer.audioEl.pause();
      } catch (e) {}
      peer.audioEl.srcObject = null;
      peer.audioEl.remove();
      peer.audioEl = null;
    }
    this.groupAnalysers.delete(peerId);
    // NE PAS appeler updateGroupTile ici : la tuile sera supprimée par renderGroupGrid()
    // si le participant n'est plus dans le roster
  };

  // Ferme toutes les connexions (fin d'appel ou reconnexion).
  closeAllGroupPeers = () => {
    Array.from(this.groupPeers.keys()).forEach((id) => this.closeGroupPeer(id));
  };

  /* =========================================================
     GROUPE — SECTION 9 : INTERFACE (grille de tuiles)
  ========================================================= */

  // Affiche l'écran de groupe et démarre chrono + détection de l'orateur.
  showGroupScreen = (elapsedSeconds = 0) => {
    const ui = this.interfaceGroup;
    if (!ui) return;
    ui.dataset.video = String(this.groupIsVideo);
    this.showInterface(ui);
    this.updateGroupMicUI();
    this.updateGroupCamUI();
    this.updateGroupSpeakerUI();
    this.renderGroupGrid();
    this.startGroupTimer(elapsedSeconds);
    this.startGroupSpeakerDetection();
  };

  // Liste des participants à afficher : celui qui partage son écran en premier, puis les autres
  // IMPORTANT : Affiche UNIQUEMENT JOINED (pas RINGING)
  // Les participants en RINGING ne doivent pas apparaître dans la grille
  // Style WhatsApp : dès qu'un participant quitte, sa tuile disparaît
  // Style WhatsApp partage d'écran : celui qui partage prend le grand cadre en haut
  getGroupDisplayIds = () => {
    const joined = this.groupRoster
      .filter(
        (r) => r.state === "JOINED", // Uniquement JOINED, pas RINGING
      )
      .map((r) => r.userId);

    // Si je ne suis pas dans la liste, m'ajouter (pour mon propre affichage)
    if (!joined.includes(this.myId)) {
      joined.push(this.myId);
    }

    // Trouver celui qui partage son écran
    let screenSharerId = null;
    for (const userId of joined) {
      const state = this.groupPeerStates.get(userId);
      if (state && state.screenSharing) {
        screenSharerId = userId;
        break;
      }
    }

    // Si quelqu'un partage son écran, le mettre en premier
    if (screenSharerId) {
      const others = joined.filter(id => id !== screenSharerId);
      return [screenSharerId, ...others].slice(0, CallManager.GROUP_MAX_PARTICIPANTS);
    }

    // Sinon, ordre normal : moi d'abord, puis les autres
    const others = joined.filter(id => id !== this.myId);
    return [this.myId, ...others].slice(0, CallManager.GROUP_MAX_PARTICIPANTS);
  };

  // (Re)construit la grille : crée les tuiles manquantes, retire les obsolètes,
  // garde les <video> existantes pour ne pas couper un flux qui joue.
  renderGroupGrid = () => {
    // En réunion planifiée, la grille visible est #meeting-video-grid (UI Google Meet).
    // En salle d'attente de réunion, la grille dédiée est #meeting-waiting-grid
    // (ID unique : évite la collision historique avec #meeting-video-grid).
    // Sinon on utilise la grille d'appel de groupe classique.
    const gridId = this.groupIsMeeting ? "meeting-video-grid" : "group-grid";
    const grid = document.getElementById(gridId)
      || (this.groupIsMeeting ? document.getElementById("meeting-waiting-grid") : null);
    if (!grid) return;
    if (this.groupIsMeeting) {
      for (let n = 1; n <= 6; n++) grid.classList.remove(`count-${n}`);
      grid.classList.add(`count-${Math.max(1, Math.min(this.getGroupDisplayIds().length, 6))}`);
      grid.classList.toggle("has-screen-share", Array.from(this.groupPeerStates.values()).some((state) => state && state.screenSharing));
    }
    if (this.groupIsMeeting && !grid.dataset.featuredTileHandler) {
      grid.dataset.featuredTileHandler = "1";
      grid.addEventListener("click", (event) => {
        const tile = event.target.closest(".video-tile");
        if (!tile || !grid.contains(tile)) return;
        const selectedId = Array.from(this.groupTiles.entries()).find(([, element]) => element === tile)?.[0];
        if (!selectedId || selectedId === this.meetingPinnedParticipantId) return;
        this.meetingPinnedParticipantId = selectedId;
        this.renderGroupGrid();
      });
    }
    let ids = this.getGroupDisplayIds();
    if (this.groupIsMeeting) {
      const featuredId = ids.includes(this.meetingPinnedParticipantId)
        ? this.meetingPinnedParticipantId
        : ids.includes(this.meetingCreatedBy) ? this.meetingCreatedBy : ids[0];
      this.meetingPinnedParticipantId = featuredId;
      ids = ids.slice().sort((left, right) => left === featuredId ? -1 : right === featuredId ? 1 : 0);
    }

    console.log(`🔧 [GROUPE] renderGroupGrid - Tuiles à afficher: [${ids.join(", ")}]`);

    // Déterminer si quelqu'un partage son écran
    let screenSharerId = null;
    // (seulement les AUTRES : celui qui partage ne se voit pas en grand, il voit un bandeau « Vous partagez »)
    for (const userId of ids) {
      if (userId === this.myId) continue;
      const state = this.groupPeerStates.get(userId);
      if (state && state.screenSharing) {
        screenSharerId = userId;
        break;
      }
    }

    // Appliquer la classe de layout selon le partage d'écran / nombre de participants
    const count = Math.max(1, Math.min(ids.length, 6));
    if (this.groupIsMeeting) {
      grid.className = `video-grid count-${count}` + (screenSharerId && ids.length > 1 ? " screen-share-mode" : "");
    } else if (screenSharerId && ids.length > 1) {
      grid.className = `group-grid count-${count} screen-share-mode`;
    } else {
      grid.className = `group-grid count-${count}`;
    }

    // Tuiles qui ne doivent plus exister
    Array.from(this.groupTiles.keys()).forEach((id) => {
      if (!ids.includes(id)) {
        console.log(`🗑️ [GROUPE] Suppression tuile: ${id}`);
        const tile = this.groupTiles.get(id);
        const v = tile.querySelector("video");
        if (v) v.srcObject = null;
        tile.remove();
        this.groupTiles.delete(id);
      }
    });

    // Création / ordre / mise à jour
    ids.forEach((id, index) => {
      let tile = this.groupTiles.get(id);
      if (!tile) {
        tile = this.createGroupTile(id);
        this.groupTiles.set(id, tile);
      }
      if (grid.children[index] !== tile) {
        grid.insertBefore(tile, grid.children[index] || null);
      }
      tile.classList.toggle("meeting-featured-tile", this.groupIsMeeting && index === 0);
      this.updateGroupTile(id);
    });

    this.updateGroupHeader();
    this.applyScreenShareUI();
  };

  // Crée l'élément DOM d'une tuile (le contenu texte est posé par updateGroupTile).
  createGroupTile = (userId) => {
    const tile = document.createElement("div");
    // Classes duales : compatible grille groupe ET grille réunion (meeting.css .video-tile)
    tile.className = this.groupIsMeeting ? "video-tile group-tile" : "group-tile";
    if (userId === this.myId) {
      tile.classList.add("is-self");
      tile.classList.add("self");
    }
    tile.innerHTML = `
      <video class="group-video" autoplay playsinline webkit-playsinline muted></video>
      <div class="group-avatar"><span class="group-initial"></span></div>
      <i class="fa-solid fa-microphone-slash group-badge-mute"></i>
      <div class="group-tile-info video-tile-info">
        <span class="group-tile-name user-name"></span>
        <span class="group-tile-status"></span>
      </div>`;
    return tile;
  };

  // Met à jour UNE tuile (nom, statut, vidéo/avatar, micro coupé, orateur).
  updateGroupTile = (userId) => {
    const tile = this.groupTiles.get(userId);
    if (!tile) return;

    const isSelf = userId === this.myId;
    const entry = this.groupRoster.find((r) => r.userId === userId);
    let state = isSelf ? "JOINED" : entry ? entry.state : "RINGING";
    // Personne déjà en ligne avec nous avant la transformation 1-à-1 -> groupe :
    // le serveur la voit "RINGING" environ 1 s, on affiche "Connexion…" (pas "Sonne…").
    if (state === "RINGING" && this.groupMigratingIds.has(userId)) state = "JOINED";
    const peer = this.groupPeers.get(userId);
    const remoteState = this.groupPeerStates.get(userId) || {};

    const stream = isSelf ? this.groupLocalStream : peer && peer.stream;
    const micMuted = isSelf ? this.groupIsMuted : !!remoteState.micMuted;
    const camOff = isSelf ? this.groupIsCamOff : !!remoteState.camOff;
    const screenSharing = isSelf ? this.isScreenSharing : !!remoteState.screenSharing;
    const hasVideoTrack = !!stream && stream.getVideoTracks().some((t) => t.readyState !== "ended");
    // Afficher la vidéo si : JOINED + piste vidéo présente + caméra non coupée
    // Indépendamment de groupIsVideo (pour permettre réception vidéo même si appel démarré en audio)
    // Un participant qui partage son écran est toujours affiché (même caméra coupée) : sa piste porte l'écran.
    const showVideo = state === "JOINED" && hasVideoTrack && (!camOff || (screenSharing && !isSelf));

    // Textes (textContent : jamais d'HTML venant d'un autre utilisateur)
    const isMeetingHostUser = this.groupIsMeeting && (
      (isSelf && this.isMeetingHost) ||
      (!isSelf && this.meetingCreatedBy && userId === this.meetingCreatedBy)
    );
    tile.querySelector(".group-tile-name").textContent = isSelf ? "Vous" : this.getGroupDisplayName(userId);

    // Badge organisateur uniquement pour le vrai hôte
    let statusEl = tile.querySelector(".group-tile-status");
    if (this.groupIsMeeting) {
      tile.dataset.isHost = isMeetingHostUser ? "1" : "0";
      tile.classList.toggle("meeting-host-tile", isMeetingHostUser);
    }
    tile.querySelector(".group-initial").textContent = String(userId).charAt(0).toUpperCase();

    let statusText = CallManager.GROUP_STATE_LABELS[state] || "";
    if (state === "JOINED" && !isSelf && (!peer || peer.connState !== "connected")) {
      statusText = "Connexion…";
    }
    if (screenSharing) {
      statusText = "Partage d'écran";
    }
    tile.querySelector(".group-tile-status").textContent = statusText;

    // Classes d'état
    tile.classList.toggle("is-ringing", state === "RINGING");
    tile.classList.toggle("is-muted", state === "JOINED" && micMuted);
    tile.classList.toggle("is-speaking", this.groupActiveSpeakerId === userId);
    tile.classList.toggle("has-video", showVideo);
    tile.classList.toggle("is-screen-sharing", screenSharing);

    // Vidéo (toujours muette : le son passe par les <audio>)
    const video = tile.querySelector("video");
    if (showVideo) {
      video.muted = true;
      if (video.srcObject !== stream) {
        console.log(`📹 [GROUPE] Attachement vidéo pour ${userId} - showVideo: ${showVideo}, hasVideoTrack: ${hasVideoTrack}`);
        video.srcObject = stream;
      }
      const p = video.play();
      if (p && p.catch) {
        p.catch((e) => {
          console.warn(`⚠️ [GROUPE] Erreur play vidéo pour ${userId}:`, e);
        });
      }
    } else if (video.srcObject) {
      video.srcObject = null;
    }
  };

  // Titre + nombre de personnes dans l'en-tête.
  updateGroupHeader = () => {
    const title = document.getElementById("group-title");
    const status = document.getElementById("group-status");
    if (title) title.textContent = this.groupIsVideo ? "Appel de groupe vidéo" : "Appel de groupe";
    if (!status) return;

    const joined = this.groupRoster.filter((r) => r.state === "JOINED").length;
    const ringing = this.groupRoster.filter((r) => r.state === "RINGING").length;
    status.textContent =
      ringing > 0 && joined <= 1
        ? "Appel en cours…"
        : `${joined} participant${joined > 1 ? "s" : ""}`;
  };

  // Surligne la tuile de celui qui parle.
  setActiveSpeaker = (userId) => {
    if (this.groupActiveSpeakerId === userId) return;
    this.groupActiveSpeakerId = userId;
    this.groupTiles.forEach((tile, id) => tile.classList.toggle("is-speaking", id === userId));
  };

  // Chrono de l'appel de groupe.
  // initialSeconds : temps déjà écoulé (appel 1-à-1 transformé en groupe).
  startGroupTimer = (initialSeconds = 0) => {
    if (this.groupTimerInterval) return;
    let seconds = Math.max(0, Math.floor(initialSeconds));
    const render = () => {
      const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
      const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
      const s = String(seconds % 60).padStart(2, "0");
      const el = document.getElementById("timer-group");
      if (el) el.textContent = `${h}:${m}:${s}`;
    };
    render(); // affiche tout de suite le temps déjà écoulé
    this.groupTimerInterval = setInterval(() => {
      seconds++;
      render();
    }, 1000);
  };

  stopGroupTimer = () => {
    clearInterval(this.groupTimerInterval);
    this.groupTimerInterval = null;
    const el = document.getElementById("timer-group");
    if (el) el.textContent = "00:00:00";
  };

  // Détection de l'orateur actif : toutes les 400 ms on mesure le volume de
  // chaque flux audio (AnalyserNode) et on surligne le plus fort.
  startGroupSpeakerDetection = () => {
    if (this.groupSpeakerTimer) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.groupAudioCtx = this.groupAudioCtx || new AC();
      if (this.groupAudioCtx.state === "suspended") this.groupAudioCtx.resume().catch(() => {});
    } catch (e) {
      return; // fonction décorative : on ignore si indisponible
    }
    this.groupSpeakerTimer = setInterval(this.pollGroupSpeaker, 400);
  };

  pollGroupSpeaker = () => {
    const ctx = this.groupAudioCtx;
    if (!ctx) return;

    // Liste des flux à mesurer : le mien (si micro actif) + ceux des pairs.
    const sources = [];
    if (this.groupLocalStream && !this.groupIsMuted) sources.push([this.myId, this.groupLocalStream]);
    this.groupPeers.forEach((peer, id) => {
      if (peer.stream) sources.push([id, peer.stream]);
    });

    let loudestId = null;
    let loudest = 0.03; // seuil de silence
    sources.forEach(([id, stream]) => {
      if (!stream.getAudioTracks().length) return;
      let node = this.groupAnalysers.get(id);
      if (!node || node.stream !== stream) {
        try {
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          ctx.createMediaStreamSource(stream).connect(analyser); // pas relié aux haut-parleurs
          node = { analyser, stream, buffer: new Uint8Array(analyser.fftSize) };
          this.groupAnalysers.set(id, node);
        } catch (e) {
          return;
        }
      }
      node.analyser.getByteTimeDomainData(node.buffer);
      let sum = 0;
      for (let i = 0; i < node.buffer.length; i++) {
        const v = (node.buffer[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / node.buffer.length);
      if (rms > loudest) {
        loudest = rms;
        loudestId = id;
      }
    });
    this.setActiveSpeaker(loudestId);
  };

  stopGroupSpeakerDetection = () => {
    clearInterval(this.groupSpeakerTimer);
    this.groupSpeakerTimer = null;
    this.groupAnalysers.clear();
    if (this.groupAudioCtx) {
      try {
        this.groupAudioCtx.close();
      } catch (e) {}
      this.groupAudioCtx = null;
    }
    this.groupActiveSpeakerId = null;
  };

  /* =========================================================
     GROUPE — SECTION 10 : AJOUTER DES PARTICIPANTS PENDANT L'APPEL
  ========================================================= */

  openGroupAddSheet = () => {
    console.log("🔧 openGroupAddSheet appelé");
    console.log("  - groupRoomId:", this.groupRoomId);
    console.log("  - targetUserId:", this.targetUserId);
    console.log("  - Éléments avec 'group' dans le DOM:", document.querySelectorAll('[id*="group"]').length);
    // Autorisé : pendant un appel de groupe OU pendant un appel 1-à-1 (connecté ou en cours de connexion)
    // (dans ce second cas, l'appel sera transformé en groupe à la validation).
    if (!this.groupRoomId && !this.targetUserId) {
      this.showCallToast("Aucun appel en cours");
      return;
    }
    this.groupSelectedIds = [];
    this.renderGroupInviteeChips();
    this.setGroupSheetHint("");
    const sheet = document.getElementById("group-add-sheet");
    console.log("  - sheet trouvé:", !!sheet);
    if (!sheet) {
      console.log("  - ⚠️ Élément group-add-sheet introuvable, tentative de réinjection...");
      const host = document.createElement("div");
      host.innerHTML = CallManager.HTML;
      const sheetFromHost = host.querySelector("#group-add-sheet");
      if (sheetFromHost) {
        document.body.appendChild(sheetFromHost);
        console.log("  - ✅ Sheet réinjecté avec succès");
      } else {
        console.log("  - ❌ Sheet introuvable même dans le HTML template");
      }
    }
    const sheet2 = document.getElementById("group-add-sheet");
    if (sheet2) sheet2.classList.add("show");
    setTimeout(() => {
      const input = document.getElementById("group-add-input");
      if (input) input.focus();
    }, 150);
  };

  closeGroupAddSheet = () => {
    const sheet = document.getElementById("group-add-sheet");
    if (sheet) sheet.classList.remove("show");
    const input = document.getElementById("group-add-input");
    if (input) {
      input.value = "";
      input.blur();
    }
  };

  setGroupSheetHint = (text) => {
    const el = document.getElementById("group-sheet-hint");
    if (el) el.textContent = text || "";
  };

  // Ajoute l'ID saisi (ou plusieurs IDs séparés par des virgules) à la liste.
  addGroupInviteeFromInput = () => {
    const input = document.getElementById("group-add-input");
    if (!input) return;
    const ids = this.parseGroupIds(input.value);
    if (!ids.length) return;

    let hint = "";
    for (const id of ids) {
      const inCall =
        id === this.targetUserId || // mon interlocuteur 1-à-1 est déjà dans l'appel
        this.groupRoster.some(
          (r) => r.userId === id && (r.state === "JOINED" || r.state === "RINGING"),
        );
      if (id === this.myId) hint = "C'est votre propre ID.";
      else if (inCall) hint = `${id} est déjà dans l'appel.`;
      else if (this.groupSelectedIds.includes(id)) hint = `${id} est déjà dans la liste.`;
      else if (this.getActiveMembersCount() + this.groupSelectedIds.length + 1 > CallManager.GROUP_MAX_PARTICIPANTS) {
        hint = `Maximum ${CallManager.GROUP_MAX_PARTICIPANTS} participants.`;
        break;
      } else this.groupSelectedIds.push(id);
    }
    input.value = "";
    this.setGroupSheetHint(hint);
    this.renderGroupInviteeChips();
  };

  removeGroupInvitee = (userId) => {
    this.groupSelectedIds = this.groupSelectedIds.filter((id) => id !== userId);
    this.setGroupSheetHint("");
    this.renderGroupInviteeChips();
  };

  // Dessine les pastilles (chips) des IDs choisis.
  renderGroupInviteeChips = () => {
    const box = document.getElementById("group-chips");
    if (!box) return;
    box.innerHTML = "";
    this.groupSelectedIds.forEach((id) => {
      const chip = document.createElement("span");
      chip.className = "group-chip";
      const label = document.createElement("span");
      label.textContent = id; // textContent : pas d'injection HTML
      const remove = document.createElement("button");
      remove.type = "button";
      remove.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      remove.addEventListener("click", () => this.removeGroupInvitee(id));
      chip.appendChild(label);
      chip.appendChild(remove);
      box.appendChild(chip);
    });
  };

  // Valide : le serveur fait sonner les nouveaux invités (message group-add).
  confirmGroupAdd = () => {
    // Prend aussi en compte un ID tapé mais pas encore ajouté avec "+"
    this.addGroupInviteeFromInput();
    if (!this.groupSelectedIds.length) {
      this.setGroupSheetHint("Ajoutez au moins un ID.");
      return;
    }
    // Appel 1-à-1 en cours (pas encore de salle) : on le transforme en groupe.
    if (!this.groupRoomId) {
      const ids = this.groupSelectedIds.slice();
      this.groupSelectedIds = [];
      this.closeGroupAddSheet();
      this.convertCallToGroup(ids);
      return;
    }

    this.sendSignal({
      type: "group-add",
      roomId: this.groupRoomId,
      invitedIds: this.groupSelectedIds,
    });
    this.showCallToast("Invitation envoyée");
    this.groupSelectedIds = [];
    this.closeGroupAddSheet();
  };

  /* =========================================================
     GROUPE — SECTION 11 : QUITTER / NETTOYER
  ========================================================= */

  // Quitter l'appel : on sort, les autres continuent (comme WhatsApp).
  leaveGroupCall = (message) => {
    this.groupIsLeaving = true;
    if (this.groupRoomId) {
      this.sendSignal({ type: "group-leave", roomId: this.groupRoomId });
    }
    this.finishGroupCall(typeof message === "string" ? message : undefined);
  };

  // Fin d'appel côté écran : nettoie l'état, ferme les écrans, libère l'audio.
  finishGroupCall = (message) => {
    this.cleanGroupState();
    this.closeInterfaces();
    this.updateStatus("En ligne");

    // IMPORTANT : Nettoyer l'état de l'appel 1-à-1 pour désactiver le bouton d'appel
    this.targetUserId = null;
    this.peerConnection = null;
    this.localStream = null;
    this.isVideoCall = false;
    this.toggleCallButtons(false);

    // Android : libère le périphérique audio de communication
    if (this.isAndroid() && window.cordova && cordova.exec) {
      cordova.exec(() => {}, () => {}, "AudioRoutePlugin", "clearRoute", []);
    }
    if (message) this.showCallToast(message);
  };

  // Remet à zéro TOUT l'état de groupe (aucune minuterie ne reste active).
  cleanGroupState = () => {
    [
      "groupAloneTimer",
      "groupInviteTimer",
      "groupRequestTimer",
      "groupMigrateTimer",
    ].forEach((name) => {
      clearTimeout(this[name]);
      this[name] = null;
    });
    this.groupDowngradingToOneToOne = false;
    this.stopGroupTimer();
    this.stopGroupSpeakerDetection();
    this.closeAllGroupPeers();

    if (this.groupLocalStream) {
      this.groupLocalStream.getTracks().forEach((t) => {
        try { t.stop(); } catch (e) {}
      });
      this.groupLocalStream = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => {
        try { t.stop(); } catch (e) {}
      });
      this.localStream = null;
    }
    if (this._groupScreenTrack) {
      try { this._groupScreenTrack.stop(); } catch (e) {}
      this._groupScreenTrack = null;
    }
    this.isScreenSharing = false;

    // Grille et tuiles
    this.groupTiles.forEach((tile) => {
      const v = tile.querySelector("video");
      if (v) v.srcObject = null;
      tile.remove();
    });
    this.groupTiles.clear();
    const grid = document.getElementById("group-grid");
    if (grid) grid.innerHTML = "";
    const meetingGrid = document.getElementById("meeting-video-grid");
    if (meetingGrid) meetingGrid.innerHTML = "";
    const waitingGrid = document.getElementById("meeting-waiting-grid");
    if (waitingGrid) waitingGrid.innerHTML = "";
    const audioBox = document.getElementById("group-audio-container");
    if (audioBox) audioBox.innerHTML = "";
    this.closeGroupAddSheet();

    this.groupRoomId = null;
    this.groupIsVideo = false;
    this.groupIsMeeting = false;
    this.groupRoster = [];
    this.groupPeerStates.clear();
    this.groupMigratingIds.clear();
    this.groupRetryCount.clear();
    this.groupPendingInvite = null;
    this.groupSelectedIds = [];
    this.groupIsMuted = false;
    this.groupIsCamOff = false;
    this.groupIsFrontCamera = true;
    this.groupSpeakerOn = false;
    this.groupCreating = false;
    this.groupJoinPending = false;
    this.groupRejoining = false;
    this.groupEverHadPeer = false;
    this.groupIsMeeting = false;
    this.groupAcceptInProgress = false;
    this.groupIsLeaving = false;
    this._groupSwitching = false;
    this.stopVibration();
  };

  /* =========================================================
     GROUPE — SECTION 12 : TRANSFORMER UN APPEL 1-À-1 EN APPEL DE GROUPE
     Scénario (comme WhatsApp) : A est en appel avec B et appuie sur 👤+ pour
     ajouter C.
       A : convertCallToGroup([C])
           -> récupère son micro/caméra (aucune réouverture, pas de coupure),
              ferme la connexion 1-à-1 SANS envoyer "call-end",
              crée la salle avec B et C ("group-create").
       B : reçoit "group-invite" de A, alors qu'il est en appel avec A
           -> handleGroupInvite détecte le cas et appelle joinGroupFromCall :
              bascule AUTOMATIQUEMENT (aucune sonnerie) et rejoint la salle.
       C : reçoit un appel entrant de groupe normal (il sonne).
     Aucune modification du serveur n'est nécessaire.
  ========================================================= */

  // Vrai si un appel 1-à-1 est établi (connecté) en ce moment.
  isOneToOneConnected = () => {
    const pc = this.peerConnection;
    if (!pc || !this.targetUserId || this.groupRoomId) return false;
    const state = this.isIOS() ? pc.iceConnectionState : pc.connectionState || pc.iceConnectionState;
    return state === "connected" || state === "completed";
  };

  // Nombre de personnes actuellement dans l'appel (moi inclus), 1-à-1 ou groupe.
  getActiveMembersCount = () => {
    if (this.groupRoomId) return this.countActiveGroupMembers();
    return this.isOneToOneConnected() ? 2 : 0;
  };

  // Temps écoulé de l'appel 1-à-1 (lu sur le chrono affiché), pour le conserver.
  getOneToOneElapsedSeconds = () => {
    const read = (id) => {
      const el = document.getElementById(id);
      const m = el && /^(\d+):(\d+):(\d+)$/.exec((el.textContent || "").trim());
      return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
    };
    return Math.max(read("timer"), read("timer-video"));
  };

  // Sort de l'appel 1-à-1 SANS le raccrocher côté interlocuteur :
  //  - le flux micro/caméra est conservé (transmis au groupe),
  //  - la connexion WebRTC 1-à-1 est MAINTENUE TEMPORAIREMENT (pour éviter la coupure),
  //  - aucun "call-end" n'est envoyé,
  //  - tout l'état 1-à-1 est remis à zéro (SAUF peerConnection).
  // Retourne ce qu'il faut pour continuer en groupe.
  handOverCallToGroup = () => {
    const stream = this.localStream;
    const carry = {
      stream,
      isVideo: this.isVideoCall && !this.isCameraOff, // Utiliser isVideoCall + caméra activée (pas juste présence de pistes)
      isMuted: this.isMuted,
      isCameraOff: this.isCameraOff,
      isFrontCamera: this.isFrontCamera,
      speakerOn: this.currentAudioRoute === "speaker" || this.isSpeakerOn === true,
      elapsed: this.getOneToOneElapsedSeconds(),
      peerConnection: this.peerConnection, // ✅ Garder le peerConnection actif
      targetUserId: this.targetUserId,     // ✅ Garder l'ID de l'interlocuteur
    };

    // 1) Le flux local passe au groupe : on le détache
    this.localStream = null;

    // 2) Neutraliser la connexion 1-à-1 : plus aucun événement (ni redémarrage ICE).
    //    MAIS ON NE FERME PAS LA CONNEXION (pour éviter la coupure audio/vidéo)
    const pc = this.peerConnection;
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
    }

    // 3) Nettoyage PARTIEL (sans fermer le peerConnection ni envoyer de signal)
    this.targetUserId = null;
    this.pendingOffer = null;
    this.currentCallId = null;
    this.currentNotId = null;
    this.pendingCandidates = [];
    this.autoAcceptOnOffer = false;
    this._acceptInProgress = false;
    this.isRestartingIce = false;
    this.isVideoCall = false;
    this.peerConnection = null; // ✅ Important : retirer la référence pour que cleanCallState ne le ferme pas
    // On garde this.isMuted, this.isCameraOff, etc. pour adoptCarriedMedia

    return carry;
  };

  // Ferme proprement un peerConnection sans envoyer de signal "call-end"
  closePeerConnectionSilently = (pc) => {
    if (!pc) return;
    try {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.close();
    } catch (e) {
      console.error("❌ Erreur fermeture silencieuse peerConnection :", e);
    }
  };

  // Le groupe reprend le micro / la caméra de l'appel 1-à-1.
  adoptCarriedMedia = (carry) => {
    this.groupLocalStream = carry.stream;
    this.groupIsVideo = carry.isVideo;
    this.groupIsMuted = carry.isMuted;
    this.groupIsCamOff = carry.isCameraOff;
    this.groupIsFrontCamera = carry.isFrontCamera;
    this.groupSpeakerOn = carry.speakerOn;
    this.groupIsLeaving = false;
  };

  // CÔTÉ QUI AJOUTE (A) : transforme l'appel 1-à-1 en groupe en invitant newIds.
  // Retourne true si la transformation a démarré.
  convertCallToGroup = (newIds) => {
    if (!this.isOneToOneConnected()) {
      this.showCallToast("Attendez que l'appel soit connecté");
      return false;
    }
    const peerId = this.targetUserId;
    const extra = (newIds || []).filter((id) => id && id !== this.myId && id !== peerId);
    if (!extra.length) return false;
    if (extra.length + 2 > CallManager.GROUP_MAX_PARTICIPANTS) {
      this.showCallToast(`Maximum ${CallManager.GROUP_MAX_PARTICIPANTS} participants`);
      return false;
    }

    console.log("🔀 [GROUPE] transformation de l'appel 1-à-1 avec", peerId, "en groupe, + ", extra.join(", "));
    const carry = this.handOverCallToGroup();
    this.adoptCarriedMedia(carry);

    // ✅ Sauvegarder l'ancien peerConnection pour le fermer plus tard (quand le groupe est créé)
    this._oldPeerConnection = carry.peerConnection;

    // Mon interlocuteur est déjà en ligne : il bascule tout seul (pas de sonnerie).
    // En attendant sa jonction on affiche "Connexion…" au lieu de "Sonne…".
    this.groupMigratingIds = new Set([peerId]);
    clearTimeout(this.groupMigrateTimer);
    this.groupMigrateTimer = setTimeout(() => {
      this.groupMigratingIds.clear();
      this.renderGroupGrid();
    }, 8000);

    // On invite l'interlocuteur ET les nouveaux : le serveur diffuse "group-invite".
    this.sendGroupCreate([peerId, ...extra], carry.elapsed);
    return true;
  };

  // CÔTÉ ADDITIONNÉ (B) : mon interlocuteur 1-à-1 (data.from) vient de créer une
  // salle de groupe -> je quitte l'appel 1-à-1 et je rejoins la salle, sans sonnerie.
  joinGroupFromCall = (data) => {
    console.log("🔀 [GROUPE] bascule automatique de l'appel 1-à-1 vers la salle", data.roomId);
    const from = data.from;
    const carry = this.handOverCallToGroup();
    this.adoptCarriedMedia(carry);

    this.groupRoomId = data.roomId;
    this.groupIsVideo = data.isVideo === true || data.isVideo === "true";

    // Liste provisoire : moi + l'appelant (déjà dans l'appel) + ce que l'invitation contient.
    const others = (Array.isArray(data.roster) ? data.roster : []).filter(
      (r) => r.userId !== this.myId && r.userId !== from,
    );
    this.groupRoster = [
      { userId: this.myId, state: "JOINED" },
      { userId: from, state: "JOINED" },
      ...others,
    ];
    this.showGroupScreen(carry.elapsed);
    this.sendSignal({ type: "group-join", roomId: data.roomId });

    // ✅ Fermer l'ancien peerConnection 1-à-1 maintenant que le groupe est rejoint
    // Cela permet une transition fluide sans coupure (le peerConnection reste actif pendant la transition)
    this.closePeerConnectionSilently(carry.peerConnection);

    // Garde-fou : si le serveur ne confirme pas, on abandonne.
    this.groupJoinPending = true;
    clearTimeout(this.groupRequestTimer);
    this.groupRequestTimer = setTimeout(() => {
      if (this.groupJoinPending) {
        this.finishGroupCall("Impossible de rejoindre l'appel de groupe");
      }
    }, CallManager.GROUP_REQUEST_TIMEOUT_MS);
  };
}

/* =========================================================
   INSTANCIATION ET EXPOSITIONS GLOBALES
   (compatibilité avec les attributs onclick="..." du HTML)
========================================================= */

if (!window.__callManagerInitialized) {
  window.__callManagerInitialized = true;

  const callManager = new CallManager();
  window.callManager = callManager;

window.makeCall = callManager.makeCall;
window.acceptCall = callManager.acceptCall;
window.rejectCall = callManager.rejectCall;
window.hangUp = callManager.hangUp;
window.closeInterfaces = callManager.closeInterface;

window.connectWebSocket = callManager.connectWebSocket;
window.toggleMicrophone = callManager.toggleMicrophone;
window.makeVideoCall = callManager.makeVideoCall;
window.sendVideoLike = callManager.sendVideoLike;
window.sendGroupLike = callManager.sendGroupLike;

// ===== APPEL DE GROUPE : fonctions appelées par les onclick du HTML =====
window.startGroupCall = callManager.startGroupCall;
window.leaveGroupCall = callManager.leaveGroupCall;
window.toggleGroupMic = callManager.toggleGroupMic;
window.toggleGroupCamera = callManager.toggleGroupCamera;
window.switchGroupCamera = callManager.switchGroupCamera;
window.toggleGroupSpeaker = callManager.toggleGroupSpeaker;
window.openGroupAddSheet = callManager.openGroupAddSheet;
window.closeGroupAddSheet = callManager.closeGroupAddSheet;
window.addGroupInviteeFromInput = callManager.addGroupInviteeFromInput;
window.confirmGroupAdd = callManager.confirmGroupAdd;
window.toggleCamera = callManager.toggleCamera;
window.switchCamera = callManager.switchCamera;
window.onNativeIncomingCall = callManager.onNativeIncomingCall;
window.upgradeToVideo = callManager.upgradeToVideo;
window.toggleAudioRouteMenu = callManager.toggleAudioRouteMenu;
window.toggleSpeaker = callManager.toggleSpeaker;
window.toggleScreenLog = callManager.toggleScreenLog;
window.clearScreenLog = callManager.clearScreenLog;
window.showLocalStorageOnScreen = callManager.showLocalStorageOnScreen;
window.toggleIncomingCamera = callManager.toggleIncomingCamera;
window.toggleScreenShare = callManager.toggleScreenShare;
window.toggleShareFit = callManager.toggleShareFit;

// Helpers écran d'accueil (index.html)
window.copyMyId = () => {
  const id = (window.callManager && callManager.myId) || localStorage.getItem("app_user_id") || "";
  if (!id) {
    alert("ID non encore généré.");
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(id).then(
      () => alert("ID copié : " + id),
      () => prompt("Copiez votre ID :", id),
    );
  } else {
    prompt("Copiez votre ID :", id);
  }
};

window.disconnectWebSocket = () => {
  if (!window.callManager) return;
  callManager.manuallyClosed = true;
  callManager.stopHeartbeat();
  clearTimeout(callManager.reconnectTimer);

  const wsPlugin = window.CordovaWebsocketPlugin || cordova?.plugins?.CordovaWebsocketPlugin;

  // Fallback pour le navigateur
  if (!window.cordova || !wsPlugin) {
    if (callManager.ws) {
      callManager.ws.close();
      callManager.ws = null;
    }
  } else {
    // Utiliser le plugin Cordova
    if (callManager.wsId != null) {
      try {
        wsPlugin.wsClose(callManager.wsId, 1000, "Manual disconnect");
      } catch (e) {}
      callManager.wsId = null;
    }
  }

  callManager.wsReadyState = WebSocket.CLOSED;
  callManager.updateStatus("Hors ligne");
};
}
