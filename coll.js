/* =========================================================================
   CallApp -- classe unique regroupant le balisage HTML et toute la logique JS de
   l'application (état, permissions, notifications push, signalisation WebSocket,
   WebRTC, pont CallKit/PushKit iOS, interactions d'interface). Générée à partir des
   fichiers d'origine (index.html + app.js + effet.js + ios-callkit-bridge.js) sans
   changement de comportement -- seule l'organisation du code change.
========================================================================= */

class CallApp {                                                                                                                                                  
  constructor(containerId) {
    this.SIGNALING_SERVER_URL = "wss://serveur-appel.onrender.com";
    this.HTTP_SERVER_URL = "https://serveur-appel.onrender.com";
    this.RECONNECT_DELAY = 5000;
    this.rtcConfig = {
      iceServers: [
        {
          urls: "stun:socialstatus.furthermarket.com:443",
          username: "fmturn57",
          credential: "fmturn57",
        },                                                 
        {
          urls: "turn:socialstatus.furthermarket.com:80",
          username: "fmturn57",
          credential: "fmturn57",
        },
      ],
    };
    this.contain = containerId;
    this.myId = null;
    this.targetUserId = null;
    this.ws = null;
    this.reconnectTimer = null;
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
    this.isSpeakerOn = true;
    this.isRenegotiating = false;
    this.interfaceReceiver = null;
    this.interfaceSender = null;
    this.interfaceVideo = null;
    this.appReady = false;
    this.pendingNativeCall = null;
    this.callToastTimer = null;
    this.wsId = null;
    this.currentAudioRoute = "earpiece";
    this.webSocketIsConnected = false;


    this.ROUTE_LABELS = {
      earpiece: "Téléphone",
      speaker: "Haut-parleur",
      bluetooth: "Bluetooth",
    };
    this.ROUTE_ICONS = {
      earpiece: "fa-solid fa-phone-volume",
      speaker: "fa-solid fa-volume-high",
      bluetooth: "fa-brands fa-bluetooth-b",
    };
  }

 // FM_CALLS_INSTANCE = this;

  // Balisage HTML de l'application (page d'accueil + les 3 interfaces d'appel),
  // injecté dans <body> par mount(). Identique à l'ancien contenu statique de
  // index.html ; les attributs onclick appellent désormais "app.methode()" au lieu
  // de la fonction globale du même nom.
  getMarkup() {
    return `
      <div class="container fm-call-container">
        <h2>Appel Audio P2P</h2>
        <!--  cordova-plugin-iosrtc ne rend le flux audio distant que via un élément <video>
             (son videoElementsHandler observe uniquement les tags <video>, jamais <audio>).
             Cet élément reste caché : seul l'audio nous intéresse ici. -->
        <video id="remoteAudio" autoplay playsinline style="display:none; width:0; height:0;"></video>

        <!-- Mon ID généré -->
        <div class="card">
          <span class="label">Votre ID d'installation :</span>
          <div id="my-id-display" class="id-box">Génération...</div>
          <button id="btn-copy" onclick="app.copyMyId()">Copier mon ID</button>
          <button id="btn-copy" onclick="backHistory()">Retour</button>
        </div>

        <!-- Zone pour composer un ID -->
        <div class="card">
          <label for="target-id-input">ID du destinataire :</label>
          <input type="text" id="target-id-input" placeholder="Ex: ID-482910" />

          <div class="actions">
            <button id="btn-call" class="btn-green" onclick="app.makeCall()">
               Appeler
            </button>
            <button id="btn-video-call" class="btn-green" onclick="app.makeVideoCall()">
               Appeler en vidéo
            </button>
          </div>
        </div>

        <!-- Interface appel en cour emetteur -->
        <!-- ===== INTERFACE 1 : APPEL EN COURS (CLASSIQUE) ===== -->
        <div id="interface-1" class="view-container">
          <div class="app-container">
            <div class="header">
              <button class="icon-btn-top" onclick="app.closeInterface()">
                <i class="fa-solid fa-arrow-left"></i>
              </button>
              <div class="contact-info">
                <span class="contact-name">Junior</span>
                <div id="status" class="status-bar">Hors ligne</div>
                <div class="remote-status-badge js-remote-mute-badge"><i class="fa-solid fa-microphone-slash"></i> Micro coupé</div>
              </div>
              <button class="icon-btn-top">
                <i class="fa-solid fa-user-plus"></i>
              </button>
            </div>
            <div class="center" id="timer">00:00:00</div>
            <div class="center-avatar">
              <div class="avatar-container">
                <span style="font-size: 80px; color: #8696a0; font-weight: 600">J</span>
              </div>
            </div>
            <!-- Indicateur de statut -->
            <!-- <div id="status" class="status-bar">Hors ligne</div> -->

            <div class="control-panel">
              <div class="btn-wrapper">
                <button class="control-btn">
                  <i class="fa-brands fa-bluetooth-b"></i>
                </button>
                <span class="btn-label">Audio</span>
              </div>
              <div class="btn-wrapper">
                <button class="control-btn" onclick="app.upgradeToVideo()" >
                  <i class="fa-solid fa-video"></i>
                </button>
                <span class="btn-label">Vidéo</span>
              </div>
              <div class="btn-wrapper">
                <button class="control-btn js-mic-btn" onclick="app.toggleMicrophone()" aria-label="Micro">
                  <i class="fa-solid fa-microphone js-mic-icon"></i>
                </button>
                <span class="btn-label js-mic-label">Désactiver le micro</span>
              </div>
              <div class="btn-wrapper">
                <button class="control-btn">
                  <i class="fa-solid fa-ellipsis"></i>
                </button>
                <span class="btn-label">Plus</span>
              </div>
              <div class="btn-wrapper">
                <button class="control-btn">
                  <i class="fa-solid fa-arrow-up-from-bracket"></i>
                </button>
                <span class="btn-label">Partager</span>
              </div>
              <div class="btn-wrapper">
                <button class="control-btn hangup" onclick="app.hangUp()">
                  <i class="fa-solid fa-phone-slash"></i>
                </button>
                <span class="btn-label">Terminer</span>
              </div>
            </div>
          </div>
        </div>

        <!-- New interface receive call -->
        <!-- ===== INTERFACE 2 : APPEL ENTRANT ===== -->
        <div id="interface-2" class="view-container">
          <div class="app-container">
            <div class="header" style="justify-content: center">
              <div class="contact-info">
                <span class="contact-name">Junior</span>
                <div id="status" class="status-bar">Hors ligne</div>
              </div>
            </div>
            <div class="center-avatar">
              <div class="avatar-container">
                <span style="font-size: 80px; color: #8696a0; font-weight: 600">J</span>
              </div>
            </div>
            <div class="incoming-actions">
              <div class="incoming-btn-wrapper">
                <button class="incoming-btn refuse" onclick="app.rejectCall()">
                  <i class="fa-solid fa-phone-slash"></i>
                </button>
                <span class="incoming-label">Refuser</span>
              </div>
              <div class="incoming-btn-wrapper">
                <!-- <button class="incoming-btn accept" onclick="acceptCall()">
                    <i class="fa-solid fa-phone"></i>
                  </button> -->
                <div class="swipe-arrows">
                  <i class="fa-solid fa-chevron-up"></i>
                  <i class="fa-solid fa-chevron-up"></i>
                  <i class="fa-solid fa-chevron-up"></i>
                </div>

                <!-- C'est ici qu'il faut insérer l'id -->
                <button class="incoming-btn accept" id="swipeAcceptBtn" onclick="app.acceptCall()">
                  <i class="fa-solid fa-phone"></i>
                </button>
                <span class="incoming-label">Balayer vers le haut pour accepter</span>
              </div>
              <div class="incoming-btn-wrapper">
                <button class="incoming-btn message">
                  <i class="fa-solid fa-message"></i>
                </button>
                <span class="incoming-label">Message</span>
              </div>
            </div>
          </div>
        </div>

        <!-- ===== INTERFACE 3 : APPEL VIDÉO EN COURS ===== -->
        <div id="interface-3" class="view-container video-call-view">
          <div class="video-call-container">

            <!-- Video Distante -->
            <video id="remote-video" class="remote-video" autoplay playsinline webkit-playsinline disablePictureInPicture disableRemotePlayback controlsList="nofullscreen nodownload noremoteplayback noplaybackrate"></video>

            <!-- En-tête avec statut -->
            <div class="video-header">
              <div class="video-header-info">
                <div class="video-header-name">Junior</div>
                <div class="video-header-status status-bar">Connexion...</div>
                <div class="remote-status-row">
                  <span class="remote-status-badge js-remote-mute-badge"><i class="fa-solid fa-microphone-slash"></i> Micro coupé</span>
                  <span class="remote-status-badge js-remote-camera-badge"><i class="fa-solid fa-video-slash"></i> Caméra coupée</span>
                </div>
              </div>
            </div>

            <!-- Timer d'appel -->
            <div class="video-call-info">
              <span id="timer-video">00:00:00</span>
            </div>

            <!-- Ma Video (Miniature) -->
            <div class="local-video-wrapper">
              <video id="local-video" class="local-video" autoplay playsinline webkit-playsinline muted disablePictureInPicture disableRemotePlayback controlsList="nofullscreen nodownload noremoteplayback noplaybackrate"></video>
              <div id="local-video-placeholder" class="local-video-placeholder"><i class="fa-solid fa-video-slash"></i></div>
            </div>

            <!-- Panneau de contrôle -->
            <div class="video-control-panel">
              <div class="video-control-wrapper">
                <button class="video-control-btn" id="btn-toggle-camera" onclick="app.toggleCamera()">
                  <i class="fa-solid fa-video" id="camera-icon"></i>
                </button>
                <span>Caméra</span>
              </div>

              <div class="video-control-wrapper">
                <button class="video-control-btn" id="btn-switch-camera" onclick="app.switchCamera()" aria-label="Changer de caméra">
                  <i class="fa-solid fa-camera-rotate"></i>
                </button>
                <span>Retourner</span>
              </div>

              <div class="video-control-wrapper">
                <button class="video-control-btn" id="btn-toggle-speaker" onclick="app.toggleSpeaker()">
                  <i class="fa-solid fa-volume-high" id="speaker-icon"></i>
                </button>
                <span>Haut-parleur</span>
              </div>

              <div class="btn-wrapper">
                <button class="control-btn js-mic-btn" onclick="app.toggleMicrophone()" aria-label="Micro">
                  <i class="fa-solid fa-microphone js-mic-icon"></i>
                </button>
                <span class="btn-label js-mic-label" data-label-on="Micro" data-label-muted="Muet">Micro</span>
              </div>

              <!-- <div class="video-control-wrapper">
                <button class="video-control-btn" id="btn-toggle-video-mic" onclick="app.toggleMicrophone()">
                  <i class="fa-solid fa-microphone" id="video-mic-icon"></i>
                </button>
                <span>Micro</span>
              </div> -->

              <div class="video-control-wrapper">
                <button class="video-control-btn video-hangup" onclick="app.hangUp(true)">
                  <i class="fa-solid fa-phone-slash"></i>
                </button>
                <span>Terminer</span>
              </div>
            </div>

          </div>
        </div>


        <!-- Indicateur de statut -->
        <div id="status" class="status-bar">Hors ligne</div>

        <!-- Flux audio distant (masqué) -->
        <video id="remote-audio" autoplay playsinline style="display:none; width:0; height:0;"></video>

        <!-- Message local bref (ex: "Micro coupé") : voir showCallToast() dans app.js -->
        <div id="call-toast" class="call-toast"></div>
      </div>
`;
  }

  mount() {
    const container = document.getElementById(this.contain);
    if (!container) {
      console.error(
        ` CallApp.mount() : aucun élément #${this.contain} dans le DOM — l'application ne peut pas démarrer.`,
      );
      return;
    }
    container.innerHTML = this.getMarkup();
  }

  init() {
    const self = this;
    self.mount();

    document.addEventListener(
      "deviceready",
      function () {
        // iOS: Configuration iosrtc
        if (self.isIOS() && cordova.plugins && cordova.plugins.iosrtc) {
          cordova.plugins.iosrtc.registerGlobals();
          console.log(" [iOS] iosrtc activé - WebRTC natif iOS");
        } else if (self.isIOS()) {
          console.error(" [iOS] iosrtc non disponible");
        }
      },
      false,
    );

    document.addEventListener("deviceready", () => self.onDeviceReady(), false);

    // Récupération des interfaces du DOM dès le chargement
    self.interfaceReceiver = document.getElementById("interface-2");
    self.interfaceSender = document.getElementById("interface-1");
    self.interfaceVideo = document.getElementById("interface-3");
    

    self.setupLocalVideoDragging();

    window.callKitPendingAnswer = false;
    document.addEventListener(
      "deviceready",
      () => self.initIOSCallKit(),
      false,
    );

    document.addEventListener("DOMContentLoaded", () =>
      self.setupSwipeAccept(),
    );
  }

  getPlatform() {
    const self = this;

    if (!window.cordova) return "web";
    return cordova.platformId || "web";
  }

  isIOS() {
    const self = this;

    return self.getPlatform() === "ios";
  }

  isAndroid() {
    const self = this;

    return self.getPlatform() === "android";
  }

  async onDeviceReady() {
    const self = this;

    console.log(" Initialisation de l'application WebRTC...");
    console.log(" Plateforme détectée:", self.getPlatform());
    console.log(" isIOS():", self.isIOS());
    console.log(" isAndroid():", self.isAndroid());

    try {
      // Permissions communes
      await self.requestMicrophonePermission();
      await self.requestCameraPermission();

      // Permissions spécifiques Android
      if (self.isAndroid()) {
        await self.requestBluetoothPermission();
        await self.requestNotificationPermission();
      }

      // Permissions spécifiques iOS
      if (self.isIOS()) {
        await self.ensureMediaAuthorizedIOS();
      }

      self.initializeUserId();
      self.initPushNotifications();

      const idElement = document.getElementById("my-id-display");
      if (idElement) idElement.innerText = self.myId;

      await self.connectWebSocket();

      self.appReady = true;
      if (self.pendingNativeCall) {
        const call = self.pendingNativeCall;
        self.pendingNativeCall = null;
        self.processIncomingCall(
          call.callId,
          call.from,
          call.isVideo,
          call.autoAnswer,
        );
      }
    } catch (error) {
      console.error(" Erreur au démarrage :", error);
      self.updateStatus("Erreur d'initialisation");
    }
  }

  requestCameraPermission() {
    const self = this;

    return new Promise((resolve) => {
      if (window.cordova && cordova.plugins && cordova.plugins.permissions) {
        const permissions = cordova.plugins.permissions;
        permissions.requestPermission(
          permissions.CAMERA,
          (status) => resolve(),
          (error) => resolve(),
        );
      } else {
        resolve();
      }
    });
  }

  requestNotificationPermission() {
    const self = this;

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
  }

  requestMicrophonePermission() {
    const self = this;

    return new Promise((resolve) => {
      if (window.cordova && cordova.plugins && cordova.plugins.permissions) {
        const permissions = cordova.plugins.permissions;
        permissions.requestPermission(
          permissions.RECORD_AUDIO,
          (status) => resolve(),
          (error) => resolve(),
        );
      } else {
        resolve();
      }
    });
  }

  requestBluetoothPermission() {
    const self = this;

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
  }

  waitForAppActive() {
    const self = this;

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
  }

  ensureMediaAuthorizedIOS() {
    const self = this;

    if (
      !self.isIOS() ||
      !(window.cordova && cordova.plugins && cordova.plugins.diagnostic)
    ) {
      return Promise.resolve();
    }
    const diagnostic = cordova.plugins.diagnostic;

    function ensureAuthorized(getStatus, requestAuth, label) {
      return new Promise((resolve) => {
        getStatus(
          async (status) => {
            console.log(` [iOS] Statut ${label} :`, status);

            if (status !== diagnostic.permissionStatus.NOT_REQUESTED) {
              resolve();
              return;
            }

            console.log(
              ` [iOS] ${label} jamais demandé, attente du premier plan...`,
            );
            await self.waitForAppActive();

            requestAuth(
              (newStatus) => {
                console.log(` [iOS] ${label} ->`, newStatus);
                resolve();
              },
              (error) => {
                console.warn(` [iOS] Erreur demande ${label} :`, error);
                resolve();
              },
            );
          },
          (error) => {
            console.warn(` [iOS] Erreur lecture statut ${label} :`, error);
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
  }

  initializeUserId() {
    const self = this;

    self.myId = localStorage.getItem("app_user_id");
    if (!self.myId) {
      self.myId = "ID-" + Math.floor(100000 + Math.random() * 900000);
      localStorage.setItem("app_user_id", self.myId);
    }
    console.log(" Mon ID local :", self.myId);
  }

  initPushNotifications() {
    const self = this;

    console.log(" ===== INITIALISATION PUSH =====");

    if (typeof PushNotification === "undefined") {
      console.error(" PushNotification est undefined");
      return;
    }

    try {
      self.push = PushNotification.init({
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

      self.push.on("registration", function (data) {
        console.log(" ENREGISTREMENT PUSH RÉUSSI :", data.registrationId);
        self.deviceToken = data.registrationId;

        if (self.webSocketIsConnected === true) {
          self.sendSignal({
            action: "FM_Calls",
            type: "register-user",
            userId: self.myId,
            pushToken: self.deviceToken,
          });
        }
      });

      // Action: Accepter depuis notification
      self.push.on("accept", async function (data) {
        console.log(" ACCEPTER DEPUIS PUSH");
        const additionalData = data.additionalData || {};

        self.extractPushData(additionalData);
        self.autoAcceptOnOffer = true;

        if (self.peerConnection) {
          console.log("Appel déjà en cours, acceptation ignorée");
          return;
        }
        self.showInterface(
          self.isVideoCall ? self.interfaceVideo : self.interfaceSender,
        );
        self.updateStatus("Connexion à l'appel...");

        await self.ensureConnectedAndFetchOffer();
      });

      // Action: Refuser
      self.push.on("reject", async function (data) {
        console.log(" REFUSER APPEL");
        const additionalData = data.additionalData || {};

        self.extractPushData(additionalData);

        await self.ensureSocketReady();
        self.rejectCall();

        if (self.push && additionalData.notId) {
          self.push.finish(() => console.log(" Notification refusée terminée"));
        }
      });

      // Action: Clic sur notification
      self.push.on("notification", async function (data) {
        console.log(" Notification cliquée :", JSON.stringify(data));
        const additionalData = data.additionalData || {};

        if (additionalData.type === "incoming-call") {
          self.extractPushData(additionalData);
          self.autoAcceptOnOffer = false;

          self.showInterface(self.interfaceReceiver);
          self.updateStatus(
            self.isVideoCall ? "Appel vidéo entrant..." : "Appel entrant...",
          );
          self.startVibration();

          await self.ensureConnectedAndFetchOffer();
        }

        self.push.finish(() => console.log(" Notification terminée"));
      });

      self.push.on("error", (error) => console.error(" ERREUR PUSH :", error));
    } catch (error) {
      console.error(" Exception Push :", error);
    }
  }

  extractPushData(data) {
    const self = this;

    if (data.callerId) self.targetUserId = data.callerId;
    if (data.callId) {
      self.currentCallId = data.callId;
      localStorage.setItem("pending_call_id", data.callId);
    }
    if (data.isVideo !== undefined) {
      self.isVideoCall = data.isVideo === "true" || data.isVideo === true;
    }
    if (data.notId) self.currentNotId = data.notId;
  }

  async ensureConnectedAndFetchOffer() {
    const self = this;

    if (!self.currentCallId) {
      self.currentCallId = localStorage.getItem("pending_call_id");
    }

    await self.ensureSocketReady();

    if (self.currentCallId) {
      console.log(" Demande de l'offre SDP pour callId :", self.currentCallId);
      self.sendSignal({
        action: "FM_Calls",
        type: "get-offer",
        callId: self.currentCallId,
      });
    }
  }

  ensureSocketReady() {
    const self = this;

    return new Promise((resolve) => {
      const enregistrerEtValider = () => {
        self.sendSignal({
          action: "FM_Calls",
          type: "register-user",
          userId: self.myId,
          pushToken: self.deviceToken,
        });
        if (self.isIOS() && self.voipToken) {
          self.sendSignal({
            action: "FM_Calls",
            type: "register-voip-token",
            userId: self.myId,
            voipToken: self.voipToken,
          });
        }
        setTimeout(resolve, 400);
      };

      if (self.webSocketIsConnected === true) {
        enregistrerEtValider();
        return;
      }

      self.connectWebSocket().then(() => {
        let settled = false;
        const checkInterval = setInterval(() => {
          if (self.webSocketIsConnected === true) {
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
  }

  async connectWebSocket() {
    const self = this;

    if (self.webSocketIsConnected == true) {
      return;
    }

    self.updateStatus("Connexion au serveur...");

    try {
      await fetch(self.HTTP_SERVER_URL, { method: "GET", cache: "no-cache" });
    } catch (err) {
      console.warn(" HTTP Ping échoué :", err);
    }

    return new Promise((resolve) => {
      let settled = false;
      const settleOnce = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      setTimeout(settleOnce, 15000);
      self.createWebSocket(settleOnce);
    });
  }

  createWebSocket(onSettle) {
    const self = this;

    try {
      //self.ws = new WebSocket(self.SIGNALING_SERVER_URL);
      var wsOptions = {
                url: self.SIGNALING_SERVER_URL,
                timeout: 5000,
                pingInterval: 25000,
                // headers: {"Authorization": "Bearer " + accessToken},
                // acceptAllCerts: false
            }

       CordovaWebsocketPlugin.wsConnect(wsOptions,
                function(recvEvent) {
                    console.log("Received callback from WebSocket: "+recvEvent["callbackMethod"]);
                    let data = recvEvent["data"] || recvEvent["message"] || "";

                    if (recvEvent["callbackMethod"] === "onClose") {
                        self.webSocketIsConnected = false; // Mise à jour de l'état
                    }
                    try {
                        data = JSON.parse(data);
                    } catch (e) {
                        return;
                    }

                    if (data.type === "ping") {
                        self.sendSignal({ 
                            action: "FM_Calls",
                            type: "pong" 
                        });
                        console.log(" Pong envoyé");
                        return;
                    }

                    console.log(" Signal reçu :", data.type);

                    switch (data.type) {
                        case "incoming-call":
                        self.handleIncomingCall(data);
                        break;

                        case "call-offer-details":
                        self.handleCallOfferDetails(data);
                        break;

                        case "call-expired":
                        alert("L'appel a expiré ou a été annulé.");
                        self.hangUp(false);
                        break;

                        case "restart-offer":
                        if (data.isVideoUpgrade) {
                            self.handleVideoUpgradeOffer(data);
                        } else {
                            self.handleRestartOffer(data);
                        }
                        break;

                        case "call-answered":
                        self.handleCallAnswered(data);
                        break;

                        case "ice-candidate":
                        self.handleNewICECandidate(data);
                        break;

                        case "peer-mic-state":
                        self.handleRemoteMicState(data);
                        break;

                        case "peer-camera-state":
                        self.handleRemoteCameraState(data);
                        break;

                        case "call-refused":
                        case "call-end":
                        self.hangUp(false);
                        break;

                        case "video-upgrade-offer":
                        self.handleVideoUpgradeOffer(data);
                        break;
                    }
                },
                function(success) {
                    self.wsId = success.webSocketId;
                    self.webSocketIsConnected = true;
                    console.log("Connected to WebSocket with id: " + success.webSocketId);
                     console.log(" WebSocket Connecté");
                    self.updateStatus("En ligne");
                    self.sendSignal({
                        action: "FM_Calls",
                        type: "register-user",
                        userId: self.myId,
                        pushToken: self.deviceToken,
                    });
                    if (self.isIOS() && self.voipToken) {
                        self.sendSignal({
                        action: "FM_Calls",
                        type: "register-voip-token",
                        userId: self.myId,
                        voipToken: self.voipToken,
                        });
                    }
                    if (typeof onSettle === "function") onSettle();
                },
                function(error) {
                    console.log("Failed to connect to WebSocket: "+
                                "code: "+error["code"]+
                                ", reason: "+error["reason"]+
                                ", exception: "+error["exception"]);
                    console.error(" Erreur WebSocket :", JSON.stringify(error));
                    self.updateStatus("Erreur réseau WebSocket");
                    self.webSocketIsConnected = false;            
                }
        );     
    } catch (error) {
      console.error(" Erreur création WebSocket :", error);
      self.scheduleReconnect();
      if (typeof onSettle === "function") onSettle();
      return;
    }

    // self.ws.onopen = () => {
      
    // };

    // self.ws.onmessage = (event) => {
      
    // };

    // self.ws.onerror = (error) => {
      
    // };

    // self.ws.onclose = () => {
    //   self.ws = null;
    //   if (!self.manuallyClosed) {
    //     self.updateStatus("Hors ligne");
    //     self.scheduleReconnect();
    //   }
    // };
  }

  processSocketMessage(data) {
    const self = this;

    switch (data.type) {
        case "incoming-call":
        self.handleIncomingCall(data);
        break;

        case "call-offer-details":
        self.handleCallOfferDetails(data);
        break;

        case "call-expired":
        alert("L'appel a expiré ou a été annulé.");
        self.hangUp(false);
        break;

        case "restart-offer":
        if (data.isVideoUpgrade) {
            self.handleVideoUpgradeOffer(data);
        } else {
            self.handleRestartOffer(data);
        }
        break;

        case "call-answered":
        self.handleCallAnswered(data);
        break;

        case "ice-candidate":
        self.handleNewICECandidate(data);
        break;

        case "peer-mic-state":
        self.handleRemoteMicState(data);
        break;

        case "peer-camera-state":
        self.handleRemoteCameraState(data);
        break;

        case "call-refused":
        case "call-end":
        self.hangUp(false);
        break;

        case "video-upgrade-offer":
        self.handleVideoUpgradeOffer(data);
        break;
    }
  }

  scheduleReconnect() {
    const self = this;

    clearTimeout(self.reconnectTimer);
    self.reconnectTimer = setTimeout(
      () => self.connectWebSocket(),
      self.RECONNECT_DELAY,
    );
  }

  sendSignal(data) {
    const self = this;

    if (self.webSocketIsConnected == true) {
      //self.ws.send(JSON.stringify(data));
      CordovaWebsocketPlugin.wsSend(self.wsId, JSON.stringify(data));
      return true;
    } else {                                         
      console.warn(
        " Impossible d'envoyer le signal (Socket non prêt), nouvelle tentative dans 500ms:",
        data.type,
      );
      setTimeout(() => self.sendSignal(data), 500);
      return false;
    }
  }

  async makeCall(video = false) {
    const self = this;

    if (!self.ws || self.ws.readyState !== WebSocket.OPEN) {
      //alert("Vous n'êtes pas connecté au serveur.");
      //return;
    }

    const input = document.getElementById("target-id-input");
    const targetId = input ? input.value.trim() : "";

    if (!targetId || targetId === self.myId) {
      alert("Veuillez saisir un ID valide.");
      return;
    }

    self.cleanCallState();
    self.targetUserId = targetId;
    self.isVideoCall = video;

    self.updateStatus("Initialisation média...");

    try {
      await self.initMediaAndPeer();

      const offer = await self.peerConnection.createOffer();
      await self.peerConnection.setLocalDescription(offer);

      self.sendSignal({
        action: "FM_Calls",
        type: "call-user",
        targetId: self.targetUserId,
        offer: offer,
        isVideo: self.isVideoCall,
      });

      self.updateStatus("Appel en cours...");
      self.toggleCallButtons(true);
      self.toggleCallControlButtons(false);
      self.showInterface(
        self.isVideoCall ? self.interfaceVideo : self.interfaceSender,
      );
    } catch (error) {
      console.error(" Erreur lancement appel :", error);
      self.hangUp(false);
    }
  }

  makeVideoCall() {
    const self = this;

    self.makeCall(true);
  }

  async handleCallAnswered(data) {
    const self = this;

    console.log(" Appel accepté par le destinataire");
    if (!self.peerConnection) return;

    try {
      const SessionDescription = self.activeRTC
        ? self.activeRTC.SessionDescription
        : RTCSessionDescription;
      await self.peerConnection.setRemoteDescription(
        new SessionDescription(data.answer),
      );
      await self.processPendingCandidates();
      self.startTimer();
      self.updateStatus("Appel connecté");
      self.toggleCallControlButtons(true);
    } catch (error) {
      console.error(" Erreur réponse :", error);
      self.hangUp(false);
    } finally {
      self.isRenegotiating = false;
    }
  }

  async upgradeToVideo() {
    const self = this;

    if (!self.peerConnection || !self.localStream || self.isVideoCall) {
      console.log(" upgradeToVideo() annulé");
      return;
    }

    const confirmed = true;
    //window.confirm("Voulez-vous passer en appel vidéo ?");
    if (!confirmed) {
      console.log(" Passage en vidéo annulé par l'appelant");
      return;
    }

    console.log(" upgradeToVideo() démarré");

    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
      });
      const videoTrack = videoStream.getVideoTracks()[0];
      if (!videoTrack) return;

      self.isRenegotiating = true;

      self.localStream.addTrack(videoTrack);
      self.peerConnection.addTrack(videoTrack, self.localStream);

      self.isVideoCall = true;

      const localVideo = document.getElementById("local-video");
      if (localVideo) localVideo.srcObject = self.localStream;
      self.showInterface(self.interfaceVideo);
      self.showLocalVideoPlaceholder(false);

      const offer = await self.peerConnection.createOffer();
      await self.peerConnection.setLocalDescription(offer);

      self.sendSignal({
        action: "FM_Calls",
        type: "restart-offer",
        targetId: self.targetUserId,
        offer: offer,
        isVideo: true,
      });
      self.updateStatus("Passage en appel vidéo...");
    } catch (error) {
      self.isRenegotiating = false;
      console.error(" Erreur passage en vidéo :", error);
    }
  }

  async performVideoUpgrade() {
    const self = this;

    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
      });
      const videoTrack = videoStream.getVideoTracks()[0];
      if (!videoTrack) return;

      self.isRenegotiating = true;

      self.localStream.addTrack(videoTrack);
      self.peerConnection.addTrack(videoTrack, self.localStream);

      self.isVideoCall = true;

      const localVideo = document.getElementById("local-video");
      if (localVideo) localVideo.srcObject = self.localStream;
      self.showInterface(self.interfaceVideo);
      self.showLocalVideoPlaceholder(false);

      const offer = await self.peerConnection.createOffer();
      await self.peerConnection.setLocalDescription(offer);

      self.sendSignal({
        action: "FM_Calls",
        type: "restart-offer",
        targetId: self.targetUserId,
        offer: offer,
        isVideo: true,
      });
      self.updateStatus("Passage en appel vidéo...");
    } catch (error) {
      self.isRenegotiating = false;
      console.error(" Erreur passage en vidéo :", error);
    }
  }

  handleVideoUpgradeRequest(data) {
    const self = this;

    console.log(" Demande de passage en vidéo reçue de :", data.from);

    const accept = window.confirm("Voulez-vous passer en appel vidéo ?");

    self.sendSignal({
      action: "FM_Calls",
      type: "video-upgrade-response",
      targetId: self.targetUserId,
      accepted: accept,
    });

    if (!accept) {
      console.log(" Passage en vidéo refusé");
    }
  }

  handleVideoUpgradeResponse(data) {
    const self = this;

    if (data.accepted) {
      console.log(" Passage en vidéo accepté par le destinataire");
      self.performVideoUpgrade();
    } else {
      console.log(" Passage en vidéo refusé par le destinataire");
      self.updateStatus("Appel connecté");
      alert("L'autre personne a refusé de passer en appel vidéo.");
    }
  }

  async handleVideoUpgradeOffer(data) {
    const self = this;

    if (!self.peerConnection) {
      console.log(" handleVideoUpgradeOffer() ignoré — pas de peerConnection");
      return;
    }
    console.log(
      " handleVideoUpgradeOffer() reçu — isVideoCall avant:",
      self.isVideoCall,
    );
    self.isRenegotiating = true;

    try {
      if (!self.isVideoCall) {
        self.isVideoCall = true;
        self.showInterface(self.interfaceVideo);
        self.showLocalVideoPlaceholder(true);
        self.isCameraOff = true;
        self.updateCameraIcon();
        self.sendCameraState();
      }

      const SessionDescription = self.activeRTC
        ? self.activeRTC.SessionDescription
        : RTCSessionDescription;
      await self.peerConnection.setRemoteDescription(
        new SessionDescription(data.offer),
      );
      console.log(" setRemoteDescription(offer) OK");
      await self.processPendingCandidates();

      const videoTransceiver = self.peerConnection
        .getTransceivers()
        .find(
          (t) =>
            t.receiver && t.receiver.track && t.receiver.track.kind === "video",
        );

      if (
        videoTransceiver &&
        !(self.localStream && self.localStream.getVideoTracks().length > 0)
      ) {
        videoTransceiver.direction = "recvonly";
      }

      const answer = await self.peerConnection.createAnswer();
      await self.peerConnection.setLocalDescription(answer);
      console.log(" Réponse créée (recvonly si pas encore de caméra locale)");

      self.sendSignal({
        action: "FM_Calls",
        type: "answer-call",
        targetId: self.targetUserId,
        answer: answer,
        callId: self.currentCallId
      });
      self.updateStatus("Appel vidéo connecté");
    } catch (error) {
      console.error(" Erreur réception passage vidéo :", error);
    } finally {
      self.isRenegotiating = false;
    }
  }

  handleIncomingCall(data) {
    const self = this;

    console.log(" Appel entrant reçu de :", data.from);

    self.cleanCallState();
    self.targetUserId = data.from;
    self.pendingOffer = data.offer;
    self.currentCallId = data.callId;
    self.isVideoCall = data.isVideo === "true" || data.isVideo === true;
    if (data.notId) self.currentNotId = data.notId;

    self.updateStatus(
      self.isVideoCall ? "Appel vidéo entrant..." : "Appel entrant...",
    );
    self.showInterface(self.interfaceReceiver);
    self.startVibration();
  }

  async handleCallOfferDetails(data) {
    const self = this;

    console.log(" Offre SDP reçue du serveur pour :", data.callId);

    self.targetUserId = data.from;
    self.pendingOffer = data.offer;
    self.isVideoCall = data.isVideo === "true" || data.isVideo === true;

    if (self.autoAcceptOnOffer && self.pendingOffer) {
      self.autoAcceptOnOffer = false;
      await self.acceptCall();
    }
  }

  async acceptCall() {
    const self = this;

    // iOS: réponse forcée via CallKit
    if (self.isIOS()) {
      console.log(" [iOS] Réponse forcée via l'écran d'appel natif CallKit.");
      self.updateStatus("Décrochez depuis l'écran d'appel");
      return self.answerIncomingCall();
    }

    self.stopVibration();

    if (!self.pendingOffer) {
      if (self.currentCallId) {
        self.autoAcceptOnOffer = true;
        await self.ensureConnectedAndFetchOffer();
        return;
      }
      console.warn(" Aucune offre SDP disponible pour répondre.");
      return;
    }

    try {
      self.updateStatus("Connexion à l'appel...");
      await self.initMediaAndPeer();

      const SessionDescription = self.activeRTC
        ? self.activeRTC.SessionDescription
        : RTCSessionDescription;
      await self.peerConnection.setRemoteDescription(
        new SessionDescription(self.pendingOffer),
      );
      await self.processPendingCandidates();

      const answer = await self.peerConnection.createAnswer();
      await self.peerConnection.setLocalDescription(answer);

      self.sendSignal({
        action: "FM_Calls",
        type: "answer-call",
        targetId: self.targetUserId,
        answer: answer,
      });

      self.startTimer();
      self.pendingOffer = null;

      self.showInterface(
        self.isVideoCall ? self.interfaceVideo : self.interfaceSender,
      );
      self.updateStatus("Appel connecté");
    } catch (error) {
      console.error(" Erreur acceptation appel :", error);
      self.hangUp(false);
    }
  }

  async answerIncomingCall() {
    const self = this;

    console.log(" [iOS] answerIncomingCall() démarre");
    self.stopVibration();

    if (!self.pendingOffer) {
      if (self.currentCallId) {
        console.log(" [iOS] Pas encore d'offre — nouvelle demande get-offer");
        self.autoAcceptOnOffer = true;
        await self.ensureConnectedAndFetchOffer();
        return;
      }
      console.warn(" [iOS] Aucune offre SDP disponible");
      return;
    }

    try {
      self.updateStatus("Connexion à l'appel...");

      // iOS: Activation audio AVANT getUserMedia
      if (self.isIOS() && cordova.plugins && cordova.plugins.CordovaCall) {
        console.log(" [iOS] activateAudio() natif démarre...");
        await new Promise((resolve) => {
          try {
            cordova.plugins.CordovaCall.activateAudio(
              () => {
                console.log(" [iOS] AVAudioSession activée.");
                resolve();
              },
              (err) => {
                console.warn(" [iOS] activateAudio erreur:", err);
                resolve();
              },
            );
          } catch (e) {
            console.warn(" [iOS] activateAudio exception:", e);
            resolve();
          }
        });
      }

      await self.initMediaAndPeer(false); // false: attacher pistes après setRemoteDescription

      if (self.isVideoCall) {
        self.showInterface(self.interfaceVideo);
      }

      const SessionDescription = self.activeRTC
        ? self.activeRTC.SessionDescription
        : RTCSessionDescription;
      await self.peerConnection.setRemoteDescription(
        new SessionDescription(self.pendingOffer),
      );

      self.attachLocalTracksToPeer();

      await self.processPendingCandidates();

      const answer = await self.peerConnection.createAnswer();
      await self.peerConnection.setLocalDescription(answer);

      self.sendSignal({
        action: "FM_Calls",
        type: "answer-call",
        targetId: self.targetUserId,
        answer: answer,
      });

      self.startTimer();
      self.pendingOffer = null;

      self.showInterface(
        self.isVideoCall ? self.interfaceVideo : self.interfaceSender,
      );
      self.updateStatus("Appel connecté");
    } catch (error) {
      console.error(" [iOS] Erreur acceptation appel :", error);
      self.hangUp(false);
    }
  }

  rejectCall() {
    const self = this;

    // iOS: Terminer appel CallKit
    if (self.isIOS() && cordova.plugins && cordova.plugins.CordovaCall) {
      try {
        cordova.plugins.CordovaCall.endCall();
      } catch (e) {}
    }

    if (self.targetUserId) {
      self.sendSignal({
        action: "FM_Calls",
        type: "call-refused",
        targetId: self.targetUserId,
      });
    }
    self.stopVibration();
    self.cleanCallState();
    self.closeInterfaces();
    self.updateStatus("En ligne");
  }

  attachLocalTracksToPeer() {
    const self = this;

    if (!self.peerConnection || !self.localStream) return;
    self.localStream.getTracks().forEach((track) => {
      self.peerConnection.addTrack(track, self.localStream);
    });
    console.log(" Pistes locales attachées au peerConnection");
  }

  async initMediaAndPeer(attachTracksNow = true) {
    const self = this;

    try {
      // Configuration de l'implémentation WebRTC
      self.activeRTC = {
        getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
        PeerConnection: window.RTCPeerConnection,
        SessionDescription: window.RTCSessionDescription,
        IceCandidate: window.RTCIceCandidate,
      };

      // iOS: Vérifier autorisations médias
      if (self.isIOS()) {
        await self.ensureMediaAuthorizedIOS();
      }

      self.localStream = await self.activeRTC.getUserMedia({
        audio: true,
        video: self.isVideoCall ? { facingMode: "user" } : false,
      });

      if (self.isVideoCall) {
        const localVideo = document.getElementById("local-video");
        if (localVideo) localVideo.srcObject = self.localStream;
      }

      // iOS: Activer haut-parleur par défaut
      if (self.isIOS() && typeof self.activerAudioSessionIOS === "function") {
        self.activerAudioSessionIOS(self.isSpeakerOn ? "speaker" : "receiver");
      }

      self.peerConnection = new self.activeRTC.PeerConnection(self.rtcConfig);

      if (attachTracksNow) {
        self.attachLocalTracksToPeer();
      }

      self.peerConnection.onicecandidate = (event) => {
        if (event.candidate && self.targetUserId) {
          self.sendSignal({
            action: "FM_Calls",
            type: "ice-candidate",
            targetId: self.targetUserId,
            candidate: event.candidate,
          });
        }
      };

      self.peerConnection.ontrack = async (event) => {
        console.log(" ontrack déclenché — kind:", event.track.kind);

        const stream =
          event.streams && event.streams[0]
            ? event.streams[0]
            : new MediaStream([event.track]);

        if (event.track.kind === "video") {
          const remoteVideo = document.getElementById("remote-video");
          if (remoteVideo) {
            if (remoteVideo.srcObject !== stream) {
              remoteVideo.srcObject = stream;
            }
            try {
              await remoteVideo.play();
            } catch (e) {
              console.error(" Erreur play remote-video :", e);
            }
          }
        } else {
          const remoteAudio =
            document.getElementById("remoteAudio") ||
            document.getElementById("remote-audio");
          if (remoteAudio) {
            if (remoteAudio.srcObject !== stream) {
              remoteAudio.srcObject = stream;
            }
            try {
              await remoteAudio.play();
            } catch (e) {}
          }
        }
      };

      // iOS: Utiliser oniceconnectionstatechange au lieu de onconnectionstatechange
      const stateChangeEvent = self.isIOS()
        ? "oniceconnectionstatechange"
        : "onconnectionstatechange";
      const stateProperty = self.isIOS()
        ? "iceConnectionState"
        : "connectionState";

      self.peerConnection[stateChangeEvent] = () => {
        const state = self.peerConnection[stateProperty];
        console.log(" État WebRTC :", state);

        if (
          (state === "failed" || state === "disconnected") &&
          !self.isRestartingIce &&
          !self.isRenegotiating
        ) {
          console.log(" Déclenchement restartIceSession()");
          self.restartIceSession();
        }

        if (state === "connected") {
          self.isRestartingIce = false;
          self.updateStatus("Appel connecté");

          // iOS: Activer haut-parleur à la connexion
          if (
            self.isIOS() &&
            typeof self.activerAudioSessionIOS === "function"
          ) {
            self.activerAudioSessionIOS(
              self.isSpeakerOn ? "speaker" : "receiver",
            );
          }
        }
      };
    } catch (error) {
      console.error(" Erreur dans initMediaAndPeer() :", error);
    }
  }

  async handleNewICECandidate(data) {
    const self = this;

    if (!data.candidate) return;

    if (!self.peerConnection || !self.peerConnection.remoteDescription) {
      self.pendingCandidates.push(data.candidate);
      return;
    }

    try {
      const IceCandidate = self.activeRTC
        ? self.activeRTC.IceCandidate
        : RTCIceCandidate;
      await self.peerConnection.addIceCandidate(
        new IceCandidate(data.candidate),
      );
    } catch (error) {
      console.error(" Erreur ICE candidate :", error);
    }
  }

  async processPendingCandidates() {
    const self = this;

    if (self.pendingCandidates.length > 0) {
      const IceCandidate = self.activeRTC
        ? self.activeRTC.IceCandidate
        : RTCIceCandidate;
      for (const candidate of self.pendingCandidates) {
        try {
          await self.peerConnection.addIceCandidate(
            new IceCandidate(candidate),
          );
        } catch (e) {}
      }
      self.pendingCandidates = [];
    }
  }

  async restartIceSession() {
    const self = this;

    if (!self.peerConnection || !self.targetUserId) return;

    try {
      self.isRestartingIce = true;
      if (typeof self.peerConnection.restartIce === "function") {
        self.peerConnection.restartIce();
      }

      const offer = await self.peerConnection.createOffer({ iceRestart: true });
      await self.peerConnection.setLocalDescription(offer);

      self.sendSignal({
        action: "FM_Calls",
        type: "restart-offer",
        targetId: self.targetUserId,
        offer: offer,
      });
    } catch (error) {
      self.isRestartingIce = false;
    }
  }

  async handleRestartOffer(data) {
    const self = this;

    if (!self.peerConnection) return;

    try {
      const SessionDescription = self.activeRTC
        ? self.activeRTC.SessionDescription
        : RTCSessionDescription;
      await self.peerConnection.setRemoteDescription(
        new SessionDescription(data.offer),
      );
      await self.processPendingCandidates();

      const answer = await self.peerConnection.createAnswer();
      await self.peerConnection.setLocalDescription(answer);

      self.sendSignal({
        action: "FM_Calls",
        type: "answer-call",
        targetId: self.targetUserId,
        answer: answer,
      });
    } catch (e) {}
  }

  clearNativeCallNotification() {
    const self = this;

    if (!self.currentNotId) return;
    if (
      !(
        self.isIOS() &&
        self.push &&
        typeof self.push.clearNotification === "function"
      )
    ) {
      return;
    }
    const notIdToClear = self.currentNotId;
    self.push.clearNotification(
      Number(notIdToClear),
      () => console.log(" Notification native supprimée"),
      (err) => console.warn(" Échec suppression notification native :", err),
    );
  }

  hangUp(sendSignalToPeer = true) {
    const self = this;
    console.log(" Fermeture forcée de CallKit et nettoyage...");

    if (
      window.cordova &&
      cordova.platformId === "ios" &&
      cordova.plugins &&
      cordova.plugins.CordovaCall
    ) {
      try {
        cordova.plugins.CordovaCall.endCall();
      } catch (e) {
        console.warn(" Erreur CordovaCall.endCall() :", e);
      }
    }

    if (sendSignalToPeer && self.targetUserId) {
      self.sendSignal({
        action: "FM_Calls",
        type: "call-end",
        targetId: self.targetUserId,
      });
    }

    self.cleanCallState();
    self.closeInterfaces();
    self.toggleCallButtons(false);
    self.updateStatus("En ligne");
  }

  cleanCallState() {
    const self = this;

    self.clearNativeCallNotification();

    if (self.localStream) {
      self.localStream.getTracks().forEach((track) => track.stop());
      self.localStream = null;
    }

    const localVideo = document.getElementById("local-video");
    const remoteVideo = document.getElementById("remote-video");
    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;

    if (self.peerConnection) {
      try {
        self.peerConnection.close();
      } catch (e) {}
      self.peerConnection = null;
    }
    self.activeRTC = null;

    self.stopTimer();
    self.stopVibration();

    self.pendingOffer = null;
    self.currentCallId = null;
    self.currentNotId = null;
    self.targetUserId = null;
    self.pendingCandidates = [];
    self.autoAcceptOnOffer = false;
    self.isRestartingIce = false;
    self.isVideoCall = false;
    self.isCameraOff = false;
    self.isMuted = false;
    self.updateMicUI();
    document
      .querySelectorAll(".js-remote-mute-badge")
      .forEach((badge) => badge.classList.remove("show"));
    document
      .querySelectorAll(".js-remote-camera-badge")
      .forEach((badge) => badge.classList.remove("show"));
    self.hideCallToast();
    self.isFrontCamera = true;
    self.isSwitchingCamera = false;
    self.isRenegotiating = false;
    self.isSpeakerOn = true;
    self.toggleCallControlButtons(true);

    const switchCameraBtn = document.getElementById("btn-switch-camera");
    if (switchCameraBtn) switchCameraBtn.disabled = false;

    localStorage.removeItem("pending_call_id");
  }

  showCallToast(message) {
    const self = this;

    const toast = document.getElementById("call-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(self.callToastTimer);
    self.callToastTimer = setTimeout(
      () => toast.classList.remove("show"),
      1800,
    );
  }

  hideCallToast() {
    const self = this;

    clearTimeout(self.callToastTimer);
    const toast = document.getElementById("call-toast");
    if (toast) toast.classList.remove("show");
  }

  toggleMicrophone() {
    const self = this;

    if (!self.localStream) return;
    const audioTrack = self.localStream.getAudioTracks()[0];
    if (!audioTrack) return;

    self.isMuted = !self.isMuted;
    audioTrack.enabled = !self.isMuted;
    self.updateMicUI();
    if (self.isMuted) self.showCallToast("Micro coupé");

    if (self.targetUserId) {
      self.sendSignal({
        action: "FM_Calls",
        type: "peer-mic-state",
        targetId: self.targetUserId,
        muted: self.isMuted,
      });
    }
  }

  handleRemoteMicState(data) {
    const self = this;

    document.querySelectorAll(".js-remote-mute-badge").forEach((badge) => {
      badge.classList.toggle("show", !!data.muted);
    });
  }

  handleRemoteCameraState(data) {
    const self = this;

    document.querySelectorAll(".js-remote-camera-badge").forEach((badge) => {
      badge.classList.toggle("show", !!data.cameraOff);
    });
  }

  sendCameraState() {
    const self = this;

    if (self.targetUserId) {
      self.sendSignal({
        action: "FM_Calls",
        type: "peer-camera-state",
        targetId: self.targetUserId,
        cameraOff: self.isCameraOff,
      });
    }
  }

  updateMicUI() {
    const self = this;

    document
      .querySelectorAll(".js-mic-btn")
      .forEach((btn) => btn.classList.toggle("active-mute", self.isMuted));
    document.querySelectorAll(".js-mic-icon").forEach((icon) => {
      icon.className = self.isMuted
        ? "fa-solid fa-microphone-slash js-mic-icon"
        : "fa-solid fa-microphone js-mic-icon";
    });
    document.querySelectorAll(".js-mic-label").forEach((label) => {
      label.textContent = self.isMuted
        ? label.dataset.labelMuted || "Activer le micro"
        : label.dataset.labelOn || "Désactiver le micro";
    });
  }

  getAudioRoutes() {
    const self = this;

    return new Promise((resolve) => {
      if (!window.cordova || !cordova.exec) {
        resolve({ routes: ["earpiece", "speaker"], current: "earpiece" });
        return;
      }
      cordova.exec(
        resolve,
        () => resolve({ routes: ["earpiece", "speaker"], current: "earpiece" }),
        "AudioRoutePlugin",
        "getRoutes",
        [],
      );
    });
  }

  setAudioRoute(route) {
    const self = this;

    return new Promise((resolve) => {
      if (!window.cordova || !cordova.exec) {
        resolve(route);
        return;
      }
      cordova.exec(
        resolve,
        () => resolve(route),
        "AudioRoutePlugin",
        "setRoute",
        [route],
      );
    });
  }

  async toggleAudioRouteMenu() {
    const self = this;

    const menu = document.getElementById("audio-route-menu");
    if (!menu) return;

    if (menu.classList.contains("open")) {
      menu.classList.remove("open");
      return;
    }

    const { routes, current } = await self.getAudioRoutes();
    self.currentAudioRoute = current || "earpiece";

    menu.innerHTML = "";
    routes.forEach((route) => {
      const item = document.createElement("div");
      item.className =
        "audio-route-item" +
        (route === self.currentAudioRoute ? " active" : "");
      item.innerHTML = `<i class="${self.ROUTE_ICONS[route] || "fa-solid fa-volume-high"}"></i><span>${self.ROUTE_LABELS[route] || route}</span>`;
      item.onclick = async () => {
        await self.setAudioRoute(route);
        self.currentAudioRoute = route;
        self.updateAudioRouteIcon();
        menu.classList.remove("open");
      };
      menu.appendChild(item);
    });

    menu.classList.add("open");
  }

  updateAudioRouteIcon() {
    const self = this;

    const icon = document.getElementById("audio-route-icon");
    if (icon)
      icon.className =
        self.ROUTE_ICONS[self.currentAudioRoute] || "fa-brands fa-bluetooth-b";
  }

  toggleSpeaker() {
    const self = this;

    self.isSpeakerOn = !self.isSpeakerOn;

    if (self.isIOS() && typeof self.activerAudioSessionIOS === "function") {
      self.activerAudioSessionIOS(self.isSpeakerOn ? "speaker" : "receiver");
    }

    const speakerIcon = document.getElementById("speaker-icon");
    const btn = document.getElementById("btn-toggle-speaker");

    if (self.isSpeakerOn) {
      if (speakerIcon) speakerIcon.className = "fa-solid fa-volume-high";
      if (btn) btn.classList.remove("disabled");
    } else {
      if (speakerIcon) speakerIcon.className = "fa-solid fa-volume-low";
      if (btn) btn.classList.add("disabled");
    }
  }

  updateStatus(message) {
    const self = this;

    const statusElement = document.querySelectorAll(".status-bar");
    for (let i = 0; i < statusElement.length; i++) {
      statusElement[i].innerText = message;
    }
  }

  toggleCallControlButtons(enabled) {
    const self = this;

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

    // Interface d'appel audio (interface-1) : les boutons "Audio", "Vidéo",
    // "Plus" et "Partager" n'ont pas d'id dans le HTML de référence (qu'on ne
    // modifie pas), donc on les cible par leur position dans le panneau de
    // contrôle. Le bouton "Terminer" (classe .hangup) est explicitement exclu
    // pour rester utilisable et permettre d'annuler l'appel en cours.
    if (self.interfaceSender) {
      const audioPanelButtons = self.interfaceSender.querySelectorAll(
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
  }

  toggleCallButtons(inCall) {
    const self = this;

    const callButton = document.getElementById("btn-call");
    if (callButton) callButton.disabled = inCall;

    const hangupButton = document.getElementById("btn-hangup");
    if (hangupButton) hangupButton.disabled = !inCall;
  }

  setScreenKeptAwake(enabled) {
    const self = this;

    const insomnia = window.plugins && window.plugins.insomnia;
    if (!insomnia) return;

    const onError = (err) => console.warn(" [setScreenKeptAwake] erreur:", err);
    if (enabled) {
      insomnia.keepAwake(() => {}, onError);
    } else {
      insomnia.allowSleepAgain(() => {}, onError);
    }
  }

  showInterface(activeInterface) {
    const self = this;

    self.closeInterfaces();
    if (activeInterface) activeInterface.classList.add("active");
    self.setScreenKeptAwake(!!activeInterface);

    // iOS: Configuration pour vidéo native
    const containerEl = document.getElementById(self.contain);
    if (containerEl) {
      containerEl.classList.toggle(
        "video-call-active",
        activeInterface === self.interfaceVideo,
      );
    }

    // iOS: Refresh vidéos natives
    if (
      activeInterface === self.interfaceVideo &&
      self.isIOS() &&
      cordova.plugins &&
      cordova.plugins.iosrtc
    ) {
      cordova.plugins.iosrtc.refreshVideos();
      setTimeout(() => cordova.plugins.iosrtc.refreshVideos(), 300);
    }
  }

  closeInterfaces() {
    const self = this;

    if (self.interfaceReceiver)
      self.interfaceReceiver.classList.remove("active");
    if (self.interfaceSender) self.interfaceSender.classList.remove("active");
    if (self.interfaceVideo) self.interfaceVideo.classList.remove("active");
    const containerEl = document.getElementById(self.contain);
    if (containerEl) containerEl.classList.remove("video-call-active");
    self.setScreenKeptAwake(false);
  }

  startTimer() {
    const self = this;

    let secondes = 0;
    if (self.timerInterval) return;

    self.timerInterval = setInterval(() => {
      secondes++;
      const h = String(Math.floor(secondes / 3600)).padStart(2, "0");
      const m = String(Math.floor((secondes % 3600) / 60)).padStart(2, "0");
      const s = String(secondes % 60).padStart(2, "0");

      const timerElement = document.getElementById("timer");
      const timerVideo = document.getElementById("timer-video");
      if (timerElement) timerElement.textContent = `${h}:${m}:${s}`;
      if (timerVideo) timerVideo.textContent = `${h}:${m}:${s}`;
    }, 1000);
  }

  stopTimer() {
    const self = this;

    clearInterval(self.timerInterval);
    self.timerInterval = null;
    const timerElement = document.getElementById("timer");
    const timerVideo = document.getElementById("timer-video");
    if (timerElement) timerElement.textContent = "00:00:00";
    if (timerVideo) timerVideo.textContent = "00:00:00";
  }

  async toggleCamera() {
    const self = this;

    // Cas 1: on a déjà une piste vidéo locale
    if (self.localStream && self.localStream.getVideoTracks().length > 0) {
      const videoTrack = self.localStream.getVideoTracks()[0];
      self.isCameraOff = !self.isCameraOff;
      videoTrack.enabled = !self.isCameraOff;
      self.updateCameraIcon();
      self.sendCameraState();
      if (self.isCameraOff) self.showCallToast("Caméra coupée");

      // Contrairement à Android/Chromium, iosrtc n'affiche pas d'écran noir sur une piste
      // vidéo désactivée (track.enabled = false) : la vue native continue de peindre la
      // dernière image reçue, figée. On détache/réattache donc le flux de la miniature locale
      // pour forcer l'équivalent — ça n'a aucun effet sur ce qui est envoyé à l'interlocuteur
      // (la piste réellement transmise reste celle du peerConnection, gérée séparément).
      const localVideoEl = document.getElementById("local-video");
      if (localVideoEl) {
        if (self.isCameraOff) {
          localVideoEl.srcObject = null;
        } else {
          localVideoEl.srcObject = self.localStream;
          localVideoEl.play().catch(() => {});
        }
      }
      self.showLocalVideoPlaceholder(self.isCameraOff);
      return;
    }

    // Cas 2: pas encore de caméra locale
    if (!self.peerConnection || !self.localStream) return;

    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
      });
      const videoTrack = videoStream.getVideoTracks()[0];
      if (!videoTrack) return;

      self.localStream.addTrack(videoTrack);

      const videoTransceiver = self.peerConnection
        .getTransceivers()
        .find(
          (t) =>
            t.receiver && t.receiver.track && t.receiver.track.kind === "video",
        );

      if (videoTransceiver) {
        await videoTransceiver.sender.replaceTrack(videoTrack);
        videoTransceiver.direction = "sendrecv";
      } else {
        self.peerConnection.addTrack(videoTrack, self.localStream);
      }

      const localVideo = document.getElementById("local-video");
      if (localVideo) localVideo.srcObject = self.localStream;

      self.showLocalVideoPlaceholder(false);
      self.isRenegotiating = true;
      const offer = await self.peerConnection.createOffer();
      await self.peerConnection.setLocalDescription(offer);
      self.sendSignal({
        action: "FM_Calls",
        type: "restart-offer",
        targetId: self.targetUserId,
        offer: offer,
        isVideo: true,
      });
      console.log(" Caméra activée manuellement, renégociation envoyée");

      self.isCameraOff = false;
      self.updateCameraIcon();
      self.sendCameraState();
    } catch (error) {
      console.error(" Erreur activation caméra :", error);
      self.isRenegotiating = false;
    }
  }

  async switchCamera() {
    const self = this;

    if (self.isSwitchingCamera || !self.localStream) return;
    const oldTrack = self.localStream.getVideoTracks()[0];
    if (!oldTrack) return;

    const button = document.getElementById("btn-switch-camera");
    self.isSwitchingCamera = true;
    if (button) button.disabled = true;

    const openCamera = async (front) => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: front ? "user" : "environment" } },
      });
      return stream.getVideoTracks()[0];
    };

    const wasFront = self.isFrontCamera;
    const videoSender = self.peerConnection
      ? self.peerConnection
          .getSenders()
          .find((s) => s.track && s.track.kind === "video")
      : null;
    oldTrack.stop();
    self.localStream.removeTrack(oldTrack);

    let newTrack = null;
    try {
      newTrack = await openCamera(!wasFront);
      self.isFrontCamera = !wasFront;
    } catch (error) {
      console.error(
        " Caméra " + (wasFront ? "arrière" : "avant") + " indisponible :",
        error,
      );
      try {
        newTrack = await openCamera(wasFront);
      } catch (restoreError) {
        console.error(
          " Impossible de rouvrir la caméra d'origine :",
          restoreError,
        );
      }
    }

    try {
      if (newTrack) {
        newTrack.enabled = !self.isCameraOff;
        self.localStream.addTrack(newTrack);

        if (videoSender) await videoSender.replaceTrack(newTrack);
      }
    } catch (error) {
      console.error(" Erreur remplacement piste vidéo :", error);
    }

    const localVideo = document.getElementById("local-video");
    if (localVideo) {
      localVideo.srcObject = self.localStream;
      localVideo.play().catch(() => {});
    }
    if (self.isIOS() && cordova.plugins && cordova.plugins.iosrtc) {
      cordova.plugins.iosrtc.refreshVideos();
    }

    self.isSwitchingCamera = false;
    if (button) button.disabled = false;
  }

  updateCameraIcon() {
    const self = this;

    const cameraIcon = document.getElementById("camera-icon");
    const btn = document.getElementById("btn-toggle-camera");

    if (self.isCameraOff) {
      if (cameraIcon) cameraIcon.className = "fa-solid fa-video-slash";
      if (btn) btn.classList.add("disabled");
    } else {
      if (cameraIcon) cameraIcon.className = "fa-solid fa-video";
      if (btn) btn.classList.remove("disabled");
    }
  }

  showLocalVideoPlaceholder(show) {
    const self = this;

    const placeholder = document.getElementById("local-video-placeholder");
    if (placeholder) placeholder.style.display = show ? "flex" : "none";
  }

  onNativeIncomingCall(callId, from, isVideo, autoAnswer = false) {
    const self = this;

    console.log(
      " Appel entrant natif :",
      callId,
      from,
      isVideo,
      "autoAnswer:",
      autoAnswer,
    );

    if (!self.appReady) {
      console.log(" App pas encore prête, appel natif mis en attente");
      self.pendingNativeCall = { callId, from, isVideo, autoAnswer };
      return;
    }

    self.processIncomingCall(callId, from, isVideo, autoAnswer);
  }

  processIncomingCall(callId, from, isVideo, autoAnswer = false) {
    const self = this;

    if (self.peerConnection) {
      console.log("Appel déjà en cours, appel natif ignoré");
      return;
    }

    if (!self.interfaceReceiver)
      self.interfaceReceiver = document.getElementById("interface-2");
    if (!self.interfaceSender)
      self.interfaceSender = document.getElementById("interface-1");
    if (!self.interfaceVideo)
      self.interfaceVideo = document.getElementById("interface-3");

    self.currentCallId = callId;
    self.targetUserId = from;
    self.isVideoCall = !!isVideo;
    self.autoAcceptOnOffer = !!autoAnswer;

    if (self.autoAcceptOnOffer) {
      self.showInterface(
        self.isVideoCall ? self.interfaceVideo : self.interfaceSender,
      );
      self.updateStatus("Connexion à l'appel...");
    } else {
      self.showInterface(self.interfaceReceiver);
      self.updateStatus(
        self.isVideoCall ? "Appel vidéo entrant..." : "Appel entrant...",
      );
      self.startVibration();
    }

    self.ensureConnectedAndFetchOffer();
  }

  startVibration() {
    const self = this;

    if (!("vibrate" in navigator)) return;

    self.isVibrating = true;
    const triggerContinuousVibration = () => {
      if (!self.isVibrating) return;
      navigator.vibrate([1000, 1000]);
      self.vibrationTimer = setTimeout(triggerContinuousVibration, 2000);
    };
    triggerContinuousVibration();
  }

  stopVibration() {
    const self = this;

    self.isVibrating = false;
    if (self.vibrationTimer) {
      clearTimeout(self.vibrationTimer);
      self.vibrationTimer = null;
    }
    if ("vibrate" in navigator) {
      navigator.vibrate(0);
    }
  }

  initIOSCallKit() {
    const self = this;

    if (!window.cordova || cordova.platformId !== "ios") return;

    console.log(
      " [CallKit ÉTAPE 4/21] Bridge JS prêt (deviceready) — initIOSCallKit() démarre.",
    );

    // ---- 1. PushKit : récupération du token VoIP + contexte d'appel ----
    if (typeof VoIPPushNotification !== "undefined") {
      console.log(
        " [CallKit] VoIPPushNotification disponible, appel de init()...",
      );
      const voipPush = VoIPPushNotification.init();

      voipPush.on("registration", function (data) {
        console.log(" [PushKit] Token VoIP iOS reçu :", data.deviceToken);
        self.voipToken = data.deviceToken;
        self.enregistrerTokenVoipSurServeur(data.deviceToken);
      });

      voipPush.on("notification", function (data) {
        console.log(
          ` [CallKit ÉTAPE ?/21] [PushKit] Notification VoIP reçue en JS (peut être rejouée après un cold-launch) : ${JSON.stringify(data)}`,
        );
        try {
          const infos =
            typeof data.extra === "string"
              ? JSON.parse(data.extra)
              : data.extra || data;
          const caller = infos.Caller || infos || {};

          self.targetUserId =
            caller.Username || caller.callerId || self.targetUserId;
          self.currentCallId =
            caller.ConnectionId || caller.callId || self.currentCallId;
          self.isVideoCall =
            caller.isVideo === "true" ||
            caller.isVideo === true ||
            self.isVideoCall;

          if (self.currentCallId)
            localStorage.setItem("pending_call_id", self.currentCallId);
          if (self.targetUserId)
            localStorage.setItem("pending_caller_id", self.targetUserId);

          console.log(
            " [PushKit] Contexte d'appel mis en cache : targetUserId =",
            self.targetUserId,
            "| currentCallId =",
            self.currentCallId,
            "| isVideoCall =",
            self.isVideoCall,
          );

          // Si l'utilisateur avait déjà appuyé sur "Répondre" de CallKit avant que PushKit ne termine d'analyser
          if (window.callKitPendingAnswer) {
            console.log(
              " [PushKit] callKitPendingAnswer=true détecté : le décrochage CallKit attendait ce contexte, lancement de traiterAcceptationCallKit() maintenant.",
            );
            window.callKitPendingAnswer = false;
            self.traiterAcceptationCallKit();
          } else {
            console.log(
              " [PushKit] Pas de décrochage CallKit en attente pour cette notification.",
            );
          }
        } catch (e) {
          console.error(" [PushKit] Erreur d'analyse des données :", e);
        }
      });

      voipPush.on("error", function (e) {
        console.error(" [PushKit] Erreur APNs VoIP :", JSON.stringify(e));
      });
    } else {
      console.error(
        " [CallKit] VoIPPushNotification non disponible — le contexte d'appel (callId/targetUserId) ne pourra jamais être résolu en JS.",
      );
    }

    // ---- 2. CallKit : Événements Natifs ----
    if (cordova.plugins && cordova.plugins.CordovaCall) {
      const callKit = cordova.plugins.CordovaCall;
      console.log(
        " [CallKit] cordova.plugins.CordovaCall disponible, enregistrement des listeners d'événements natifs...",
      );

      callKit.setAppName("CallApp");

      callKit.on("answer", async function (data) {
        console.log(
          " [CallKit ÉTAPE 5/21] Événement 'answer' reçu en JS (rejoué immédiatement par le natif si l'action était en attente — voir logs natifs 'performAnswerCallAction'/'registerEvent').",
        );
        //  FIX: Ne pas appeler activerAudioSessionIOS() ici car WebRTC
        // n'est pas encore prêt. L'appel est déplacé dans traiterAcceptationCallKit.

        self.autoAcceptOnOffer = true;

        // Si le contexte d'appel (callId/targetUserId) n'est pas encore présent, attendre PushKit
        if (!self.currentCallId && !localStorage.getItem("pending_call_id")) {
          console.log(
            " [CallKit ÉTAPE 6/21] Contexte d'appel (callId/targetUserId) absent — mise en attente de la notification PushKit JS via callKitPendingAnswer=true.",
          );
          window.callKitPendingAnswer = true;
          return;
        }

        console.log(
          " [CallKit ÉTAPE 6/21] Contexte d'appel déjà disponible (currentCallId =",
          self.currentCallId,
          "| localStorage =",
          localStorage.getItem("pending_call_id"),
          ") — poursuite immédiate.",
        );
        await self.traiterAcceptationCallKit();
      });

      callKit.on("reject", async function () {
        console.log(" [CallKit] Événement 'reject' reçu");
        await self.ensureSocketReady();
        self.rejectCall();
      });

      callKit.on("hangup", function () {
        console.log(" [CallKit] Événement 'hangup' natif");
        self.hangUp(true);
      });

      callKit.on("mute", function (muted) {
        console.log(" [CallKit] Événement 'mute' natif reçu :", muted);
        self.toggleMicrophone();
      });
    } else {
      console.error(
        " [CallKit] cordova.plugins.CordovaCall non disponible — aucun événement natif (answer/reject/hangup/mute) ne pourra être reçu.",
      );
    }
  }

  async traiterAcceptationCallKit() {
    const self = this;

    console.log(" [CallKit ÉTAPE 7/21] traiterAcceptationCallKit() démarre.");

    //  FIX: Si l'app était tuée depuis un moment, ce handler peut s'exécuter AVANT que
    // onDeviceReady() (veille.js) n'ait eu le temps de terminer initializeUserId() — myId
    // serait alors encore null au moment de l'enregistrement WebSocket (register-user avec
    // un userId invalide), cassant toute communication utile avec le serveur même si le
    // socket "semble" connecté. On le garantit ici, indépendamment de l'avancement de
    // onDeviceReady() ailleurs (idempotent : relit juste localStorage si déjà fait).
    if (!self.myId && typeof self.initializeUserId === "function") {
      console.log(
        " [CallKit] myId pas encore initialisé par onDeviceReady() — initializeUserId() appelé directement ici.",
      );
      self.initializeUserId();
    }

    if (!self.currentCallId)
      self.currentCallId = localStorage.getItem("pending_call_id");
    if (!self.targetUserId)
      self.targetUserId = localStorage.getItem("pending_caller_id");

    console.log(
      " [CallKit] Contexte résolu — myId =",
      self.myId,
      "| targetUserId =",
      self.targetUserId,
      "| currentCallId =",
      self.currentCallId,
      "| isVideoCall =",
      self.isVideoCall,
    );

    if (!self.currentCallId || !self.targetUserId) {
      console.warn(
        " [CallKit] Contexte d'appel incomplet (callId ou targetUserId manquant) — la suite risque d'échouer silencieusement.",
      );
    }

    // Note : l'attente d'un premier plan garanti pour l'autorisation micro/caméra se fait
    // au plus près de getUserMedia(), dans ensureMediaAuthorizedIOS() (veille.js), et
    // uniquement si l'autorisation n'a jamais été tranchée. Aucune attente inutile ici.

    // Mettre à jour l'interface Web
    if (typeof self.showInterface === "function") {
      console.log(
        " [CallKit] Affichage de l'interface d'appel et mise à jour du statut.",
      );
      self.showInterface(
        self.isVideoCall ? self.interfaceVideo : self.interfaceSender,
      );
      self.updateStatus("Connexion à l'appel...");
    }

    //  Mécanisme de connexion WebSocket dédié et robuste, directement à ce niveau (le
    // point d'entrée du décrochage CallKit) : ne suppose PAS que l'initialisation générale
    // de l'app (onDeviceReady) est déjà terminée, et réessaie plusieurs fois avec un délai
    // croissant si la première tentative échoue (ex : serveur Render.com endormi après une
    // longue période sans appel, peut prendre jusqu'à ~50s à se réveiller).
    console.log(
      " [CallKit ÉTAPE 8/21] ensureCallKitSocketConnection() démarre...",
    );
    const socketConnected = await self.ensureCallKitSocketConnection();
    if (!socketConnected) {
      console.error(
        " [CallKit] Connexion WebSocket impossible après plusieurs tentatives — abandon du décrochage.",
      );
      self.updateStatus("Erreur réseau, réessayez");
      return;
    }
    console.log(
      " [CallKit ÉTAPE 8/21] Connexion WebSocket confirmée (OPEN + utilisateur enregistré).",
    );

    console.log(
      " [CallKit ÉTAPE 9/21] ensureConnectedAndFetchOffer() démarre (envoi get-offer)...",
    );
    await self.ensureConnectedAndFetchOffer();
    console.log(
      " [CallKit ÉTAPE 9/21] ensureConnectedAndFetchOffer() terminé (la suite — offre SDP, getUserMedia, WebRTC — se poursuit de façon async dans handleCallOfferDetails()/answerIncomingCall() dès réception du message 'call-offer-details').",
    );

    //  FIX: Activer la session audio APRÈS que WebRTC est établi
    // pour éviter la race condition (session audio sans flux audio)
    console.log(
      " [CallKit ÉTAPE 19/21] activerAudioSessionIOS() (renfort post-WebRTC) démarre...",
    );
    self.activerAudioSessionIOS();
    console.log(
      " [CallKit ÉTAPE 19/21] activerAudioSessionIOS() appelé (async, résultat natif loggé séparément) — traiterAcceptationCallKit() fini.",
    );
  }

  ensureCallKitSocketConnection(maxAttempts = 4) {
    const self = this;

    return new Promise((resolve) => {
      let attempt = 0;

      const tryConnect = async () => {
        attempt++;
        console.log(
          ` [CallKit] Connexion WebSocket — tentative ${attempt}/${maxAttempts}...`,
        );

        await self.ensureSocketReady();

        if (self.webSocketIsConnected === true) {
          console.log(
            ` [CallKit] WebSocket OPEN (tentative ${attempt}/${maxAttempts}).`,
          );
          resolve(true);
          return;
        }

        console.warn(
          ` [CallKit] WebSocket pas encore OPEN après la tentative ${attempt}/${maxAttempts} ` +
            `(readyState=${self.ws ? self.ws.readyState : "ws=null"}).`,
        );

        if (attempt >= maxAttempts) {
          console.error(
            ` [CallKit] Abandon après ${maxAttempts} tentatives de connexion WebSocket.`,
          );
          resolve(false);
          return;
        }

        const delay = 2000 * attempt;
        console.log(` [CallKit] Nouvelle tentative dans ${delay}ms...`);
        setTimeout(tryConnect, delay);
      };

      tryConnect();
    });
  }

  activerAudioSessionIOS(route) {
    const self = this;

    const desiredRoute = route === "receiver" ? "receiver" : "speaker";
    //  cordova.plugins.iosrtc.selectAudioOutput() n'accepte QUE "earpiece" ou "speaker"
    // (voir js/iosrtc.js du plugin) — "receiver" levait une exception silencieusement
    // avalée par le catch ci-dessous, donc l'appel n'avait jamais d'effet réel.
    const iosrtcRoute = desiredRoute === "speaker" ? "speaker" : "earpiece";

    if (
      cordova.plugins &&
      cordova.plugins.CordovaCall &&
      typeof cordova.plugins.CordovaCall.activateAudio === "function"
    ) {
      cordova.plugins.CordovaCall.activateAudio(
        () => console.log(" [activerAudioSessionIOS] AVAudioSession réactivée"),
        (err) =>
          console.warn(" [activerAudioSessionIOS] activateAudio erreur:", err),
      );
    }

    // 1. Si cordova-plugin-iosrtc est utilisé
    if (window.cordova && cordova.plugins && cordova.plugins.iosrtc) {
      try {
        cordova.plugins.iosrtc.selectAudioOutput(iosrtcRoute);
        console.log(" [iosrtc] Sortie audio configurée :", iosrtcRoute);
      } catch (e) {
        console.warn("Erreur iosrtc audio:", e);
      }
    }

    // 2. Si AudioToggle plugin est disponible
    if (window.AudioToggle) {
      try {
        window.AudioToggle.setAudioMode(
          desiredRoute === "speaker"
            ? window.AudioToggle.SPEAKER
            : window.AudioToggle.EARPIECE,
        );
        console.log(" [AudioToggle] Mode appliqué :", desiredRoute);
      } catch (e) {
        console.warn(" [AudioToggle] Erreur setAudioMode:", e);
      }
    } else {
      console.log(
        "[activerAudioSessionIOS] Plugin AudioToggle non disponible, étape ignorée.",
      );
    }
  }

  enregistrerTokenVoipSurServeur(token) {
    const self = this;

    const tenterEnvoi = () => {
      if (self.webSocketIsConnected === true) {
        self.sendSignal({
          action: "FM_Calls",
          type: "register-voip-token",
          userId: self.myId,
          voipToken: token,
        });
        console.log(" Token VoIP iOS enregistré sur le serveur");
      } else {
        setTimeout(tenterEnvoi, 500);
      }
    };
    tenterEnvoi();
  }

  setupLocalVideoDragging() {
    const self = this;

    const wrapper = document.querySelector(".local-video-wrapper");
    const localVideo = document.getElementById("local-video");
    const remoteVideo = document.getElementById("remote-video");
    if (!wrapper) return;

    wrapper.style.position = "fixed";
    wrapper.style.zIndex = "9999";
    wrapper.style.touchAction = "none";

    //  iosrtc rend <video> via une vue native placée par-dessus/derrière la WebView, dont la
    // position/taille ne sont recalculées QUE sur appel explicite à refreshVideos() (aucun
    // observateur interne ne suit un déplacement du wrapper par simple style.left/top — voir
    // showInterface() plus haut). Sans ça, ce bloc ne fait bouger que le fond/la bordure CSS du
    // wrapper : la vidéo elle-même reste figée à sa position d'origine.
    let refreshScheduled = false;
    function refreshLocalVideoNative() {
      if (
        self.isIOS() &&
        window.cordova &&
        cordova.plugins &&
        cordova.plugins.iosrtc
      ) {
        cordova.plugins.iosrtc.refreshVideos();
      }
    }
    function scheduleNativeRefresh() {
      if (refreshScheduled) return;
      refreshScheduled = true;
      requestAnimationFrame(() => {
        refreshScheduled = false;
        refreshLocalVideoNative();
      });
    }

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

      const rect = wrapper.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const snapLeft = centerX < window.innerWidth / 2;
      wrapper.style.left = snapLeft
        ? "10px"
        : window.innerWidth - rect.width - 10 + "px";

      // Le snap est animé (transition CSS) : la vidéo native doit suivre à l'arrivée, pas au
      // point de départ. transitionend est le signal fiable ; le setTimeout couvre le cas où il
      // ne se déclenche pas (ex. prefers-reduced-motion).
      wrapper.addEventListener("transitionend", refreshLocalVideoNative, {
        once: true,
      });
      setTimeout(refreshLocalVideoNative, 250);
    }

    function swapVideos() {
      // Caméra locale coupée -> localVideo.srcObject est volontairement détaché (voir
      // toggleCamera()) : rien de significatif à échanger, et swapper enverrait "null" dans
      // remote-video (écran principal), effaçant l'image de l'interlocuteur.
      if (!localVideo || !remoteVideo || !localVideo.srcObject) return;
      const tmp = localVideo.srcObject;
      localVideo.srcObject = remoteVideo.srcObject;
      remoteVideo.srcObject = tmp;
      localVideo.play().catch(() => {});
      remoteVideo.play().catch(() => {});
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
  }

  setupSwipeAccept() {
    const self = this;

    const acceptBtn = document.getElementById("swipeAcceptBtn");
    let startY = 0;
    let currentY = 0;
    let isDragging = false;
    const threshold = -80; // Distance en pixels à parcourir vers le haut pour déclencher le clic

    // --- 1. Gestion des vibrations ---
    function demarrerVibration() {
      if (!acceptBtn) return;
      acceptBtn.classList.add("vibrating");

      // Vibration physique du téléphone (sur mobile)
      if ("vibrate" in navigator) {
        navigator.vibrate([200, 100, 200, 100, 200, 800]);
      }
    }

    function arreterVibration() {
      if (!acceptBtn) return;
      acceptBtn.classList.remove("vibrating");

      if ("vibrate" in navigator) {
        navigator.vibrate(0);
      }
    }

    // Lancer la vibration au chargement
    demarrerVibration();

    // --- 2. Action au clic (Événement onclick) ---
    if (acceptBtn) {
      acceptBtn.onclick = function (e) {
        arreterVibration();
        console.log("Événement ONCLICK déclenché !");

        // Exécutez votre logique ici (ex: changer d'écran)
        if (typeof switchInterface === "function") {
          const premierBouton = document.querySelector(".switch-btn");
          switchInterface(1, { currentTarget: premierBouton });
        }
      };
    }

    // --- 3. Gestion du Swipe (Glissement) ---
    function startDrag(y) {
      isDragging = true;
      startY = y;
      arreterVibration();
      if (acceptBtn) {
        acceptBtn.style.transition = "none";
      }
    }

    function moveDrag(y) {
      if (!isDragging || !acceptBtn) return;
      currentY = y - startY;

      // Limiter le déplacement visuel du bouton
      if (currentY > 10) currentY = 10;
      if (currentY < -150) currentY = -150;

      acceptBtn.style.transform = `translateY(${currentY}px)`;
    }

    function endDrag() {
      if (!isDragging || !acceptBtn) return;
      isDragging = false;
      acceptBtn.style.transition = "transform 0.3s ease";

      // Si le swipe dépasse le seuil (-80px vers le haut)
      if (currentY <= threshold) {
        acceptBtn.style.transform = `translateY(0px)`;

        // Déclenche explicitement le gestionnaire onclick
        if (typeof acceptBtn.onclick === "function") {
          acceptBtn.onclick(self.acceptCall());
        } else {
          acceptBtn.click();
        }
      } else {
        // Rétablissement du bouton si le swipe n'a pas été assez haut
        acceptBtn.style.transform = `translateY(0px)`;
        demarrerVibration();
      }
      currentY = 0;
    }

    // Écouteurs pour Smart-phones (Tactile)
    if (acceptBtn) {
      acceptBtn.addEventListener(
        "touchstart",
        (e) => startDrag(e.touches[0].clientY),
        { passive: true },
      );
      window.addEventListener(
        "touchmove",
        (e) => {
          if (isDragging) moveDrag(e.touches[0].clientY);
        },
        { passive: true },
      );
      window.addEventListener("touchend", endDrag);

      // Écouteurs pour Ordinateur (Souris)
      acceptBtn.addEventListener("mousedown", (e) => startDrag(e.clientY));
      window.addEventListener("mousemove", (e) => {
        if (isDragging) moveDrag(e.clientY);
      });
      window.addEventListener("mouseup", endDrag);
    }
  }
} 


try {    

    var mapTypeStyle = '<style>' +
    '</style>';

    // data-suffix="$" data-prefix="$"
    var uri = "ionic://localhost/_app_file_/var/mobile/Containers/Data/Application/52FDD0BF-EF22-46CD-8FC3-82008D39A270/Documents/FurtherMarket/Images/FMVideo_3_Thumb4_2312.mp4";

    var tapticHtml = ' <div id="app"></div>';


    var zIndex = getTopZIndex(1);
    var WSDivName = 'taptiDom';

    var view = '<fm-header class="header header-md">' +

        '<fm-navbar class="toolbar-md toolbar toolbar-search-grps">' +
        '<div class="toolbar-background toolbar-background-md"></div>' +
        '<button class="bar-button bar-button-md back-button-md waves-effect icon-header-app mr-0" onclick="backHistory();"><span class="button-inner"><fm-icon class="back-button-icon-md icon ion-android-arrow-back"></fm-icon></span></button>' +

        '</fm-navbar>' +
        '</fm-header>' +

        '<fm-content class="content content-md myDefaultAppBg p-0" padding>' +
        '<div class="fixed-content p-0"></div>' +
        '<div class="scroll-content mrgtop-md p-0">' + tapticHtml + mapTypeStyle + '</div>' +
        '</fm-content>';

    $('<page-home id="' + WSDivName + '" style="z-index:' + zIndex + '">').
        addClass('fm-page show-page bgwhite').
        appendTo($('fm-nav')).
        html(view);

    addHistory('#' + WSDivName + GLOBALS.get('SeperatorGoBack') + Un);

    setColorFM_Header(WSDivName);   
       applyNicescrollToScrollContent('#' + WSDivName + ' .scroll-content');

    
    window.app = new CallApp(WSDivName);
    window.app.init(); 
} catch (error) {
  console.error(" Erreur au démarrage :", error);
}
