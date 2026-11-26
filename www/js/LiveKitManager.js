/**
 * LiveKitManager.js
 *
 * Adaptateur SFU LiveKit isolé pour CallApp (Cordova Android / iOS / Browser).
 * Conçu pour être chargé via <script> (UMD / global) sans bundler, et branché
 * progressivement dans CallManager.js / Meetings.js.
 *
 * Dépendance : charger `livekit-client.umd.min.js` avant ce fichier dans index.html.
 */
(function (globalScope) {
  "use strict";

  function getLiveKitSDK() {
    const sdk = globalScope.LivekitClient || globalScope.LiveKit;
    if (!sdk || !sdk.Room) {
      throw new Error(
        "SDK livekit-client introuvable. Chargez livekit-client.umd.min.js avant LiveKitManager.js."
      );
    }
    return sdk;
  }

  class LiveKitManager {
    /**
     * @param {object} [options]
     * @param {HTMLVideoElement|null} [options.localVideoEl] - Balise <video> pour la caméra locale
     * @param {HTMLElement|null} [options.remoteContainerEl] - Conteneur DOM pour les tracks distants
     * @param {function(object):void} [options.onParticipantJoined] - ({ identity, name, participant })
     * @param {function(object):void} [options.onParticipantLeft] - ({ identity, participant })
     * @param {function(object):void} [options.onTrackSubscribed] - ({ track, publication, participant, element })
     * @param {function(object):void} [options.onTrackUnsubscribed] - ({ track, publication, participant })
     * @param {function(string):void} [options.onConnectionStateChanged] - (state)
     * @param {function(Array<string>):void} [options.onActiveSpeakersChanged] - (identities)
     * @param {function(object):void} [options.onApproved] - () appelé quand canPublish passe à true (salle d'attente)
     * @param {function(Error):void} [options.onError] - (error)
     */
    constructor(options = {}) {
      this.options = options;
      this.room = null;

      this.isMicMuted = false;
      this.isCameraOff = false;
      this.isScreenSharing = false;
      this.isReconnecting = false;

      // Préférences souhaitées à l'entrée (mémorisées si en attente d'approbation)
      this._desiredAudio = true;
      this._desiredVideo = true;

      // Suivi des éléments DOM créés par trackSid pour nettoyage garanti
      this._attachedElements = new Map();
      this._customScreenTrack = null;
    }

    /**
     * Rejoint une room LiveKit et publie micro + caméra si les permissions l'autorisent.
     *
     * @param {object} params
     * @param {string} params.url - URL WebSocket LiveKit (wss://...)
     * @param {string} params.token - JWT généré par POST /api/livekit-token
     * @param {boolean} [params.video=true]
     * @param {boolean} [params.audio=true]
     * @returns {Promise<object>} Instance Room LiveKit
     */
    async join({ url, token, video = true, audio = true } = {}) {
      if (!url || !token) {
        throw new Error("url et token LiveKit sont requis pour rejoindre la room.");
      }

      // Fermer proprement une session précédente si encore active
      if (this.room) {
        await this.leave();
      }

      this._desiredAudio = !!audio;
      this._desiredVideo = !!video;

      const { Room, RoomEvent, VideoPresets } = getLiveKitSDK();
      const isIOS =
        typeof navigator !== "undefined" &&
        /iPad|iPhone|iPod/.test(navigator.userAgent || "");

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: {
          resolution: VideoPresets.h720.resolution,
        },
        publishDefaults: {
          // Désactivé sur iOS pour compatibilité cordova-plugin-iosrtc
          simulcast: !isIOS,
        },
      });

      this.room = room;
      this._bindRoomEvents(room, RoomEvent);

      try {
        await room.connect(url, token);

        // Vérifier le droit de publier (peut être false en salle d'attente)
        const canPublish = room.localParticipant.permissions?.canPublish !== false;

        if (canPublish) {
          await this._publishInitialMedia();
        } else {
          this.isMicMuted = true;
          this.isCameraOff = true;
        }

        // Débloquer l'AudioContext / lecture audio WebView si possible
        if (typeof room.startAudio === "function") {
          room.startAudio().catch(() => {});
        }

        // Notifier les participants distants déjà présents dans la room
        room.remoteParticipants.forEach((participant) => {
          this._emit("onParticipantJoined", {
            identity: participant.identity,
            name: participant.name || participant.identity,
            participant,
          });
        });

        return room;
      } catch (error) {
        this._emit("onError", error);
        await this.leave();
        throw error;
      }
    }

    /**
     * Quitte la room, arrête toutes les captures locales et nettoie le DOM.
     */
    async leave() {
      try {
        if (this._customScreenTrack) {
          try {
            this._customScreenTrack.stop();
          } catch (_) {}
          this._customScreenTrack = null;
        }

        if (this.room) {
          this._detachLocalCamera();
          this.room.removeAllListeners();
          if (this.room.localParticipant) {
            this.room.localParticipant.removeAllListeners();
          }
          await this.room.disconnect(true);
        }
      } finally {
        this._clearAttachedElements();
        this.room = null;
        this.isMicMuted = false;
        this.isCameraOff = false;
        this.isScreenSharing = false;
        this.isReconnecting = false;
      }
    }

    /**
     * Active ou coupe le microphone local.
     *
     * @param {boolean} [forceMuted] - Si omis, inverse l'état courant
     * @returns {Promise<boolean>} Nouvel état (true = micro coupé)
     */
    async toggleMute(forceMuted) {
      this._ensureConnected();
      const nextMuted = typeof forceMuted === "boolean" ? forceMuted : !this.isMicMuted;
      await this.room.localParticipant.setMicrophoneEnabled(!nextMuted);
      this.isMicMuted = nextMuted;
      return this.isMicMuted;
    }

    /**
     * Active ou coupe la caméra locale.
     *
     * @param {boolean} [forceOff] - Si omis, inverse l'état courant
     * @returns {Promise<boolean>} Nouvel état (true = caméra coupée)
     */
    async toggleCamera(forceOff) {
      this._ensureConnected();
      const nextOff = typeof forceOff === "boolean" ? forceOff : !this.isCameraOff;
      await this.room.localParticipant.setCameraEnabled(!nextOff);
      this.isCameraOff = nextOff;

      if (!nextOff) {
        this._attachLocalCamera();
      } else {
        this._detachLocalCamera();
      }

      return this.isCameraOff;
    }

    /**
     * Active ou arrête le partage d'écran.
     * Sur Cordova mobile, fournir `customTrack` (issu de cordova-plugin-screenshare-live)
     * afin de publier le flux natif sans jamais appeler `getDisplayMedia`.
     *
     * @param {object} [opts]
     * @param {boolean} [opts.forceState] - true pour démarrer, false pour arrêter
     * @param {MediaStreamTrack} [opts.customTrack] - Track natif optionnel
     * @returns {Promise<boolean>} Nouvel état (true = partage actif)
     */
    async toggleScreenShare({ forceState, customTrack } = {}) {
      this._ensureConnected();
      const { Track } = getLiveKitSDK();
      const nextSharing =
        typeof forceState === "boolean" ? forceState : !this.isScreenSharing;

      if (nextSharing) {
        if (customTrack) {
          // Mode natif Cordova : publication directe du track sans getDisplayMedia
          await this.room.localParticipant.publishTrack(customTrack, {
            name: "screen",
            source: Track.Source.ScreenShare,
          });
          this._customScreenTrack = customTrack;
          customTrack.onended = () => {
            if (this.isScreenSharing && this.room) {
              this.toggleScreenShare({ forceState: false }).catch((err) => {
                this._emit("onError", err);
              });
            }
          };
        } else {
          // Mode navigateur desktop uniquement
          await this.room.localParticipant.setScreenShareEnabled(true, {
            audio: false,
          });
        }
        this.isScreenSharing = true;
      } else {
        if (this._customScreenTrack) {
          await this.room.localParticipant.unpublishTrack(this._customScreenTrack);
          try {
            this._customScreenTrack.stop();
          } catch (_) {}
          this._customScreenTrack = null;
        } else {
          await this.room.localParticipant.setScreenShareEnabled(false);
        }
        this.isScreenSharing = false;
      }

      return this.isScreenSharing;
    }

    /**
     * Débloque manuellement la lecture audio (politique autoplay WebView/Chrome).
     */
    async startAudio() {
      if (this.room && typeof this.room.startAudio === "function") {
        await this.room.startAudio();
      }
    }

    /**
     * Retourne la liste des participants distants actuellement dans la room.
     *
     * @returns {Array<{identity: string, name: string, isMuted: boolean, isCameraOn: boolean, isScreenSharing: boolean}>}
     */
    getRemoteParticipants() {
      if (!this.room) return [];
      return Array.from(this.room.remoteParticipants.values()).map((p) => ({
        identity: p.identity,
        name: p.name || p.identity,
        isMuted: !p.isMicrophoneEnabled,
        isCameraOn: !!p.isCameraEnabled,
        isScreenSharing: !!p.isScreenShareEnabled,
      }));
    }

    // =========================================================
    // Méthodes internes
    // =========================================================

    _ensureConnected() {
      if (!this.room) {
        throw new Error("LiveKitManager : non connecté à une room.");
      }
    }

    async _publishInitialMedia() {
      if (!this.room) return;
      await this.room.localParticipant.setMicrophoneEnabled(this._desiredAudio);
      await this.room.localParticipant.setCameraEnabled(this._desiredVideo);
      this.isMicMuted = !this._desiredAudio;
      this.isCameraOff = !this._desiredVideo;

      if (this._desiredVideo) {
        this._attachLocalCamera();
      }
    }

    _bindRoomEvents(room, RoomEvent) {
      room
        .on(RoomEvent.ConnectionStateChanged, (state) => {
          this._emit("onConnectionStateChanged", state);
        })
        .on(RoomEvent.Reconnecting, () => {
          this.isReconnecting = true;
          this._emit("onConnectionStateChanged", "reconnecting");
        })
        .on(RoomEvent.Reconnected, () => {
          this.isReconnecting = false;
          this._emit("onConnectionStateChanged", "reconnected");
          // Ré-attacher la vidéo locale si la WebView a été mise en veille
          if (!this.isCameraOff) {
            this._attachLocalCamera();
          }
        })
        .on(RoomEvent.ParticipantConnected, (participant) => {
          this._emit("onParticipantJoined", {
            identity: participant.identity,
            name: participant.name || participant.identity,
            participant,
          });
        })
        .on(RoomEvent.ParticipantDisconnected, (participant) => {
          this._emit("onParticipantLeft", {
            identity: participant.identity,
            participant,
          });
        })
        .on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
          const element = this._attachRemoteTrack(track, publication, participant);
          this._emit("onTrackSubscribed", {
            track,
            publication,
            participant,
            element,
          });
        })
        .on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
          this._detachRemoteTrack(track);
          this._emit("onTrackUnsubscribed", {
            track,
            publication,
            participant,
          });
        })
        .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
          this._emit(
            "onActiveSpeakersChanged",
            speakers.map((s) => s.identity)
          );
        })
        .on(RoomEvent.Disconnected, () => {
          this.isReconnecting = false;
          this._clearAttachedElements();
          this._emit("onConnectionStateChanged", "disconnected");
        })
        .on(RoomEvent.AudioPlaybackStatusChanged, () => {
          if (!room.canPlaybackAudio) {
            this._emit("onAudioPlaybackBlocked", { room });
          }
        });

      // Salle d'attente : détecter l'approbation hôte (canPublish: false -> true)
      room.localParticipant.on(
        RoomEvent.ParticipantPermissionsChanged,
        async (prevPermissions) => {
          const canNowPublish = !!room.localParticipant.permissions?.canPublish;
          if (!prevPermissions?.canPublish && canNowPublish) {
            try {
              await this._publishInitialMedia();
              this._emit("onApproved", { room });
            } catch (error) {
              this._emit("onError", error);
            }
          }
        }
      );
    }

    _attachLocalCamera() {
      const targetEl = this.options.localVideoEl;
      if (!targetEl || !this.room) return;

      const { Track } = getLiveKitSDK();
      const camPub = this.room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (camPub && camPub.track) {
        camPub.track.attach(targetEl);
        targetEl.muted = true; // Éviter tout écho/larsen local
        targetEl.playsInline = true;
        targetEl.autoplay = true;
        if (typeof targetEl.play === "function") {
          targetEl.play().catch(() => {});
        }
      }
    }

    _detachLocalCamera() {
      const targetEl = this.options.localVideoEl;
      if (!targetEl || !this.room) return;

      const { Track } = getLiveKitSDK();
      const camPub = this.room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (camPub && camPub.track) {
        camPub.track.detach(targetEl);
      }
    }

    _attachRemoteTrack(track, publication, participant) {
      const el = track.attach();
      el.dataset.participantId = participant.identity;
      el.dataset.trackSource = String(publication.source || "");

      if (track.kind === "video") {
        el.playsInline = true;
        el.autoplay = true;
        el.className = "lk-remote-video";
      }

      if (this.options.remoteContainerEl) {
        this.options.remoteContainerEl.appendChild(el);
      }

      if (track.sid) {
        this._attachedElements.set(track.sid, el);
      }
      return el;
    }

    _detachRemoteTrack(track) {
      try {
        const detached = track.detach();
        detached.forEach((el) => {
          if (el && el.parentNode) {
            el.parentNode.removeChild(el);
          }
        });
      } catch (_) {}

      if (track.sid && this._attachedElements.has(track.sid)) {
        const el = this._attachedElements.get(track.sid);
        if (el && el.parentNode) {
          el.parentNode.removeChild(el);
        }
        this._attachedElements.delete(track.sid);
      }
    }

    _clearAttachedElements() {
      this._attachedElements.forEach((el) => {
        if (el && el.parentNode) {
          el.parentNode.removeChild(el);
        }
      });
      this._attachedElements.clear();
    }

    _emit(callbackName, payload) {
      const fn = this.options && this.options[callbackName];
      if (typeof fn === "function") {
        try {
          fn(payload);
        } catch (err) {
          console.error(`[LiveKitManager] Erreur dans ${callbackName}:`, err);
        }
      }
    }
  }

  globalScope.LiveKitManager = LiveKitManager;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = LiveKitManager;
  }
})(typeof window !== "undefined" ? window : globalThis);
