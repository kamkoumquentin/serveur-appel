/**
 * ============================================
 *  RÉUNIONS PLANIFIÉES - EXTENSION CALLMANAGER
 * ============================================
 *
 * Ce fichier étend CallManager avec les fonctionnalités de réunions planifiées.
 * Il doit être inclus après CallManager.js dans index.html
 */

// Une seule classe porte désormais les méthodes de réunion. Elle hérite de
// CallManager afin de réutiliser ses appels, son état WebRTC et sa connexion.
class Meetings extends CallManager {}
window.escapeHtml = function(value) {
  return String(value == null ? "" : value).replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
};
Meetings.prototype.confirmMeetingAction = function(title, message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "mt-modal-backdrop";
    overlay.innerHTML = `<section class="mt-modal" role="dialog" aria-modal="true" aria-labelledby="mt-modal-title"><h2 id="mt-modal-title">${window.escapeHtml(title)}</h2><p>${window.escapeHtml(message)}</p><div class="mt-modal-actions"><button type="button" data-choice="cancel" class="btn btn-secondary">Annuler</button><button type="button" data-choice="confirm" class="btn btn-danger">Confirmer</button></div></section>`;
    const finish = (answer) => { document.removeEventListener("keydown", onKey); overlay.remove(); resolve(answer); };
    const onKey = (event) => { if (event.key === "Escape") finish(false); if (event.key === "Tab") { event.preventDefault(); buttons[1 - active] .focus(); active = 1 - active; } };
    const buttons = overlay.querySelectorAll("button"); let active = 0;
    buttons[0].addEventListener("click", () => finish(false)); buttons[1].addEventListener("click", () => finish(true));
    overlay.addEventListener("click", (event) => { if (event.target === overlay) finish(false); });
    document.addEventListener("keydown", onKey); document.body.appendChild(overlay); buttons[1].focus();
  });
};
Meetings.prototype.copyMeetingText = async function(value, label) {
  try { await navigator.clipboard.writeText(String(value)); this.showCallToast(`${label} copié`); }
  catch (_) {
    const overlay = document.createElement("div"); overlay.className = "mt-modal-backdrop";
    overlay.innerHTML = `<section class="mt-modal" role="dialog" aria-modal="true"><h2>Copier le ${window.escapeHtml(label.toLowerCase())}</h2><input class="mt-copy-value" readonly value="${window.escapeHtml(value)}"><div class="mt-modal-actions"><button type="button" class="btn btn-secondary">Fermer</button></div></section>`;
    const input = overlay.querySelector("input"); overlay.querySelector("button").addEventListener("click", () => overlay.remove()); overlay.addEventListener("click", (event) => { if (event.target === overlay) overlay.remove(); }); document.body.appendChild(overlay); input.focus(); input.select();
  }
};

// CallManager est créé à la fin de CallManager.js; on rattache cette instance
// à la classe spécialisée sans la recréer ni perdre sa connexion active.
Object.setPrototypeOf(window.callManager, Meetings.prototype);
// ===== HANDLERS DES MESSAGES SERVEUR (réunions) =====
// Ces méthodes sont ajoutées à Meetings.prototype

Meetings.prototype.normalizeMeetingCode = function(code) {
  if (!code && code !== 0) return "";
  const cleaned = String(code).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return "";
  if (cleaned.length === 9) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6, 9)}`;
  }
  if (cleaned.length === 11) {
    return cleaned.replace(/(.{3})(?=.)/g, "$1-");
  }
  return cleaned;
};

Meetings.prototype.handleMeetingCreated = function(data) {
  console.log("📅 [MEETING] Réunion créée:", data);
  this.meetingCreateSubmitting = false;
  clearTimeout(this.meetingCreateTimeout);
  this.meetingCreateTimeout = null;
  this.closeMeetingCreateView();

  // Réunion instantanée : on va directement à l'aperçu caméra, sans écran intermédiaire
  if (this.instantMeetingPending) {
    this.instantMeetingPending = false;
    this.showMeetingPreviewView(data.code, !!data.isVideo);
    return;
  }

  this.showMeetingCreatedView(data);
};

Meetings.prototype.handleMeetingLiveReady = function(data) {
  console.log("📅 [MEETING] Réunion maintenant live:", data);
  // Plus besoin de rejoindre automatiquement - le créateur rejoint comme les autres
  // en utilisant son code ou lien
};

// Apporte aux 3 points d'acquisition média les périphériques choisis dans
// l'écran de prévisualisation (sinon comportement par défaut).
Meetings.prototype._mediaDeviceOptionsForMeeting = function() {
  const adapter = window.meetingMediaAdapter;
  if (!adapter) return {};
  return {
    cameraDeviceId: adapter.selectedCamera || undefined,
    microphoneDeviceId: adapter.selectedMicrophone || undefined,
  };
};

// Réapplique les choix micro/caméra faits en prévisualisation (ou en salle
// d'attente) à la salle live de la réunion. Condense la logique historique
// de handleMeetingJoined pour être partagée avec la salle d'attente.
Meetings.prototype._applyPendingMeetingMediaPreferences = function() {
  const mediaPreferences = this.pendingMeetingMediaPreferences;
  if (!mediaPreferences) return;
  const stream = this.groupLocalStream;
  const audioTrack = stream?.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !!mediaPreferences.microphoneEnabled;
    this.groupIsMuted = !mediaPreferences.microphoneEnabled;
  }
  const videoTrack = stream?.getVideoTracks()[0];
  if (this.groupIsVideo && !mediaPreferences.cameraEnabled) {
    if (videoTrack) videoTrack.enabled = false;
    this.groupIsCamOff = true;
  }
  this.groupPeerStates.set(this.myId, {
    micMuted: this.groupIsMuted,
    camOff: this.groupIsCamOff,
    screenSharing: false,
  });
  this.pendingMeetingMediaPreferences = null;
};

Meetings.prototype.handleMeetingJoined = async function(data) {
  console.log("📅 [MEETING] Réunion jointe, salle live:", data.roomId);
  this.stopWaitingMusicLocally();
  const previousWaitingRoom = this.meetingWaitingRoomId;
  if (previousWaitingRoom && previousWaitingRoom !== data.roomId) {
    this.sendSignal({ type: "group-leave", roomId: previousWaitingRoom });
    this.meetingWaitingRoomId = null;
  }
  this.closeMeetingWaitingView();

  // Marquer que c'est une réunion planifiée pour empêcher la bascule automatique
  // vers l'écran 1-à-1 lorsqu'il ne reste qu'un autre participant dans la salle.
  this.groupIsMeeting = true;
  this.groupDowngradingToOneToOne = false;
  this.groupRoomId = data.roomId;
  this.groupIsVideo = !!data.isVideo;

  // Stocker les infos de la réunion
  this.currentMeetingTitle = data.title || "Réunion";
  this.currentMeetingId = data.meetingId;
    this.currentMeetingCode = data.code
    ? this.normalizeMeetingCode(data.code)
    : (this.meetingPendingCode || this.currentMeetingCode || "");
  // Qui est l'hôte ? (créateur de la réunion)
  this.meetingCreatedBy = data.createdBy || data.hostId || null;
  this.isMeetingHost = !!(this.meetingCreatedBy && this.meetingCreatedBy === this.myId);

  // Le flux de réunion doit avoir les médias du groupe prêts avant d'ouvrir
  // la salle live et d'envoyer le group-join. Sans cela le client se retrouve
  // avec un roster mais sans peer WebRTC réel, ce qui provoque la fausse
  // sensation "personne présente" alors qu'un participant est en attente.
  if (!this.groupLocalStream) {
    try {
      await this.acquireGroupMedia(this.groupIsVideo, this._mediaDeviceOptionsForMeeting());
    } catch (error) {
      console.error("❌ [MEETING] Impossible d'acquérir les médias de la réunion:", error);
      this.showCallToast("Accès média impossible");
      this.sendSignal({ type: "group-leave", roomId: data.roomId });
      this.groupIsMeeting = false;
      this.pendingMeetingMediaPreferences = null;
      return;
    }
  }

  // Appliquer ici les choix faits dans l'aperçu / la salle d'attente.
  this._applyPendingMeetingMediaPreferences();

  // Préparer le roster temporaire
  this.groupRoster = [{ userId: this.myId, state: "JOINED" }];

  // Enchaîner sur l'appel de groupe existant
  this.groupJoinPending = true;
  clearTimeout(this.groupRequestTimer);
  this.groupRequestTimer = setTimeout(() => {
    if (this.groupJoinPending && this.groupRoomId === data.roomId) {
      this.finishGroupCall("Impossible de rejoindre la reunion. Reessayez.");
    }
  }, CallManager.GROUP_REQUEST_TIMEOUT_MS);
  this.sendSignal({
    type: "group-join",
    roomId: data.roomId,
  });

  // Afficher l'écran de réunion spécifique (Google Meet style)
  this.showMeetingScreen(data);
};

Meetings.prototype.handleMeetingReconnect = async function(data) {
  console.log("📅 [MEETING] Reconnexion à la réunion demandée:", data.roomId);
  this.showCallToast("Reconnexion à la réunion en cours...");

  // Fermer l'écran actuel si existant
  this.closeMeetingScreen();
  this.closeMeetingWaitingView();

  // Marquer que c'est une réunion planifiée
  this.groupIsMeeting = true;
  this.groupDowngradingToOneToOne = false;
  this.groupRoomId = data.roomId;
  this.groupIsVideo = !!data.isVideo;

  // Stocker les infos de la réunion
  this.currentMeetingTitle = data.title || "Réunion";
  this.currentMeetingId = data.meetingId;
    this.currentMeetingCode = data.code
    ? this.normalizeMeetingCode(data.code)
    : (this.meetingPendingCode || this.currentMeetingCode || "");
  this.meetingCreatedBy = data.createdBy || data.hostId || null;
  this.isMeetingHost = !!(this.meetingCreatedBy && this.meetingCreatedBy === this.myId);

  // Acquérir les médias
  if (!this.groupLocalStream) {
    try {
      await this.acquireGroupMedia(this.groupIsVideo, this._mediaDeviceOptionsForMeeting());
    } catch (error) {
      console.error("❌ [MEETING] Impossible d'acquérir les médias:", error);
      this.showCallToast("Accès média impossible");
      this.groupIsMeeting = false;
      return;
    }
  }

  // Préparer le roster temporaire
  this.groupRoster = [{ userId: this.myId, state: "JOINED" }];

  // Rejoindre la salle
  this.groupJoinPending = true;
  clearTimeout(this.groupRequestTimer);
  this.groupRequestTimer = setTimeout(() => {
    if (this.groupJoinPending && this.groupRoomId === data.roomId) {
      this.finishGroupCall("Impossible de se reconnecter a la reunion.");
    }
  }, CallManager.GROUP_REQUEST_TIMEOUT_MS);
  this.sendSignal({
    type: "group-join",
    roomId: data.roomId,
  });

  // Afficher l'écran de réunion
  this.showMeetingScreen(data);
};

Meetings.prototype.handleMeetingWaiting = async function(data) {
  console.log("📅 [MEETING] Réunion en attente, temps restant:", data.waitTimeMin, "min");

  // Ne PAS écraser l'écran live si on est déjà dans la réunion
  if (this.groupIsMeeting && this.groupRoomId && !this.meetingWaitingRoomId) {
    console.log("📅 [MEETING] Déjà en réunion live, on ignore meeting-waiting");
    return;
  }

  // Si la réunion est déjà live/active et non verrouillée, ne jamais forcer la salle d'attente
  const current = window.meetingService?.currentMeeting;
  const serverReportsLive = data.status === "live" || data.status === "active";
  const currentIsLive = current && (current.status === "live" || current.status === "active");
  const isLocked = !!(data.locked || data.lockMeeting || data.alwaysWaitingRoom || current?.lockMeeting || current?.alwaysWaitingRoom);
  if ((serverReportsLive || currentIsLive) && !isLocked) {
    console.log("📅 [MEETING] Réunion déjà live et non verrouillée — pas de salle d'attente");
    if (data.roomId) {
      await this.handleMeetingJoined(data);
    }
    return;
  }

  this.meetingPendingCode = data.code;
  this.meetingPendingMeetingId = data.meetingId;
  if (data.waitingRoomId && !this.meetingWaitingRoomId) {
    this.groupIsMeeting = true;
    this.groupIsVideo = !!data.isVideo;
    this.groupRoomId = data.waitingRoomId;
    this.meetingWaitingRoomId = data.waitingRoomId;
    this.groupIsLeaving = false;
    this.groupRoster = [{ userId: this.myId, state: "JOINED" }];
    try {
      if (!this.groupLocalStream) {
        await this.acquireGroupMedia(this.groupIsVideo, this._mediaDeviceOptionsForMeeting());
        // Respecter micro/caméra choisis en prévisualisation pendant l'attente
        this._applyPendingMeetingMediaPreferences();
      }
      this.sendSignal({ type: "group-join", roomId: data.waitingRoomId });
    } catch (error) {
      console.warn("[MEETING] Waiting media unavailable:", error);
      // L'utilisateur peut quand même attendre sans caméra ni micro
    }
  }

  if (data.serverNow) {
    this.clockOffset = data.serverNow - Date.now();
    console.log("🕐 Décalage d'horloge:", this.clockOffset, "ms");
  }

  this.showMeetingWaitingView(data);
  if (data.waitingMusic && (data.waitingMusic.dataUrl || data.waitingMusic.tracks)) {
    this.receiveWaitingMusic(data.waitingMusic);
  }
};

// ===== LECTEUR DE MUSIQUE D'ATTENTE =====
// Playlist transmise par l'hôte, lecture locale chez chaque participant.
// - passage automatique au morceau suivant + boucle de playlist
// - progression, volume, pause/reprise (contrôles 100% locaux)
// - gestion de l'autoplay refusé (bouton "Activer la musique", pas de faux état)
// - synchronisation approximative via syncAt (horodatage serveur) + clockOffset
// - libération complète des ressources audio à l'arrêt
Meetings.prototype.receiveWaitingMusic = function(music) {
  const tracks = Array.isArray(music?.tracks) && music.tracks.length
    ? music.tracks
    : (music?.dataUrl ? [{ dataUrl: music.dataUrl, name: music.name }] : []);
  if (!tracks.length || this.waitingMusicStoppedForMeeting) return;
  // Nouvelle playlist (ou arrivée tardive) : repartir du début proprement
  this._destroyWaitingMusicNode();
  this.waitingMusicTracks = tracks;
  this.waitingMusicTrackIndex = 0;
  this.waitingMusicDataUrl = tracks[0].dataUrl;
  this.waitingMusicTitle = tracks[0].name || "Musique d'attente";
  this.waitingMusicLocallyEnabled = true;
  this.waitingMusicLocallyPaused = false;
  this.waitingMusicBlocked = false;
  // Synchronisation approximative : position de lecture calculée depuis
  // l'horodatage serveur (syncAt) et le décalage d'horloge mesuré (clockOffset).
  const syncAt = music?.syncAt ? Number(music.syncAt) : null;
  this.waitingMusicPendingSeekSec = 0;
  if (syncAt) {
    const nowSync = Date.now() + (this.clockOffset || 0);
    const elapsed = Math.max(0, (nowSync - syncAt) / 1000);
    // Garde-fou : au-delà de 2 h on repart simplement du début
    this.waitingMusicPendingSeekSec = elapsed > 7200 ? 0 : elapsed;
  }
  this.renderWaitingMusicPlaylist();
  this.updateWaitingMusicControls();
  this.playWaitingMusicLocally(this.waitingMusicPendingSeekSec);
};

Meetings.prototype._ensureWaitingMusicAudio = function() {
  if (this.waitingMusicAudio) return this.waitingMusicAudio;
  const audio = new Audio();
  audio.preload = "auto";
  audio.volume = typeof this.waitingMusicVolume === "number" ? this.waitingMusicVolume : 1;
  this.waitingMusicAudio = audio;
  return audio;
};

// Lecture locale. `seekSec` optionnel : position de départ (synchronisation).
Meetings.prototype.playWaitingMusicLocally = async function(seekSec = 0) {
  const tracks = this.waitingMusicTracks || [];
  if (!tracks.length) return;
  const index = Math.min(this.waitingMusicTrackIndex || 0, tracks.length - 1);
  const track = tracks[index];
  const audio = this._ensureWaitingMusicAudio();
  this.waitingMusicTrackIndex = index;

  // Écouteurs installés une fois (le ouï-dire "ended" avance la playlist)
  if (!audio.dataset.cmWired) {
    audio.dataset.cmWired = "1";
    audio.addEventListener("ended", () => {
      this._advanceWaitingTrack(true);
    });
    audio.addEventListener("timeupdate", () => this._updateWaitingMusicProgress());
    audio.addEventListener("loadedmetadata", () => {
      // Appliquer la position de synchronisation dès que la durée est connue
      if (this.waitingMusicPendingSeekSec > 0 && isFinite(audio.duration)) {
        try { audio.currentTime = this.waitingMusicPendingSeekSec % Math.max(audio.duration, 1); } catch (e) {}
      }
      this.waitingMusicPendingSeekSec = 0;
    });
    audio.addEventListener("error", () => {
      // Fichier illisible : ignorer ce morceau et essayer le suivant
      console.warn("[MEETING] Morceau audio illisible, passage au suivant");
      this._advanceWaitingTrack(true);
    });
  }

  if (audio.src !== track.dataUrl) {
    audio.src = track.dataUrl;
    this.waitingMusicPendingSeekSec = seekSec || 0;
    this.waitingMusicTitle = track.name || "Musique d'attente";
  } else if (seekSec > 0) {
    try { audio.currentTime = seekSec; } catch (e) {}
  }

  this.waitingMusicLocallyEnabled = true;
  try {
    await audio.play();
    this.waitingMusicLocallyPaused = false;
    this.waitingMusicBlocked = false;
  } catch (err) {
    if (err && (err.name === "NotAllowedError" || err.name === "NotSupportedError" || /permission/i.test(err.message || ""))) {
      // Autoplay refusé par le navigateur / WebView : NE PAS mentir sur l'état.
      // Un bouton "Activer la musique" s'affiche ; le prochain geste utilisateur débloque.
      console.warn("[MEETING] Lecture musique bloquée par l'autoplay :", err.name);
      this.waitingMusicBlocked = true;
      this.waitingMusicLocallyPaused = true;
    } else {
      console.warn("[MEETING] Lecture musique impossible :", err);
      this.waitingMusicBlocked = true;
      this.waitingMusicLocallyPaused = true;
    }
  }
  this.updateWaitingMusicControls();
};

// Avance d'un morceau (boucle de playlist). `auto` = fin ou erreur du morceau.
Meetings.prototype._advanceWaitingTrack = function(auto = false) {
  const tracks = this.waitingMusicTracks || [];
  if (!tracks.length) return;
  const wasPlaying = this.waitingMusicLocallyEnabled && !this.waitingMusicLocallyPaused;
  this.waitingMusicTrackIndex = ((this.waitingMusicTrackIndex || 0) + 1) % tracks.length;
  // Autoplay autorisé seulement si la lecture était déjà en cours (geste utilisateur
  // antérieur) : après "ended" le navigateur accepte en général ; en cas d'erreur
  // d'autoplay, passer en mode "bloqué" sans boucle infinie.
  this.playWaitingMusicLocally(0).then(() => {
    if (this.waitingMusicBlocked && wasPlaying) {
      // Re-tentative unique via geste : l'UI affichera "Activer la musique"
      this.updateWaitingMusicControls();
    }
  });
};

Meetings.prototype.pauseWaitingMusicLocally = function() {
  this.waitingMusicLocallyPaused = true;
  if (this.waitingMusicAudio) {
    try { this.waitingMusicAudio.pause(); } catch (e) {}
  }
  this.waitingMusicLocallyEnabled = true; // en pause, pas coupé
  this.updateWaitingMusicControls();
};

// Détruit complètement le nœud audio et libère ses ressources.
Meetings.prototype._destroyWaitingMusicNode = function() {
  if (this.waitingMusicAudio) {
    try {
      this.waitingMusicAudio.pause();
      this.waitingMusicAudio.removeAttribute("src");
      this.waitingMusicAudio.load();
    } catch (e) {}
    this.waitingMusicAudio = null;
  }
};

Meetings.prototype.stopWaitingMusicLocally = function() {
  if (this.waitingMusicAudio) {
    try {
      this.waitingMusicAudio.pause();
      this.waitingMusicAudio.currentTime = 0;
    } catch (e) {}
  }
  this.waitingMusicLocallyEnabled = false;
  this.waitingMusicLocallyPaused = false;
  this.waitingMusicTrackIndex = 0;
  this.updateWaitingMusicControls();
};

Meetings.prototype.setWaitingMusicVolume = function(volume) {
  const v = Math.min(1, Math.max(0, Number(volume)));
  if (isNaN(v)) return;
  this.waitingMusicVolume = v;
  if (this.waitingMusicAudio) this.waitingMusicAudio.volume = v;
  this.updateWaitingMusicControls();
};

// L'utilisateur accepte la lecture depuis un geste (anti-autoplay)
Meetings.prototype.unlockWaitingMusic = function() {
  this.waitingMusicBlocked = false;
  this.waitingMusicLocallyEnabled = true;
  this.waitingMusicLocallyPaused = false;
  this.playWaitingMusicLocally(0);
};

// Toggle local : lecture ↔ pause (couper CHEZ MOI n'arrête pas chez les autres)
Meetings.prototype.toggleWaitingMusicLocally = function() {
  if (this.waitingMusicBlocked) {
    // Autoplay refusé : le tap sur le bouton est le geste utilisateur attendu
    this.unlockWaitingMusic();
    return;
  }
  if (this.waitingMusicLocallyEnabled && !this.waitingMusicLocallyPaused) {
    this.pauseWaitingMusicLocally();
  } else {
    this.playWaitingMusicLocally(0);
  }
};

// Sélection des musiques par l'hôte : validation type / taille / décodage,
// ajout à la playlist, lecture locale et diffusion aux participants.
Meetings.WAITING_MUSIC_MAX_PER_FILE_BYTES = 10 * 1024 * 1024; // 10 Mo / morceau
Meetings.WAITING_MUSIC_MAX_TOTAL_BYTES = 30 * 1024 * 1024;    // 30 Mo total
Meetings.prototype.selectWaitingMusic = async function(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  // 1) Validation du format (type MIME audio ou extension connue)
  const audioExtOk = (name) => /\.(mp3|aac|m4a|ogg|oga|opus|wav|webm|flac)$/i.test(name || "");
  const invalid = files.filter((file) => !/^audio\//i.test(file.type) && !audioExtOk(file.name));
  if (invalid.length) {
    this.showCallToast(`Format non audio : ${invalid[0].name}`);
    return;
  }

  // 2) Validation de la taille (évite de saturer la WS et la RAM du serveur)
  for (const file of files) {
    if (file.size > Meetings.WAITING_MUSIC_MAX_PER_FILE_BYTES) {
      this.showCallToast(`« ${file.name} » dépasse 10 Mo — non ajouté`);
      return;
    }
  }
  const currentBytes = (this.waitingMusicTracks || [])
    .reduce((sum, track) => sum + (track.dataUrl ? track.dataUrl.length * 0.75 : 0), 0);
  const newBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (currentBytes + newBytes > Meetings.WAITING_MUSIC_MAX_TOTAL_BYTES) {
    this.showCallToast("Playlist trop lourde (max 30 Mo au total)");
    return;
  }

  // 3) Décodage en dataURL + vérification de décodabilité (durée lisible)
  const existingTracks = this.waitingMusicTracks || [];
  this.showCallToast("Lecture des fichiers audio…");
  for (const file of files) {
    const existing = existingTracks.some((t) => t.name === file.name && t.fileSize === file.size);
    if (existing) continue;
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("read error"));
        reader.readAsDataURL(file);
      });
      // Vérifier que le navigateur sait décoder le fichier et récupérer la durée
      const duration = await new Promise((resolve) => {
        const probe = new Audio();
        const done = (value) => { probe.removeAttribute("src"); probe.load(); resolve(value); };
        probe.preload = "metadata";
        probe.onloadedmetadata = () => done(isFinite(probe.duration) ? probe.duration : 0);
        probe.onerror = () => done(-1);
        probe.src = dataUrl;
        setTimeout(() => done(-1), 8000);
      });
      if (duration === -1) {
        this.showCallToast(`« ${file.name} » illisible — ignoré`);
        continue;
      }
      if (duration > 15 * 60) {
        this.showCallToast(`« ${file.name} » dépasse 15 min — ignoré`);
        continue;
      }
      existingTracks.push({ dataUrl, name: file.name, fileSize: file.size, duration: Math.round(duration) });
    } catch (error) {
      console.warn("[MEETING] Fichier audio ignoré:", file.name, error);
    }
  }

  if (!existingTracks.length) {
    this.showCallToast("Aucun fichier audio valide");
    return;
  }

  const firstAdded = (this.waitingMusicTracks || []).length !== existingTracks.length;
  this.waitingMusicTracks = existingTracks;
  if (firstAdded && !this.waitingMusicAudio) {
    this.waitingMusicTrackIndex = 0;
    this.waitingMusicLocallyEnabled = true;
    this.waitingMusicLocallyPaused = false;
  }
  this.waitingMusicDataUrl = this.waitingMusicTracks[0].dataUrl;
  this.waitingMusicTrackIndex = Math.min(this.waitingMusicTrackIndex || 0, this.waitingMusicTracks.length - 1);
  const current = this.waitingMusicTracks[this.waitingMusicTrackIndex];
  this.waitingMusicTitle = current?.name || "Musique d'attente";
  this.waitingMusicStoppedForMeeting = false;
  this.updateWaitingMusicControls();
  // Lecture locale immédiate pour l'hôte, puis diffusion synchronisée
  this.playWaitingMusicLocally(0).then(() => this._broadcastWaitingMusicPlaylist());
};

// Message serveur : playlist à jour (set) ou arrêt collectif (stop)
Meetings.prototype.handleWaitingMusicMessage = function(data) {
  if (data.meetingId && this.meetingPendingMeetingId && data.meetingId !== this.meetingPendingMeetingId) return;
  if (data.type === "meeting-waiting-music-set") {
    // L'hôte reçoit son propre écho : pas d'écrasement brutal si identique
    const incoming = Array.isArray(data.tracks) ? data.tracks : [];
    const current = this.waitingMusicTracks || [];
    if (data.clientOnly) return;
    if (incoming.length && incoming.length === current.length &&
        incoming.every((t, i) => t.dataUrl === current[i]?.dataUrl) &&
        data.syncAt && this.waitingMusicLastSyncAt === data.syncAt) {
      return;
    }
    this.waitingMusicLastSyncAt = data.syncAt || null;
    this.waitingMusicStoppedForMeeting = false;
    this.receiveWaitingMusic(data);
  }
  if (data.type === "meeting-waiting-music-stop") {
    this._broadcastWaitingMusicStop(); // purge complète + libération ressources
  }
};

Meetings.prototype._updateWaitingMusicProgress = function() {
  const audio = this.waitingMusicAudio;
  if (!audio) return;
  const bar = document.getElementById("waiting-music-progress-fill");
  const cur = document.getElementById("waiting-music-current-time");
  const total = document.getElementById("waiting-music-total-time");
  if (bar && isFinite(audio.duration) && audio.duration > 0) {
    bar.style.width = `${Math.min(100, (audio.currentTime / audio.duration) * 100)}%`;
  }
  const fmt = (s) => {
    if (!isFinite(s)) return "--:--";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };
  if (cur) cur.textContent = fmt(audio.currentTime);
  if (total) total.textContent = fmt(audio.duration);
};

Meetings.prototype.updateWaitingMusicControls = function() {
  const title = document.getElementById("meeting-waiting-music-title");
  if (title) title.textContent = this.waitingMusicTitle || "Aucune musique sélectionnée";
  const hasTracks = (this.waitingMusicTracks || []).length > 0;

  const toggle = document.getElementById("meeting-waiting-music-toggle");
  if (toggle) {
    toggle.disabled = !hasTracks;
    toggle.classList.toggle(
      "playing",
      !!(this.waitingMusicLocallyEnabled && !this.waitingMusicLocallyPaused && !this.waitingMusicBlocked),
    );
    if (this.waitingMusicBlocked) {
      toggle.textContent = "🔊 Activer la musique";
    } else if (this.waitingMusicLocallyEnabled && !this.waitingMusicLocallyPaused) {
      toggle.textContent = "⏸ Pause (chez moi)";
    } else {
      toggle.textContent = "▶︎ Reprendre la musique";
    }
  }

  const hostStop = document.getElementById("meeting-waiting-music-stop-all");
  if (hostStop) hostStop.disabled = !hasTracks;

  const trackPos = document.getElementById("waiting-music-track-pos");
  if (trackPos && hasTracks) {
    trackPos.textContent = `${(this.waitingMusicTrackIndex || 0) + 1}/${this.waitingMusicTracks.length}`;
  }
  const volume = document.getElementById("waiting-music-volume");
  if (volume && document.activeElement !== volume) {
    volume.value = String(typeof this.waitingMusicVolume === "number" ? this.waitingMusicVolume : 1);
  }

  // État visible : en pause / bloqué, la barre de progression se fige mais ne
  // donne pas la fausse impression que la musique tourne.
  const status = document.getElementById("waiting-music-status");
  if (status) {
    status.classList.toggle("waiting-music-blocked", !!this.waitingMusicBlocked);
    if (!hasTracks) {
      status.textContent = "";
    } else if (this.waitingMusicBlocked) {
      status.textContent = "Lecture bloquée par le navigateur — appuyez sur « Activer la musique »";
    } else if (this.waitingMusicLocallyPaused) {
      status.textContent = "Musique en pause chez vous";
    } else {
      status.textContent = "Musique en cours (chez vous et chez les participants en attente)";
    }
  }
  this.renderWaitingMusicPlaylist();
};

// Rend la playlist dans le(s) conteneur(s) présents à l'écran (hôte uniquement
// en édition, participants en lecture seule).
Meetings.prototype.renderWaitingMusicPlaylist = function() {
  const list = document.getElementById("waiting-music-playlist");
  if (!list) return;
  const tracks = this.waitingMusicTracks || [];
  if (!tracks.length) {
    list.innerHTML = "";
    return;
  }
  const isEditableHost = !!document.getElementById("waiting-music-file");
  list.innerHTML = tracks.map((track, index) => `
    <li class="waiting-music-track${index === (this.waitingMusicTrackIndex || 0) ? " now-playing" : ""}"
        data-music-index="${index}">
      ${index === (this.waitingMusicTrackIndex || 0) && this.waitingMusicLocallyEnabled && !this.waitingMusicLocallyPaused
        ? '<i class="fa-solid fa-music fa-beat" style="color:#00a884"></i> '
        : `<span class="waiting-music-index">${index + 1}</span> `}
      <span class="waiting-music-track-name" title="${window.escapeHtml(track.name || "")}">${window.escapeHtml(track.name || "Morceau")}</span>
      ${isEditableHost ? `
        <button type="button" class="waiting-music-track-btn" data-music-action="up" aria-label="Monter" ${index === 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-up"></i></button>
        <button type="button" class="waiting-music-track-btn" data-music-action="down" aria-label="Descendre" ${index === tracks.length - 1 ? "disabled" : ""}><i class="fa-solid fa-arrow-down"></i></button>
        <button type="button" class="waiting-music-track-btn" data-music-action="remove" aria-label="Retirer"><i class="fa-solid fa-trash-can"></i></button>
      ` : ""}
    </li>`).join("");
};

Meetings.prototype._bindWaitingMusicPlaylist = function(list) {
  if (!list || list.dataset.bound) return;
  list.dataset.bound = "1";
  list.addEventListener("click", (event) => {
    const item = event.target.closest("[data-music-index]");
    if (!item) return;
    const index = Number(item.dataset.musicIndex);
    const action = event.target.closest("[data-music-action]")?.dataset.musicAction;
    if (action) {
      if (action === "up") this.moveWaitingTrack(index, -1);
      if (action === "down") this.moveWaitingTrack(index, 1);
      if (action === "remove") this.removeWaitingTrack(index);
      event.stopPropagation();
      return;
    }
    // Tap sur un morceau : le lire immédiatement
    if (index !== this.waitingMusicTrackIndex) {
      this.waitingMusicTrackIndex = index;
      this.playWaitingMusicLocally(0);
    }
  });
};

// Réordonner (hôte) : déplacer le morceau et diffuser la nouvelle playlist
Meetings.prototype.moveWaitingTrack = function(index, direction) {
  const tracks = this.waitingMusicTracks;
  if (!Array.isArray(tracks) || !tracks.length) return;
  const target = index + direction;
  if (target < 0 || target >= tracks.length) return;
  [tracks[index], tracks[target]] = [tracks[target], tracks[index]];
  this.waitingMusicTrackIndex = tracks.indexOf(
    tracks.find((t) => t.dataUrl === (this.waitingMusicAudio?.src || tracks[0].dataUrl)),
  );
  if (this.waitingMusicTrackIndex < 0) this.waitingMusicTrackIndex = 0;
  this._broadcastWaitingMusicPlaylist();
  this.updateWaitingMusicControls();
};

Meetings.prototype.removeWaitingTrack = function(index) {
  const tracks = this.waitingMusicTracks;
  if (!Array.isArray(tracks) || !tracks.length) return;
  const removedDataUrl = tracks[index]?.dataUrl;
  tracks.splice(index, 1);
  if (!tracks.length) {
    this._destroyWaitingMusicNode();
    this.waitingMusicTracks = [];
    this.waitingMusicTrackIndex = 0;
    this.waitingMusicDataUrl = null;
    this.waitingMusicTitle = "Aucune musique sélectionnée";
    this._broadcastWaitingMusicStop();
    this.updateWaitingMusicControls();
    return;
  }
  const currentNode = this.waitingMusicAudio;
  if (currentNode && removedDataUrl && currentNode.src === removedDataUrl) {
    this.waitingMusicTrackIndex = Math.min(index, tracks.length - 1);
    this._destroyWaitingMusicNode();
    if (this.waitingMusicLocallyEnabled && !this.waitingMusicLocallyPaused) {
      this.playWaitingMusicLocally(0);
    }
  }
  this._broadcastWaitingMusicPlaylist();
  this.updateWaitingMusicControls();
};

// Diffuse la playlist à jour aux participants (hôte)
Meetings.prototype._broadcastWaitingMusicPlaylist = function() {
  if (!this.waitingMusicTracks?.length) return;
  this.sendSignal({
    type: "meeting-waiting-music-set",
    meetingId: this.meetingPendingMeetingId,
    syncAt: Date.now() + (this.clockOffset || 0),
    tracks: this.waitingMusicTracks.map((t) => ({ dataUrl: t.dataUrl, name: t.name })),
  });
};

// Arrête la musique chez tout le monde (hôte) — y compris chez l'hôte lui-même.
Meetings.prototype.stopWaitingMusicForEveryone = function() {
  this.sendSignal({ type: "meeting-waiting-music-stop", meetingId: this.meetingPendingMeetingId });
  // Effet immédiat local (le serveur renvoie aussi le message, mais soyons
  // certains que l'hôte s'arrête même si le réseau fait défaut) :
  this._broadcastWaitingMusicStop();
};

// Purge locale finale : playlist effacée + ressources libérées.
Meetings.prototype._broadcastWaitingMusicStop = function() {
  this.waitingMusicStoppedForMeeting = true;
  this.waitingMusicDataUrl = null;
  this.waitingMusicTracks = [];
  this.waitingMusicTrackIndex = 0;
  this.waitingMusicTitle = "La musique a été arrêtée par l’hôte";
  this._destroyWaitingMusicNode();
  this.waitingMusicLocallyEnabled = false;
  this.waitingMusicLocallyPaused = false;
  this.updateWaitingMusicControls();
};

Meetings.prototype.handleMeetingHostStarted = function(data) {
  console.log("📅 [MEETING] L'hôte a démarré la réunion:", data.hostId);
  this.showCallToast("L'hôte a démarré la réunion");

  // Déjà dans la salle LIVE de la réunion (et pas en salle d'attente) : on ne
  // bouge pas — évite de repartir en attente ou de double-rejoindre.
  const alreadyInLiveRoom = !this.meetingWaitingRoomId && this.groupRoomId
    && (!data.roomId || this.groupRoomId === data.roomId);
  if (alreadyInLiveRoom) {
    this.closeMeetingWaitingView();
    return;
  }

  // On était en salle d'attente : quitter PROPREMENT la salle d'attente PUIS
  // rejoindre la salle live. (Corrige le bug historique : les participants en
  // attente quittaient la salle puis restaient sur l'écran d'accueil sans
  // jamais rejoindre la réunion.)
  this.closeMeetingWaitingView();

  if (data.roomId) {
    this.handleMeetingJoined({
      meetingId: data.meetingId,
      roomId: data.roomId,
      isVideo: data.isVideo,
      title: data.title,
      code: data.code || this.meetingPendingCode,
      createdBy: data.hostId,
    });
    return;
  }

  if (this.meetingPendingCode) {
    this.joinMeeting(this.meetingPendingCode);
  }
};

Meetings.prototype.handleMeetingError = function(data) {
  console.error("📅 [MEETING] Erreur:", data.reason);
  this.meetingCreateSubmitting = false;
  this.instantMeetingPending = false;
  clearTimeout(this.meetingCreateTimeout);
  this.meetingCreateTimeout = null;
  this.pendingMeetingMediaPreferences = null;
  this.showCallToast("Erreur: " + data.reason);
  this.closeMeetingWaitingView();
  this.closeMeetingCreatedView();
};

Meetings.prototype.handleMeetingApprovalGranted = async function(data) {
  console.log("📅 [MEETING] Accès accordé:", data);
  this.meetingApprovalPending = false;
  this.showCallToast("Accès accepté — connexion…");
  this.closeMeetingWaitingView();
  if (typeof this.closeMeetingPreviewView === "function") {
    try { this.closeMeetingPreviewView(); } catch (e) {}
  }

  // Même flux que handleMeetingJoined
  await this.handleMeetingJoined({
    meetingId: data.meetingId,
    roomId: data.roomId,
    isVideo: data.isVideo,
    title: data.title,
    createdBy: data.createdBy || data.hostId,
  });
};

Meetings.prototype.handleMeetingApprovalDenied = function(data) {
  console.log("📅 [MEETING] Accès refusé:", data);
  this.meetingApprovalPending = false;
  this.showCallToast(data.reason || "Accès refusé par l'hôte");
  this.pendingMeetingMediaPreferences = null;
  this.closeMeetingWaitingView();
};

Meetings.prototype.handleMeetingPendingApproval = function(data) {
  console.log("📅 [MEETING] En attente d'approbation:", data);
  this.meetingApprovalPending = true; // bloque l'auto-join du compte à rebours
  this.showCallToast("Demande d'accès envoyée à l'hôte");
  // Fermer prévisualisation / attente classique
  if (typeof this.closeMeetingPreviewView === "function") {
    try { this.closeMeetingPreviewView(); } catch (e) {}
  }
  this.closeMeetingWaitingView();
  this.showMeetingApprovalWaitingView(data);
};

/**
 * Écran dédié : en attente d'approbation de l'hôte
 */
Meetings.prototype.showMeetingApprovalWaitingView = function(data) {
  if (this.meetingWaitingView) {
    try { this.meetingWaitingView.remove(); } catch (e) {}
    this.meetingWaitingView = null;
  }

  const title = data.title || "la réunion";
  const html = `
    <div class="view-container meeting-waiting-view active" id="meeting-approval-view">
      <div class="app-container" style="background:#202124;">
        <div class="header" style="background:transparent;">
          <button class="icon-btn-top" onclick="window.closeMeetingWaitingView()">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <div class="contact-info">
            <div class="contact-name">Accès en attente</div>
          </div>
          <div style="width:40px;"></div>
        </div>
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;padding:24px;text-align:center;">
          <div style="width:96px;height:96px;border-radius:50%;background:#3c4043;display:flex;align-items:center;justify-content:center;">
            <i class="fa-solid fa-user-shield" style="font-size:40px;color:#8ab4f8;"></i>
          </div>
          <div>
            <div style="font-size:18px;font-weight:500;color:#e8eaed;margin-bottom:8px;">En attente de l'hôte</div>
            <div style="font-size:14px;color:#9aa0a6;line-height:1.5;">
              Votre demande pour rejoindre <strong style="color:#e8eaed;">${title}</strong> a été envoyée.<br>
              Vous entrerez automatiquement dès que l'hôte aura accepté.
            </div>
          </div>
          <div style="width:32px;height:32px;border:3px solid #3c4043;border-top-color:#8ab4f8;border-radius:50%;animation:spin 1s linear infinite;"></div>
          <button onclick="window.closeMeetingWaitingView()"
                  style="width:100%;max-width:280px;padding:14px;background:#3c4043;border:none;border-radius:24px;color:#e8eaed;font-size:15px;cursor:pointer;">
            Annuler
          </button>
        </div>
      </div>
    </div>
    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
  `;
  document.body.insertAdjacentHTML("beforeend", html);
  this.meetingApprovalView = document.getElementById("meeting-approval-view");
};

Meetings.prototype.handleMeetingPendingRequest = function(data) {
  console.log("📅 [MEETING] Demande d'accès reçue:", data);
  this.showCallToast(`${window.escapeHtml(data.displayName || data.userId || "Participant")} demande à rejoindre`);
  // Toujours afficher le dialogue, même si l'hôte est déjà dans la réunion
  this.showPendingRequestDialog(data);
};

Meetings.prototype.handleMeetingKicked = function(data) {
  console.log("📅 [MEETING] Expulsé de la réunion:", data);
  this.showCallToast(data.reason || "Vous avez été retiré de la réunion");
  // Nettoyage complet : apreinte hôte effacée, panneaux fermés, médias libérés
  this.stopWaitingMusicLocally();
  this._destroyWaitingMusicNode();
  this.meetingChat?.reset?.();
  this.meetingParticipants?.reset?.();
  if (this.groupRoomId || this.groupIsMeeting) {
    try {
      this.endGroupCall(undefined);
    } catch (e) { console.warn("kicked cleanup:", e); }
  }
  this.closeMeetingScreen();
  this.groupIsMeeting = false;
  this.groupRoomId = null;
  this.isMeetingHost = false;
  this.meetingCreatedBy = null;
  this.meetingWaitingRoomId = null;
  this.currentMeetingId = null;
  this.currentMeetingCode = "";
  this.currentMeetingTitle = null;
};

/**
 * Fin d'appel de groupe avec nettoyage complet (corrige l'ancien appel à une
 * méthode inexistante : endGroupCall n'existait pas dans CallManager).
 * Utilisée par handleMeetingEnded, handleMeetingKicked et l'adaptateur média.
 */
Meetings.prototype.endGroupCall = function(message) {
  if (this.groupRoomId) {
    this.sendSignal({ type: "group-leave", roomId: this.groupRoomId });
  }
  this.groupIsMeeting = false;
  this.groupIsLeaving = true;
  this.stopMeetingTimer?.();
  this.closeMeetingScreen();
  // Fermer les panneaux chat/participants et éviter les résidus d'état
  this.meetingChat?.reset?.();
  this.meetingParticipants?.reset?.();
  try {
    if (typeof this.leaveGroupCall === "function") {
      // libère peers WebRTC, tuiles, médias, timers et interfaces d'appel
      this.leaveGroupCall(typeof message === "string" ? message : undefined);
    } else {
      if (typeof this.closeAllGroupPeers === "function") this.closeAllGroupPeers();
      if (this.groupLocalStream) {
        this.groupLocalStream.getTracks().forEach((track) => track.stop());
        this.groupLocalStream = null;
      }
      if (this.groupRoomId) this.groupRoomId = null;
    }
  } catch (e) {
    console.warn("endGroupCall cleanup:", e);
  }
  this.pendingMeetingMediaPreferences = null;
};

Meetings.prototype.showPendingRequestDialog = function(data) {
  // Toujours recréer avec les bonnes données (nouvelle demande)
  if (this.pendingRequestDialog) {
    try { this.pendingRequestDialog.remove(); } catch (e) {}
    this.pendingRequestDialog = null;
  }

  const dialog = document.createElement("div");
  dialog.className = "pending-request-dialog";
  dialog.id = "pending-request-dialog";
  dialog.style.zIndex = "5000";
  dialog.innerHTML = `
    <div class="dialog-overlay" data-close-pending></div>
    <div class="dialog-content">
      <div class="dialog-header">
        <h3>Demande d'accès</h3>
        <button class="dialog-close" data-close-pending aria-label="Fermer">
          <i class="fa-solid fa-times"></i>
        </button>
      </div>
      <div class="dialog-body">
        <p>${window.escapeHtml(data.displayName || data.userId || "Participant")} souhaite rejoindre la réunion "${window.escapeHtml(data.title || "R\u00e9union")}"</p>
      </div>
      <div class="dialog-footer">
        <button class="btn-secondary" data-request-action="reject">
          Refuser
        </button>
        <button class="btn-primary" data-request-action="approve">
          Accepter
        </button>
      </div>
    </div>
  `;

  dialog.querySelector("[data-close-pending]").addEventListener("click", () => this.closePendingRequestDialog());
  dialog.querySelector("[data-request-action=reject]").addEventListener("click", () => window.rejectMeetingRequest(data.meetingId, data.userId));
  dialog.querySelector("[data-request-action=approve]").addEventListener("click", () => window.approveMeetingRequest(data.meetingId, data.userId));
  document.body.appendChild(dialog);
  this.pendingRequestDialog = dialog;
  setTimeout(() => dialog.classList.add("active"), 10);
};

Meetings.prototype.closePendingRequestDialog = function() {
  if (this.pendingRequestDialog) {
    this.pendingRequestDialog.classList.remove("active");
    setTimeout(() => {
      if (this.pendingRequestDialog) {
        this.pendingRequestDialog.remove();
        this.pendingRequestDialog = null;
      }
    }, 300);
  }
};

Meetings.prototype.approveMeetingRequest = function(meetingId, userId) {
  this.sendSignal({
    type: "meeting-approve",
    meetingId,
    userId,
  });
  this.closePendingRequestDialog();
  this.showCallToast("Demande acceptée");
};

Meetings.prototype.rejectMeetingRequest = function(meetingId, userId) {
  this.sendSignal({
    type: "meeting-reject",
    meetingId,
    userId,
  });
  this.closePendingRequestDialog();
  this.showCallToast("Demande refusée");
};

Meetings.prototype.handleMeetingParticipantJoined = function(data) {
  console.log("📅 [MEETING] Participant rejoint:", data);
  if (window.meetingParticipants) {
    meetingParticipants.updateParticipant(data.userId, "JOINED");
  }
  this.showCallToast(`${data.userId} a rejoint la réunion`);
  this.updateMeetingParticipantCount();
};

Meetings.prototype.handleMeetingParticipantLeft = function(data) {
  console.log("📅 [MEETING] Parti:", data);
  if (window.meetingParticipants) {
    meetingParticipants.updateParticipant(data.userId, "LEFT");
  }
  this.showCallToast(`${data.userId} a quitté la réunion`);
  this.updateMeetingParticipantCount();
};

Meetings.prototype.handleMeetingParticipantState = function(data) {
  console.log("📅 [MEETING] État participant:", data);
  if (!data || !data.userId) return;
  if (!window.meetingParticipants) return;
  // Nouveau format borné (serveur) : objet { micEnabled, camEnabled, screenSharing }
  if (data.state && typeof data.state === "object") {
    meetingParticipants.updateParticipantMedia(data.userId, data.state);
    return;
  }
  // Ancien format (chaîne d'état brut) — conservé pour compatibilité
  if (typeof data.state === "string") {
    meetingParticipants.updateParticipant(data.userId, data.state);
  }
};

Meetings.prototype.broadcastParticipantState = function(state) {
  if (!this.groupRoomId || !this.myId) return;

  this.sendSignal({
    type: "meeting-participant-state",
    roomId: this.groupRoomId,
    userId: this.myId,
    state,
  });
};

Meetings.prototype.toggleMeetingMic = function() {
  const btn = document.getElementById("meeting-mic-btn");
  if (!btn) return;

  // Utilise la même logique que les appels de groupe
  if (typeof this.toggleGroupMic === "function") {
    this.toggleGroupMic();
  }

  const muted = !!this.groupIsMuted;
  if (muted) {
    btn.classList.remove("active");
    btn.innerHTML = '<i class="fa-solid fa-microphone-slash"></i>';
  } else {
    btn.classList.add("active");
    btn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
  }

  if (window.meetingParticipants) {
    meetingParticipants.updateParticipantMedia(this.myId, { micEnabled: !muted });
  }
  this.broadcastParticipantState({ micEnabled: !muted });
};

Meetings.prototype.toggleMeetingCam = async function() {
  const btn = document.getElementById("meeting-cam-btn");
  if (!btn) return;

  if (typeof this.toggleGroupCamera === "function") {
    await this.toggleGroupCamera();
  }

  const camOff = !!this.groupIsCamOff;
  if (camOff) {
    btn.classList.remove("active");
    btn.innerHTML = '<i class="fa-solid fa-video-slash"></i>';
  } else {
    btn.classList.add("active");
    btn.innerHTML = '<i class="fa-solid fa-video"></i>';
  }

  if (window.meetingParticipants) {
    meetingParticipants.updateParticipantMedia(this.myId, { camEnabled: !camOff });
  }
  this.broadcastParticipantState({ camEnabled: !camOff });
};

Meetings.prototype.leaveMeeting = function() {
  // Purge musique d'attente (aucun son ne doit continuer en arrière-plan)
  this.stopWaitingMusicLocally();
  this._destroyWaitingMusicNode();
  // Quitter proprement la salle de groupe (peers WebRTC + médias + signal)
  if (this.groupRoomId || this.groupIsMeeting) {
    try {
      if (typeof this.leaveGroupCall === "function") {
        this.leaveGroupCall("Vous avez quitté la réunion");
      } else {
        this.sendSignal({ type: "group-leave", roomId: this.groupRoomId });
        if (typeof this.finishGroupCall === "function") {
          this.finishGroupCall("Vous avez quitté la réunion");
        }
      }
    } catch (e) {
      console.warn("leaveMeeting cleanup:", e);
    }
  }
  this.stopMeetingTimer?.();
  this.closeMeetingScreen();
  // Fermer les panneaux chat/participants (sinon résidus pour la prochaine réunion)
  this.meetingChat?.reset?.();
  this.meetingParticipants?.reset?.();
  this.groupIsMeeting = false;
  this.groupRoomId = null;
  this.meetingWaitingRoomId = null;
  this.meetingApprovalPending = false;
  this.isMeetingHost = false;
  this.meetingCreatedBy = null;
  this.currentMeetingId = null;
  this.currentMeetingCode = "";
  this.currentMeetingTitle = null;
};

Meetings.prototype.endMeetingForEveryone = async function() {
  if (!(await this.confirmMeetingAction("Terminer la R\u00e9union", "Voulez-vous terminer la r\u00e9union pour tous les participants ?"))) {
    return;
  }

  if (this.currentMeetingId) {
    this.sendSignal({
      type: "meeting-end",
      meetingId: this.currentMeetingId,
    });
  }

  this.leaveMeeting();
};

Meetings.prototype.handleMeetingChatMessage = function(data) {
  console.log("📅 [MEETING] Message chat reçu:", data);
  if (window.meetingChat) {
    meetingChat.receiveMessage(data);
  }
};

/**
 * Afficher l'écran de réunion (Google Meet style)
 */
Meetings.prototype.showMeetingScreen = function(data) {
  console.log("📅 [MEETING] Affichage écran de réunion:", data);

  if (this.meetingScreen) {
    this.meetingScreen.classList.add("active");
    document.body.classList.add("meeting-ui-active");
    return;
  }

  const html = `
    <div class="view-container meeting-screen" id="meeting-screen">
      <div class="meeting-container">
        <!-- Header de réunion -->
        <div class="meeting-header">
          <div class="meeting-room-info">
            <h1 class="meeting-title">${window.escapeHtml(this.currentMeetingTitle || "R\u00e9union")}</h1>
            <div class="meeting-time">${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
          <div class="meeting-actions">
            <button class="meeting-action-btn" aria-label="Participants" data-meeting-action="participants" title="Participants">
              <i class="fa-solid fa-users"></i>
              <span id="participant-count">1</span>
            </button>
            <button class="meeting-action-btn" aria-label="Ouvrir le chat" data-meeting-action="chat" title="Chat">
              <i class="fa-solid fa-comment"></i>
            </button>
            <button class="meeting-action-btn" aria-label="Copier le code" data-meeting-action="copy" title="Copier le code de la réunion">
              <i class="fa-solid fa-key"></i>
            </button>
          </div>
        </div>

        <!-- Zone vidéo principale -->
        <div class="meeting-video-area" id="meeting-video-area">
          <div class="video-grid" id="meeting-video-grid">
            <!-- Rempli dynamiquement par renderGroupGrid (même logique que les appels de groupe) -->
          </div>
        </div>

        <!-- Overlay réactions flottantes -->
        <div id="meeting-reaction-overlay" class="meeting-reaction-overlay" aria-hidden="true"></div>

        <!-- Barre de contrôle (plus haute, style Meet) -->
        <div class="meeting-controls meeting-controls-raised">
          <div class="meeting-time-display" id="meeting-time-display">00:00:00</div>
          <div class="meeting-control-buttons">
            <button class="meeting-control-btn active" id="meeting-mic-btn" aria-label="Activer ou couper le micro" onclick="window.toggleMeetingMic()" title="Micro">
              <i class="fa-solid fa-microphone"></i>
            </button>
            <button class="meeting-control-btn active" id="meeting-cam-btn" aria-label="Activer ou couper la cam\u00e9ra" onclick="window.toggleMeetingCam()" title="Caméra">
              <i class="fa-solid fa-video"></i>
            </button>
            <button class="meeting-control-btn" id="meeting-screen-btn" aria-label="Partager l\u2019\u00e9cran" onclick="window.toggleMeetingScreenShare()" title="Partager l'écran">
              <i class="fa-solid fa-desktop"></i>
            </button>
            <button class="meeting-control-btn" id="meeting-hand-btn" aria-label="Lever ou baisser la main" onclick="window.toggleMeetingHand()" title="Lever la main">
              <i class="fa-solid fa-hand"></i>
            </button>
            <button class="meeting-control-btn" id="meeting-reaction-btn" aria-label="Afficher les r\u00e9actions" onclick="window.showMeetingReactions()" title="Réactions">
              <i class="fa-solid fa-face-smile"></i>
            </button>
            <button class="meeting-control-btn meeting-hangup" aria-label="Quitter la r\u00e9union" onclick="window.leaveMeeting()" title="Quitter">
              <i class="fa-solid fa-phone-slash"></i>
            </button>
            ${this.isMeetingHost ? `<button class="meeting-control-btn meeting-end" onclick="window.endMeetingForEveryone()" title="Terminer pour tous">
              <i class="fa-solid fa-power-off"></i>
            </button>` : ''}
          </div>
        </div>
        <!-- Picker réactions -->
        <div id="meeting-reaction-picker" class="meeting-reaction-picker" style="display:none">
          <button type="button" onclick="window.sendMeetingReaction('👍')">👍</button>
          <button type="button" onclick="window.sendMeetingReaction('👏')">👏</button>
          <button type="button" onclick="window.sendMeetingReaction('❤️')">❤️</button>
          <button type="button" onclick="window.sendMeetingReaction('😂')">😂</button>
          <button type="button" onclick="window.sendMeetingReaction('😮')">😮</button>
          <button type="button" onclick="window.sendMeetingReaction('🎉')">🎉</button>
          <button type="button" onclick="window.sendMeetingReaction('🔥')">🔥</button>
          <button type="button" onclick="window.sendMeetingReaction('👎')">👎</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", html);
  this.meetingScreen = document.getElementById("meeting-screen");
  this.meetingScreen.addEventListener("click", (event) => {
    const action = event.target.closest("[data-meeting-action]")?.dataset.meetingAction;
    if (action === "participants") window.meetingParticipants.show(this.currentMeetingId, this.groupRoomId, !!this.isMeetingHost);
    if (action === "chat") window.meetingChat.show(this.currentMeetingId, this.groupRoomId);
    if (action === "copy") this.copyMeetingCode(this.currentMeetingCode);
  });
  this.meetingScreen.classList.add("active");
  document.body.classList.add("meeting-ui-active");

  const micButton = document.getElementById("meeting-mic-btn");
  if (micButton) {
    micButton.classList.toggle("active", !this.groupIsMuted);
    micButton.innerHTML = this.groupIsMuted
      ? '<i class="fa-solid fa-microphone-slash"></i>'
      : '<i class="fa-solid fa-microphone"></i>';
  }
  const cameraButton = document.getElementById("meeting-cam-btn");
  if (cameraButton) {
    cameraButton.classList.toggle("active", !this.groupIsCamOff);
    cameraButton.innerHTML = this.groupIsCamOff
      ? '<i class="fa-solid fa-video-slash"></i>'
      : '<i class="fa-solid fa-video"></i>';
  }

  // Afficher immédiatement la grille (moi + participants déjà présents)
  // via le même système que les appels de groupe
  if (typeof this.renderGroupGrid === "function") {
    this.renderGroupGrid();
  }

  this.updateMeetingParticipantCount();
};

/**
 * Attacher la vidéo locale à l'écran de réunion
 */
/**
 * Démarrer le timer de réunion
 */
Meetings.prototype.startMeetingTimer = function() {
  if (this.meetingTimerInterval) return;
  this.meetingStartTime = Date.now();

  this.meetingTimerInterval = setInterval(() => {
    const elapsed = Date.now() - this.meetingStartTime;
    const hours = Math.floor(elapsed / 3600000);
    const minutes = Math.floor((elapsed % 3600000) / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);

    const timeDisplay = document.getElementById("meeting-time-display");
    if (timeDisplay) {
      timeDisplay.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
  }, 1000);
};

Meetings.prototype.maybeStartMeetingTimer = function() {
  if (!this.groupIsMeeting || this.meetingTimerInterval) return;
  const others = (this.groupRoster || []).filter(
    participant => participant?.userId !== this.myId && participant?.state === "JOINED",
  );
  if (others.length === 0) {
    if (this.isMeetingHost) this.startMeetingTimer();
    return;
  }
  const hasConnectedPeer = Array.from(this.groupPeers?.values?.() || [])
    .some(peer => peer.connState === "connected");
  if (hasConnectedPeer) this.startMeetingTimer();
};

/**
 * Arrêter le timer de réunion
 */
Meetings.prototype.stopMeetingTimer = function() {
  if (this.meetingTimerInterval) {
    clearInterval(this.meetingTimerInterval);
    this.meetingTimerInterval = null;
  }
};

/**
 * Fermer l'écran de réunion
 */
Meetings.prototype.closeMeetingScreen = function() {
  this.stopMeetingTimer();

  if (this.meetingScreen) {
    this.meetingScreen.classList.remove("active");
    document.body.classList.remove("meeting-ui-active");
    setTimeout(() => {
      if (this.meetingScreen) {
        this.meetingScreen.remove();
        this.meetingScreen = null;
      }
    }, 300);
  }
};

/**
 * Lever / baisser la main
 */
Meetings.prototype.toggleMeetingHand = function() {
  const btn = document.getElementById("meeting-hand-btn");
  if (!btn || !this.groupRoomId) return;

  this.handRaised = !this.handRaised;
  if (this.handRaised) {
    btn.classList.add("active");
    this.sendSignal({
      type: "meeting-hand-raise",
      roomId: this.groupRoomId,
      meetingId: this.currentMeetingId,
    });
    this.showCallToast("Main levée");
  } else {
    btn.classList.remove("active");
    this.sendSignal({
      type: "meeting-hand-lower",
      roomId: this.groupRoomId,
      meetingId: this.currentMeetingId,
    });
  }
};

Meetings.prototype.handleMeetingHandRaised = function(data) {
  if (!data || !data.userId) return;
  if (data.userId === this.myId) return;
  this.showCallToast(`${data.userId} a levé la main ✋`);
  // Badge sur la tuile
  const tile = this.groupTiles && this.groupTiles.get(data.userId);
  if (tile) {
    tile.classList.add("hand-raised");
    let badge = tile.querySelector(".hand-raised-badge");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "hand-raised-badge";
      badge.textContent = "✋";
      tile.appendChild(badge);
    }
  }
};

Meetings.prototype.handleMeetingHandLowered = function(data) {
  if (!data || !data.userId) return;
  const tile = this.groupTiles && this.groupTiles.get(data.userId);
  if (tile) {
    tile.classList.remove("hand-raised");
    const badge = tile.querySelector(".hand-raised-badge");
    if (badge) badge.remove();
  }
};

/**
 * Afficher le picker de réactions
 */
Meetings.prototype.showMeetingReactions = function() {
  const picker = document.getElementById("meeting-reaction-picker");
  if (!picker) return;
  const visible = picker.style.display !== "none";
  picker.style.display = visible ? "none" : "flex";
};

Meetings.prototype.sendMeetingReaction = function(emoji) {
  if (!this.groupRoomId || !emoji) return;
  this.sendSignal({
    type: "meeting-reaction",
    roomId: this.groupRoomId,
    meetingId: this.currentMeetingId,
    reaction: emoji,
  });
  // Afficher localement aussi
  this.showFloatingReaction(this.myId, emoji);
  const picker = document.getElementById("meeting-reaction-picker");
  if (picker) picker.style.display = "none";
};

Meetings.prototype.handleMeetingReaction = function(data) {
  if (!data) return;
  this.showFloatingReaction(data.userId, data.reaction);
};

Meetings.prototype.showFloatingReaction = function(userId, emoji) {
  const overlay = document.getElementById("meeting-reaction-overlay");
  if (!overlay || !emoji) return;
  const el = document.createElement("div");
  el.className = "floating-reaction";
  el.textContent = emoji;
  el.style.left = (10 + Math.random() * 70) + "%";
  overlay.appendChild(el);
  setTimeout(() => el.remove(), 2500);
  if (userId && userId !== this.myId) {
    this.showCallToast(`${userId}: ${emoji}`);
  }
};

/**
 * Partage d'écran (réutilise le flux groupe)
 */
Meetings.prototype.toggleMeetingScreenShare = async function() {
  const btn = document.getElementById("meeting-screen-btn");
  try {
    if (typeof this.toggleScreenShare === "function") {
      await this.toggleScreenShare();
    }
  } catch (e) {
    console.error("screen share error", e);
    this.showCallToast("Partage d'écran impossible");
    return;
  }
  // Mettre à jour le bouton
  setTimeout(() => {
    if (!btn) return;
    if (this.isScreenSharing) {
      btn.classList.add("active", "sharing");
      btn.innerHTML = '<i class="fa-solid fa-desktop"></i>';
      this.showCallToast("Partage d'écran activé");
    } else {
      btn.classList.remove("active", "sharing");
      btn.innerHTML = '<i class="fa-solid fa-desktop"></i>';
    }
  }, 300);
};

/**
 * Ordre hôte : couper mon micro ou ma caméra
 */
Meetings.prototype.handleMeetingForceMute = function(data) {
  if (!data) return;
  const muted = data.muted !== false;
  if (data.media === "mic") {
    if (muted && !this.groupIsMuted) {
      if (typeof this.toggleGroupMic === "function") this.toggleGroupMic();
    } else if (!muted && this.groupIsMuted) {
      if (typeof this.toggleGroupMic === "function") this.toggleGroupMic();
    }
    // Sync bouton UI
    const btn = document.getElementById("meeting-mic-btn");
    if (btn) {
      if (this.groupIsMuted) {
        btn.classList.remove("active");
        btn.innerHTML = '<i class="fa-solid fa-microphone-slash"></i>';
      } else {
        btn.classList.add("active");
        btn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
      }
    }
    this.showCallToast(muted ? "L'hôte a coupé votre micro" : "L'hôte a réactivé votre micro");
  } else if (data.media === "cam") {
    const needOff = muted && !this.groupIsCamOff;
    const needOn = !muted && this.groupIsCamOff;
    if (needOff || needOn) {
      if (typeof this.toggleGroupCamera === "function") this.toggleGroupCamera();
    }
    setTimeout(() => {
      const btn = document.getElementById("meeting-cam-btn");
      if (btn) {
        if (this.groupIsCamOff) {
          btn.classList.remove("active");
          btn.innerHTML = '<i class="fa-solid fa-video-slash"></i>';
        } else {
          btn.classList.add("active");
          btn.innerHTML = '<i class="fa-solid fa-video"></i>';
        }
      }
    }, 200);
    this.showCallToast(muted ? "L'hôte a coupé votre caméra" : "L'hôte a réactivé votre caméra");
  }
};

/**
 * Hôte : forcer mute micro/cam d'un participant
 */
Meetings.prototype.hostMuteParticipant = function(targetUserId, media, muted = true) {
  if (!this.isMeetingHost || !this.groupRoomId || !targetUserId) {
    this.showCallToast("Action réservée à l'hôte");
    return;
  }
  this.sendSignal({
    type: "meeting-host-mute",
    meetingId: this.currentMeetingId,
    roomId: this.groupRoomId,
    targetUserId,
    media, // "mic" | "cam"
    muted,
  });
  this.showCallToast(muted
    ? (media === "mic" ? "Micro coupé" : "Caméra coupée")
    : (media === "mic" ? "Micro réactivé" : "Caméra réactivée"));
};

/**
 * Quitter la réunion (avec confirmation)
 * Note: la version sans confirm est définie plus haut et appelée par endMeetingForEveryone.
 * Cette version demande confirmation pour le bouton "quitter".
 */
Meetings.prototype.leaveMeetingWithConfirm = async function() {
  if (await this.confirmMeetingAction("Quitter la r\u00e9union", "Voulez-vous vraiment quitter la r\u00e9union ?")) {
    this.leaveMeeting();
  }
};

Meetings.prototype.updateMeetingParticipantCount = function() {
  const el = document.getElementById("participant-count");
  if (!el) return;
  const roster = this.groupRoster || [];
  const count = roster.filter(r => r && r.state === "JOINED").length || 1;
  el.textContent = String(count);
};

/**
 * Ouvrir le panel participants
 */
window.showMeetingParticipants = function() {
  if (window.callManager && window.meetingParticipants) {
    const meetingId = window.callManager.currentMeetingId;
    const roomId = window.callManager.groupRoomId;
    const isHost = !!window.callManager.isMeetingHost;
    window.meetingParticipants.show(meetingId, roomId, isHost);
  }
};

/**
 * Ouvrir le panel chat
 */
window.showMeetingChat = function() {
  if (window.callManager && window.meetingChat) {
    const meetingId = window.callManager.currentMeetingId;
    const roomId = window.callManager.groupRoomId;
    window.meetingChat.show(meetingId, roomId);
  }
};

Meetings.prototype.handleMeetingCancelled = function(data) {
  console.log("📅 [MEETING] Réunion annulée:", data.meetingId);
  this.showCallToast("Réunion annulée");
  this.closeMeetingCreatedView();
};

Meetings.prototype.handleMeetingList = function(data) {
  console.log("📅 [MEETING] Liste reçue:", data.upcoming.length, "à venir,", data.past.length, "passées");
  this.showMeetingListView(data);
};

Meetings.prototype.handleMeetingEnded = function(data) {
  console.log("📅 [MEETING] Réunion terminée:", data.meetingId, "raison:", data.reason);
  this.showCallToast(data.reason || "La réunion est terminée");
  // Purge musique d'attente + compte à rebours + salle d'attente
  this._broadcastWaitingMusicStop();
  this.closeMeetingWaitingView();
  this.closeMeetingCreatedView();
  // endGroupCall : leave signal + peers + médias + écran + panneaux
  this.endGroupCall(undefined);
  this.isMeetingHost = false;
  this.meetingCreatedBy = null;
  this.meetingWaitingRoomId = null;
  this.meetingApprovalPending = false;
};

// ===== UI LISTE DES RÉUNIONS =====

Meetings.prototype.showMeetingListView = function(data) {
  if (this.meetingListView) {
    this.meetingListView.classList.add("active");
    this._renderMeetingList(data);
    return;
  }

  const html = `
    <div class="view-container meeting-list-view" id="meeting-list-view">
      <div class="app-container">
        <div class="header">
          <button class="icon-btn-top" onclick="window.closeMeetingListView()">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <div class="contact-info">
            <div class="contact-name">Mes réunions</div>
          </div>
          <button class="icon-btn-top" onclick="window.createMeetingFromList()">
            <i class="fa-solid fa-plus"></i>
          </button>
        </div>

        <div style="flex: 1; width: 100%; overflow-y: auto; padding: 0 16px;">
          <div id="meeting-list-content"></div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", html);
  this.meetingListView = document.getElementById("meeting-list-view");
  this.meetingListView.classList.add("active");

  this._renderMeetingList(data);
};

Meetings.prototype._renderMeetingList = function(data) {
  const content = document.getElementById("meeting-list-content");
  if (!content) return;

  let html = "";

  // Réunions à venir
  if (data.upcoming && data.upcoming.length > 0) {
    html += `<div style="margin-top: 16px;">
      <div style="color: #8696a0; font-size: 13px; margin-bottom: 12px; padding-left: 8px;">À venir</div>`;

    data.upcoming.forEach(meeting => {
      const date = new Date(meeting.scheduledAt);
      const dateStr = date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
      const timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

      html += `
        <div style="background: #222d34; border-radius: 12px; padding: 16px; margin-bottom: 12px; cursor: pointer;"
             data-action="details" data-meeting-id="${window.escapeHtml(meeting.id)}">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <div style="flex: 1;">
              <div style="font-size: 16px; font-weight: 500; color: white; margin-bottom: 4px;">${window.escapeHtml(meeting.title || "R\u00e9union sans titre")}</div>
              <div style="font-size: 13px; color: #8696a0;">${dateStr} à ${timeStr}</div>
            </div>
            <div style="background: ${meeting.isVideo ? '#00a884' : '#374045'}; padding: 4px 8px; border-radius: 6px; font-size: 11px; color: white;">
              ${meeting.isVideo ? 'Vidéo' : 'Audio'}
            </div>
          </div>
          <div style="display: flex; gap: 8px; margin-top: 12px;">
            <button data-action="start" data-meeting-code="${window.escapeHtml(meeting.code)}"
                    style="flex: 1; padding: 10px; background: #00a884; border: none; border-radius: 8px; color: white; font-size: 14px; cursor: pointer;">
              Démarrer
            </button>
            <button data-action="copy" data-meeting-code="${window.escapeHtml(meeting.code)}" aria-label="Copier le code"
                    style="padding: 10px 16px; background: #374045; border: none; border-radius: 8px; color: white; font-size: 14px; cursor: pointer;">
              <i class="fa-solid fa-copy"></i>
            </button>
          </div>
        </div>
      `;
    });

    html += `</div>`;
  }

  // Réunions passées
  if (data.past && data.past.length > 0) {
    html += `<div style="margin-top: 16px;">
      <div style="color: #8696a0; font-size: 13px; margin-bottom: 12px; padding-left: 8px;">Passées</div>`;

    data.past.forEach(meeting => {
      const date = new Date(meeting.scheduledAt);
      const dateStr = date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
      const timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

      const statusColors = {
        ended: '#8696a0',
        cancelled: '#ef5350'
      };
      const statusLabels = {
        ended: 'Terminée',
        cancelled: 'Annulée'
      };

      html += `
        <div style="background: #1f2c33; border-radius: 12px; padding: 16px; margin-bottom: 12px; opacity: 0.7;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <div style="flex: 1;">
              <div style="font-size: 16px; font-weight: 500; color: white; margin-bottom: 4px;">${window.escapeHtml(meeting.title || "R\u00e9union sans titre")}</div>
              <div style="font-size: 13px; color: #8696a0;">${dateStr} à ${timeStr}</div>
            </div>
            <div style="background: ${statusColors[meeting.status] || '#374045'}; padding: 4px 8px; border-radius: 6px; font-size: 11px; color: white;">
              ${window.escapeHtml(statusLabels[meeting.status] || meeting.status || "\u00c9tat inconnu")}
            </div>
          </div>
        </div>
      `;
    });

    html += `</div>`;
  }

  // Liste vide
  if (!data.upcoming || data.upcoming.length === 0) {
    html += `
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 40px 16px;">
        <i class="fa-solid fa-calendar-plus" style="font-size: 48px; color: #374045;"></i>
        <div style="text-align: center; color: #8696a0; font-size: 14px;">
          Aucune réunion à venir
        </div>
        <button onclick="window.createMeetingFromList()"
                style="padding: 12px 24px; background: #00a884; border: none; border-radius: 20px; color: white; font-size: 15px; cursor: pointer;">
          Créer une réunion
        </button>
      </div>
    `;
  }

  content.innerHTML = html;
  content.onclick = (event) => {
    const button = event.target.closest("[data-action]"); if (!button) return;
    const action = button.dataset.action;
    if (action === "details") this.openMeetingDetails(button.dataset.meetingId);
    if (action === "start") this.startMeetingFromList(button.dataset.meetingCode);
    if (action === "copy") this.copyMeetingText(button.dataset.meetingCode, "Code");
  };
};

Meetings.prototype.closeMeetingListView = function() {
  if (this.meetingListView) {
    this.meetingListView.classList.remove("active");
    setTimeout(() => {
      if (this.meetingListView) {
        this.meetingListView.remove();
        this.meetingListView = null;
      }
    }, 300);
  }
};

Meetings.prototype.createMeetingFromList = function() {
  this.closeMeetingListView();
  this.showMeetingCreateView();
};

Meetings.prototype.startMeetingFromList = function(code) {
  this.closeMeetingListView();
  this.startMeeting(code);
};

Meetings.prototype.openMeetingDetails = function(meetingId) {
  // Ouvrir l'écran de modification
  this.showMeetingCreateView(meetingId);
};

// ===== MÉTHODES DE RÉUNION =====

Meetings.prototype.createMeeting = function(title, scheduledAt, durationMin, isVideo, participants, description = "", accessPolicy = "direct", waitingMusicTracks = []) {
  console.log("📅 [MEETING] createMeeting appelé - wsReadyState:", this.wsReadyState, "wsId:", this.wsId);

  // Pour Cordova : utiliser wsReadyState, pour navigateur : utiliser ws.readyState
  const isConnected = this.wsReadyState === WebSocket.OPEN || (this.ws && this.ws.readyState === WebSocket.OPEN);

  if (!isConnected) {
    if (this.meetingConnectionRetryPending) return;
    this.meetingConnectionRetryPending = true;
    this.showCallToast("Connexion au serveur…");
    console.log("📅 [MEETING] WebSocket non connecté, tentative de connexion...");
    this.connectWebSocket();

    const deadline = Date.now() + 20000;
    const retryCreate = () => {
      const nowConnected = this.wsReadyState === WebSocket.OPEN || (this.ws && this.ws.readyState === WebSocket.OPEN);
      if (nowConnected) {
        this.meetingConnectionRetryPending = false;
        this.createMeeting(title, scheduledAt, durationMin, isVideo, participants, description, accessPolicy, waitingMusicTracks);
      } else if (Date.now() < deadline) {
        setTimeout(retryCreate, 200);
      } else {
        this.meetingConnectionRetryPending = false;
        console.error("📅 [MEETING] WebSocket toujours non connecté après tentative");
        this.showCallToast("Connexion au serveur impossible. Réessayez.");
      }
    };
    setTimeout(retryCreate, 150);
    return;
  }

  if (!this.myId) {
    this.showCallToast("ID utilisateur requis - veuillez patienter");
    return;
  }

  const scheduledAtTimestamp = new Date(scheduledAt).getTime();
  if (isNaN(scheduledAtTimestamp) || scheduledAtTimestamp <= Date.now()) {
    this.showCallToast("Date invalide (doit être dans le futur)");
    return;
  }

  this.sendSignal({
    type: "meeting-create",
    title,
    description,
    scheduledAt: scheduledAtTimestamp,
    durationMin: parseInt(durationMin),
    isVideo: !!isVideo,
    participants: participants || [],
    accessPolicy: accessPolicy || "direct",
    waitingMusicTracks,
  });

  clearTimeout(this.meetingCreateTimeout);
  this.meetingCreateTimeout = setTimeout(() => {
    this.meetingCreateTimeout = null;
    this.meetingCreateSubmitting = false;
    this.instantMeetingPending = false;
    const connected = this.wsReadyState === WebSocket.OPEN || (this.ws && this.ws.readyState === WebSocket.OPEN);
    this.showCallToast(connected
      ? "Aucune réponse du serveur. Vérifie ta connexion puis réessaie."
      : "Connexion au serveur interrompue. Vérifie ta connexion puis réessaie.");
  }, 20000);

  console.log("📅 [MEETING] Demande de création de réunion envoyée avec politique:", accessPolicy);
};

Meetings.prototype.joinMeeting = function(code) {
  console.log("📅 [MEETING] joinMeeting appelé - wsReadyState:", this.wsReadyState, "wsId:", this.wsId);

  const normalizedCode = this.normalizeMeetingCode(code);
  if (!normalizedCode) {
    this.showCallToast("Code requis");
    return;
  }

  // Stocker le code pour les réessais
  this.meetingPendingCode = normalizedCode;

  // Pour Cordova : utiliser wsReadyState, pour navigateur : utiliser ws.readyState
  const isConnected = this.wsReadyState === WebSocket.OPEN || (this.ws && this.ws.readyState === WebSocket.OPEN);

  if (!isConnected) {
    // Tenter de connecter automatiquement
    this.showCallToast("Connexion en cours...");
    console.log("📅 [MEETING] WebSocket non connecté, tentative de connexion...");

    this.connectWebSocket().then(() => {
      console.log("📅 [MEETING] Connexion terminée, nouvel état wsReadyState:", this.wsReadyState);

      // Attendre un peu pour s'assurer que la connexion est stable
      setTimeout(() => {
        const nowConnected = this.wsReadyState === WebSocket.OPEN || (this.ws && this.ws.readyState === WebSocket.OPEN);
        if (nowConnected) {
          console.log("📅 [MEETING] WebSocket maintenant connecté, tentative de rejoindre");
          this.joinMeeting(this.meetingPendingCode);
        } else {
          console.error("📅 [MEETING] WebSocket toujours non connecté après tentative");
          this.showCallToast("Impossible de se connecter au serveur (timeout)");
        }
      }, 1000);
    });

    return;
  }

  if (!this.myId) {
    this.showCallToast("ID utilisateur requis - veuillez patienter");
    return;
  }

  this.sendSignal({
    type: "meeting-join",
    code: this.meetingPendingCode,
  });

  console.log("📅 [MEETING] Demande de rejoindre réunion envoyée pour code:", this.meetingPendingCode);
};

Meetings.prototype.listMeetings = function() {
  const isConnected = this.wsReadyState === WebSocket.OPEN || (this.ws && this.ws.readyState === WebSocket.OPEN);
  if (!isConnected) {
    this.showCallToast("Connexion requise");
    return;
  }

  this.sendSignal({
    type: "meeting-list",
  });

  console.log("📅 [MEETING] Demande de liste de réunions envoyée");
};

// ===== UI RÉUNIONS =====

Meetings.prototype.showMeetingCreateView = function(editMeetingId = null) {
  this.editingMeetingId = editMeetingId;

  if (this.meetingCreateView) {
    this.meetingCreateView.classList.add("active");
    if (editMeetingId) {
      this.loadMeetingForEdit(editMeetingId);
    }
    return;
  }

  const html = `
    <div class="view-container meeting-create-view" id="meeting-create-view">
      <div class="app-container">
        <div class="header">
          <button class="icon-btn-top" onclick="window.closeMeetingCreateView()">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <div class="contact-info">
            <div class="contact-name">${editMeetingId ? 'Modifier la réunion' : 'Programmer une réunion'}</div>
          </div>
          <div style="width: 40px;"></div>
        </div>

        <div style="flex: 1; width: 100%; display: flex; flex-direction: column; gap: 20px; padding: 0 16px; overflow-y: auto;">
          <div>
            <label style="color: #8696a0; font-size: 13px; margin-bottom: 8px; display: block;">Titre *</label>
            <input type="text" id="meeting-title" placeholder="Ex: Réunion d'équipe" maxlength="100"
                   style="width: 100%; padding: 12px; background: #222d34; border: 1px solid #374045;
                          border-radius: 8px; color: white; font-size: 15px; outline: none;">
          </div>

          <div>
            <label style="color: #8696a0; font-size: 13px; margin-bottom: 8px; display: block;">Description (optionnel)</label>
            <textarea id="meeting-description" placeholder="Ajoutez une description..."
                      style="width: 100%; padding: 12px; background: #222d34; border: 1px solid #374045;
                             border-radius: 8px; color: white; font-size: 15px; outline: none; resize: vertical; min-height: 80px;"></textarea>
          </div>

          <div>
            <label style="color: #8696a0; font-size: 13px; margin-bottom: 8px; display: block;">Mode de réunion</label>
            <div style="display: flex; gap: 10px;">
              <button id="meeting-mode-scheduled" class="meeting-type-btn active" onclick="window.selectMeetingMode('scheduled')">
                <i class="fa-solid fa-calendar"></i>
                <span>Planifiée</span>
              </button>
              <button id="meeting-mode-instant" class="meeting-type-btn" onclick="window.selectMeetingMode('instant')">
                <i class="fa-solid fa-bolt"></i>
                <span>Immédiate</span>
              </button>
            </div>
          </div>

          <div>
            <label style="color: #8696a0; font-size: 13px; margin-bottom: 8px; display: block;">Politique d'accès</label>
            <div style="display: flex; gap: 10px;">
              <button id="access-direct" class="meeting-type-btn active" onclick="window.selectAccessPolicy('direct')">
                <i class="fa-solid fa-unlock"></i>
                <span>Direct</span>
              </button>
              <button id="access-approval" class="meeting-type-btn" onclick="window.selectAccessPolicy('approval')">
                <i class="fa-solid fa-user-shield"></i>
                <span>Approbation</span>
              </button>
            </div>
          </div>

          <div id="datetime-container">
            <label style="color: #8696a0; font-size: 13px; margin-bottom: 8px; display: block;">Date et heure *</label>
            <input type="datetime-local" id="meeting-datetime"
                   style="width: 100%; padding: 12px; background: #222d34; border: 1px solid #374045;
                          border-radius: 8px; color: white; font-size: 15px; outline: none;">
          </div>

          <div>
            <label style="color: #8696a0; font-size: 13px; margin-bottom: 8px; display: block;">Durée (minutes) *</label>
            <select id="meeting-duration"
                    style="width: 100%; padding: 12px; background: #222d34; border: 1px solid #374045;
                           border-radius: 8px; color: white; font-size: 15px; outline: none; cursor: pointer;">
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="45">45 minutes</option>
              <option value="60" selected>1 heure</option>
              <option value="90">1 heure 30</option>
              <option value="120">2 heures</option>
              <option value="180">3 heures</option>
              <option value="240">4 heures</option>
              <option value="480">8 heures</option>
            </select>
          </div>

          ${editMeetingId ? '' : `<div class="scheduled-waiting-music-picker">
            <label style="color:#8696a0;font-size:13px;margin-bottom:8px;display:block;">Musique pendant l’attente (optionnel)</label>
            <label class="waiting-music-choose" for="meeting-scheduled-music-files">Choisir un morceau ou une liste</label>
            <input id="meeting-scheduled-music-files" type="file" accept="audio/*" multiple hidden>
            <div id="meeting-scheduled-music-names" style="color:#8696a0;font-size:12px;margin-top:8px;">Aucun morceau sélectionné</div>
          </div>`}

          <div>
            <label style="color: #8696a0; font-size: 13px; margin-bottom: 8px; display: block;">Type</label>
            <div style="display: flex; gap: 10px;">
              <button id="meeting-type-audio" class="meeting-type-btn" onclick="window.selectMeetingType('audio')">
                <i class="fa-solid fa-phone"></i>
                <span>Audio</span>
              </button>
              <button id="meeting-type-video" class="meeting-type-btn active" onclick="window.selectMeetingType('video')">
                <i class="fa-solid fa-video"></i>
                <span>Vidéo</span>
              </button>
            </div>
          </div>

          <div id="edit-actions" style="display: none; gap: 8px;">
            <button onclick="window.cancelMeeting()"
                    style="flex: 1; padding: 12px; background: #ef5350; border: none; border-radius: 20px;
                           color: white; font-size: 15px; font-weight: 500; cursor: pointer;">
              Annuler la réunion
            </button>
          </div>
        </div>

        <div style="width: 100%; padding: 0 16px;">
          <button onclick="window.confirmCreateMeeting()"
                  style="width: 100%; padding: 14px; background: #00a884; border: none; border-radius: 24px;
                         color: white; font-size: 16px; font-weight: 500; cursor: pointer;">
            ${editMeetingId ? 'Enregistrer les modifications' : 'Créer la réunion'}
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", html);
  this.meetingCreateView = document.getElementById("meeting-create-view");
  this.meetingCreateView.classList.add("active");
  const musicInput = document.getElementById("meeting-scheduled-music-files");
  this.scheduledMusicFiles = [];
  if (musicInput) musicInput.addEventListener("change", () => {
    const selectedFiles = Array.from(musicInput.files || []);
    const existingFiles = this.scheduledMusicFiles || [];
    this.scheduledMusicFiles = [...existingFiles, ...selectedFiles.filter((file) => !existingFiles.some((existing) => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified))];
    const names = document.getElementById("meeting-scheduled-music-names");
    if (names) names.textContent = this.scheduledMusicFiles.length ? this.scheduledMusicFiles.map((file) => file.name).join(" • ") : "Aucun morceau sélectionné";
    musicInput.value = "";
  });

  // Date par défaut (demain à 9h)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  tomorrow.setMinutes(tomorrow.getMinutes() - tomorrow.getTimezoneOffset());
  document.getElementById("meeting-datetime").value = tomorrow.toISOString().slice(0, 16);

  // Charger si édition
  if (editMeetingId) {
    this.loadMeetingForEdit(editMeetingId);
  }
};

Meetings.prototype.loadMeetingForEdit = async function(meetingId) {
  try {
    if (window.meetingService) {
      const meeting = await meetingService.loadMeetingById(meetingId);

      document.getElementById("meeting-title").value = meeting.title || "";
      document.getElementById("meeting-description").value = meeting.description || "";

      const date = new Date(meeting.scheduledAt);
      date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
      document.getElementById("meeting-datetime").value = date.toISOString().slice(0, 16);

      document.getElementById("meeting-duration").value = meeting.durationMin || 60;

      this.selectMeetingType(meeting.isVideo ? "video" : "audio");

      document.getElementById("edit-actions").style.display = "flex";
    }
  } catch (error) {
    console.error("Erreur chargement réunion pour édition:", error);
    this.showCallToast("Erreur lors du chargement");
  }
};

Meetings.prototype.closeMeetingCreateView = function() {
  if (this.meetingCreateView) {
    this.meetingCreateView.classList.remove("active");
    setTimeout(() => {
      if (this.meetingCreateView) {
        this.meetingCreateView.remove();
        this.meetingCreateView = null;
      }
    }, 300);
  }
};

Meetings.prototype.selectMeetingType = function(type) {
  const audioBtn = document.getElementById("meeting-type-audio");
  const videoBtn = document.getElementById("meeting-type-video");

  if (type === "audio") {
    audioBtn.classList.add("active");
    videoBtn.classList.remove("active");
  } else {
    videoBtn.classList.add("active");
    audioBtn.classList.remove("active");
  }
};

Meetings.prototype.selectMeetingMode = function(mode) {
  const scheduledBtn = document.getElementById("meeting-mode-scheduled");
  const instantBtn = document.getElementById("meeting-mode-instant");
  const datetimeContainer = document.getElementById("datetime-container");

  if (mode === "scheduled") {
    scheduledBtn.classList.add("active");
    instantBtn.classList.remove("active");
    datetimeContainer.style.display = "block";
  } else {
    instantBtn.classList.add("active");
    scheduledBtn.classList.remove("active");
    datetimeContainer.style.display = "none";
  }
};

Meetings.prototype.selectAccessPolicy = function(policy) {
  const directBtn = document.getElementById("access-direct");
  const approvalBtn = document.getElementById("access-approval");

  if (policy === "direct") {
    directBtn.classList.add("active");
    approvalBtn.classList.remove("active");
  } else {
    approvalBtn.classList.add("active");
    directBtn.classList.remove("active");
  }
};

Meetings.prototype.confirmCreateMeeting = async function() {
  if (this.meetingCreateSubmitting) return;
  const title = document.getElementById("meeting-title").value.trim();
  const description = document.getElementById("meeting-description").value.trim();
  const duration = document.getElementById("meeting-duration").value;
  const isVideo = document.getElementById("meeting-type-video").classList.contains("active");
  const isInstant = document.getElementById("meeting-mode-instant").classList.contains("active");
  const musicFiles = this.scheduledMusicFiles || [];

  if (!title) {
    this.showCallToast("Veuillez entrer un titre");
    return;
  }

  if (!duration || duration < 15 || duration > 480) {
    this.showCallToast("Durée invalide (15-480 minutes)");
    return;
  }

  let scheduledAtTimestamp;
  let datetime;

  if (isInstant) {
    // Réunion immédiate: commencer dans 5 secondes
    scheduledAtTimestamp = Date.now() + 5000;
    datetime = new Date(scheduledAtTimestamp).toISOString();
  } else {
    // Réunion planifiée: date requise
    datetime = document.getElementById("meeting-datetime").value;
    if (!datetime) {
      this.showCallToast("Veuillez sélectionner une date et heure");
      return;
    }

    scheduledAtTimestamp = new Date(datetime).getTime();
    if (isNaN(scheduledAtTimestamp) || scheduledAtTimestamp <= Date.now() + 60000) {
      this.showCallToast("Date invalide (doit être dans le futur, au moins 1 minute)");
      return;
    }
  }

  // Mode édition
  if (this.editingMeetingId) {
    try {
      const updates = {
        title,
        description,
        scheduledAt: scheduledAtTimestamp,
        durationMin: parseInt(duration),
        isVideo,
        userId: this.myId
      };

      await meetingService.updateMeeting(this.editingMeetingId, updates);
      this.showCallToast("Réunion modifiée avec succès");
      this.closeMeetingCreateView();
      this.editingMeetingId = null;
    } catch (error) {
      console.error("Erreur modification réunion:", error);
      this.showCallToast("Erreur lors de la modification");
    }
    return;
  }

  // Récupérer la politique d'accès
  const accessPolicy = document.getElementById("access-approval").classList.contains("active") ? "approval" : "direct";

  if (musicFiles.some((file) => !/^audio\//i.test(file.type))) {
    this.showCallToast("Choisis des fichiers audio valides");
    return;
  }
  this.meetingCreateSubmitting = true;
  let waitingMusicTracks;
  try {
    waitingMusicTracks = await Promise.all(musicFiles.map((file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ dataUrl: reader.result, name: file.name });
      reader.onerror = reject;
      reader.readAsDataURL(file);
    })));
  } catch (error) {
    this.meetingCreateSubmitting = false;
    console.error("Erreur lecture de la musique d’attente:", error);
    this.showCallToast("Impossible de lire un des fichiers audio");
    return;
  }
  this.waitingMusicTracks = waitingMusicTracks;
  this.waitingMusicTrackIndex = 0;
  this.waitingMusicDataUrl = waitingMusicTracks[0]?.dataUrl || null;
  this.waitingMusicTitle = waitingMusicTracks.map((track) => track.name).join(" • ");

  // Mode création
  this.createMeeting(title, datetime, duration, isVideo, [], description, accessPolicy, waitingMusicTracks);
};

Meetings.prototype.cancelMeeting = async function() {
  if (!this.editingMeetingId) return;

  if (await this.confirmMeetingAction("Annuler la r\u00e9union", "\u00cates-vous s\u00fbr de vouloir annuler cette r\u00e9union ?")) {
    try {
      const isConnected = this.wsReadyState === WebSocket.OPEN || (this.ws && this.ws.readyState === WebSocket.OPEN);
      if (!isConnected) {
        this.showCallToast("Connexion requise");
        return;
      }
      this.sendSignal({ type: "meeting-cancel", meetingId: this.editingMeetingId });
      this.showCallToast("Réunion annulée");
      this.closeMeetingCreateView();
      this.editingMeetingId = null;

      // Rafraîchir la liste si affichée
      if (this.meetingListView) {
        this.listMeetings();
      }
    } catch (error) {
      console.error("Erreur annulation réunion:", error);
      this.showCallToast("Erreur lors de l'annulation");
    }
  }
};

Meetings.prototype.showMeetingCreatedView = function(data) {
  if (this.meetingCreatedView) {
    this.meetingCreatedView.classList.add("active");
    return;
  }

  const html = `
    <div class="view-container meeting-created-view" id="meeting-created-view">
      <div class="app-container">
        <div class="header">
          <button class="icon-btn-top" onclick="window.closeMeetingCreatedView()">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <div class="contact-info">
            <div class="contact-name">Réunion créée</div>
          </div>
          <div style="width: 40px;"></div>
        </div>

        <div style="flex: 1; width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 15px; padding: 0 16px; overflow-y: auto;">
          <div style="width: 80px; height: 80px; border-radius: 50%; background: linear-gradient(145deg, #00a884, #008f6f);
                     display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
            <i class="fa-solid fa-calendar-check" style="font-size: 35px; color: white;"></i>
          </div>

          <div style="text-align: center;">
            <div style="font-size: 18px; font-weight: 500; color: white; margin-bottom: 4px;">${window.escapeHtml(data.title || "R\u00e9union sans titre")}</div>
            <div style="font-size: 12px; color: #8696a0;">
              ${new Date(data.scheduledAt).toLocaleString('fr-FR', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </div>
            <div style="font-size: 12px; color: #8696a0; margin-top: 2px;">
              Durée: ${data.durationMin} min • ${data.isVideo ? 'Vidéo' : 'Audio'}
            </div>
          </div>

          <div style="background: #222d34; padding: 12px; border-radius: 10px; width: 100%; text-align: center;">
            <div style="font-size: 11px; color: #8696a0; margin-bottom: 6px;">Code de la réunion</div>
            <div style="font-size: 22px; font-weight: 600; color: #00a884; letter-spacing: 2px; margin-bottom: 8px;">
              ${window.escapeHtml(data.code || "") }
            </div>
            <button data-created-action="copy-code"
                    style="padding: 8px 16px; background: #374045; border: none; border-radius: 16px;
                           color: white; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
              <i class="fa-solid fa-copy"></i>
              Copier
            </button>
          </div>

          <div style="background: #222d34; padding: 12px; border-radius: 10px; width: 100%; text-align: center;">
            <div style="font-size: 11px; color: #8696a0; margin-bottom: 6px;">Lien de partage</div>
            <div style="font-size: 12px; color: white; word-break: break-all; margin-bottom: 8px; padding: 6px; background: #1f2c33; border-radius: 6px;">
              ${window.escapeHtml(data.link || "")}
            </div>
            <button data-created-action="copy-link"
                    style="padding: 8px 16px; background: #374045; border: none; border-radius: 16px;
                           color: white; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
              <i class="fa-solid fa-copy"></i>
              Copier
            </button>
          </div>

          <div style="width: 100%; display: flex; flex-direction: column; gap: 8px;">
            <button data-created-action="start"
                    style="width: 100%; padding: 12px; background: #00a884; border: none; border-radius: 20px;
                           color: white; font-size: 15px; font-weight: 500; cursor: pointer; display: flex;
                           align-items: center; justify-content: center; gap: 8px;">
              <i class="fa-solid fa-play"></i>
              Démarrer maintenant
            </button>
            <button data-created-action="share"
                    style="width: 100%; padding: 12px; background: #374045; border: none; border-radius: 20px;
                           color: white; font-size: 15px; font-weight: 500; cursor: pointer; display: flex;
                           align-items: center; justify-content: center; gap: 8px;">
              <i class="fa-solid fa-share-nodes"></i>
              Partager
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", html);
  this.meetingCreatedView = document.getElementById("meeting-created-view");
  this.meetingCreatedView.addEventListener("click", (event) => {
    const action = event.target.closest("[data-created-action]")?.dataset.createdAction;
    if (action === "copy-code") this.copyMeetingCode(data.code);
    if (action === "copy-link") this.copyMeetingText(data.link, "Lien");
    if (action === "start") this.startMeeting(data.code);
    if (action === "share") this.shareMeetingLink(data.link);
  });
  this.meetingCreatedView.classList.add("active");
};

Meetings.prototype.closeMeetingCreatedView = function() {
  if (this.meetingCreatedView) {
    this.meetingCreatedView.classList.remove("active");
    setTimeout(() => {
      if (this.meetingCreatedView) {
        this.meetingCreatedView.remove();
        this.meetingCreatedView = null;
      }
    }, 300);
  }
};

Meetings.prototype.copyMeetingCode = function(code) {
  if (!code) {
    this.showCallToast("Code indisponible");
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(
      () => this.showCallToast("Code copié: " + code),
      () => this.showCallToast("Échec de la copie")
    );
  } else {
    this.copyMeetingText(code, "Code");
  }
};

Meetings.prototype.shareMeetingLink = function(link) {
  if (navigator.share) {
    navigator.share({
      title: "Rejoindre ma réunion",
      text: "Rejoins ma réunion via ce lien :",
      url: link,
    }).catch((err) => console.log("Share error:", err));
  } else if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(
      () => this.showCallToast("Lien copié"),
      () => this.showCallToast("Échec de la copie")
    );
  } else {
    this.copyMeetingText(link, "Lien");
  }
};

// ===== RÉUNION INSTANTANÉE (équivalent de "Nouvelle réunion" dans Google Meet) =====
Meetings.prototype.startInstantMeeting = function() {
  if (this.instantMeetingPending) return; // anti double-clic
  this.instantMeetingPending = true;
  setTimeout(() => { this.instantMeetingPending = false; }, 25000); // sécurité si la création échoue

  this.createMeeting(
    "Réunion de " + (this.myId || "moi"),
    new Date(Date.now() + 3000).toISOString(), // démarre dans 3 s
    480,       // durée max autorisée par le serveur
    true,      // vidéo
    [],        // pas d'invités : on partage le code
    "",
    "direct"   // entrée libre avec le code
  );
};

Meetings.prototype.startMeetingFromCreated = function(code) {
  this.closeMeetingCreatedView();
  this.startMeeting(code);
};

Meetings.prototype.startMeeting = function(code) {
  console.log("📅 [MEETING] startMeeting appelé pour code:", code);

  const cleanCode = this.normalizeMeetingCode(code);
  if (!cleanCode) {
    this.showCallToast("Code requis");
    return;
  }

  const isConnected = this.wsReadyState === WebSocket.OPEN || (this.ws && this.ws.readyState === WebSocket.OPEN);
  if (!isConnected) {
    this.showCallToast("Connexion requise");
    return;
  }

  // On marque immédiatement la réunion comme live côté client pour empêcher toute
  // rebasculer automatiquement en 1-à-1 tant que la confirmation serveur n'est pas revenue.
  this.groupIsMeeting = true;
  this.waitingMusicStoppedForMeeting = true;
  this.stopWaitingMusicLocally();
  this.groupDowngradingToOneToOne = false;
  this.meetingPendingCode = cleanCode;
  this.sendSignal({
    type: "meeting-force-start",
    code: cleanCode,
  });

  console.log("📅 [MEETING] Demande de démarrage forcé pour:", cleanCode);
};

Meetings.prototype.showMeetingJoinView = function(prefillCode) {
  if (this.meetingJoinView) {
    this.meetingJoinView.classList.add("active");
    if (prefillCode) {
      const input = document.getElementById("meeting-code-input");
      if (input) input.value = prefillCode;
    }
    return;
  }

  const html = `
    <div class="view-container meeting-join-view" id="meeting-join-view">
      <div class="app-container">
        <div class="header">
          <button class="icon-btn-top" onclick="window.closeMeetingJoinView()">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <div class="contact-info">
            <div class="contact-name">Rejoindre une réunion</div>
          </div>
          <div style="width: 40px;"></div>
        </div>

        <div style="flex: 1; width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px; padding: 0 16px;">
          <div style="width: 120px; height: 120px; border-radius: 50%; background: linear-gradient(145deg, #2a3942, #1f2c33);
                     display: flex; align-items: center; justify-content: center;">
            <i class="fa-solid fa-key" style="font-size: 50px; color: #8696a0;"></i>
          </div>

          <div style="width: 100%;">
            <label style="color: #8696a0; font-size: 13px; margin-bottom: 8px; display: block;">Code de la réunion</label>
            <input type="text" id="meeting-code-input" placeholder="ABC-123-XYZ" maxlength="11"
                   style="width: 100%; padding: 16px; background: #222d34; border: 1px solid #374045;
                          border-radius: 12px; color: white; font-size: 20px; font-weight: 500; text-align: center;
                          letter-spacing: 2px; text-transform: uppercase; outline: none;"
                   oninput="this.value = this.value.toUpperCase().replace(/[^A-Z0-9-]/g, '')"
                   value="${window.escapeHtml(prefillCode || '')}">
          </div>

          <div style="width: 100%;">
            <button onclick="window.confirmJoinMeeting()"
                    style="width: 100%; padding: 14px; background: #00a884; border: none; border-radius: 24px;
                           color: white; font-size: 16px; font-weight: 500; cursor: pointer;">
              Rejoindre
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", html);
  this.meetingJoinView = document.getElementById("meeting-join-view");
  this.meetingJoinView.classList.add("active");

  setTimeout(() => {
    const input = document.getElementById("meeting-code-input");
    if (input) input.focus();
  }, 100);
};

Meetings.prototype.closeMeetingJoinView = function() {
  if (this.meetingJoinView) {
    this.meetingJoinView.classList.remove("active");
    setTimeout(() => {
      if (this.meetingJoinView) {
        this.meetingJoinView.remove();
        this.meetingJoinView = null;
      }
    }, 300);
  }
};

// ===== ÉCRAN DE PRÉVISUALISATION (NOUVEAU) =====

Meetings.prototype.showMeetingPreviewView = async function(code, meetingIsVideo) {
  if (this.meetingPreviewView) {
    this.meetingPreviewView.classList.add("active");
    return;
  }
  this.previewMeetingIsVideo = typeof meetingIsVideo === "boolean" ? meetingIsVideo : null;

  // Initialiser l'adaptateur média
  if (window.meetingMediaAdapter && window.callManager) {
    meetingMediaAdapter.initialize(window.callManager);
  }

  const html = `
    <div class="view-container meeting-preview-view" id="meeting-preview-view">
      <div class="app-container">
        <div class="header">
          <button class="icon-btn-top" onclick="window.closeMeetingPreviewView()">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <div class="contact-info">
            <div class="contact-name">Prévisualisation</div>
          </div>
          <div style="width: 40px;"></div>
        </div>

        <div class="preview-container">
          <div class="meeting-preview-info">
            <h2 id="preview-meeting-title">Chargement...</h2>
            <div class="organizer" id="preview-meeting-organizer">
              <i class="fa-solid fa-user"></i>
              <span>Organisateur: --</span>
            </div>
          </div>

          <div class="preview-video" id="preview-video-container">
            <video id="preview-video" autoplay muted playsinline></video>
            <div class="avatar" id="preview-avatar" style="display: none;">
              <i class="fa-solid fa-user"></i>
            </div>
          </div>

          <div class="preview-controls">
            <button class="preview-control-btn active" id="preview-mic-btn" onclick="window.togglePreviewMic()">
              <i class="fa-solid fa-microphone"></i>
            </button>
            <button class="preview-control-btn active" id="preview-cam-btn" onclick="window.togglePreviewCam()">
              <i class="fa-solid fa-video"></i>
            </button>
          </div>

          <div class="device-selector" id="camera-selector-container" style="display: none;">
            <label style="color: #8696a0; font-size: 13px; margin-bottom: 8px; display: block;">Caméra</label>
            <select id="camera-select" onchange="window.selectCamera(this.value)">
              <option value="">Caméra par défaut</option>
            </select>
          </div>

          <div class="device-selector" id="mic-selector-container" style="display: none;">
            <label style="color: #8696a0; font-size: 13px; margin-bottom: 8px; display: block;">Microphone</label>
            <select id="mic-select" onchange="window.selectMicrophone(this.value)">
              <option value="">Microphone par défaut</option>
            </select>
          </div>
          <div class="meeting-code-card">
            <div>
              <span>Code de la réunion</span>
              <strong>${window.escapeHtml(code)}</strong>
            </div>
            <button class="meeting-code-copy" data-action="copy-meeting-code" aria-label="Copier le code de la réunion">
              <i class="fa-solid fa-copy"></i>
            </button>
          </div>
        </div>
        <button class="join-button" id="join-meeting-btn" data-action="join-meeting-code">
          Rejoindre la réunion
        </button>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", html);
  this.meetingPreviewView = document.getElementById("meeting-preview-view");
  this.meetingPreviewView.classList.add("active");
  document.body.classList.add("meeting-ui-active");
  this.meetingPreviewView.addEventListener("click", (event) => {
    if (event.target.closest("[data-action=copy-meeting-code]")) this.copyMeetingText(code, "Code");
    if (event.target.closest("[data-action=join-meeting-code]")) this.confirmJoinMeetingFromPreview(code);
  });

  // Afficher la prévisualisation sans attendre la requête réseau des détails.
  this.previewMicEnabled = true;
  this.previewCamEnabled = true;
  this.previewStream = null;
  this.startPreview().then(() => this.loadPreviewDevices());

  // Charger les infos de la réunion
  try {
    if (window.meetingService) {
      const meeting = await meetingService.loadMeetingByCode(code);
      if (typeof meetingIsVideo !== "boolean" && typeof meeting?.isVideo === "boolean") {
        this.previewMeetingIsVideo = meeting.isVideo;
      }
      const titleEl = document.getElementById("preview-meeting-title");
      const orgEl = document.getElementById("preview-meeting-organizer");
      if (titleEl) titleEl.textContent = (meeting && meeting.title) || "Réunion";
      if (orgEl) orgEl.innerHTML = `
        <i class="fa-solid fa-user"></i>
        <span>Organisateur: ${window.escapeHtml((meeting && meeting.createdBy) || "Inconnu")}</span>
      `;
    }
  } catch (error) {
    console.error("Erreur chargement réunion:", error);
  }

};

Meetings.prototype.closeMeetingPreviewView = function() {
  this.stopPreview();
  document.body.classList.remove("meeting-ui-active");

  if (this.meetingPreviewView) {
    this.meetingPreviewView.classList.remove("active");
    setTimeout(() => {
      if (this.meetingPreviewView) {
        this.meetingPreviewView.remove();
        this.meetingPreviewView = null;
      }
    }, 300);
  }
};

Meetings.prototype.loadPreviewDevices = async function() {
  try {
    const devices = await meetingMediaAdapter.getDevices();

    const cameraSelect = document.getElementById("camera-select");
    const micSelect = document.getElementById("mic-select");
    const camContainer = document.getElementById("camera-selector-container");
    const micContainer = document.getElementById("mic-selector-container");

    if (cameraSelect && camContainer && devices.cameras && devices.cameras.length > 1) {
      camContainer.style.display = "block";
      devices.cameras.forEach(device => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent = device.label || `Caméra ${device.deviceId.slice(0, 8)}`;
        cameraSelect.appendChild(option);
      });
    }

    if (micSelect && micContainer && devices.microphones && devices.microphones.length > 1) {
      micContainer.style.display = "block";
      devices.microphones.forEach(device => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent = device.label || `Microphone ${device.deviceId.slice(0, 8)}`;
        micSelect.appendChild(option);
      });
    }
  } catch (error) {
    console.error("Erreur chargement périphériques:", error);
  }
};

Meetings.prototype.startPreview = async function() {
  try {
    this.stopPreview();

    // Sur Android, obtenir les autorisations natives avant l'appel WebRTC évite
    // que la WebView rejette la caméra alors que l'appareil l'a déjà autorisée.
    if (window.cordova && cordova.plugins && cordova.plugins.permissions) {
      const cameraGranted = !this.previewCamEnabled || await this.requestCameraPermission();
      const microphoneGranted = await this.requestMicrophonePermission();
      if (!cameraGranted || !microphoneGranted) {
        throw new Error("Autorisation caméra ou microphone refusée");
      }
    }

    const isVideo = this.previewCamEnabled;
    this.previewStream = await meetingMediaAdapter.preparePreview(isVideo, this.previewMicEnabled);

    const videoElement = document.getElementById("preview-video");
    const avatarElement = document.getElementById("preview-avatar");
    const container = document.getElementById("preview-video-container");
    if (!videoElement || !container) return;

    if (isVideo && this.previewStream && this.previewStream.getVideoTracks().length > 0) {
      videoElement.srcObject = this.previewStream;
      videoElement.style.display = "block";
      if (avatarElement) avatarElement.style.display = "none";
      container.classList.remove("audio-only");
    } else {
      videoElement.style.display = "none";
      if (avatarElement) avatarElement.style.display = "flex";
      container.classList.add("audio-only");
    }
  } catch (error) {
    console.error("Erreur démarrage prévisualisation:", error);
    // Caméra déjà utilisée ailleurs : bascule audio-only sans planter
    const videoElement = document.getElementById("preview-video");
    const avatarElement = document.getElementById("preview-avatar");
    const container = document.getElementById("preview-video-container");
    if (videoElement) videoElement.style.display = "none";
    if (avatarElement) avatarElement.style.display = "flex";
    if (container) container.classList.add("audio-only");
    this.previewCamEnabled = false;
    this.showCallToast("Caméra indisponible — mode audio");
  }
};

Meetings.prototype.stopPreview = function() {
  if (this.previewStream) {
    this.previewStream.getTracks().forEach(track => track.stop());
    this.previewStream = null;
  }
  meetingMediaAdapter.stopPreview();
};

Meetings.prototype.togglePreviewMic = function() {
  this.previewMicEnabled = !this.previewMicEnabled;

  const btn = document.getElementById("preview-mic-btn");
  if (this.previewMicEnabled) {
    btn.classList.remove("inactive");
    btn.classList.add("active");
    btn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
  } else {
    btn.classList.remove("active");
    btn.classList.add("inactive");
    btn.innerHTML = '<i class="fa-solid fa-microphone-slash"></i>';
  }

  const stream = this.previewStream || meetingMediaAdapter.preparedMedia;
  const audioTracks = stream?.getAudioTracks?.() || [];
  audioTracks.forEach(track => { track.enabled = this.previewMicEnabled; });
  if (this.previewMicEnabled && audioTracks.length === 0) this.startPreview();
};

Meetings.prototype.togglePreviewCam = function() {
  this.previewCamEnabled = !this.previewCamEnabled;

  const btn = document.getElementById("preview-cam-btn");
  if (this.previewCamEnabled) {
    btn.classList.remove("inactive");
    btn.classList.add("active");
    btn.innerHTML = '<i class="fa-solid fa-video"></i>';
  } else {
    btn.classList.remove("active");
    btn.classList.add("inactive");
    btn.innerHTML = '<i class="fa-solid fa-video-slash"></i>';
  }

  const videoElement = document.getElementById("preview-video");
  const avatarElement = document.getElementById("preview-avatar");
  const container = document.getElementById("preview-video-container");
  const stream = this.previewStream || meetingMediaAdapter.preparedMedia;
  const videoTracks = stream?.getVideoTracks?.() || [];
  videoTracks.forEach(track => { track.enabled = this.previewCamEnabled; });
  if (videoElement) videoElement.style.display = this.previewCamEnabled && videoTracks.length ? "block" : "none";
  if (avatarElement) avatarElement.style.display = this.previewCamEnabled && videoTracks.length ? "none" : "flex";
  if (container) container.classList.toggle("audio-only", !this.previewCamEnabled || !videoTracks.length);
  if (this.previewCamEnabled && videoTracks.length === 0) this.startPreview();
};

Meetings.prototype.selectCamera = function(deviceId) {
  meetingMediaAdapter.selectCamera(deviceId);
  this.startPreview();
};

Meetings.prototype.selectMicrophone = function(deviceId) {
  meetingMediaAdapter.selectMicrophone(deviceId);
  this.startPreview();
};

Meetings.prototype.confirmJoinMeetingFromPreview = async function(code) {
  const btn = document.getElementById("join-meeting-btn");
  btn.disabled = true;
  btn.textContent = "Connexion...";

  try {
    const meetingIsVideo = this.previewMeetingIsVideo ?? meetingService.currentMeeting?.isVideo ?? this.previewCamEnabled;
    this.pendingMeetingMediaPreferences = {
      microphoneEnabled: this.previewMicEnabled,
      cameraEnabled: meetingIsVideo && this.previewCamEnabled,
    };
    // Rejoindre la réunion
    this.joinMeeting(code);
    this.closeMeetingPreviewView();
  } catch (error) {
    console.error("Erreur rejoindre réunion:", error);
    this.showCallToast("Erreur lors de la connexion");
    btn.disabled = false;
    btn.textContent = "Rejoindre la réunion";
    this.startPreview();
  }
};

Meetings.prototype.confirmJoinMeeting = function() {
  const rawCode = document.getElementById("meeting-code-input").value;
  const code = this.normalizeMeetingCode(rawCode);
  if (!code) {
    this.showCallToast("Veuillez entrer un code");
    return;
  }
  this.closeMeetingJoinView();
  this.showMeetingPreviewView(code);
};

Meetings.prototype.showMeetingWaitingView = function(data) {
  this.meetingPendingCode = data.code;
  this.meetingPendingMeetingId = data.meetingId;
  this.waitingMusicStoppedForMeeting = false;
  const isCreator = data.createdBy === this.myId;
  const escape = window.escapeHtml;
  const meetingTitle = data.title || "Réunion";
  const meetingCode = data.code ? this.normalizeMeetingCode(data.code) : "";
  const scheduledAt = data.startsAt || data.opensAt || data.scheduledAt;
  const scheduledStr = scheduledAt
    ? new Date(scheduledAt).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
    : "Heure de démarrage prévue";

  if (this.meetingWaitingView) {
    this.meetingWaitingView.classList.add("active");
    this._updateMeetingCountdown(data);
    this._updateWaitingRoomStatus();
    return;
  }

  const html = `
    <div class="view-container meeting-waiting-view active" id="meeting-waiting-view">
      <div class="app-container waiting-room-shell">
        <div class="header waiting-room-header">
          <button class="icon-btn-top" onclick="window.closeMeetingWaitingView()" aria-label="Quitter la salle d'attente">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <div class="contact-info">
            <div class="contact-name">${isCreator ? "Vous &ecirc;tes l&rsquo;h&ocirc;te" : "Salle d'attente"}</div>
          </div>
          <span class="waiting-room-conn" id="waiting-room-conn" title="État de la connexion au serveur">
            <span class="conn-dot"></span>
            <span id="waiting-room-conn-text">Connexion…</span>
          </span>
        </div>

        <main class="waiting-room-content${isCreator ? " is-host" : ""}">
          <section class="waiting-room-stage" aria-live="polite">
            <div class="waiting-room-stage-label"><span class="waiting-room-stage-icon"><i class="fa-regular fa-clock"></i></span> ${isCreator ? "R&Eacute;UNION PROGRAMM&Eacute;E" : "&Eacute;CRAN DE L&rsquo;H&Ocirc;TE"}</div>
            <div class="waiting-room-meeting-name" id="waiting-room-meeting-name">${escape(meetingTitle)}</div>
            <div class="waiting-room-code-chip">
              <i class="fa-solid fa-hashtag"></i>
              <span id="waiting-room-code">${escape(meetingCode)}</span>
              <button type="button" class="waiting-room-code-copy" id="waiting-room-code-copy" aria-label="Copier le code de la réunion">
                <i class="fa-regular fa-copy"></i>
              </button>
            </div>
            <p class="waiting-room-stage-title">${isCreator ? "Votre r&eacute;union commence dans" : "La r&eacute;union commence dans"}</p>
            <div class="waiting-room-countdown" id="meeting-countdown">--:--:--</div>
            <p class="waiting-room-stage-note">${escape(scheduledStr)}</p>
            <div class="waiting-room-media-note" id="waiting-room-media-note"></div>
          </section>

          ${!isCreator && data.waitingRoomId ? `<section class="waiting-room-participants">
            <div class="waiting-room-participants-heading">
              <div>
                <h2>Les participants</h2>
                <p>Vous pouvez d&eacute;j&agrave; vous voir en attendant l'h&ocirc;te.</p>
              </div>
              <span class="waiting-room-live"><i class="fa-solid fa-circle"></i> EN ATTENTE · <span id="waiting-participant-count">1</span></span>
            </div>
            <div id="meeting-waiting-grid" class="video-grid waiting-room-grid"></div>
            <div class="waiting-room-self-controls">
              <button class="waiting-room-self-btn active" id="waiting-mic-btn" type="button" aria-label="Activer ou couper mon micro">
                <i class="fa-solid fa-microphone"></i><span>Micro</span>
              </button>
              <button class="waiting-room-self-btn active" id="waiting-cam-btn" type="button" aria-label="Activer ou couper ma caméra">
                <i class="fa-solid fa-video"></i><span>Caméra</span>
              </button>
            </div>
          </section>` : ""}

          <div class="waiting-room-actions">
            ${isCreator ? `<button class="waiting-room-start" data-meeting-code="${escape(data.code)}"><i class="fa-solid fa-play"></i> D&eacute;marrer la r&eacute;union maintenant</button>` : ""}

            <section class="waiting-music-controls" aria-label="Musique d'attente">
              <div class="waiting-music-head">
                <strong>Musique d'attente</strong>
                <span class="waiting-music-track-pos" id="waiting-music-track-pos"></span>
              </div>
              <span class="waiting-music-title" id="meeting-waiting-music-title">Aucune musique sélectionnée</span>
              <span class="waiting-music-status" id="waiting-music-status"></span>
              <div class="waiting-music-progress">
                <span class="waiting-music-time" id="waiting-music-current-time">0:00</span>
                <div class="waiting-music-progress-track"><div class="waiting-music-progress-fill" id="waiting-music-progress-fill"></div></div>
                <span class="waiting-music-time" id="waiting-music-total-time">--:--</span>
              </div>
              <div class="waiting-music-buttons">
                <button id="waiting-music-unlock" type="button" class="waiting-music-unlock" style="display:none">
                  <i class="fa-solid fa-play"></i> Activer la musique
                </button>
                <button id="meeting-waiting-music-toggle" type="button" class="waiting-music-toggle" disabled>Écouter la musique</button>
                ${isCreator ? `<button id="meeting-waiting-music-stop-all" type="button" class="waiting-music-stop-all" disabled><i class="fa-solid fa-stop"></i> Arrêter chez tout le monde</button>` : ""}
              </div>
              <div class="waiting-music-volume-row" id="waiting-music-volume-row" style="display:none">
                <i class="fa-solid fa-volume-low"></i>
                <input type="range" id="waiting-music-volume" min="0" max="1" step="0.05" value="1" aria-label="Volume de la musique">
                <i class="fa-solid fa-volume-high"></i>
              </div>
              ${isCreator ? `
                <ul id="waiting-music-playlist" class="waiting-music-playlist"></ul>
                <label class="waiting-music-choose" for="waiting-music-file"><i class="fa-solid fa-music"></i> Ajouter des morceaux
                  <input id="waiting-music-file" type="file" accept="audio/*" multiple hidden>
                </label>` : ""}
            </section>

            <button class="waiting-room-leave" onclick="window.closeMeetingWaitingView()">Quitter la salle d'attente</button>
          </div>
        </main>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", html);
  this.meetingWaitingView = document.getElementById("meeting-waiting-view");
  this.meetingWaitingView.classList.add("active");

  // --- Actions ---
  const startButton = this.meetingWaitingView.querySelector("[data-meeting-code]");
  if (startButton) startButton.addEventListener("click", () => this.startMeeting(startButton.dataset.meetingCode));
  const copyButton = this.meetingWaitingView.querySelector("#waiting-room-code-copy");
  if (copyButton) copyButton.addEventListener("click", () => this.copyMeetingText(meetingCode, "Code"));

  // --- Lecteur musique d'attente ---
  const musicFile = this.meetingWaitingView.querySelector("#waiting-music-file");
  if (musicFile) musicFile.addEventListener("change", () => this.selectWaitingMusic(musicFile.files));
  const musicToggle = this.meetingWaitingView.querySelector("#meeting-waiting-music-toggle");
  if (musicToggle) musicToggle.addEventListener("click", () => this.toggleWaitingMusicLocally());
  const musicUnlock = this.meetingWaitingView.querySelector("#waiting-music-unlock");
  if (musicUnlock) musicUnlock.addEventListener("click", () => this.unlockWaitingMusic());
  const stopAll = this.meetingWaitingView.querySelector("#meeting-waiting-music-stop-all");
  if (stopAll) stopAll.addEventListener("click", () => this.stopWaitingMusicForEveryone());
  const volume = this.meetingWaitingView.querySelector("#waiting-music-volume");
  if (volume) {
    volume.addEventListener("input", () => this.setWaitingMusicVolume(volume.value));
    const volumeRow = this.meetingWaitingView.querySelector("#waiting-music-volume-row");
    if (volumeRow) volumeRow.style.display = "flex";
  }
  const playlist = this.meetingWaitingView.querySelector("#waiting-music-playlist");
  if (playlist) this._bindWaitingMusicPlaylist(playlist);

  // --- Contrôles micro/caméra de la salle d'attente (participants attendus) ---
  const micBtn = this.meetingWaitingView.querySelector("#waiting-mic-btn");
  if (micBtn) {
    micBtn.classList.toggle("active", !this.groupIsMuted);
    micBtn.addEventListener("click", () => {
      if (!this.groupLocalStream) return;
      if (typeof this.toggleGroupMic === "function") this.toggleGroupMic();
      const muted = !!this.groupIsMuted;
      micBtn.classList.toggle("active", !muted);
      micBtn.innerHTML = muted
        ? '<i class="fa-solid fa-microphone-slash"></i><span>Micro coupé</span>'
        : '<i class="fa-solid fa-microphone"></i><span>Micro</span>';
    });
  }
  const camBtn = this.meetingWaitingView.querySelector("#waiting-cam-btn");
  if (camBtn) {
    camBtn.classList.toggle("active", !this.groupIsCamOff);
    camBtn.addEventListener("click", async () => {
      if (!this.groupLocalStream) return;
      if (typeof this.toggleGroupCamera === "function") await this.toggleGroupCamera();
      const camOff = !!this.groupIsCamOff;
      camBtn.classList.toggle("active", !camOff);
      camBtn.innerHTML = camOff
        ? '<i class="fa-solid fa-video-slash"></i><span>Caméra coupée</span>'
        : '<i class="fa-solid fa-video"></i><span>Caméra</span>';
      this.renderGroupGrid();
    });
  }

  // Reconduire les préférences choisies dans la prévisualisation (attendre sans
  // violer les autorisations : micro/caméra restent dans l'état choisi).
  this._applyPendingMeetingMediaPreferences();
  if (!this.groupLocalStream && !isCreator) {
    const note = this.meetingWaitingView.querySelector("#waiting-room-media-note");
    if (note) {
      note.textContent = "Caméra/micro indisponibles — vous pouvez attendre ici sans vos périphériques.";
      note.classList.add("visible");
    }
  }

  this._updateWaitingRoomStatus();
  this.updateMeetingParticipantCount();
  this.renderWaitingMusicPlaylist();
  if (isCreator && this.waitingMusicTracks?.length) {
    this.playWaitingMusicLocally(0);
  }

  this._updateMeetingCountdown(data);
};

// Indicateur de connexion dans la salle d'attente
Meetings.prototype._updateWaitingRoomStatus = function() {
  const dot = document.querySelector("#waiting-room-conn");
  const text = document.getElementById("waiting-room-conn-text");
  if (!text) return;
  const connected = this.wsReadyState === WebSocket.OPEN || (this.ws && this.ws.readyState === WebSocket.OPEN);
  if (dot) dot.classList.toggle("connected", connected);
  text.textContent = connected ? "Connecté" : "Reconnexion…";
};

// Compteur de participants de la salle d'attente (lorsque la liste est visible)
Meetings.prototype._updateWaitingRoomParticipantCount = function() {
  const el = document.getElementById("waiting-participant-count");
  if (!el) return;
  const waitingCount = (this.groupRoster || []).filter((r) => r && r.state === "JOINED").length;
  el.textContent = String(waitingCount || 1);
};

Meetings.prototype._updateMeetingCountdown = function(data) {
  if (this.meetingTimer) {
    clearInterval(this.meetingTimer);
  }

  const startsAt = data.startsAt || data.opensAt || data.scheduledAt;

  const update = () => {
    // Indicateurs temps réel de la salle d'attente
    this._updateWaitingRoomStatus();
    this._updateWaitingRoomParticipantCount();

    const now = this.clockOffset ? Date.now() + this.clockOffset : Date.now();
    const remaining = Math.max(0, startsAt - now);

    if (remaining <= 0) {
      if (this.meetingTimer) {
        clearInterval(this.meetingTimer);
        this.meetingTimer = null;
      }

      // Pas d'auto-join pendant qu'une demande d'approbation est en cours
      if (this.meetingApprovalPending) {
        console.log("📅 [MEETING] Heure atteinte mais approbation en attente — pas d'auto-join");
        return;
      }

      if (this.meetingPendingCode) {
        console.log("📅 [MEETING] Heure de démarrage atteinte, auto-join...");
        const autoCode = this.meetingPendingCode;
        this.meetingPendingCode = null;
        this.joinMeeting(autoCode);
      }
      return;
    }

    const totalSeconds = Math.ceil(remaining / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const countdownEl = document.getElementById("meeting-countdown");
    if (countdownEl) {
      countdownEl.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
  };

  update();
  this.meetingTimer = setInterval(update, 1000);
};

Meetings.prototype.closeMeetingWaitingView = function() {
  this.stopWaitingMusicLocally();
  // Libérer complètement les ressources audio : aucun son ne doit persister
  // en arrière-plan ou se relancer lors d'une prochaine réunion.
  this._destroyWaitingMusicNode();
  if (!this.isMeetingHost) {
    // Les invités repartent de zéro : la prochaine playlist viendra du serveur
    this.waitingMusicTracks = [];
    this.waitingMusicTrackIndex = 0;
    this.waitingMusicLastSyncAt = null;
  }
  this.waitingMusicLocallyEnabled = false;
  this.waitingMusicLocallyPaused = false;
  this.waitingMusicBlocked = false;

  if (this.meetingApprovalView) {
    // Écran "En attente d'approbation" également présent
    this.meetingApprovalView.remove();
    this.meetingApprovalView = null;
  }

  if (this.meetingTimer) {
    clearInterval(this.meetingTimer);
    this.meetingTimer = null;
  }

  if (this.meetingWaitingView) {
    this.meetingWaitingView.classList.remove("active");
    const viewRef = this.meetingWaitingView;
    this.meetingWaitingView = null;
    setTimeout(() => {
      // Nettoyage de l'élément précis capturé (pas de la propriété actuelle) :
      // évite qu'un timer de 300 ms supprime une vue recréée entre-temps.
      if (viewRef && viewRef.isConnected) viewRef.remove();
    }, 300);
  }
  if (this.meetingWaitingRoomId) {
    if (this.meetingPendingMeetingId) this.sendSignal({ type: "meeting-waiting-leave", meetingId: this.meetingPendingMeetingId });
    this.sendSignal({ type: "group-leave", roomId: this.meetingWaitingRoomId });
    this.meetingWaitingRoomId = null;
    this.groupIsMeeting = false;
    this.groupRoomId = null;
    this.groupRoster = [];
    if (this.closeAllGroupPeers) this.closeAllGroupPeers();
    if (this.groupLocalStream) {
      this.groupLocalStream.getTracks().forEach((track) => track.stop());
      this.groupLocalStream = null;
    }
  }
};

Meetings.prototype.extractMeetingCodeFromURL = function() {
  try {
    let urlStr = window.location.href;

    if (window.cordova && window.cordova.plugins && window.cordova.plugins.launcher) {
      const launchUrl = window.cordova.plugins.launcher.getLaunchUrl();
      if (launchUrl) {
        urlStr = launchUrl;
      }
    }

    const url = new URL(urlStr);
    let code = null;

    const pathMatch = url.pathname.match(/\/join\/([A-Z0-9-]{9,11})/i);
    if (pathMatch) {
      code = pathMatch[1].toUpperCase();
    }

    if (!code) {
      code = url.searchParams.get('code');
      if (code) {
        code = code.toUpperCase();
      }
    }

    if (code) {
      code = code.replace(/[^A-Z0-9-]/g, '');
      if (code.length === 9 && !code.includes('-')) {
        code = code.slice(0, 3) + '-' + code.slice(3, 6) + '-' + code.slice(6);
      }
    }

    if (code) {
      console.log("📅 [MEETING] Code extrait de l'URL:", code);
      return code;
    }

    return null;
  } catch (e) {
    console.error("❌ Erreur extraction code URL:", e);
    return null;
  }
};

Meetings.prototype.handleDeepLink = function() {
  const code = this.extractMeetingCodeFromURL();
  if (code) {
    const checkAndJoin = () => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.myId) {
        this.showMeetingJoinView(code);
      } else {
        if (!this.deepLinkRetries) this.deepLinkRetries = 0;
        this.deepLinkRetries++;
        if (this.deepLinkRetries < 10) {
          setTimeout(checkAndJoin, 1000);
        } else {
          console.warn("⚠️ [MEETING] Impossible de rejoindre automatiquement: connexion non établie");
        }
      }
    };

    setTimeout(checkAndJoin, 500);
  }
};

// ===== INITIALISATION DES PROPRIÉTÉS =====
// Initialiser les propriétés pour les réunions sur l'instance existante
if (window.callManager) {
  window.callManager.meetingCreateView = null;
  window.callManager.meetingJoinView = null;
  window.callManager.meetingWaitingView = null;
  window.callManager.meetingCreatedView = null;
  window.callManager.meetingPreviewView = null;
  window.callManager.meetingTimer = null;
  window.callManager.meetingPendingCode = null;
  window.callManager.deepLinkRetries = 0;
  window.callManager.previewMicEnabled = true;
  window.callManager.previewCamEnabled = true;
  window.callManager.previewStream = null;
  window.callManager.pendingRequestDialog = null;
  window.callManager.waitingMusicTracks = [];
  window.callManager.waitingMusicTrackIndex = 0;
  window.callManager.waitingMusicVolume = 1;
  window.callManager.waitingMusicLocallyEnabled = false;
  window.callManager.waitingMusicLocallyPaused = false;
  window.callManager.waitingMusicBlocked = false;
  window.callManager.waitingMusicStoppedForMeeting = false;
  window.callManager.waitingMusicLastSyncAt = null;
  window.callManager.waitingMusicPendingSeekSec = 0;
  window.callManager.waitingMusicAudio = null;
  window.callManager.meetingApprovalPending = false;
}

// ===== EXPORTS GLOBAUX =====
window.showMeetingCreateView = function(meetingId) { window.callManager.showMeetingCreateView(meetingId); };
window.closeMeetingCreateView = function() { window.callManager.closeMeetingCreateView(); };
window.selectMeetingType = function(type) { window.callManager.selectMeetingType(type); };
window.selectMeetingMode = function(mode) { window.callManager.selectMeetingMode(mode); };
window.selectAccessPolicy = function(policy) { window.callManager.selectAccessPolicy(policy); };
window.confirmCreateMeeting = function() { window.callManager.confirmCreateMeeting(); };
window.cancelMeeting = function() { window.callManager.cancelMeeting(); };
window.showMeetingJoinView = function(code) { window.callManager.showMeetingJoinView(code); };
window.closeMeetingJoinView = function() { window.callManager.closeMeetingJoinView(); };
window.confirmJoinMeeting = function() { window.callManager.confirmJoinMeeting(); };
window.closeMeetingWaitingView = function() { window.callManager.closeMeetingWaitingView(); };
window.closeMeetingCreatedView = function() { window.callManager.closeMeetingCreatedView(); };
window.copyMeetingCode = function(code) { window.callManager.copyMeetingCode(code); };
window.closePendingRequestDialog = function() { window.callManager.closePendingRequestDialog(); };
window.approveMeetingRequest = function(meetingId, userId) { window.callManager.approveMeetingRequest(meetingId, userId); };
window.rejectMeetingRequest = function(meetingId, userId) { window.callManager.rejectMeetingRequest(meetingId, userId); };
// Bouton "quitter" : quitte directement (style WhatsApp). La confirmation
// détaillée reste disponible via leaveMeetingWithConfirm pour le Web.
window.leaveMeeting = function() { window.callManager.leaveMeeting ? window.callManager.leaveMeeting() : window.callManager.leaveMeetingWithConfirm(); };
window.endMeetingForEveryone = function() { window.callManager.endMeetingForEveryone(); };
window.toggleMeetingMic = function() { window.callManager.toggleMeetingMic(); };
window.toggleMeetingCam = function() { window.callManager.toggleMeetingCam(); };
window.toggleMeetingHand = function() { window.callManager.toggleMeetingHand(); };
window.showMeetingReactions = function() { window.callManager.showMeetingReactions(); };
window.sendMeetingReaction = function(emoji) { window.callManager.sendMeetingReaction(emoji); };
window.toggleMeetingScreenShare = function() { window.callManager.toggleMeetingScreenShare(); };
window.hostMuteParticipant = function(uid, media, muted) { window.callManager.hostMuteParticipant(uid, media, muted); };
window.shareMeetingLink = function(link) { window.callManager.shareMeetingLink(link); };
window.startMeetingFromCreated = function(code) { window.callManager.startMeetingFromCreated(code); };
window.showMeetingListView = function() { window.callManager.listMeetings(); };
window.closeMeetingListView = function() { window.callManager.closeMeetingListView(); };
window.createMeetingFromList = function() { window.callManager.createMeetingFromList(); };
window.startMeetingFromList = function(code) { window.callManager.startMeetingFromList(code); };
// Exports pour l'écran de prévisualisation
window.closeMeetingPreviewView = function() { window.callManager.closeMeetingPreviewView(); };
window.togglePreviewMic = function() { window.callManager.togglePreviewMic(); };
window.togglePreviewCam = function() { window.callManager.togglePreviewCam(); };
window.selectCamera = function(deviceId) { window.callManager.selectCamera(deviceId); };
window.selectMicrophone = function(deviceId) { window.callManager.selectMicrophone(deviceId); };
window.confirmJoinMeetingFromPreview = function(code) { window.callManager.confirmJoinMeetingFromPreview(code); };
window.startInstantMeeting = function() { window.callManager.startInstantMeeting(); };
window.openMeetingDetails = function(meetingId) { window.callManager.openMeetingDetails(meetingId); };

// ===== HANDLE DEEP LINK AU DÉMARRAGE =====
if (document.readyState === 'complete') {
  window.callManager.handleDeepLink();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    window.callManager.handleDeepLink();
  });
}


// ============================================================================
// MODULE MEETINGS : services internes, médias, participants et chat.
// Les instances globales ci-dessous gardent les points d'entrée utilisés par
// CallManager et les boutons HTML existants.
// ============================================================================


// Une classe unique regroupe les composants internes du meeting.

  // --- SERVICE ET ÉTAT DES RÉUNIONS ---

/**
 * ============================================
 *  MEETING SERVICE - SERVICE ISOLÉ POUR LES RÉUNIONS
 * ============================================
 *
 * Ce service gère toute la logique métier des réunions planifiées,
 * indépendamment du système d'appel classique (CallManager).
 *
 * RESPONSABILITÉS:
 * - Gestion de l'état des réunions
 * - Interface avec Firebase Firestore
 * - Gestion des participants
 * - Chat de réunion
 * - Permissions
 * - Notifications de réunion
 *
 * PRINCIPE: Ne pas modifier CallManager, utiliser MeetingMediaAdapter
 * pour l'intégration avec le système d'appel de groupe existant.
 */

Meetings.MeetingService = class MeetingService {
  constructor() {
    // État local du service
    this.currentMeeting = null;
    this.meetingParticipants = new Map();
    this.meetingChatMessages = [];
    this.meetingPermissions = new Map();
    this.subscribers = new Map();
  }

  /**
   * Abonnement aux changements d'état
   */
  subscribe(event, callback) {
    if (!this.subscribers.has(event)) {
      this.subscribers.set(event, []);
    }
    this.subscribers.get(event).push(callback);
  }

  unsubscribe(event, callback) {
    if (this.subscribers.has(event)) {
      const callbacks = this.subscribers.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  emit(event, data) {
    if (this.subscribers.has(event)) {
      this.subscribers.get(event).forEach(callback => callback(data));
    }
  }

  /**
   * Charger une réunion par code
   */
  async loadMeetingByCode(code) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/by-code/${code}`);
      if (!response.ok) throw new Error('Réunion introuvable');
      const meeting = await response.json();
      this.currentMeeting = meeting;
      this.emit('meeting-loaded', meeting);
      return meeting;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur chargement réunion:', error);
      throw error;
    }
  }

  /**
   * Charger une réunion par ID
   */
  async loadMeetingById(meetingId) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/${meetingId}`);
      if (!response.ok) throw new Error('Réunion introuvable');
      const meeting = await response.json();
      this.currentMeeting = meeting;
      this.emit('meeting-loaded', meeting);
      return meeting;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur chargement réunion:', error);
      throw error;
    }
  }

  /**
   * Modifier une réunion
   */
  async updateMeeting(meetingId, updates) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/${meetingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (!response.ok) throw new Error('Échec de la modification');
      const updated = await response.json();
      this.currentMeeting = updated;
      this.emit('meeting-updated', updated);
      return updated;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur modification réunion:', error);
      throw error;
    }
  }

  /**
   * Charger les participants d'une réunion
   */
  async loadParticipants(meetingId) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/${meetingId}/participants`);
      if (!response.ok) throw new Error('Échec du chargement des participants');
      const participants = await response.json();
      this.meetingParticipants.clear();
      participants.forEach(p => this.meetingParticipants.set(p.userId, p));
      this.emit('participants-loaded', participants);
      return participants;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur chargement participants:', error);
      throw error;
    }
  }

  /**
   * Ajouter un participant à la réunion
   */
  async addParticipant(meetingId, userId) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/${meetingId}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      if (!response.ok) throw new Error('Échec de l\'ajout');
      const participant = await response.json();
      this.meetingParticipants.set(userId, participant);
      this.emit('participant-added', participant);
      return participant;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur ajout participant:', error);
      throw error;
    }
  }

  /**
   * Retirer un participant de la réunion
   */
  async removeParticipant(meetingId, userId) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/${meetingId}/participants/${userId}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Échec du retrait');
      this.meetingParticipants.delete(userId);
      this.emit('participant-removed', userId);
      return true;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur retrait participant:', error);
      throw error;
    }
  }

  /**
   * Envoyer un message de chat
   */
  async sendChatMessage(meetingId, message) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/${meetingId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          userId: window.callManager?.myId,
          timestamp: Date.now()
        })
      });
      if (!response.ok) throw new Error('Échec de l\'envoi');
      const chatMessage = await response.json();
      this.meetingChatMessages.push(chatMessage);
      this.emit('chat-message-sent', chatMessage);
      return chatMessage;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur envoi message:', error);
      throw error;
    }
  }

  /**
   * Charger l'historique du chat
   */
  async loadChatHistory(meetingId) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/${meetingId}/chat`);
      if (!response.ok) throw new Error('Échec du chargement');
      const messages = await response.json();
      this.meetingChatMessages = messages;
      this.emit('chat-history-loaded', messages);
      return messages;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur chargement chat:', error);
      throw error;
    }
  }

  /**
   * Lever la main
   */
  async raiseHand(meetingId) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/${meetingId}/raise-hand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: window.callManager?.myId })
      });
      if (!response.ok) throw new Error('Échec');
      this.emit('hand-raised', { userId: window.callManager?.myId });
      return true;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur lever main:', error);
      throw error;
    }
  }

  /**
   * Baisser la main
   */
  async lowerHand(meetingId) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/${meetingId}/lower-hand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: window.callManager?.myId })
      });
      if (!response.ok) throw new Error('Échec');
      this.emit('hand-lowered', { userId: window.callManager?.myId });
      return true;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur baisser main:', error);
      throw error;
    }
  }

  /**
   * Envoyer une réaction
   */
  async sendReaction(meetingId, reaction) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/${meetingId}/reaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: window.callManager?.myId,
          reaction,
          timestamp: Date.now()
        })
      });
      if (!response.ok) throw new Error('Échec');
      this.emit('reaction-sent', { userId: window.callManager?.myId, reaction });
      return true;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur réaction:', error);
      throw error;
    }
  }

  /**
   * Obtenir les permissions d'un utilisateur
   */
  async getPermissions(meetingId, userId) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/${meetingId}/permissions/${userId}`);
      if (!response.ok) throw new Error('Échec');
      const permissions = await response.json();
      this.meetingPermissions.set(userId, permissions);
      return permissions;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur permissions:', error);
      throw error;
    }
  }

  /**
   * Mettre à jour les permissions d'un utilisateur
   */
  async updatePermissions(meetingId, userId, permissions) {
    try {
      const response = await fetch(`${CallManager.HTTP_SERVER_URL}/api/meeting/${meetingId}/permissions/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(permissions)
      });
      if (!response.ok) throw new Error('Échec');
      const updated = await response.json();
      this.meetingPermissions.set(userId, updated);
      this.emit('permissions-updated', { userId, permissions: updated });
      return updated;
    } catch (error) {
      console.error('❌ [MeetingService] Erreur mise à jour permissions:', error);
      throw error;
    }
  }

  /**
   * Réinitialiser l'état du service
   */
  reset() {
    this.currentMeeting = null;
    this.meetingParticipants.clear();
    this.meetingChatMessages = [];
    this.meetingPermissions.clear();
    this.emit('reset');
  }
  };


// --- MÉDIAS ET PÉRIPHÉRIQUES ---

/**
 * ============================================
 *  MEETING MEDIA ADAPTER
 * ============================================
 *
 * Ce fichier sert d'interface entre le module Meeting et le système d'appel
 * de groupe existant (CallManager).
 *
 * RESPONSABILITÉS:
 * - Adapter les meetings aux appels de groupe existants
 * - Gérer la transition meeting → salle live
 * - Gérer les médias (caméra/micro) pour les meetings
 * - Ne PAS modifier CallManager.js
 *
 * PRINCIPE: Utiliser les interfaces existantes de CallManager pour les appels
 * de groupe, mais isoler la logique spécifique aux meetings.
 */

Meetings.MeetingMediaAdapter = class MeetingMediaAdapter {
  constructor() {
    this.callManager = null;
    this.preparedMedia = null;
    this.selectedCamera = null;
    this.selectedMicrophone = null;
    this.selectedSpeaker = null;
  }

  /**
   * Initialiser l'adaptateur avec CallManager
   */
  initialize(callManager) {
    this.callManager = callManager;
  }

  /**
   * Obtenir la liste des périphériques disponibles
   */
  async getDevices() {
    try {
      // enumerateDevices n'a pas besoin d'ouvrir le micro ni la caméra. Ouvrir
      // un flux ici puis un second pour l'aperçu fait échouer la caméra sur Android.
      const devices = await navigator.mediaDevices.enumerateDevices();
      return {
        cameras: devices.filter(d => d.kind === 'videoinput'),
        microphones: devices.filter(d => d.kind === 'audioinput'),
        speakers: devices.filter(d => d.kind === 'audiooutput')
      };
    } catch (error) {
      console.error('❌ [MeetingMediaAdapter] Erreur obtention périphériques:', error);
      throw error;
    }
  }

  /**
   * Sélectionner une caméra
   */
  selectCamera(deviceId) {
    this.selectedCamera = deviceId;
  }

  /**
   * Sélectionner un microphone
   */
  selectMicrophone(deviceId) {
    this.selectedMicrophone = deviceId;
  }

  /**
   * Sélectionner un haut-parleur
   */
  selectSpeaker(deviceId) {
    this.selectedSpeaker = deviceId;
  }

  /**
   * Préparer les médias pour un aperçu
   */
  async preparePreview(isVideo = true, isAudio = true) {
    try {
      const constraints = {
        video: isVideo ? {
          deviceId: this.selectedCamera ? { exact: this.selectedCamera } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } : false,
        audio: isAudio ? {
          deviceId: this.selectedMicrophone ? { exact: this.selectedMicrophone } : undefined
        } : false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.preparedMedia = stream;
      return stream;
    } catch (error) {
      console.error('❌ [MeetingMediaAdapter] Erreur préparation média:', error);
      throw error;
    }
  }

  /**
   * Arrêter l'aperçu
   */
  stopPreview() {
    if (this.preparedMedia) {
      this.preparedMedia.getTracks().forEach(track => track.stop());
      this.preparedMedia = null;
    }
  }

  /**
   * Obtenir le niveau audio du microphone
   */
  async getAudioLevel(stream) {
    return new Promise((resolve, reject) => {
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        analyser.fftSize = 256;
        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const checkLevel = () => {
          analyser.getByteFrequencyData(dataArray);
          const sum = dataArray.reduce((a, b) => a + b, 0);
          const average = sum / dataArray.length;
          resolve(average);
        };

        checkLevel();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Transférer les médias préparés à CallManager pour rejoindre une réunion
   */
  async transferMediaToCallManager(isVideo) {
    if (!this.callManager) {
      throw new Error('CallManager non initialisé');
    }

    if (!this.preparedMedia) {
      // Si pas de média préparé, en acquérir un
      const wantsVideo = isVideo ?? meetingService.currentMeeting?.isVideo ?? true;
      await this.preparePreview(wantsVideo);
    }

    // CallManager utilise déjà acquireGroupMedia, on peut l'utiliser
    // mais on s'assure d'utiliser les périphériques sélectionnés
    const wantsVideo = isVideo ?? meetingService.currentMeeting?.isVideo ?? true;
    // Libérer l'aperçu avant d'ouvrir la caméra d'appel : Android n'autorise
    // souvent qu'une seule capture simultanée dans la WebView.
    if (this.callManager.stopPreview) {
      this.callManager.stopPreview();
    } else {
      this.stopPreview();
    }
    await this.callManager.acquireGroupMedia(wantsVideo);
  }

  /**
   * Basculer la caméra (on/off)
   */
  async toggleCamera(enabled) {
    if (!this.callManager) return;

    if (enabled) {
      await this.callManager.enableGroupCamera();
    } else {
      this.callManager.disableGroupCamera();
    }
  }

  /**
   * Basculer le microphone (on/off)
   */
  async toggleMicrophone(enabled) {
    if (!this.callManager) return;

    if (enabled) {
      await this.callManager.enableGroupMicrophone();
    } else {
      this.callManager.disableGroupMicrophone();
    }
  }

  /**
   * Rejoindre une réunion via CallManager
   */
  async joinMeeting(code) {
    if (!this.callManager) {
      throw new Error('CallManager non initialisé');
    }

    // Utiliser la méthode existante de CallManager pour rejoindre
    return this.callManager.joinMeeting(code);
  }

  /**
   * Démarrer une réunion via CallManager
   */
  async startMeeting(code) {
    if (!this.callManager) {
      throw new Error('CallManager non initialisé');
    }

    // Utiliser la méthode existante de CallManager pour démarrer
    return this.callManager.startMeeting(code);
  }

  /**
   * Quitter la réunion via CallManager
   */
  async leaveMeeting() {
    if (!this.callManager) return;

    // Utiliser la méthode existante de CallManager pour quitter
    this.callManager.endGroupCall();
  }

  /**
   * Réinitialiser l'adaptateur
   */
  reset() {
    this.stopPreview();
    this.selectedCamera = null;
    this.selectedMicrophone = null;
    this.selectedSpeaker = null;
  }
  };


// --- PANNEAU DES PARTICIPANTS ---

/**
 * ============================================
 *  MEETING PARTICIPANTS - GESTION DES PARTICIPANTS
 * ============================================
 *
 * Ce fichier gère l'affichage et la gestion des participants
 * pendant une réunion en cours.
 */

Meetings.MeetingParticipants = class MeetingParticipants {
  constructor() {
    this.panel = null;
    this.participants = new Map();
    this.currentMeetingId = null;
    this.currentRoomId = null;
    this.isHost = false;
  }

  /**
   * Afficher le panneau des participants
   */
  show(meetingId, roomId, isHost = false) {
    this.currentMeetingId = meetingId;
    this.currentRoomId = roomId;
    this.isHost = isHost;

    if (this.panel) {
      this.panel.classList.add("open");
      this.loadParticipants();
      return;
    }

    const html = `
      <div class="meeting-participants-panel" id="meeting-participants-panel">
        <div class="chat-header">
          <button class="icon-btn-top" onclick="window.meetingParticipants.close()">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <div class="chat-title">Participants</div>
          <div style="width: 40px;"></div>
        </div>

        <div class="participants-list" id="participants-list">
          <div class="loading-spinner"></div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML("beforeend", html);
    this.panel = document.getElementById("meeting-participants-panel");
    this.panel.classList.add("open");

    this.loadParticipants();
  }

  /**
   * Fermer le panneau
   */
  close() {
    if (this.panel) {
      this.panel.classList.remove("open");
    }
  }

  /**
   * Charger les participants
   */
  async loadParticipants() {
    try {
      const listContainer = document.getElementById("participants-list");
      if (!listContainer) return;

      // Priorité au roster live (WebRTC) — source de vérité pendant la réunion
      if (window.callManager && Array.isArray(window.callManager.groupRoster) && window.callManager.groupRoster.length) {
        const roster = window.callManager.groupRoster.map(r => {
          const st = window.callManager.groupPeerStates?.get(r.userId) || {};
          const isSelf = r.userId === window.callManager.myId;
          return {
            userId: r.userId,
            name: r.name || null,
            state: r.state || "JOINED",
            micEnabled: isSelf ? !window.callManager.groupIsMuted : !st.micMuted,
            camEnabled: isSelf ? !window.callManager.groupIsCamOff : !st.camOff,
          };
        });
        this.renderParticipants(roster);
        return;
      }

      if (window.meetingService) {
        const participants = await meetingService.loadParticipants(this.currentMeetingId);
        this.renderParticipants(participants);
      }
    } catch (error) {
      console.error("Erreur chargement participants:", error);
    }
  }

  /**
   * Afficher les participants
   */
  renderParticipants(participants) {
    const listContainer = document.getElementById("participants-list");
    if (!listContainer) return;

    if (!participants || participants.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-users"></i>
          <div class="empty-state-text">Aucun participant</div>
        </div>
      `;
      return;
    }

    const hostId = window.callManager?.meetingCreatedBy || null;
    const myId = window.callManager?.myId;
    let html = "";
    participants.forEach(p => {
      const userId = p.userId || p.id;
      const state = p.state || "JOINED";
      const isOrganizer = hostId && userId === hostId;
      const isSelf = userId === myId;
      // Les états média sont soit portés par l'événement, soit relus depuis
      // l'état WebRTC live — sinon on n'invente pas de valeur par défaut.
      const liveState = window.callManager?.groupPeerStates?.get(userId) || {};
      const micEnabled = typeof p.micEnabled === "boolean" ? p.micEnabled : !liveState.micMuted;
      const camEnabled = typeof p.camEnabled === "boolean" ? p.camEnabled : !liveState.camOff;

      html += `
        <div class="participant-item" data-user-id="${window.escapeHtml(userId)}">
          <div class="participant-avatar">
            ${p.name ? window.escapeHtml(String(p.name).slice(0, 2).toUpperCase()) : window.escapeHtml(String(userId).slice(-2).toUpperCase())}
          </div>
          <div class="participant-info">
            <div class="participant-name">
              ${isSelf ? "Vous" : window.escapeHtml(p.displayName || p.name || userId)}
              ${isOrganizer ? '<span style="color: #00a884; font-size: 11px; margin-left: 4px;">(Organisateur)</span>' : ''}
            </div>
            <div class="participant-role">${window.escapeHtml(state)}</div>
          </div>
          <div class="participant-media-status">
            <span class="media-status ${micEnabled ? 'enabled' : 'disabled'}" title="Microphone">
              <i class="fa-solid ${micEnabled ? 'fa-microphone' : 'fa-microphone-slash'}"></i>
            </span>
            <span class="media-status ${camEnabled ? 'enabled' : 'disabled'}" title="Caméra">
              <i class="fa-solid ${camEnabled ? 'fa-video' : 'fa-video-slash'}"></i>
            </span>
          </div>
          ${this.isHost && !isSelf ? `
            <div class="participant-actions">
              <button class="participant-action-btn" data-participant-action="mic" title="Couper le micro">
                <i class="fa-solid fa-microphone-slash"></i>
              </button>
              <button class="participant-action-btn" data-participant-action="cam" title="Couper la caméra">
                <i class="fa-solid fa-video-slash"></i>
              </button>
              <button class="participant-action-btn" data-participant-action="remove" title="Retirer">
                <i class="fa-solid fa-user-minus"></i>
              </button>
            </div>
          ` : ''}
        </div>
      `;
    });

    listContainer.innerHTML = html;
    listContainer.onclick = (event) => {
      const btn = event.target.closest("[data-participant-action]"); if (!btn) return;
      const userId = btn.closest("[data-user-id]")?.dataset.userId; if (!userId) return;
      if (btn.dataset.participantAction === "mic") window.hostMuteParticipant(userId, "mic", true);
      if (btn.dataset.participantAction === "cam") window.hostMuteParticipant(userId, "cam", true);
      if (btn.dataset.participantAction === "remove") this.removeParticipant(userId);
    };
  }

  /**
   * Retirer un participant
   */
  async removeParticipant(userId) {
    // this.participants est une Map : `?.[userId]` ne marchait jamais
    const displayName = this.participants.get(userId)?.displayName || userId;
    if (!await window.callManager.confirmMeetingAction("Retirer un participant", `Retirer ${displayName} de la r\u00e9union ?`)) return;

    const toast = (msg) => {
      if (window.callManager && typeof window.callManager.showCallToast === "function") {
        window.callManager.showCallToast(msg);
      }
    };

    try {
      // Priorité WebSocket (évite CORS DELETE)
      if (window.callManager && window.callManager.groupRoomId) {
        window.callManager.sendSignal({
          type: "meeting-kick",
          meetingId: this.currentMeetingId || window.callManager.currentMeetingId,
          roomId: this.currentRoomId || window.callManager.groupRoomId,
          targetUserId: userId,
        });
        toast("Participant retiré");
        setTimeout(() => this.loadParticipants(), 400);
        return;
      }

      if (window.meetingService) {
        await meetingService.removeParticipant(this.currentMeetingId, userId);
        toast("Participant retiré");
        this.loadParticipants();
      }
    } catch (error) {
      console.error("Erreur retrait participant:", error);
      toast("Erreur lors du retrait");
    }
  }

  /**
   * Mettre à jour en temps réel
   */
  updateParticipant(userId, state) {
    const existing = this.participants.get(userId) || { userId };
    this.participants.set(userId, { ...existing, state });
    this.renderParticipants(Array.from(this.participants.values()));
  }

  /**
   * Mettre à jour l'état média d'un participant
   */
  updateParticipantMedia(userId, mediaState) {
    const existing = this.participants.get(userId) || { userId };
    this.participants.set(userId, { ...existing, ...mediaState });
    this.renderParticipants(Array.from(this.participants.values()));
  }

  /**
   * Réinitialiser
   */
  reset() {
    this.close();
    this.participants.clear();
    this.currentMeetingId = null;
    this.currentRoomId = null;
    this.isHost = false;
  }
  };

// --- CHAT EN TEMPS RÉEL ---

/**
 * ============================================
 *  MEETING CHAT - CHAT INTÉGRÉ AUX RÉUNIONS
 * ============================================
 *
 * Ce fichier gère le chat de réunion avec envoi/réception
 * de messages en temps réel.
 */

Meetings.MeetingChat = class MeetingChat {
  constructor() {
    this.panel = null;
    this.messages = [];
    this.currentMeetingId = null;
    this.currentRoomId = null;
    this.pendingSend = null;
    this.pendingSendTimeout = null;
  }

  /**
   * Afficher le panneau de chat
   */
  show(meetingId, roomId) {
    if (this.currentMeetingId !== meetingId) {
      this.messages = this.messages.filter(message => message.meetingId === meetingId);
    }
    this.currentMeetingId = meetingId;
    this.currentRoomId = roomId;

    if (this.panel) {
      this.panel.classList.add("open");
      this.loadHistory();
      return;
    }

    const html = `
      <div class="meeting-chat-panel" id="meeting-chat-panel">
        <div class="chat-header">
          <button class="icon-btn-top" onclick="window.meetingChat.close()">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <div class="chat-title">Chat</div>
          <div style="width: 40px;"></div>
        </div>

        <div class="chat-messages" id="chat-messages">
          <div class="loading-spinner"></div>
        </div>

        <div class="chat-input-container">
          <input type="text" id="chat-input" class="chat-input" maxlength="1000" placeholder="Écrire un message..."
                 onkeypress="if(event.key === 'Enter') window.meetingChat.sendMessage()">
          <button class="chat-send-btn" onclick="window.meetingChat.sendMessage()">
            <i class="fa-solid fa-paper-plane"></i>
          </button>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML("beforeend", html);
    this.panel = document.getElementById("meeting-chat-panel");
    this.panel.classList.add("open");

    this.loadHistory();
  }

  /**
   * Fermer le panneau
   */
  close() {
    if (this.panel) {
      this.panel.classList.remove("open");
    }
  }

  /**
   * Charger l'historique des messages
   */
  async loadHistory() {
    const requestedMeetingId = this.currentMeetingId;
    try {
      const messagesContainer = document.getElementById("chat-messages");
      if (!messagesContainer) return;

      if (window.meetingService) {
        const history = await meetingService.loadChatHistory(requestedMeetingId);
        if (requestedMeetingId !== this.currentMeetingId) return;
        // Les messages WebSocket reçus pendant le chargement ne doivent pas
        // disparaître lorsque l'historique REST revient.
        this.messages = this.mergeMessages(history, this.messages);
        this.renderMessages();
      }
    } catch (error) {
      console.error("Erreur chargement historique:", error);
      if (requestedMeetingId === this.currentMeetingId && this.messages.length === 0) {
        const messagesContainer = document.getElementById("chat-messages");
        if (messagesContainer) {
          messagesContainer.innerHTML = '<div class="empty-state"><div class="empty-state-text">Historique indisponible. Vous pouvez toujours envoyer un message.</div></div>';
        }
      }
    }
  }

  /**
   * Afficher les messages
   */
  renderMessages() {
    const messagesContainer = document.getElementById("chat-messages");
    if (!messagesContainer) return;

    if (!this.messages || this.messages.length === 0) {
      messagesContainer.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-comments"></i>
          <div class="empty-state-text">Aucun message</div>
        </div>
      `;
      return;
    }

    let html = "";
    this.messages.forEach(msg => {
      const isOwn = msg.userId === window.callManager?.myId;
      const time = new Date(Number(msg.timestamp) || Date.now()).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

      html += `
        <div class="chat-message ${isOwn ? 'own' : 'other'}">
          <div class="chat-message-content">${this.escapeHtml(msg.message)}</div>
          <div class="chat-message-meta">
            ${!isOwn ? `${this.escapeHtml(msg.displayName || msg.userId || 'Participant')} • ` : ''}${time}
          </div>
        </div>
      `;
    });

    messagesContainer.innerHTML = html;
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  /**
   * Envoyer un message
   */
  async sendMessage() {
    const input = document.getElementById("chat-input");
    if (!input) return;

    const message = input.value.trim();
    if (!message) return;

    // Essayer d'envoyer via WebSocket en premier
    if (window.callManager && window.callManager.groupRoomId) {
      if (this.pendingSend) return;
      const payload = {
        type: "meeting-chat-message",
        roomId: this.currentRoomId || window.callManager.groupRoomId,
        meetingId: this.currentMeetingId || window.callManager.currentMeetingId,
        message,
        clientMessageId: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      };
      this.pendingSend = { id: payload.clientMessageId, text: message };
      input.disabled = true;
      const sendButton = document.querySelector("#meeting-chat-panel .chat-send-btn");
      if (sendButton) sendButton.disabled = true;
      const sent = window.callManager.sendSignal(payload);
      if (!sent) {
        window.callManager.showCallToast("Connexion en cours, message en attente…");
      }
      clearTimeout(this.pendingSendTimeout);
      this.pendingSendTimeout = setTimeout(() => {
        if (!this.pendingSend) return;
        input.disabled = false;
        input.value = this.pendingSend.text;
        if (sendButton) sendButton.disabled = false;
        this.pendingSend = null;
        this.pendingSendTimeout = null;
        window.callManager?.showCallToast("Message non confirmé. Vous pouvez réessayer.");
      }, 12000);
      return;
    }

    // Fallback REST
    try {
      if (window.meetingService) {
        const sent = await meetingService.sendChatMessage(this.currentMeetingId, message);
        this.receiveMessage(sent);
        input.value = "";
      }
    } catch (error) {
      console.error("Erreur envoi message:", error);
      window.callManager?.showCallToast("Erreur lors de l'envoi");
    }
  }

  /**
   * Recevoir un message (via WebSocket)
   */
  receiveMessage(message) {
    if (!message) return;
    const normalized = message.message && typeof message.message === "object"
      ? message.message
      : message;
    if (normalized.meetingId && this.currentMeetingId && normalized.meetingId !== this.currentMeetingId) return;
    if (this.pendingSend && normalized.clientMessageId === this.pendingSend.id) {
      clearTimeout(this.pendingSendTimeout);
      this.pendingSendTimeout = null;
      this.pendingSend = null;
      const input = document.getElementById("chat-input");
      const sendButton = document.querySelector("#meeting-chat-panel .chat-send-btn");
      if (input) {
        input.value = "";
        input.disabled = false;
        input.focus();
      }
      if (sendButton) sendButton.disabled = false;
    }
    this.messages = this.mergeMessages(this.messages, [normalized]);
    this.renderMessages();
  }

  handleSendError(error) {
    if (!this.pendingSend || (error.clientMessageId && error.clientMessageId !== this.pendingSend.id)) return;
    clearTimeout(this.pendingSendTimeout);
    this.pendingSendTimeout = null;
    const input = document.getElementById("chat-input");
    const sendButton = document.querySelector("#meeting-chat-panel .chat-send-btn");
    if (input) {
      input.value = this.pendingSend.text;
      input.disabled = false;
    }
    if (sendButton) sendButton.disabled = false;
    this.pendingSend = null;
  }

  mergeMessages(...groups) {
    const byKey = new Map();
    groups.flat().forEach(message => {
      if (!message || typeof message.message !== "string") return;
      const key = message.id || message.clientMessageId ||
        `${message.userId || ""}|${message.timestamp || 0}|${message.message}`;
      byKey.set(key, { ...byKey.get(key), ...message });
    });
    return [...byKey.values()].sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0));
  }

  /**
   * Échapper le HTML pour éviter XSS
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Réinitialiser
   */
  reset() {
    this.close();
    clearTimeout(this.pendingSendTimeout);
    this.pendingSendTimeout = null;
    this.pendingSend = null;
    this.messages = [];
    this.currentMeetingId = null;
    this.currentRoomId = null;
  }
};

// Instances utilisées par les fonctions CallManager et l'interface.
const meetingService = new Meetings.MeetingService();
const meetingMediaAdapter = new Meetings.MeetingMediaAdapter();
const meetingParticipants = new Meetings.MeetingParticipants();
const meetingChat = new Meetings.MeetingChat();
window.meetingService = meetingService;
window.meetingMediaAdapter = meetingMediaAdapter;
window.meetingParticipants = meetingParticipants;
window.meetingChat = meetingChat;
