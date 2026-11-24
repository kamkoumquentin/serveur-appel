const express = require("express");
const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");

// Imports Firebase Admin v10+ / v11+
const { initializeApp, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const MAX_TIMEOUT_MS = 2147483647;
function safeSetTimeout(fn, delay) {
  if (delay > MAX_TIMEOUT_MS) return setTimeout(() => safeSetTimeout(fn, delay - MAX_TIMEOUT_MS), MAX_TIMEOUT_MS);
  return setTimeout(fn, Math.max(0, delay));
}
// Configuration TURN depuis variables d'environnement
const TURN_CONFIG = {
  iceServers: [
    {
      urls: "stun:stun.relay.metered.ca:80"
    },
    {
      urls: process.env.TURN_URL || "turn:socialstatus.furthermarket.com:80",
      username: process.env.TURN_USERNAME || "coturn",
      credential: process.env.TURN_CREDENTIAL || "Fm@camtel2026coturn"
    },
    {
      urls: process.env.TURN_URL_UDP || "turn:socialstatus.furthermarket.com:443?transport=udp",
      username: process.env.TURN_USERNAME || "coturn",
      credential: process.env.TURN_CREDENTIAL || "Fm@camtel2026coturn"
    },
    {
      urls: process.env.TURN_URL_TCP || "turn:socialstatus.furthermarket.com:443?transport=tcp",
      username: process.env.TURN_USERNAME || "coturn",
      credential: process.env.TURN_CREDENTIAL || "Fm@camtel2026coturn"
    }
  ],
  iceTransportPolicy: "relay",
  bundlePolicy: "max-bundle"
};

// Initialisation de Firebase
// Essayer de lire depuis une variable d'environnement (Render) ou depuis un fichier local
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // Pour Render : la clé est stockée dans une variable d'environnement
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  // Pour le développement local : lire depuis un fichier
  try {
    serviceAccount = require("../serviceAccountKey.json");
  } catch (error) {
    console.error("❌ Erreur : Impossible de charger la clé Firebase. Veuillez définir la variable d'environnement FIREBASE_SERVICE_ACCOUNT ou placer un fichier serviceAccountKey.json");
    process.exit(1);
  }
}

initializeApp({
  credential: cert(serviceAccount),
});

// Initialisation de Firestore pour la persistance des réunions
const db = getFirestore();

const app = express();

// Nettoie les schémas PATCH/POST REST (qui étaient cassés : req.body undefined → 500)
app.use(express.json({ limit: "2mb" }));

// Middleware CORS permissif pour wake-up Render + tests
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Carte globale persistante (RAM) pour conserver les utilisateurs et leurs tokens FCM
const users = new Map();
// Noms d'affichage (userId -> nom), alimentés à l'enregistrement
const userDisplayNames = new Map();
function getUserDisplayName(userId) {
  const n = userDisplayNames.get(userId);
  return n && n !== userId ? n : null;
}

// Carte des tokens d'authentification utilisateur (userId → {token, createdAt})
// Permet d'empêcher l'usurpation d'identité
const userAuthTokens = new Map();

// Durée de validité des tokens (24 heures)
const TOKEN_VALIDITY_MS = 24 * 60 * 60 * 1000;

/**
 * Génère un token d'authentification unique pour un utilisateur
 * Format sécurisé : 32 caractères hexadécimaux
 */
function generateAuthToken(userId) {
  const timestamp = Date.now().toString(16);
  const random = Math.random().toString(16).substring(2, 10);
  const userHash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0).toString(16), '').substring(0, 16);
  return `${timestamp}-${random}-${userHash}`.substring(0, 32);
}

/**
 * Vérifie si un token est valide (existe et n'est pas expiré)
 */
function validateAuthToken(userId, token) {
  const stored = userAuthTokens.get(userId);
  if (!stored || stored.token !== token) {
    return false;
  }

  // Vérifier l'expiration
  const now = Date.now();
  if (now - stored.createdAt > TOKEN_VALIDITY_MS) {
    console.warn(`⚠️ Token expiré pour ${userId}`);
    userAuthTokens.delete(userId);
    return false;
  }

  return true;
}

// Stockage temporaire en mémoire RAM pour les offres d'appel (évite de surcharger FCM)
const pendingCalls = new Map();

// Rate limiter pour les tentatives de join de réunion (IP → {count, lastAttempt})
const meetingJoinRateLimiter = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_ATTEMPTS = 10; // 10 tentatives par minute

/**
 * Vérifie si une IP a dépassé la limite de tentatives de join
 * @param {string} ip - Adresse IP du client
 * @returns {boolean} true si autorisé, false si rate limit atteint
 */
function checkMeetingJoinRateLimit(ip) {
  const now = Date.now();
  const record = meetingJoinRateLimiter.get(ip);

  if (!record) {
    meetingJoinRateLimiter.set(ip, { count: 1, lastAttempt: now });
    return true;
  }

  // Si la fenêtre de temps est expirée, réinitialiser
  if (now - record.lastAttempt > RATE_LIMIT_WINDOW) {
    meetingJoinRateLimiter.set(ip, { count: 1, lastAttempt: now });
    return true;
  }

  // Vérifier si la limite est atteinte
  if (record.count >= RATE_LIMIT_MAX_ATTEMPTS) {
    console.warn(`⚠️ Rate limit atteint pour IP ${ip}: ${record.count} tentatives`);
    return false;
  }

  // Incrémenter le compteur
  record.count++;
  record.lastAttempt = now;
  meetingJoinRateLimiter.set(ip, record);
  return true;
}

/**
 * Valide et sanitize une chaîne de caractères
 * @param {string} str - Chaîne à valider
 * @param {number} maxLength - Longueur maximale
 * @returns {string} Chaîne sanitizée
 */
function sanitizeString(str, maxLength = 1000) {
  if (typeof str !== 'string') return '';
  // Tronquer si trop long
  if (str.length > maxLength) str = str.substring(0, maxLength);
  // Supprimer les caractères dangereux
  return str.replace(/[<>]/g, '');
}

/**
 * Valide les données d'un message de réunion
 * @param {object} data - Données du message
 * @param {string} type - Type de message
 * @returns {object} {valid: boolean, reason: string}
 */
function normalizeScheduledAt(scheduledAt) {
  if (scheduledAt === null || scheduledAt === undefined || scheduledAt === "") {
    return { valid: true, value: Date.now() };
  }
  if (typeof scheduledAt === "number") {
    return Number.isFinite(scheduledAt)
      ? { valid: true, value: scheduledAt }
      : { valid: false, reason: "Date invalide" };
  }
  if (typeof scheduledAt === "string") {
    const trimmed = scheduledAt.trim();
    const parsed = /^\d+$/.test(trimmed) ? Number(trimmed) : Date.parse(trimmed);
    return Number.isFinite(parsed)
      ? { valid: true, value: parsed }
      : { valid: false, reason: "Date invalide" };
  }
  return { valid: false, reason: "Date invalide" };
}

function validateMeetingMessage(data, type) {
  if (!data || typeof data !== 'object') {
    return { valid: false, reason: 'Données invalides' };
  }

  switch (type) {
    case 'meeting-create':
    case 'create-meeting':
      if (!data.title || typeof data.title !== 'string' || data.title.trim().length === 0 || data.title.length > 100) {
        return { valid: false, reason: 'Titre invalide (1 à 100 caractères)' };
      }
      if (data.description && typeof data.description === 'string' && data.description.length > 500) {
        return { valid: false, reason: 'Description trop longue (max 500 caractères)' };
      }
      if (!normalizeScheduledAt(data.scheduledAt).valid) {
        return { valid: false, reason: 'Date invalide' };
      }
      if (data.durationMin !== undefined && data.durationMin !== null && data.durationMin !== '') {
        const dur = Number(data.durationMin);
        if (!Number.isFinite(dur) || dur < 15 || dur > 480) {
          return { valid: false, reason: 'Durée invalide (entre 15 et 480 minutes)' };
        }
      }
      break;

    case 'meeting-join':
    case 'meeting-force-start':
      if (!data.code || typeof data.code !== 'string' || data.code.length > 20) {
        return { valid: false, reason: 'Code invalide' };
      }
      break;

    case 'meeting-cancel':
      if (!data.meetingId || typeof data.meetingId !== 'string' || data.meetingId.length > 100) {
        return { valid: false, reason: 'ID de réunion invalide' };
      }
      break;

    case 'meeting-approve':
    case 'meeting-reject':
      if (!data.meetingId || typeof data.meetingId !== 'string' || data.meetingId.length > 100) {
        return { valid: false, reason: 'ID de réunion invalide' };
      }
      if (!data.userId || typeof data.userId !== 'string' || data.userId.length > 100) {
        return { valid: false, reason: 'ID utilisateur invalide' };
      }
      break;

    case 'meeting-end':
      if (!data.meetingId || typeof data.meetingId !== 'string' || data.meetingId.length > 100) {
        return { valid: false, reason: 'ID de réunion invalide' };
      }
      break;

    case 'meeting-chat-message':
      if (!data.message || typeof data.message !== 'string' || data.message.length > 1000) {
        return { valid: false, reason: 'Message invalide (max 1000 caractères)' };
      }
      if (!data.meetingId || typeof data.meetingId !== 'string' || data.meetingId.length > 100) {
        return { valid: false, reason: 'ID de réunion invalide' };
      }
      if (!data.roomId || typeof data.roomId !== 'string' || data.roomId.length > 100) {
        return { valid: false, reason: 'ID de salle invalide' };
      }
      break;

    case 'meeting-participant-state':
      if (!data.roomId || typeof data.roomId !== 'string' || data.roomId.length > 100) {
        return { valid: false, reason: 'ID de salle invalide' };
      }
      if (!data.userId || typeof data.userId !== 'string' || data.userId.length > 100) {
        return { valid: false, reason: 'ID utilisateur invalide' };
      }
      if (!data.state || typeof data.state !== 'object') {
        return { valid: false, reason: 'État invalide' };
      }
      break;

    default:
      break;
  }

  return { valid: true };
}

/**
 * Sanitize une chaîne pour éviter les injections XSS
 * NB : il existait DEUX définitions de sanitizeString ; la seconde écrasait
 * la première et rendait maxLength inopérant. Fusionnées ici.
 */
function escapeHtmlServer(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// =========================================================
// APPEL DE GROUPE — RoomManager (Style WhatsApp)
// =========================================================
/**
 * =========================================================
 *   GESTION DES APPELS DE GROUPE - SERVEUR
 * =========================================================
 * 
 * Classe RoomManager : Gère les salles d'appel de groupe en maillage (mesh)
 * 
 * ARCHITECTURE WEBRTC MESH :
 * - Chaque participant est connecté directement à tous les autres (maillage complet)
 * - Pas de serveur de médias central : les flux vidéo/audio circulent directement entre pairs
 * - Le serveur ne sert qu'à la signalisation (échange des offres/réponses SDP et candidats ICE)
 * 
 * COMPORTEMENT STYLE WHATSAPP :
 * - Pas d'hôte : la salle vit tant qu'au moins 1 participant est JOINED
 * - Chaque invité accepte ou refuse indépendamment
 * - Les invités peuvent rejoindre même après avoir refusé (tant que la salle est active)
 * - Chaque invitation expire après INVITE_TIMEOUT_MS (45 secondes)
 * 
 * ÉTATS D'UN PARTICIPANT :
 * - RINGING : L'utilisateur est invité et n'a pas encore répondu
 * - JOINED : L'utilisateur a accepté et participe activement à l'appel
 * - LEFT : L'utilisateur a quitté l'appel volontairement
 * - DECLINED : L'utilisateur a refusé l'invitation
 * - MISSED : L'invitation a expiré (l'utilisateur n'a pas répondu à temps)
 * 
 * CYCLE DE VIE D'UN PARTICIPANT :
 * RINGING -> JOINED -> LEFT
 * RINGING -> DECLINED
 * RINGING -> MISSED (expiration du timer)
 * DECLINED/MISSED/LEFT -> JOINED (rejoindre possible)
 * 
 * CAPACITÉ :
 * - Maximum 6 participants simultanés (JOINED + RINGING comptés ensemble)
 * - WhatsApp limite à 8, mais 6 est raisonnable pour le maillage complet
 */
class RoomManager {
  constructor() {
    // Map globale de toutes les salles actives
    // Clé : roomId (identifiant unique de la salle)
    // Valeur : { roomId, creatorId, isVideo, createdAt, participants: Map<userId, {state, invitedBy, inviteTimer}>, isMeeting: boolean }
    this.rooms = new Map();
    
    // Maximum de participants par salle (JOINED + RINGING)
    this.MAX_PARTICIPANTS = 15;
    
    // Délai d'expiration d'une invitation (45 secondes comme WhatsApp)
    this.INVITE_TIMEOUT_MS = 45000;
    
    // Délai de grâce avant de marquer un utilisateur LEFT lors d'une déconnexion (30 secondes)
    this.DISCONNECT_GRACE_MS = 30000;
    
    // Map des timers de grâce pour les déconnexions (userId → timer)
    this.disconnectGraceTimers = new Map();
  }

  /**
   * =========================================================
   *   CRÉATION DE SALLE
   * =========================================================
   * 
   * Crée une nouvelle salle d'appel de groupe
   * 
   * UTILISATION : Quand un utilisateur lance un appel de groupe
   * - Le créateur est automatiquement ajouté comme JOINED
   * - L'ID de salle est généré : room_<timestamp>_<creatorId>
   * 
   * @param {string} creatorId - Identifiant unique du créateur de la salle
   * @param {boolean} isVideo - Type d'appel (true = vidéo, false = audio uniquement)
   * @returns {object} La salle créée avec tous ses détails
   */
  createRoom(creatorId, isVideo, isMeeting = false) {
    // Génération d'un ID unique pour la salle
    const roomId = `room_${Date.now()}_${creatorId}`;
    
    // Création de l'objet salle
    const room = {
      roomId,           // Identifiant unique de la salle
      creatorId,        // ID de l'utilisateur qui a créé la salle
      isVideo,          // true = appel vidéo, false = appel audio
      isMeeting,        // true = salle de réunion planifiée (ne ferme pas quand vide)
      createdAt: Date.now(),  // Timestamp de création
      endsAt: null,     // Timestamp de fin (pour les réunions)
      participants: new Map(), // Pour les réunions, salle vide au départ
    };
    
    // Pour les appels de groupe instantanés, le créateur est JOINED immédiatement
    // Pour les réunions, la salle est vide et chacun JOINED via group-join
    if (!isMeeting) {
      room.participants.set(creatorId, {
        state: "JOINED",
        invitedBy: creatorId,
        inviteTimer: null,
      });
    }
    
    // Ajout de la salle à la Map globale
    this.rooms.set(roomId, room);
    console.log(`🏠 Salle créée : ${roomId} par ${creatorId} (${isVideo ? "vidéo" : "audio"}) ${isMeeting ? "[RÉUNION]" : "[GROUPE]"}`);
    return room;
  }

  /**
   * =========================================================
   *   INVITATION DE PARTICIPANTS
   * =========================================================
   * 
   * Invite des utilisateurs à une salle existante
   * 
   * VALIDATIONS :
   * - L'inviteur doit être JOINED dans la salle
   * - L'invité ne doit pas déjà être JOINED ou RINGING dans cette salle
   * - L'invité ne doit pas être occupé dans une autre salle
   * - La salle ne doit pas être pleine (max 6 participants)
   * 
   * RÉINVITATION :
   * - Si un utilisateur a LEFT/DECLINED/MISSED, il peut être réinvité
   * - Son timer est réinitialisé et son état repasse à RINGING
   * 
   * @param {string} roomId - Identifiant de la salle
   * @param {Array<string>} invitedIds - Liste des identifiants à inviter
   * @param {string} inviterId - Identifiant de celui qui invite (doit être JOINED)
   * @returns {Array<{userId, success, reason}>} Résultat pour chaque invitation
   */
  invite(roomId, invitedIds, inviterId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return [];
    }

    // Garde-fou : invitedIds doit être un tableau
    const ids = Array.isArray(invitedIds) ? invitedIds : [];
    const results = [];
    const inviterState = room.participants.get(inviterId);

    // Vérifier que l'inviteur est JOINED (autorisation)
    if (!inviterState || inviterState.state !== "JOINED") {
      return ids.map((id) => ({
        userId: id,
        success: false,
        reason: "Non autorisé",
      }));
    }

    // Traitement de chaque invitation
    for (const invitedId of ids) {
      // Vérifier que l'invité n'est pas déjà dans la salle (sauf LEFT/DECLINED/MISSED qu'on peut réinviter)
      const existingParticipant = room.participants.get(invitedId);
      if (existingParticipant && (existingParticipant.state === "JOINED" || existingParticipant.state === "RINGING")) {
        results.push({
          userId: invitedId,
          success: false,
          reason: "Déjà dans la salle",
        });
        continue;
      }

      // Vérifier que l'invité n'est pas déjà dans une autre salle (seulement JOINED/RINGING bloquent)
      if (this.isUserInAnyRoom(invitedId)) {
        results.push({
          userId: invitedId,
          success: false,
          reason: "Occupé",
        });
        continue;
      }

      // Vérifier la capacité maximale de la salle
      const totalParticipants = room.participants.size;
      if (totalParticipants >= this.MAX_PARTICIPANTS) {
        results.push({
          userId: invitedId,
          success: false,
          reason: "Salle pleine",
        });
        continue;
      }

      // Cas 1 : L'utilisateur existe déjà (LEFT/DECLINED/MISSED) -> réinviter
      if (existingParticipant) {
        // Annuler l'ancien timer d'invitation s'il existe
        if (existingParticipant.inviteTimer) {
          clearTimeout(existingParticipant.inviteTimer);
        }

        // Réinitialiser à RINGING avec nouveau timer d'expiration
        const inviteTimer = setTimeout(() => {
          this.markMissed(roomId, invitedId);
        }, this.INVITE_TIMEOUT_MS);

        existingParticipant.state = "RINGING";
        existingParticipant.invitedBy = inviterId;
        existingParticipant.inviteTimer = inviteTimer;

        console.log(`📩 ${invitedId} réinvité à la salle ${roomId} par ${inviterId} (état précédent: ${existingParticipant.state})`);
        results.push({
          userId: invitedId,
          success: true,
        });
      } else {
        // Cas 2 : Nouvel invité -> ajouter avec état RINGING
        const inviteTimer = setTimeout(() => {
          this.markMissed(roomId, invitedId);
        }, this.INVITE_TIMEOUT_MS);

        room.participants.set(invitedId, {
          state: "RINGING",
          invitedBy: inviterId,
          inviteTimer,
        });

        console.log(`📩 ${invitedId} invité à la salle ${roomId} par ${inviterId}`);
        results.push({
          userId: invitedId,
          success: true,
        });
      }
    }

    // Diffuser le roster mis à jour à tous les participants JOINED
    this.broadcastRoster(roomId);

    return results;
  }

  /**
   * =========================================================
   *   REJOINDRE UNE SALLE
   * =========================================================
   * 
   * Un utilisateur rejoint une salle (accepte l'invitation ou rejoint après avoir refusé)
   * 
   * VALIDATIONS :
   * - La salle doit exister
   * - Si l'utilisateur n'est pas dans la salle : vérifier la capacité
   * - Si l'utilisateur n'est pas dans la salle : vérifier qu'il n'est pas dans une autre salle
   * 
   * EFFETS :
   * - L'état passe à JOINED
   * - Le timer d'invitation est annulé
   * - Le roster est diffusé à tous les participants
   * 
   * @param {string} roomId - Identifiant de la salle
   * @param {string} userId - Identifiant de l'utilisateur
   * @returns {boolean} true si rejoint avec succès, false sinon
   */
  join(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    const participant = room.participants.get(userId);

    // Cas 1 : L'utilisateur n'est pas encore dans la salle
    if (!participant) {
      // Vérifier la capacité maximale
      if (room.participants.size >= this.MAX_PARTICIPANTS) {
        return false;
      }

      // Vérifier qu'il n'est pas déjà dans une autre salle
      if (this.isUserInAnyRoom(userId)) {
        return false;
      }

      // Ajouter comme JOINED
      room.participants.set(userId, {
        state: "JOINED",
        invitedBy: userId,
        inviteTimer: null,
      });
      console.log(`👤 ${userId} a rejoint la salle ${roomId}`);
    } else {
      // Cas 2 : L'utilisateur est déjà dans la salle (LEFT/DECLINED/MISSED/RINGING)
      // Changer son état à JOINED
      // Annuler le timer d'invitation s'il existe
      if (participant.inviteTimer) {
        clearTimeout(participant.inviteTimer);
        participant.inviteTimer = null;
      }

      participant.state = "JOINED";
      console.log(`👤 ${userId} a rejoint la salle ${roomId} (état mis à jour)`);
    }

    // Diffuser le roster mis à jour à tous les participants JOINED
    this.broadcastRoster(roomId);

    return true;
  }

  /**
   * =========================================================
   *   REFUSER UNE INVITATION
   * =========================================================
   * 
   * Un utilisateur refuse une invitation d'appel de groupe
   * 
   * VALIDATIONS :
   * - La salle doit exister
   * - L'utilisateur doit être en état RINGING
   * 
   * EFFETS :
   * - L'état passe à DECLINED
   * - Le timer d'invitation est annulé
   * - Le roster est diffusé à tous les participants
   * - La salle peut être fermée si plus personne n'est actif
   * 
   * NOTE : L'utilisateur peut être réinvité plus tard
   * 
   * @param {string} roomId - Identifiant de la salle
   * @param {string} userId - Identifiant de l'utilisateur
   * @returns {boolean} true si refusé avec succès, false sinon
   */
  decline(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    const participant = room.participants.get(userId);
    if (!participant || participant.state !== "RINGING") {
      return false;
    }

    // Annuler le timer d'invitation
    if (participant.inviteTimer) {
      clearTimeout(participant.inviteTimer);
      participant.inviteTimer = null;
    }

    participant.state = "DECLINED";
    console.log(`🚫 ${userId} a refusé l'invitation à la salle ${roomId}`);

    // Diffuser le roster mis à jour à tous les participants JOINED
    this.broadcastRoster(roomId);

    // Vérifier si la salle doit être fermée (plus personne actif)
    this.checkRoomClosure(roomId);

    return true;
  }

  /**
   * =========================================================
   *   QUITTER UNE SALLE
   * =========================================================
   * 
   * Un utilisateur quitte volontairement une salle en cours d'appel
   * 
   * VALIDATIONS :
   * - La salle doit exister
   * - L'utilisateur doit être dans la salle
   * 
   * EFFETS :
   * - L'état passe à LEFT
   * - Le timer d'invitation est annulé
   * - Le roster est diffusé à tous les participants
   * - La salle peut être fermée si plus personne n'est actif
   * 
   * NOTE : L'utilisateur peut être réinvité plus tard
   * 
   * @param {string} roomId - Identifiant de la salle
   * @param {string} userId - Identifiant de l'utilisateur
   * @returns {boolean} true si quitté avec succès, false sinon
   */
  leave(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    const participant = room.participants.get(userId);
    if (!participant) {
      return false;
    }

    // Annuler le timer d'invitation s'il existe
    if (participant.inviteTimer) {
      clearTimeout(participant.inviteTimer);
      participant.inviteTimer = null;
    }

    participant.state = "LEFT";
    console.log(`👋 ${userId} a quitté la salle ${roomId}`);

    // Diffuser le roster mis à jour à tous les participants JOINED
    this.broadcastRoster(roomId);

    // Vérifier si la salle doit être fermée (plus personne actif)
    this.checkRoomClosure(roomId);

    return true;
  }

  /**
   * =========================================================
   *   MARQUER APPEL MANQUÉ
   * =========================================================
   * 
   * Marque un utilisateur comme MISSED quand son invitation expire
   * 
   * VALIDATIONS :
   * - La salle doit exister
   * - L'utilisateur doit être en état RINGING
   * 
   * EFFETS :
   * - L'état passe à MISSED
   * - Le timer est supprimé
   * - Une notification FCM est envoyée (appel manqué)
   * - Le roster est diffusé à tous les participants
   * - La salle peut être fermée si plus personne n'est actif
   * 
   * @param {string} roomId - Identifiant de la salle
   * @param {string} userId - Identifiant de l'utilisateur
   */
  markMissed(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    const participant = room.participants.get(userId);
    if (!participant || participant.state !== "RINGING") {
      return;
    }

    participant.state = "MISSED";
    participant.inviteTimer = null;
    console.log(`⏰ Invitation expirée pour ${userId} dans la salle ${roomId}`);

    // Envoyer notification FCM d'appel manqué
    const user = users.get(userId);
    if (user?.pushToken) {
      envoyerNotificationAppelManque(
        user.pushToken,
        room.creatorId,
        room.isVideo,
        null, // Pas de notId spécifique pour les appels de groupe
      );
    }

    // Diffuser le roster mis à jour à tous les participants JOINED
    this.broadcastRoster(roomId);

    // Vérifier si la salle doit être fermée (plus personne actif)
    this.checkRoomClosure(roomId);
  }

  /**
   * =========================================================
   *   RÉCUPÉRER LE ROSTER
   * =========================================================
   * 
   * Récupère la liste de tous les participants avec leur état
   * 
   * @param {string} roomId - Identifiant de la salle
   * @returns {Array<{userId, state}>} Roster ou null si salle inexistante
   */
  getRoster(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }

    const roster = [];
    for (const [userId, data] of room.participants.entries()) {
        roster.push({
        userId,
        name: getUserDisplayName(userId),
        state: data.state,
      });
    }
    return roster;
  }

  /**
   * =========================================================
   *   COMPTER LES PARTICIPANTS ACTIFS
   * =========================================================
   * 
   * Compte le nombre de participants JOINED dans une salle
   * 
   * UTILISATION : Pour vérifier si l'appel est en cours
   * 
   * @param {string} roomId - Identifiant de la salle
   * @returns {number} Nombre de participants JOINED
   */
  countJoined(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return 0;
    }

    let count = 0;
    for (const participant of room.participants.values()) {
      if (participant.state === "JOINED") {
        count++;
      }
    }
    return count;
  }

  /**
   * =========================================================
   *   COMPTER LES PARTICIPANTS EN ATTENTE
   * =========================================================
   * 
   * Compte le nombre de participants RINGING dans une salle
   * 
   * UTILISATION : Pour vérifier combien de personnes sont en train de sonner
   * 
   * @param {string} roomId - Identifiant de la salle
   * @returns {number} Nombre de participants RINGING
   */
  countRinging(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return 0;
    }

    let count = 0;
    for (const participant of room.participants.values()) {
      if (participant.state === "RINGING") {
        count++;
      }
    }
    return count;
  }

  /**
   * =========================================================
   *   DIFFUSER LE ROSTER
   * =========================================================
   * 
   * Diffuse le roster à tous les participants JOINED d'une salle
   * 
   * BUT : Informer tous les participants actifs des changements
   *       (quelqu'un a rejoint, quitté, refusé, etc.)
   * 
   * MESSAGE : { type: "group-roster", roomId, roster }
   * 
   * IMPORTANT : 
   * - Seuls les participants JOINED reçoivent le message
   * - Le roster envoyé ne contient QUE les participants JOINED
   *   (pas RINGING, LEFT, DECLINED, MISSED) pour éviter que les participants
   *   existants ne voient l'interface de ceux qui sonnent
   * 
   * @param {string} roomId - Identifiant de la salle
   */
  broadcastRoster(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    // IMPORTANT : Filtrer le roster pour n'envoyer que les participants JOINED
    // Cela évite que les participants existants ne voient ceux qui sonnent
    const joinedRoster = [];
    for (const [userId, data] of room.participants.entries()) {
      if (data.state === "JOINED") {
          joinedRoster.push({
          userId,
          name: getUserDisplayName(userId),
          state: data.state,
        });
      }
    }

    const message = {
      type: "group-roster",
      roomId,
      roster: joinedRoster,
    };

    // Envoyer uniquement aux participants JOINED
    for (const [userId, data] of room.participants.entries()) {
      if (data.state === "JOINED") {
        const user = users.get(userId);
        if (user?.ws && user.ws.readyState === WebSocket.OPEN) {
          user.ws.send(JSON.stringify(message));
        }
      }
    }
  }

  /**
   * =========================================================
   *   VÉRIFIER LA FERMETURE DE SALLE
   * =========================================================
   * 
   * Vérifie si une salle doit être fermée et la ferme si nécessaire
   * 
   * CONDITION DE FERMETURE :
   * - Pour les salles de groupe instantanés : countJoined === 0 ET countRinging === 0
   * - Pour les salles de réunion : endsAt dépassé
   * 
   * @param {string} roomId - Identifiant de la salle
   */
  checkRoomClosure(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    const joinedCount = this.countJoined(roomId);
    const ringingCount = this.countRinging(roomId);
    const now = Date.now();

    // Pour les réunions : fermer seulement si endsAt est dépassé
    if (room.isMeeting) {
      if (room.endsAt && now > room.endsAt) {
        this.closeRoom(roomId, "Durée de réunion expirée");
      }
      return;
    }

    // Pour les groupes instantanés : fermer si vide
    if (joinedCount === 0 && ringingCount === 0) {
      this.closeRoom(roomId, "Plus aucun participant");
    }
  }

  /**
   * =========================================================
   *   FERMER UNE SALLE
   * =========================================================
   *
   * Ferme une salle et notifie tous les participants
   *
   * EFFETS :
   * - Annule tous les timers d'invitation
   * - Notifie tous les participants (y compris LEFT, DECLINED, MISSED)
   * - Supprime la salle de la Map globale
   * - Notifie le MeetingManager si c'est une salle de réunion
   *
   * MESSAGE : { type: "group-ended", roomId, reason }
   *
   * @param {string} roomId - Identifiant de la salle
   * @param {string} reason - Raison de la fermeture
   */
  closeRoom(roomId, reason) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    console.log(`🗑️ Fermeture de la salle ${roomId} : ${reason}`);

    // Annuler tous les timers d'invitation en cours
    for (const participant of room.participants.values()) {
      if (participant.inviteTimer) {
        clearTimeout(participant.inviteTimer);
      }
    }

    // Notifier tous les participants (y compris LEFT, DECLINED, MISSED)
    const message = {
      type: "group-ended",
      roomId,
      reason,
    };

    for (const userId of room.participants.keys()) {
      const user = users.get(userId);
      if (user?.ws && user.ws.readyState === WebSocket.OPEN) {
        user.ws.send(JSON.stringify(message));
      }
    }

    // Supprimer la salle de la Map globale
    this.rooms.delete(roomId);

    // Notifier le MeetingManager si c'est une salle de réunion
    if (typeof meetingManager !== 'undefined') {
      meetingManager.markEndedByRoom(roomId);
    }
  }

  /**
   * =========================================================
   *   CRÉER UNE SALLE DE RÉUNION (VIDE)
   * =========================================================
   * 
   * Crée une salle vide pour une réunion planifiée
   * 
   * @param {string} meetingId - ID de la réunion
   * @param {boolean} isVideo - Type d'appel
   * @param {number} endsAt - Timestamp de fin
   * @returns {object} La salle créée
   */
  createMeetingRoom(meetingId, isVideo, endsAt) {
    const roomId = `room_meeting_${meetingId}`;
    
    const room = {
      roomId,
      creatorId: null, // Pas de créateur pour les réunions
      isVideo,
      isMeeting: true,
      createdAt: Date.now(),
      endsAt,
      participants: new Map(), // Salle vide
    };
    
    this.rooms.set(roomId, room);
    console.log(`🏠 Salle de réunion créée : ${roomId} (fin à ${new Date(endsAt).toISOString()})`);
    return room;
  }

  /**
   * =========================================================
   *   VÉRIFIER SI UTILISATEUR OCCUPÉ
   * =========================================================
   * 
   * Vérifie si un utilisateur est activement dans une salle
   * 
   * CONDITIONS :
   * - Retourne true si l'utilisateur est JOINED ou RINGING dans une salle
   * - LEFT / DECLINED / MISSED ne bloquent pas les nouvelles invitations
   * 
   * UTILISATION : Empêcher un utilisateur d'être invité à une autre salle
   *             alors qu'il est déjà occupé
   * 
  */
  // A deliberate meeting join moves the user out of any previous call room.
  leaveUserFromOtherRooms(userId, keepRoomId) {
    for (const [roomId, room] of this.rooms.entries()) {
      if (roomId === keepRoomId) continue;
      const participant = room.participants.get(userId);
      if (participant && (participant.state === "JOINED" || participant.state === "RINGING")) {
        this.leave(roomId, userId);
        console.log(`[MEETING] Moved ${userId} out of previous room ${roomId}`);
      }
    }
  }

  /**
   * @param {string} userId - Identifiant de l'utilisateur
   * @returns {boolean} true si l'utilisateur est JOINED ou RINGING dans une salle
   */
  isUserInAnyRoom(userId) {
    for (const room of this.rooms.values()) {
      const p = room.participants.get(userId);
      if (p && (p.state === "JOINED" || p.state === "RINGING")) {
        return true;
      }
    }
    return false;
  }

  /**
   * =========================================================
   *   VÉRIFIER SI UTILISATEUR DANS SALLE SPÉCIFIQUE
   * =========================================================
   * 
   * Vérifie si un utilisateur est dans une salle spécifique avec un état JOINED
   * 
   * @param {string} roomId - Identifiant de la salle
   * @param {string} userId - Identifiant de l'utilisateur
   * @returns {boolean} true si l'utilisateur est JOINED dans la salle
   */
  isJoinedInRoom(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }
    const participant = room.participants.get(userId);
    return participant && participant.state === "JOINED";
  }

  /**
   * =========================================================
   *   RÉCUPÉRER LES SALLES D'UN UTILISATEUR
   * =========================================================
   * 
   * Récupère toutes les salles dans lesquelles un utilisateur participe
   * 
   * UTILISATION : Pour quitter toutes les salles lors d'une déconnexion
   * 
   * @param {string} userId - Identifiant de l'utilisateur
   * @returns {Array<string>} Liste des roomId des salles de l'utilisateur
   */
  getUserRooms(userId) {
    const userRooms = [];
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.participants.has(userId)) {
        userRooms.push(roomId);
      }
    }
    return userRooms;
  }

  /**
   * =========================================================
   *   MARQUER UTILISATEUR PARTI TOUTES LES SALLES
   * =========================================================
   * 
   * Marque un utilisateur comme LEFT dans toutes ses salles AVEC un délai de grâce
   * 
   * UTILISATION : Appelé automatiquement lors d'une déconnexion WebSocket
   *             pour nettoyer proprement l'état de l'utilisateur
   * 
   * @param {string} userId - Identifiant de l'utilisateur
   */
  markLeftInAllRooms(userId) {
    const userRooms = this.getUserRooms(userId);
    
    // Annuler le timer de grâce existant si présent
    const existingTimer = this.disconnectGraceTimers.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // Démarrer un nouveau timer de grâce
    const graceTimer = setTimeout(() => {
      console.log(`⏰ Délai de grâce expiré pour ${userId}, marquage LEFT dans toutes les salles`);
      for (const roomId of userRooms) {
        this.leave(roomId, userId);
      }
      this.disconnectGraceTimers.delete(userId);
    }, this.DISCONNECT_GRACE_MS);
    
    this.disconnectGraceTimers.set(userId, graceTimer);
    console.log(`⏰ Délai de grâce de ${this.DISCONNECT_GRACE_MS / 1000}s démarré pour ${userId}`);
  }

  /**
   * =========================================================
   *   ANNULER LE DÉLAI DE GRÂCE
   * =========================================================
   * 
   * Annule le timer de grâce si l'utilisateur se reconnecte
   * 
   * @param {string} userId - Identifiant de l'utilisateur
   */
  cancelGracePeriod(userId) {
    const timer = this.disconnectGraceTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectGraceTimers.delete(userId);
      console.log(`✅ Délai de grâce annulé pour ${userId} (reconnexion)`);
    }
  }
}

// =========================================================
// RÉUNIONS PLANIFIÉES — MeetingManager
// =========================================================
/**
 * =========================================================
 *   GESTION DES RÉUNIONS PLANIFIÉES - SERVEUR
 * =========================================================
 *
 * Classe MeetingManager : Gère les réunions planifiées (type Google Meet)
 *
 * ARCHITECTURE :
 * - Les réunions sont persistées dans Firebase Firestore (collection "meetings")
 * - À l'heure programmée, la réunion ouvre une salle live via RoomManager
 * - Les participants rejoignent via un code court unique (ex: ABC-123-XYZ)
 *
 * ÉTATS D'UNE RÉUNION :
 * - scheduled : Réunion programmée, pas encore commencée
 * - live : Réunion en cours (salle live ouverte)
 * - ended : Réunion terminée (tous partis ou time-out)
 * - cancelled : Réunion annulée par l'hôte
 *
 * RÈGLES MÉTIER :
 * - Fenêtre d'accès : 15 minutes avant scheduledAt jusqu'à endsAt
 * - Host = créateur (seul peut annuler)
 * - Code unique non devinable (9 caractères alphanumériques)
 * - MAX participants = 15 (comme les groupes actuels)
 * - Transition scheduled→live automatique à l'heure ou premier join
 */
class MeetingManager {
  constructor() {
    // Fenêtre d'accès avant l'heure programmée (15 minutes)
    this.ACCESS_WINDOW_BEFORE_MS = 15 * 60 * 1000;

    // Code unique déjà utilisés (éviter collisions)
    this.usedCodes = new Set();

    // Map en RAM pour les timers de transition scheduled→live
    this.scheduleTimers = new Map();
  }

  normalizeCode(code) {
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
  }

  /**
   * =========================================================
   *   GÉNÉRER UN CODE COURT UNIQUE
   * =========================================================
   *
   * Génère un code court de 9 caractères (format: XXX-XXX-XXX)
   * Utilise Math.random() pour simplifier (suffisant pour ce cas d'usage)
   * Caractères sans ambiguïté : pas de 0/O/1/I
   *
   * @returns {string} Code unique (ex: "ABC-123-XYZ")
   */
  _generateCode() {
    const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 32 caractères, sans 0/O/1/I
    let code;
    let attempts = 0;
    const maxAttempts = 100;

    do {
      const parts = [];
      for (let i = 0; i < 3; i++) {
        let part = "";
        for (let j = 0; j < 3; j++) {
          part += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        parts.push(part);
      }
      code = parts.join("-");
      attempts++;
      
      // Vérifier dans le set local (optimisation)
      if (!this.usedCodes.has(code)) {
        this.usedCodes.add(code);
        return code;
      }
    } while (attempts < maxAttempts);

    throw new Error("Impossible de générer un code unique après 100 tentatives");
  }

  /**
   * =========================================================
   *   CRÉER UNE RÉUNION
   * =========================================================
   *
   * Crée une nouvelle réunion planifiée et la persiste dans Firestore
   *
   * @param {object} params - Paramètres de la réunion
   * @param {string} params.title - Titre de la réunion
   * @param {number} params.scheduledAt - Timestamp de l'heure programmée
   * @param {number} params.durationMin - Durée en minutes
   * @param {boolean} params.isVideo - true = vidéo, false = audio
   * @param {string} params.createdBy - ID du créateur (host)
   * @param {Array<string>} params.participants - Liste des participants invités
   * @returns {Promise<object>} Réunion créée avec meetingId, code, link
   */
  async create({ title, description, scheduledAt, durationMin, isVideo, createdBy, hostName, participants, accessPolicy }) {
    // Validation des paramètres
    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return { success: false, reason: "Le titre est requis" };
    }

    if (title.length > 100) {
      return { success: false, reason: "Le titre ne peut pas dépasser 100 caractères" };
    }

    if (description && description.length > 500) {
      return { success: false, reason: "La description ne peut pas dépasser 500 caractères" };
    }

    const parsedSchedule = normalizeScheduledAt(scheduledAt);
    if (!parsedSchedule.valid) {
      return { success: false, reason: "Date invalide" };
    }
    const normalizedScheduledAt = parsedSchedule.value;

    // Validation de la date: doit être dans le futur OU dans les 5 dernières secondes (réunion immédiate)
    const now = Date.now();
    if (normalizedScheduledAt <= now - 5000 && normalizedScheduledAt < now + 60000) {
      return { success: false, reason: "L'heure doit être dans le futur (au moins 1 minute)" };
    }

    const normalizedDuration = (durationMin === undefined || durationMin === null || durationMin === "") ? 60 : Number(durationMin);
    if (!Number.isFinite(normalizedDuration) || normalizedDuration < 15 || normalizedDuration > 480) {
      return { success: false, reason: "La durée doit être entre 15 et 480 minutes" };
    }

    if (participants && (!Array.isArray(participants) || participants.length > 14)) {
      return { success: false, reason: "Maximum 14 participants" };
    }
    
    const meetingId = `meeting_${Date.now()}_${createdBy}`;
    const code = await this._generateCode();
    const endsAt = normalizedScheduledAt + (normalizedDuration * 60 * 1000);
    const link = `https://app-appel.onrender.com/join/${code}`;

    const meeting = {
      meetingId,
      code,
      title: title.trim(),
      description: description ? description.trim() : "",
      scheduledAt: normalizedScheduledAt,
      durationMin: normalizedDuration,
      endsAt,
      isVideo: !!isVideo,
      createdBy,
      hostName: typeof hostName === "string" && hostName.trim() ? sanitizeString(hostName, 60) : (userDisplayNames.get(createdBy) || createdBy),
      participants: participants || [],
      status: "scheduled",
      roomId: null,
      waitingUsers: [],
      accessPolicy: accessPolicy || "direct", // "direct" ou "approval"
      pendingRequests: [], // Demandes d'accès en attente
      approvedUsers: [], // Users déjà approuvés (reconnexion)
      createdAt: Date.now(),
      link,
      success: true,
    };

    // Persister dans Firestore
    await db.collection("meetings").doc(meetingId).set(meeting);

    // Programmer les notifications de rappel
    this._scheduleMeetingNotifications(meetingId, scheduledAt, participants || []);

    console.log(`📅 Réunion créée: ${meetingId} avec code ${code}`);

    return meeting;
  }

  /**
   * =========================================================
   *   PROGRAMMER LES NOTIFICATIONS DE RAPPEL
   * =========================================================
   */
  _scheduleMeetingNotifications(meetingId, scheduledAt, participants) {
    const reminderTime = scheduledAt - (10 * 60 * 1000); // 10 min avant
    const now = Date.now();
    
    // Rappel T-10 min
    if (reminderTime > now) {
      safeSetTimeout(async () => {
        try {
        const doc = await db.collection("meetings").doc(meetingId).get();
        if (doc.exists && doc.data().status === "scheduled") {
          const meeting = doc.data();
          const message = {
            type: "meeting-reminder",
            meetingId,
            code: meeting.code,
            title: meeting.title,
            scheduledAt: meeting.scheduledAt,
          };

          for (const userId of participants) {
            const user = users.get(userId);
            if (user?.pushToken) {
              await envoyerNotificationPush(
                user.pushToken,
                "Rappel de réunion",
                `${meeting.title} commence dans 10 minutes`,
                meeting.code,
                null,
                false,
                null,
                "meeting-reminder"
              );
            }
          }
        }
        } catch (error) {
          console.error(`❌ Erreur notification rappel ${meetingId} :`, error);
        }
      }, reminderTime - now);
    }
    
    // Notification "commence maintenant" à l'heure H
    if (scheduledAt > now) {
      safeSetTimeout(async () => {
        try {
        const doc = await db.collection("meetings").doc(meetingId).get();
        if (doc.exists && doc.data().status === "scheduled") {
          const meeting = doc.data();
          const message = {
            type: "meeting-start",
            meetingId,
            code: meeting.code,
            title: meeting.title,
          };

          for (const userId of participants) {
            const user = users.get(userId);
            if (user?.pushToken) {
              await envoyerNotificationPush(
                user.pushToken,
                "Réunion en cours",
                `${meeting.title} commence maintenant`,
                meeting.code,
                null,
                false,
                null,
                "meeting-start"
              );
            }
          }
        }
        } catch (error) {
          console.error(`❌ Erreur notification démarrage ${meetingId} :`, error);
        }
      }, scheduledAt - now);
    }
  }

  /**
   * =========================================================
   *   ENVOYER MEETING-ENDED À TOUS LES PARTICIPANTS
   * =========================================================
   */
  async _sendMeetingEnded(meetingId, reason) {
    const doc = await db.collection("meetings").doc(meetingId).get();
    if (!doc.exists) return;
    
    const meeting = doc.data();
    const message = {
      type: "meeting-ended",
      meetingId,
      reason,
    };
    
    // Envoyer à tous les participants enregistrés
    for (const userId of meeting.participants) {
      const user = users.get(userId);
      if (user?.ws && user.ws.readyState === WebSocket.OPEN) {
        user.ws.send(JSON.stringify(message));
      }
    }
  }

  /**
   * =========================================================
   *   RÉCUPÉRER UNE RÉUNION PAR CODE
   * =========================================================
   *
   * @param {string} code - Code de la réunion (normalisé : majuscules, sans tirets)
   * @returns {Promise<object|null>} Réunion ou null si introuvable
   */
  async getByCode(code) {
    const normalizedCode = this.normalizeCode(code);
    const normalizedDigits = normalizedCode.replace(/-/g, "");
    const candidateCodes = [...new Set([
      normalizedCode,
      normalizedDigits,
      code ? String(code).trim() : "",
      code ? String(code).trim().toUpperCase() : "",
    ].filter(Boolean))];

    // Utiliser une requête where pour optimiser (nécessite un index Firestore sur 'code')
    // Fallback: si la requête échoue, utiliser la méthode get() complète
    try {
      for (const candidate of candidateCodes) {
        const snapshot = await db.collection("meetings").where("code", "==", candidate).limit(1).get();
        if (!snapshot.empty) {
          const doc = snapshot.docs[0];
          return { id: doc.id, ...doc.data() };
        }
      }
    } catch (error) {
      console.warn("⚠️ Index Firestore sur 'code' manquant, utilisation du fallback");
    }

    try {
      const snapshot = await db.collection("meetings").get();
      const doc = snapshot.docs.find((d) => {
        const currentCode = d.data().code;
        if (!currentCode) return false;
        return this.normalizeCode(currentCode).replace(/-/g, "") === normalizedDigits;
      });
      if (doc) {
        return { id: doc.id, ...doc.data() };
      }
    } catch (error) {
      console.error("❌ Erreur fallback getByCode:", error);
    }

    return null;
  }

  async _addWaitingUser(meetingId, userId) {
    // arrayUnion : atomique — deux arrivées simultanées ne s'écrasent plus
    // (précédemment read-modify-write → lost update, un utilisateur pouvait
    // disparaître de la liste et ne jamais être intégré à la salle live).
    await db.collection("meetings").doc(meetingId).update({
      waitingUsers: FieldValue.arrayUnion(userId),
    });
  }

  async _removeWaitingUser(meetingId, userId) {
    await db.collection("meetings").doc(meetingId).update({
      waitingUsers: FieldValue.arrayRemove(userId),
    });
  }

  async _addPendingRequest(meetingId, userId) {
    const meetingDoc = await db.collection("meetings").doc(meetingId).get();
    if (!meetingDoc.exists) return;

    const current = meetingDoc.data();
    const pendingRequests = Array.isArray(current.pendingRequests) ? current.pendingRequests.filter(Boolean) : [];

    // Vérifier si déjà en attente (la liste contient des objets, impossible avec arrayUnion)
    if (pendingRequests.some(req => req.userId === userId)) {
      return;
    }

    await db.collection("meetings").doc(meetingId).update({
      pendingRequests: FieldValue.arrayUnion({
        userId,
        requestedAt: Date.now(),
      }),
    });
  }

  async _removePendingRequest(meetingId, userId) {
    const meetingDoc = await db.collection("meetings").doc(meetingId).get();
    if (!meetingDoc.exists) return;

    const current = meetingDoc.data();
    const pendingRequests = Array.isArray(current.pendingRequests) ? current.pendingRequests.filter(Boolean) : [];
    const requestToRemove = pendingRequests.find((req) => req.userId === userId);
    if (!requestToRemove) return;

    await db.collection("meetings").doc(meetingId).update({
      pendingRequests: FieldValue.arrayRemove(requestToRemove),
    });
  }

  async _notifyHostOfPendingRequest(meetingId, userId, hostId, title) {
    const hostUser = users.get(hostId);
    if (hostUser?.ws && hostUser.ws.readyState === WebSocket.OPEN) {
      hostUser.ws.send(JSON.stringify({
        type: "meeting-pending-request",
        meetingId,
        userId,
        title,
      }));
      console.log(`📅 Notification de demande d'accès envoyée à l'hôte ${hostId}`);
    }
  }

  async _notifyWaitingUsersStarted(meetingId, roomId, title, isVideo, excludeUserId = null, waitingUsersParam = null) {
    const room = roomManager.rooms.get(roomId);

    // Utiliser la liste passée en paramètre si disponible, sinon la lire depuis Firestore
    let waitingUsers = waitingUsersParam;
    if (!waitingUsers) {
      const meetingDoc = await db.collection("meetings").doc(meetingId).get();
      if (!meetingDoc.exists) return;

      const meeting = meetingDoc.data();
      waitingUsers = Array.isArray(meeting.waitingUsers) ? meeting.waitingUsers.filter(Boolean) : [];
    }

    // Lire la politique d'accès
    const meetingSnap = await db.collection("meetings").doc(meetingId).get();
    const meetingData = meetingSnap.exists ? meetingSnap.data() : {};
    const isLocked = !!(meetingData.lockMeeting || meetingData.alwaysWaitingRoom);
    const approvedUsers = Array.isArray(meetingData.approvedUsers) ? meetingData.approvedUsers : [];
    const participantsList = Array.isArray(meetingData.participants) ? meetingData.participants : [];
    const coHosts = Array.isArray(meetingData.coHosts) ? meetingData.coHosts : [];
    const needsApproval = meetingData.accessPolicy === "approval";

    // Inclure également les utilisateurs présents en RAM dans room_waiting_<meetingId>
    const waitingRoomId = `room_waiting_${meetingId}`;
    const waitingRoomInRam = roomManager.rooms.get(waitingRoomId);
    const mergedWaitingUsers = new Set(waitingUsers);
    if (waitingRoomInRam) {
      for (const ramUserId of waitingRoomInRam.participants.keys()) {
        if (ramUserId) mergedWaitingUsers.add(ramUserId);
      }
    }

    // Préparer la map des notifications pour Firestore
    const notifiedUsers = {};
    for (const waitingUserId of mergedWaitingUsers) {
      if (excludeUserId && waitingUserId === excludeUserId) continue;

      const isPrivilegedOrApproved =
        waitingUserId === meetingData.createdBy ||
        coHosts.includes(waitingUserId) ||
        approvedUsers.includes(waitingUserId) ||
        participantsList.includes(waitingUserId);

      // Mode approbation : demander l'accord de l'hôte uniquement si non déjà approuvé/participant
      if (needsApproval && !isPrivilegedOrApproved) {
        await this._addPendingRequest(meetingId, waitingUserId);
        await this._notifyHostOfPendingRequest(meetingId, waitingUserId, meetingData.createdBy || excludeUserId, title);
        const user = users.get(waitingUserId);
        if (user?.ws && user.ws.readyState === WebSocket.OPEN) {
          user.ws.send(JSON.stringify({
            type: "meeting-pending-approval",
            meetingId,
            reason: "En attente d'approbation de l'hôte",
          }));
        }
        notifiedUsers[waitingUserId] = true;
        continue;
      }

      // Basculer immédiatement de la salle d'attente vers la salle live
      if (room) {
        if (waitingRoomInRam?.participants.has(waitingUserId)) {
          roomManager.leave(waitingRoomId, waitingUserId);
        }
        roomManager.join(roomId, waitingUserId);
        // Vérifier le résultat réel du join : sans cela, un utilisateur occupé
        // ou une salle pleine recevait meeting-joined sans être dans la salle
        // (écran "Connexion..." figé).
        if (!room.participants.has(waitingUserId)) {
          notifiedUsers[waitingUserId] = false;
          continue;
        }
      }

      const user = users.get(waitingUserId);
      if (user?.ws && user.ws.readyState === WebSocket.OPEN) {
        user.ws.send(JSON.stringify({
          type: "meeting-joined",
          meetingId,
          roomId,
          isVideo,
          title,
          code: meetingData.code,
          createdBy: excludeUserId,
        }));
        notifiedUsers[waitingUserId] = true;
      } else {
        notifiedUsers[waitingUserId] = false;
      }
    }

    // Nettoyer la salle d'attente en RAM si elle est désormais vide
    if (waitingRoomInRam && waitingRoomInRam.participants.size === 0) {
      roomManager.rooms.delete(waitingRoomId);
    }

    // Mettre à jour Firestore avec le statut de notification
    await db.collection("meetings").doc(meetingId).update({
      waitingUsers: [],
      notifiedUsers: notifiedUsers,
      roomId: roomId,
      status: "live"
    });

    // Ne vider waitingUsers que si on ne l'a pas déjà fait dans forceStart
    if (!waitingUsersParam) {
      await db.collection("meetings").doc(meetingId).update({ waitingUsers: [] });
    }
  }

  /**
   * =========================================================
   *   DÉMARRER FORCÉMENT UNE RÉUNION (CRÉATEUR)
   * =========================================================
   *
   * Permet au créateur de démarrer la réunion avant l'heure programmée
   * (comme Google Meet)
   *
   * IMPORTANT : Recalculate endsAt = now + duration (Google Meet behaviour)
   *
   * @param {string} code - Code de la réunion
   * @param {string} userId - ID du créateur
   * @returns {Promise<object>} Résultat
   */
  async forceStart(code, userId) {
    const meeting = await this.getByCode(code);

    if (!meeting) {
      return { success: false, reason: "Code invalide" };
    }

    if (meeting.createdBy !== userId) {
      return { success: false, reason: "Non autorisé" };
    }

    if (meeting.status === "cancelled") {
      return { success: false, reason: "Réunion annulée" };
    }

    if (meeting.status === "ended") {
      return { success: false, reason: "Réunion terminée" };
    }

    if ((meeting.status === "live" || meeting.status === "active") && meeting.roomId) {
      // Déjà live, s'assurer que la salle existe en RAM et basculer les éventuels retardataires en salle d'attente
      let room = roomManager.rooms.get(meeting.roomId);
      if (!room) {
        room = roomManager.createMeetingRoom(meeting.id, meeting.isVideo, meeting.endsAt);
      }
      roomManager.join(room.roomId, userId);
      await this._notifyWaitingUsersStarted(meeting.id, room.roomId, meeting.title, meeting.isVideo, userId);
      return {
        success: true,
        meetingId: meeting.id,
        roomId: room.roomId,
        isVideo: meeting.isVideo,
        title: meeting.title,
        code: meeting.code,
        createdBy: meeting.createdBy,
      };
    }

    // Recalculer endsAt = maintenant + durée (comportement Google Meet)
    const newEndsAt = Date.now() + (meeting.durationMin * 60 * 1000);

    // Sauvegarder la liste des utilisateurs en attente AVANT de la vider
    const meetingDoc = await db.collection("meetings").doc(meeting.id).get();
    const currentMeeting = meetingDoc.data();
    const waitingUsers = Array.isArray(currentMeeting.waitingUsers) ? currentMeeting.waitingUsers.filter(Boolean) : [];

    // Créer la salle live immédiatement comme une vraie salle de réunion vide,
    // puis ajouter explicitement l'hôte pour éviter le cas où la réunion est créée
    // sans participant malgré des personnes déjà en attente.
    const room = roomManager.createMeetingRoom(meeting.id, meeting.isVideo, newEndsAt);
    roomManager.leaveUserFromOtherRooms(userId, room.roomId);
    roomManager.join(room.roomId, userId);

    // Mettre à jour Firestore avec le nouveau endsAt
    await db.collection("meetings").doc(meeting.id).update({
      status: "live",
      roomId: room.roomId,
      endsAt: newEndsAt,
      waitingUsers: [],
    });

    await this._removeWaitingUser(meeting.id, userId);
    notifyWaitingMusicStopped(meeting.id, waitingUsers, userId);
    await this._notifyWaitingUsersStarted(meeting.id, room.roomId, meeting.title, meeting.isVideo, userId, waitingUsers);

    // Mode DIRECT uniquement : notifier "hôte a démarré" pour auto-join
    // Mode APPROVAL : déjà géré via pending_approval dans _notifyWaitingUsersStarted
    if (currentMeeting.accessPolicy !== "approval") {
      for (const waitingUserId of waitingUsers) {
        const user = users.get(waitingUserId);
        if (user?.ws && user.ws.readyState === WebSocket.OPEN) {
          user.ws.send(JSON.stringify({
            type: "meeting-host-started",
            meetingId: meeting.id,
            roomId: room.roomId,
            hostId: userId,
            title: meeting.title,
            isVideo: meeting.isVideo,
          }));
        }
      }
    }

    console.log(`📅 Réunion ${meeting.id} démarrée manuellement (salle ${room.roomId}), fin à ${new Date(newEndsAt).toISOString()}`);

    return {
      success: true,
      meetingId: meeting.id,
      roomId: room.roomId,
      isVideo: meeting.isVideo,
      title: meeting.title,
      code: meeting.code,
      createdBy: meeting.createdBy,
    };
  }

  /**
   * =========================================================
   *   REJOINDRE UNE RÉUNION
   * =========================================================
   *
   * Valide l'accès à une réunion et ouvre la salle live si nécessaire
   *
   * VALIDATIONS :
   * - La réunion doit exister
   * - Statut doit être scheduled ou live
   * - Doit être dans la fenêtre d'accès (15 min avant → endsAt)
   *
   * TRANSITION :
   * - Si status=scheduled et dans la fenêtre → passer à live, créer salle RoomManager
   * - Si status=live → retourner roomId existant (recréer salle si n'existe pas en RAM)
   *
   * @param {string} code - Code de la réunion
   * @param {string} userId - ID de l'utilisateur qui rejoint
   * @returns {Promise<object>} Résultat (waiting, joined, error)
   */
  async join(code, userId) {
    const normalizedCode = this.normalizeCode(code);
    const meeting = await this.getByCode(normalizedCode);

    if (!meeting) {
      return { success: false, reason: "Code invalide" };
    }

    if (meeting.status === "cancelled") {
      return { success: false, reason: "Réunion annulée" };
    }

    if (meeting.status === "ended") {
      return { success: false, reason: "Réunion terminée" };
    }

    const now = Date.now();
    const meetingStart = meeting.scheduledAt;

    console.log(`📅 [MEETING] join() - code: ${code}, userId: ${userId}`);
    console.log(`📅 [MEETING] - scheduledAt: ${new Date(meeting.scheduledAt).toISOString()}`);
    console.log(`📅 [MEETING] - now: ${new Date(now).toISOString()}`);
    console.log(`📅 [MEETING] - status: ${meeting.status}`);
    console.log(`📅 [MEETING] - isCreator: ${meeting.createdBy === userId}`);

    const isCreator = meeting.createdBy === userId;
    const coHosts = Array.isArray(meeting.coHosts) ? meeting.coHosts : [];
    const isCoHost = coHosts.includes(userId);
    const canStartEarly = (isCreator || isCoHost) && now < meetingStart;
    const approvedUsers = Array.isArray(meeting.approvedUsers) ? meeting.approvedUsers : [];
    const isApproved = approvedUsers.includes(userId);
    const participantsList = Array.isArray(meeting.participants) ? meeting.participants : [];
    const isParticipant = participantsList.includes(userId);
    const isLive = meeting.status === "live" || meeting.status === "active";
    const isLocked = !!(meeting.lockMeeting || meeting.alwaysWaitingRoom);

    // Trop tard : réunion expirée
    if (now > meeting.endsAt) {
      await this._updateStatus(meeting.id, "ended");
      return { success: false, reason: "Réunion expirée" };
    }

    // Règle d'admission stricte :
    // 1. Entrée directe si hôte/co-hôte, déjà approuvé/participant, ou réunion déjà live non verrouillée.
    // 2. Salle d'attente / approbation uniquement si réunion pas encore démarrée OU verrouillée par l'hôte.
    const canEnterDirectly =
      isCreator ||
      isCoHost ||
      isApproved ||
      isParticipant ||
      (isLive && !isLocked);

    if (!canEnterDirectly) {
      // Politique d'approbation manuelle par l'hôte
      if (meeting.accessPolicy === "approval") {
        await this._addPendingRequest(meeting.id, userId);
        await this._notifyHostOfPendingRequest(meeting.id, userId, meeting.createdBy, meeting.title);
        console.log(`📅 [MEETING] - Demande d'approbation pour ${userId}`);
        return {
          success: false,
          status: "pending_approval",
          reason: "En attente d'approbation de l'hôte",
          meetingId: meeting.id,
          title: meeting.title,
        };
      }

      // Salle d'attente (réunion pas encore démarrée ou verrouillée)
      const waitTimeMs = Math.max(0, meetingStart - now);
      const waitTimeMin = Math.ceil(waitTimeMs / 60000);
      await this._addWaitingUser(meeting.id, userId);
      const waitingRoomId = `room_waiting_${meeting.id}`;
      if (!roomManager.rooms.has(waitingRoomId)) {
        roomManager.rooms.set(waitingRoomId, {
          roomId: waitingRoomId,
          creatorId: null,
          isVideo: meeting.isVideo,
          isMeeting: true,
          isWaitingRoom: true,
          createdAt: now,
          endsAt: meeting.endsAt,
          participants: new Map(),
        });
      }
      console.log(`📅 [MEETING] - En attente (${isLocked ? "verrouillée" : `${waitTimeMin}min restantes`})`);
      return {
        success: false,
        status: "waiting",
        reason: isLocked ? "Réunion verrouillée par l'hôte" : "Réunion pas encore commencée",
        waitTimeMs,
        waitTimeMin,
        scheduledAt: meeting.scheduledAt,
        meetingId: meeting.id,
        code: meeting.code,
        createdBy: meeting.createdBy,
        serverNow: now,
        opensAt: meetingStart,
        startsAt: meetingStart,
        waitingRoomId,
        isVideo: meeting.isVideo,
        title: meeting.title,
        locked: isLocked,
      };
    }

    // Dans la fenêtre d'accès ou entrée directe autorisée : ouvrir ou utiliser la salle live
    if (meeting.status === "scheduled" || meeting.status === "waiting") {
      // Si le créateur démarre tôt, recalculer endsAt
      let finalEndsAt = meeting.endsAt;
      if (canStartEarly) {
        finalEndsAt = Date.now() + (meeting.durationMin * 60 * 1000);
        console.log(`📅 Créateur démarre tôt, endsAt recalculé à ${new Date(finalEndsAt).toISOString()}`);
      }

      // Sauvegarder la liste des utilisateurs en attente AVANT de la vider
      const waitingUsers = Array.isArray(meeting.waitingUsers) ? meeting.waitingUsers.filter(Boolean) : [];

      // Déterminer le roomId de manière déterministe
      const roomId = `room_meeting_${meeting.id}`;

      // Réservation du roomId dans Firestore via transaction
      const roomRef = db.collection("meetings").doc(meeting.id);

      let room;
      await db.runTransaction(async (transaction) => {
        const freshMeeting = await transaction.get(roomRef);
        if (!freshMeeting.exists) {
          throw "Réunion introuvable";
        }

        const freshData = freshMeeting.data();

        // Si quelqu'un d'autre a déjà créé la salle, l'utiliser
        if (freshData.status === "live" && freshData.roomId) {
          const existingRoom = roomManager.rooms.get(freshData.roomId);
          if (existingRoom) {
            room = existingRoom;
            console.log(`📅 Salle existante réutilisée: ${freshData.roomId}`);
            return;
          }
        }

        // Créer la salle vide pour réunion et forcer l'ajout du créateur dans la salle
        // afin de garantir que le host voit bien la réunion ouverte et que les participants
        // en attente soient ensuite correctement ajoutés à la salle live.
        room = roomManager.createMeetingRoom(meeting.id, meeting.isVideo, finalEndsAt);
        roomManager.leaveUserFromOtherRooms(userId, room.roomId);
        roomManager.join(room.roomId, userId);

        // Mettre à jour Firestore dans la transaction
        transaction.update(roomRef, {
          status: "live",
          roomId: room.roomId,
          endsAt: finalEndsAt,
          waitingUsers: [],
        });
      }).catch((error) => {
        console.error(`❌ Erreur transaction Firestore:`, error);
        throw error;
      });

      notifyWaitingMusicStopped(meeting.id, waitingUsers, userId);
      await this._notifyWaitingUsersStarted(meeting.id, room.roomId, meeting.title, meeting.isVideo, userId, waitingUsers);
      await this._removeWaitingUser(meeting.id, userId);
      console.log(`📅 Réunion ${meeting.id} passée à live (salle ${room.roomId})`);

      return {
        success: true,
        meetingId: meeting.id,
        roomId: room.roomId,
        isVideo: meeting.isVideo,
        title: meeting.title,
        code: meeting.code,
        createdBy: meeting.createdBy,
      };
    }

    // Status déjà live : vérifier si la salle existe en RAM
    if (isLive) {
      // Vérifier si endsAt est dépassé
      if (now > meeting.endsAt) {
        await this._updateStatus(meeting.id, "ended");
        return { success: false, reason: "Réunion expirée" };
      }

      const liveRoomId = meeting.roomId || `room_meeting_${meeting.id}`;
      let room = roomManager.rooms.get(liveRoomId);

      // Si la salle n'existe pas en RAM (redémarrage serveur), la recréer
      if (!room) {
        console.log(`📅 Salle ${liveRoomId} introuvable en RAM, recréation...`);
        room = roomManager.createMeetingRoom(meeting.id, meeting.isVideo, meeting.endsAt);
      }

      // S'assurer que le participant quitte une éventuelle salle d'attente
      const waitingRoomId = `room_waiting_${meeting.id}`;
      const waitingRoom = roomManager.rooms.get(waitingRoomId);
      if (waitingRoom?.participants.has(userId)) {
        roomManager.leave(waitingRoomId, userId);
      }

      return {
        success: true,
        meetingId: meeting.id,
        roomId: room.roomId,
        isVideo: meeting.isVideo,
        title: meeting.title,
        code: meeting.code,
        createdBy: meeting.createdBy,
      };
    }

    return { success: false, reason: "État invalide" };
  }

  /**
   * =========================================================
   *   ANNULER UNE RÉUNION
   * =========================================================
   *
   * Annule une réunion (réservé à l'hôte)
   *
   * @param {string} meetingId - ID de la réunion
   * @param {string} userId - ID de l'utilisateur qui demande l'annulation
   * @returns {Promise<object>} Résultat
   */
  async cancel(meetingId, userId) {
    const doc = await db.collection("meetings").doc(meetingId).get();

    if (!doc.exists) {
      return { success: false, reason: "Réunion introuvable" };
    }

    const meeting = doc.data();

    // Vérifier que l'utilisateur est l'hôte
    if (meeting.createdBy !== userId) {
      return { success: false, reason: "Non autorisé (seul l'hôte peut annuler)" };
    }

    // Vérifier que la réunion n'est pas déjà terminée
    if (meeting.status === "ended" || meeting.status === "cancelled") {
      return { success: false, reason: "Réunion déjà terminée" };
    }

    // Annuler le timer de transition si existant
    const timer = this.scheduleTimers.get(meetingId);
    if (timer) {
      clearTimeout(timer);
      this.scheduleTimers.delete(meetingId);
    }

    // Fermer la salle live si elle existe
    if (meeting.status === "live" && meeting.roomId) {
      roomManager.closeRoom(meeting.roomId, "Réunion annulée");
    }

    // Mettre à jour Firestore
    await db.collection("meetings").doc(meetingId).update({
      status: "cancelled",
    });

    // Arrêter la musique d'attente pour tous les participants
    const waitingUsersCancel = Array.isArray(meeting.waitingUsers) ? meeting.waitingUsers.filter(Boolean) : [];
    if (waitingUsersCancel.length) {
      notifyWaitingMusicStopped(meetingId, waitingUsersCancel, userId);
    }

    console.log(`📅 Réunion ${meetingId} annulée par ${userId}`);
    return { success: true };
  }

  async approveRequest(meetingId, userId, hostId) {
    const doc = await db.collection("meetings").doc(meetingId).get();
    if (!doc.exists) return { success: false, reason: "Réunion introuvable" };

    const meeting = doc.data();
    if (meeting.createdBy !== hostId) {
      return { success: false, reason: "Non autorisé (seul l'hôte peut approuver)" };
    }

    await this._removePendingRequest(meetingId, userId);

    // Mémoriser l'approbation pour les reconnexions
    const approvedUsers = Array.isArray(meeting.approvedUsers) ? meeting.approvedUsers.filter(Boolean) : [];
    if (!approvedUsers.includes(userId)) {
      approvedUsers.push(userId);
      await db.collection("meetings").doc(meetingId).update({ approvedUsers });
    }

    let roomId = meeting.roomId;
    let hostNeedsJoin = false;
    if (meeting.status === "scheduled" || !roomId) {
      const endsAt = meeting.endsAt || (Date.now() + (meeting.durationMin || 60) * 60 * 1000);
      const room = roomManager.createMeetingRoom(meetingId, meeting.isVideo, endsAt);
      roomManager.join(room.roomId, hostId); // hôte aussi si salle créée
      roomManager.leaveUserFromOtherRooms(userId, room.roomId);
      roomManager.join(room.roomId, userId);
      roomId = room.roomId;
      hostNeedsJoin = true;
      await db.collection("meetings").doc(meetingId).update({ status: "live", roomId });
    } else {
      if (!roomManager.rooms.get(roomId)) {
        roomManager.createMeetingRoom(meetingId, meeting.isVideo, meeting.endsAt);
        roomManager.join(roomId, hostId);
        hostNeedsJoin = true;
      }
      roomManager.join(roomId, userId);
    }

    return {
      success: true,
      roomId,
      isVideo: meeting.isVideo,
      title: meeting.title,
      code: meeting.code,
      createdBy: meeting.createdBy,
      meetingId,
      hostNeedsJoin,
    };
  }

  async rejectRequest(meetingId, userId, hostId) {
    const doc = await db.collection("meetings").doc(meetingId).get();
    if (!doc.exists) return { success: false, reason: "Réunion introuvable" };

    const meeting = doc.data();
    if (meeting.createdBy !== hostId) {
      return { success: false, reason: "Non autorisé (seul l'hôte peut refuser)" };
    }

    await this._removePendingRequest(meetingId, userId);
    return { success: true };
  }

  /**
   * Vérifier si un utilisateur est l'hôte d'une réunion
   */
  async isHost(meetingId, userId) {
    const doc = await db.collection("meetings").doc(meetingId).get();
    if (!doc.exists) return false;
    const meeting = doc.data();
    return meeting.createdBy === userId;
  }

  /**
   * Vérifier si un utilisateur est autorisé à rejoindre une réunion
   */
  async canJoin(meetingId, userId) {
    const doc = await db.collection("meetings").doc(meetingId).get();
    if (!doc.exists) return { allowed: false, reason: "Réunion introuvable" };

    const meeting = doc.data();

    // Vérifier le statut
    if (meeting.status === "cancelled") {
      return { allowed: false, reason: "Réunion annulée" };
    }
    if (meeting.status === "ended") {
      return { allowed: false, reason: "Réunion terminée" };
    }

    // L'hôte peut toujours rejoindre
    if (meeting.createdBy === userId) {
      return { allowed: true, isHost: true };
    }

    // Vérifier si l'utilisateur est dans la liste des participants
    if (meeting.participants && meeting.participants.includes(userId)) {
      return { allowed: true, isHost: false };
    }

    // Politique d'accès direct : autoriser si meeting est live
    if (meeting.accessPolicy === "direct" && meeting.status === "live") {
      return { allowed: true, isHost: false };
    }

    // Politique d'approbation : retourner "pending"
    if (meeting.accessPolicy === "approval") {
      return { allowed: false, requiresApproval: true, reason: "Nécessite l'approbation de l'hôte" };
    }

    return { allowed: false, reason: "Non autorisé" };
  }

  /**
   * =========================================================
   *   LISTER LES RÉUNIONS D'UN UTILISATEUR
   * =========================================================
   *
   * @param {string} userId - ID de l'utilisateur
   * @returns {Promise<Array>} Liste des réunions (à venir et passées)
   */
  async listForUser(userId) {
    const now = Date.now();

    // Réunions créées par l'utilisateur (filtrer par statut pour éviter cancelled/ended)
    const createdSnapshot = await db
      .collection("meetings")
      .where("createdBy", "==", userId)
      .where("status", "in", ["scheduled", "live", "cancelled", "ended"])
      .orderBy("scheduledAt", "desc")
      .get();

    // Réunions où l'utilisateur est participant
    const participatedSnapshot = await db
      .collection("meetings")
      .where("participants", "array-contains", userId)
      .where("status", "in", ["scheduled", "live", "cancelled", "ended"])
      .orderBy("scheduledAt", "desc")
      .get();

    const meetings = new Map();

    // Fusionner les résultats (éviter les doublons)
    createdSnapshot.forEach((doc) => {
      meetings.set(doc.id, { id: doc.id, ...doc.data() });
    });

    participatedSnapshot.forEach((doc) => {
      if (!meetings.has(doc.id)) {
        meetings.set(doc.id, { id: doc.id, ...doc.data() });
      }
    });

    // Séparer en à venir et passées
    const upcoming = [];
    const past = [];

    for (const meeting of meetings.values()) {
      if (meeting.scheduledAt > now && meeting.status !== "cancelled" && meeting.status !== "ended") {
        upcoming.push(meeting);
      } else {
        past.push(meeting);
      }
    }

    return { upcoming, past };
  }

  /**
   * =========================================================
   *   PROGRAMMER LA TRANSITION SCHEDULED→LIVE
   * =========================================================
   *
   * ❌ PLUS UTILISÉ - La salle est créée quand le premier participant rejoint
   * (comportement Google Meet/Zoom)
   *
   * @param {string} meetingId - ID de la réunion
   * @param {number} scheduledAt - Timestamp de l'heure programmée
   */
  _scheduleMeetingTransition(meetingId, scheduledAt) {
    // Plus de transition automatique
    console.log(`ℹ️ Réunion ${meetingId} : pas de transition automatique (salle créée au premier join)`);
  }

  /**
   * =========================================================
   *   TRANSITION AUTOMATIQUE SCHEDULED→LIVE
   * =========================================================
   *
   * ❌ PLUS UTILISÉ - La salle est créée dans join() quand le premier participant arrive
   *
   * @param {string} meetingId - ID de la réunion
   */
  async _transitionToLive(meetingId) {
    // Plus utilisé
    console.log(`ℹ️ _transitionToLive appelé mais plus utilisé`);
  }

  /**
   * =========================================================
   *   METTRE À JOUR LE STATUT D'UNE RÉUNION
   * =========================================================
   *
   * @param {string} meetingId - ID de la réunion
   * @param {string} status - Nouveau statut
   */
  async _updateStatus(meetingId, status) {
    await db.collection("meetings").doc(meetingId).update({ status });
  }

  /**
   * =========================================================
   *   MARQUER UNE RÉUNION COMME TERMINÉE
   * =========================================================
   *
   * Appelé quand la salle live est fermée (plus de participants)
   *
   * @param {string} roomId - ID de la salle live
   */
  async markEndedByRoom(roomId) {
    const snapshot = await db.collection("meetings").where("roomId", "==", roomId).limit(1).get();

    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      await db.collection("meetings").doc(doc.id).update({
        status: "ended",
      });
      console.log(`📅 Réunion ${doc.id} marquée ended (salle ${roomId} fermée)`);

      // Purger la musique d'attente éventuelle
      const waitingUsers = Array.isArray(doc.data().waitingUsers) ? doc.data().waitingUsers.filter(Boolean) : [];
      if (waitingUsers.length) {
        notifyWaitingMusicStopped(doc.id, waitingUsers, null);
      }

      // Envoyer meeting-ended à tous les participants
      await this._sendMeetingEnded(doc.id, "Salle fermée");
    }
  }

  /**
   * =========================================================
   *   VÉRIFIER LES NOTIFICATIONS EN ATTENTE
   * =========================================================
   *
   * Vérifie si un utilisateur a des notifications de meeting en attente
   * et les envoie lors de la reconnexion
   *
   * @param {string} userId - ID de l'utilisateur qui se reconnecte
   */
  async _checkPendingMeetingNotifications(userId) {
    try {
      // Chercher les réunions où l'utilisateur est dans notifiedUsers mais n'a pas reçu la notification
      const snapshot = await db.collection("meetings")
        .where("notifiedUsers." + userId, "==", false)
        .where("status", "==", "live")
        .get();

      if (snapshot.empty) {
        return;
      }

      for (const doc of snapshot.docs) {
        const meeting = doc.data();
        const user = users.get(userId);

        if (user?.ws && user.ws.readyState === WebSocket.OPEN) {
          // Envoyer la notification maintenant
          user.ws.send(JSON.stringify({
            type: "meeting-joined",
            meetingId: doc.id,
            roomId: meeting.roomId,
            isVideo: meeting.isVideo,
            title: meeting.title,
             code: meeting.code,
          }));

          // Marquer comme notifié
          await db.collection("meetings").doc(doc.id).update({
            [`notifiedUsers.${userId}`]: true
          });

          console.log(`📅 Notification de réunion envoyée à ${userId} lors de la reconnexion`);
        }
      }
    } catch (error) {
      console.error("❌ Erreur vérification notifications en attente:", error);
    }
  }

  /**
   * =========================================================
   *   NOTIFIER RECONNEXION RÉUNION
   * =========================================================
   *
   * Notifie tous les participants d'une réunion que la salle a été recréée
   * après un crash serveur
   *
   * @param {string} meetingId - ID de la réunion
   * @param {string} roomId - ID de la salle
   * @param {boolean} isVideo - Type d'appel
   * @param {string} title - Titre de la réunion
   */
  async _notifyMeetingReconnect(meetingId, roomId, isVideo, title) {
    try {
      const meetingDoc = await db.collection("meetings").doc(meetingId).get();
      if (!meetingDoc.exists) return;

      const meeting = meetingDoc.data();
      const participants = meeting.participants || [];

      for (const userId of participants) {
        const user = users.get(userId);
        if (user?.ws && user.ws.readyState === WebSocket.OPEN) {
          user.ws.send(JSON.stringify({
            type: "meeting-reconnect",
            meetingId,
            roomId,
            isVideo,
            title,
          }));
          console.log(`📅 Notification de reconnexion envoyée à ${userId}`);
        }
      }
    } catch (error) {
      console.error("❌ Erreur notification reconnexion:", error);
    }
  }
}

// Instance globale du RoomManager
const roomManager = new RoomManager();

// Instance globale du MeetingManager
const meetingManager = new MeetingManager();
// Musique d'attente transmise en direct aux appareils (non persistée entre redémarrages).
const meetingWaitingMusic = new Map();
const MAX_WAITING_MUSIC_TRANSFER_BYTES = 90 * 1024 * 1024;
// Tableau blanc collaboratif temporaire en mémoire (indexé par meetingId)
const meetingWhiteboards = new Map();
const MAX_WHITEBOARD_STROKES = 2000;
// Délai de grâce (8s) lors d'une déconnexion brutale de l'hôte
const hostLeaveGraceTimers = new Map();

function cancelHostLeaveGraceTimers(userId) {
  if (!userId) return;
  const suffix = `:${userId}`;
  for (const [key, timer] of hostLeaveGraceTimers.entries()) {
    if (key.endsWith(suffix)) {
      clearTimeout(timer);
      hostLeaveGraceTimers.delete(key);
    }
  }
}

async function endMeetingByHost(meetingId, hostId, reason = "host_left") {
  if (!meetingId) return;
  const graceKey = `${meetingId}:${hostId}`;
  const existingTimer = hostLeaveGraceTimers.get(graceKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
    hostLeaveGraceTimers.delete(graceKey);
  }

  try {
    const doc = await db.collection("meetings").doc(meetingId).get();
    if (!doc.exists) return;
    const meeting = doc.data();
    if (meeting.status === "ended" || meeting.status === "cancelled") return;

    const liveRoomId = meeting.roomId || `room_meeting_${meetingId}`;
    const waitingRoomId = `room_waiting_${meetingId}`;

    const recipients = new Set([
      ...(Array.isArray(meeting.participants) ? meeting.participants : []),
      ...(Array.isArray(meeting.waitingUsers) ? meeting.waitingUsers : []),
    ]);

    const liveRoom = roomManager.rooms.get(liveRoomId);
    if (liveRoom) {
      for (const pid of liveRoom.participants.keys()) recipients.add(pid);
    }
    const waitingRoom = roomManager.rooms.get(waitingRoomId);
    if (waitingRoom) {
      for (const pid of waitingRoom.participants.keys()) recipients.add(pid);
    }

    await db.collection("meetings").doc(meetingId).update({
      status: "ended",
      endedAt: Date.now(),
      waitingUsers: [],
    });

    const payload = JSON.stringify({
      type: "meeting-ended",
      meetingId,
      reason,
    });
    for (const pid of recipients) {
      const u = users.get(pid);
      if (u?.ws && u.ws.readyState === WebSocket.OPEN) {
        u.ws.send(payload);
      }
    }

    const waitingUsersEnd = Array.isArray(meeting.waitingUsers) ? meeting.waitingUsers.filter(Boolean) : [];
    notifyWaitingMusicStopped(meetingId, waitingUsersEnd, hostId);
    meetingWhiteboards.delete(meetingId);

    if (liveRoom) {
      roomManager.closeRoom(liveRoomId, reason);
      roomManager.rooms.delete(liveRoomId);
    }
    if (waitingRoom) {
      roomManager.closeRoom(waitingRoomId, reason);
      roomManager.rooms.delete(waitingRoomId);
    }
    console.log(`📅 Réunion ${meetingId} terminée automatiquement (${reason})`);
  } catch (error) {
    console.error(`❌ Erreur endMeetingByHost(${meetingId}):`, error);
  }
}

function notifyWaitingMusicStopped(meetingId, waitingUsers = [], hostId = null) {
  meetingWaitingMusic.delete(meetingId);
  const targets = new Set([...(Array.isArray(waitingUsers) ? waitingUsers : []), hostId].filter(Boolean));
  for (const userId of targets) {
    const user = users.get(userId);
    if (user?.ws && user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(JSON.stringify({ type: "meeting-waiting-music-stop", meetingId }));
    }
  }
}

// =========================================================
// CHARGEMENT DES RÉUNIONS AU DÉMARRAGE
// =========================================================
// Charger les réunions scheduled/live encore valides et reprogrammer leurs timers
async function loadMeetingsOnStartup() {
  try {
    const now = Date.now();
    const snapshot = await db.collection("meetings")
      .where("status", "in", ["scheduled", "live"])
      .get();
    
    console.log(`📅 Chargement de ${snapshot.size} réunions au démarrage...`);
    
    for (const doc of snapshot.docs) {
      const meeting = { id: doc.id, ...doc.data() };
      
      // Charger les codes existants pour éviter les collisions
      if (meeting.code) {
        meetingManager.usedCodes.add(meeting.code);
      }
      
      // Nettoyer les réunions expirées
      if (meeting.endsAt && now > meeting.endsAt) {
        await db.collection("meetings").doc(meeting.id).update({ status: "ended" });
        // Purger la musique d'attente éventuelle
        meetingWaitingMusic.delete(meeting.id);
        console.log(`📅 Réunion expirée nettoyée: ${meeting.id}`);
        continue;
      }
      
      // Si live et roomId existe, recréer la salle en RAM
      if (meeting.status === "live" && meeting.roomId) {
        const existingRoom = roomManager.rooms.get(meeting.roomId);
        if (!existingRoom) {
          roomManager.createMeetingRoom(meeting.id, meeting.isVideo, meeting.endsAt);
          console.log(`📅 Salle live recréée: ${meeting.roomId}`);

          // Envoyer un message de reconnexion à tous les participants
          await meetingManager._notifyMeetingReconnect(meeting.id, meeting.roomId, meeting.isVideo, meeting.title);
        }
      }
      
      // Programmer le timer de fin si endsAt existe
      if (meeting.endsAt && now < meeting.endsAt) {
        const timeUntilEnd = meeting.endsAt - now;
        setTimeout(async () => {
          const freshDoc = await db.collection("meetings").doc(meeting.id).get();
          if (freshDoc.exists) {
            const freshMeeting = freshDoc.data();
            if (freshMeeting.status === "live" && freshMeeting.roomId) {
              roomManager.closeRoom(freshMeeting.roomId, "Durée de réunion expirée");
            }
            await db.collection("meetings").doc(meeting.id).update({ status: "ended" });
            // Purger la musique d'attente éventuelle
            const waitingUsersEndTimer = Array.isArray(freshMeeting.waitingUsers) ? freshMeeting.waitingUsers.filter(Boolean) : [];
            if (waitingUsersEndTimer.length) {
              notifyWaitingMusicStopped(meeting.id, waitingUsersEndTimer, null);
            }
            // Envoyer meeting-ended si la réunion était live
            if (freshMeeting.status === "live") {
              await meetingManager._sendMeetingEnded(meeting.id, "Durée de réunion expirée");
            }
          }
        }, timeUntilEnd);
        console.log(`📅 Timer de fin programmé pour ${meeting.id} dans ${timeUntilEnd / 1000}s`);
      }
      
      // Reprogrammer les notifications de rappel pour les réunions scheduled
      if (meeting.status === "scheduled") {
        meetingManager._scheduleMeetingNotifications(meeting.id, meeting.scheduledAt, meeting.participants || []);
        console.log(`📅 Notifications reprogrammées pour ${meeting.id}`);
      }
    }
  } catch (error) {
    console.error("❌ Erreur lors du chargement des réunions:", error);
  }
}

// Lancer le chargement au démarrage
loadMeetingsOnStartup();

app.get("/", (req, res) => {
  res.send("Serveur WebSocket actif");
});

// Route pour les liens de partage de réunion
app.get("/join/:code", (req, res) => {
  const { code } = req.params;
  const normalizedCode = code.toUpperCase().replace(/-/g, "");
  // Caractères autorisés pour l'affichage et le deep link : uniquement A-Z 0-9 -
  // (corrige la XSS réflexive : le code brut venait du client et était
  // interpolé tel quel dans le HTML).
  const safeCode = code.replace(/[^A-Za-z0-9-]/g, "").slice(0, 64);
  const safeLinkCode = encodeURIComponent(safeCode);
  
  res.send(`
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rejoindre une réunion</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0b141a;
      color: #fff;
      margin: 0;
      padding: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .container {
      max-width: 400px;
      text-align: center;
      background: #1f2c34;
      padding: 30px;
      border-radius: 20px;
    }
    h1 {
      margin: 0 0 10px 0;
      font-size: 24px;
    }
    .code {
      font-size: 32px;
      font-weight: 600;
      color: #00a884;
      letter-spacing: 2px;
      margin: 20px 0;
    }
    .btn {
      display: inline-block;
      padding: 14px 28px;
      background: #00a884;
      color: white;
      text-decoration: none;
      border-radius: 24px;
      font-weight: 500;
      margin: 10px;
    }
    .btn-secondary {
      background: #374045;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📅 Réunion</h1>
    <div class="code">${safeCode}</div>
    <p style="color: #8696a0; margin-bottom: 20px;">
      Pour rejoindre cette réunion, ouvrez l'application App Appel
    </p>
    <a href="callapp://join/${safeLinkCode}" class="btn">Ouvrir dans l'application</a>
    <br>
    <a href="https://app-appel.onrender.com" class="btn btn-secondary">Télécharger l'application</a>
  </div>
</body>
</html>
  `);
});

// Assetlinks pour Android
app.get("/.well-known/assetlinks.json", (req, res) => {
  const assetlinks = process.env.ASSETLINKS_JSON || JSON.stringify([]);
  res.set("Content-Type", "application/json");
  res.send(assetlinks);
});

// Apple App Site Association
app.get("/.well-known/apple-app-site-association", (req, res) => {
  const aasa = process.env.AASA_JSON || JSON.stringify({});
  res.set("Content-Type", "application/json");
  res.send(aasa);
});

// =========================================================
// API REST POUR MEETING SERVICE
// =========================================================

// Créer une réunion planifiée via HTTP REST (fallback si WebSocket instable)
async function handleCreateMeetingHttp(req, res) {
  try {
    const body = req.body || {};
    const createdBy = typeof body.createdBy === "string"
      ? body.createdBy.trim()
      : (typeof body.userId === "string" ? body.userId.trim() : "");
    if (!createdBy) {
      return res.status(400).json({ success: false, error: "createdBy (userId) requis" });
    }

    const validation = validateMeetingMessage(body, "meeting-create");
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.reason });
    }

    const scheduleCheck = normalizeScheduledAt(body.scheduledAt);
    if (!scheduleCheck.valid) {
      return res.status(400).json({ success: false, error: scheduleCheck.reason });
    }

    const sanitizedTitle = sanitizeString(body.title, 100);
    const sanitizedDescription = body.description ? sanitizeString(body.description, 500) : "";
    const policy = body.accessPolicy === "approval" ? "approval" : "direct";
    const waitingMusicTracks = Array.isArray(body.waitingMusicTracks) ? body.waitingMusicTracks : [];
    const validWaitingMusic = waitingMusicTracks.every((track) =>
      track && typeof track.dataUrl === "string" && /^data:audio\/[a-zA-Z0-9.+-]+;base64,/.test(track.dataUrl)
    ) && waitingMusicTracks.reduce((sum, track) => sum + track.dataUrl.length, 0) <= MAX_WAITING_MUSIC_TRANSFER_BYTES;
    if (!validWaitingMusic) {
      return res.status(400).json({ success: false, error: "Liste audio invalide ou trop volumineuse" });
    }

    const meeting = await meetingManager.create({
      title: sanitizedTitle,
      description: sanitizedDescription,
      scheduledAt: scheduleCheck.value,
      durationMin: body.durationMin,
      isVideo: !!body.isVideo,
      createdBy,
      hostName: body.hostName,
      participants: Array.isArray(body.participants) ? body.participants : [],
      accessPolicy: policy,
    });

    if (meeting.success === false) {
      return res.status(400).json({ success: false, error: meeting.reason || "Création refusée" });
    }

    if (waitingMusicTracks.length) {
      meetingWaitingMusic.set(meeting.meetingId, {
        syncAt: Date.now(),
        tracks: waitingMusicTracks.map((track) => ({
          dataUrl: track.dataUrl,
          name: String(track.name || "Musique d’attente").slice(0, 120),
        })),
      });
    }

    res.status(201).json({
      success: true,
      meeting,
      meetingId: meeting.meetingId,
      code: meeting.code,
      link: meeting.link,
      title: meeting.title,
      description: meeting.description,
      scheduledAt: meeting.scheduledAt,
      endsAt: meeting.endsAt,
      durationMin: meeting.durationMin,
      isVideo: meeting.isVideo,
      createdBy: meeting.createdBy,
      hostName: meeting.hostName,
      participants: meeting.participants,
      accessPolicy: meeting.accessPolicy,
    });
  } catch (error) {
    console.error("❌ Erreur API POST /api/meeting:", error);
    res.status(500).json({ success: false, error: error.message || "Erreur serveur" });
  }
}

app.post("/api/meeting", handleCreateMeetingHttp);
app.post("/api/meetings", handleCreateMeetingHttp);

// Obtenir une réunion par code
app.get("/api/meeting/by-code/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const meeting = await meetingManager.getByCode(code);
    if (!meeting) {
      return res.status(404).json({ error: "Réunion introuvable" });
    }
    res.json(meeting);
  } catch (error) {
    console.error("❌ Erreur API /api/meeting/by-code:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Obtenir une réunion par ID
app.get("/api/meeting/:meetingId", async (req, res) => {
  try {
    const { meetingId } = req.params;
    const doc = await db.collection("meetings").doc(meetingId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "Réunion introuvable" });
    }
    res.json({ id: doc.id, ...doc.data() });
  } catch (error) {
    console.error("❌ Erreur API /api/meeting:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Modifier une réunion
app.patch("/api/meeting/:meetingId", async (req, res) => {
  try {
    const { meetingId } = req.params;
    const updates = req.body;
    
    const doc = await db.collection("meetings").doc(meetingId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "Réunion introuvable" });
    }
    
    const meeting = doc.data();
    
    // Vérifier que l'utilisateur est le créateur
    const userId = req.body.userId;
    if (meeting.createdBy !== userId) {
      return res.status(403).json({ error: "Non autorisé" });
    }
    
    // Mettre à jour les champs autorisés
    const allowedUpdates = ['title', 'description', 'scheduledAt', 'durationMin', 'isVideo'];
    const sanitizedUpdates = {};
    for (const key of allowedUpdates) {
      if (updates[key] !== undefined) {
        sanitizedUpdates[key] = updates[key];
      }
    }
    
    await db.collection("meetings").doc(meetingId).update(sanitizedUpdates);
    
    const updatedDoc = await db.collection("meetings").doc(meetingId).get();
    res.json({ id: updatedDoc.id, ...updatedDoc.data() });
  } catch (error) {
    console.error("❌ Erreur API PATCH /api/meeting:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Obtenir les participants d'une réunion
app.get("/api/meeting/:meetingId/participants", async (req, res) => {
  try {
    const { meetingId } = req.params;
    const doc = await db.collection("meetings").doc(meetingId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "Réunion introuvable" });
    }
    
    const meeting = doc.data();
    const participants = [];
    
    // Participants depuis la salle live si live
    if (meeting.status === "live" && meeting.roomId) {
      const room = roomManager.rooms.get(meeting.roomId);
      if (room) {
        for (const [userId, data] of room.participants.entries()) {
          if (data.state === "JOINED") {
            participants.push({ userId, state: data.state });
          }
        }
      }
    }
    
    // Ajouter les participants listés dans la réunion
    if (meeting.participants) {
      meeting.participants.forEach(userId => {
        if (!participants.find(p => p.userId === userId)) {
          participants.push({ userId, state: "INVITED" });
        }
      });
    }
    
    res.json(participants);
  } catch (error) {
    console.error("❌ Erreur API /api/meeting/participants:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Ajouter un participant
app.post("/api/meeting/:meetingId/participants", async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { userId } = req.body;
    
    const doc = await db.collection("meetings").doc(meetingId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "Réunion introuvable" });
    }
    
    const meeting = doc.data();
    const participants = meeting.participants || [];
    
    if (!participants.includes(userId)) {
      participants.push(userId);
      await db.collection("meetings").doc(meetingId).update({ participants });
    }
    
    res.json({ userId, meetingId });
  } catch (error) {
    console.error("❌ Erreur API POST /api/meeting/participants:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Retirer un participant
app.delete("/api/meeting/:meetingId/participants/:userId", async (req, res) => {
  try {
    const { meetingId, userId } = req.params;
    
    const doc = await db.collection("meetings").doc(meetingId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "Réunion introuvable" });
    }
    
    const meeting = doc.data();
    const participants = (meeting.participants || []).filter(id => id !== userId);
    
    await db.collection("meetings").doc(meetingId).update({ participants });
    
    // Si la réunion est live, retirer de la salle
    if (meeting.status === "live" && meeting.roomId) {
      roomManager.leave(meeting.roomId, userId);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Erreur API DELETE /api/meeting/participants:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Chat de réunion - Envoyer un message
app.post("/api/meeting/:meetingId/chat", async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { message, userId, timestamp } = req.body;
    
    const chatRef = db.collection("meetings").doc(meetingId).collection("chat");
    const newMessage = {
      message,
      userId,
      timestamp: timestamp || Date.now(),
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };
    
    await chatRef.doc(newMessage.id).set(newMessage);
    
    // Diffuser le message aux participants en salle live
    const doc = await db.collection("meetings").doc(meetingId).get();
    if (doc.exists) {
      const meeting = doc.data();
      if (meeting.status === "live" && meeting.roomId) {
        const room = roomManager.rooms.get(meeting.roomId);
        if (room) {
          const broadcastMessage = {
            type: "meeting-chat",
            meetingId,
            message: newMessage
          };
          for (const [userId, data] of room.participants.entries()) {
            if (data.state === "JOINED") {
              const user = users.get(userId);
              if (user?.ws && user.ws.readyState === WebSocket.OPEN) {
                user.ws.send(JSON.stringify(broadcastMessage));
              }
            }
          }
        }
      }
    }
    
    res.json(newMessage);
  } catch (error) {
    console.error("❌ Erreur API POST /api/meeting/chat:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Chat de réunion - Obtenir l'historique
app.get("/api/meeting/:meetingId/chat", async (req, res) => {
  try {
    const { meetingId } = req.params;
    const chatRef = db.collection("meetings").doc(meetingId).collection("chat");
    const snapshot = await chatRef.orderBy("timestamp", "desc").limit(100).get();
    
    const messages = snapshot.docs.map(doc => doc.data()).reverse();
    res.json(messages);
  } catch (error) {
    console.error("❌ Erreur API GET /api/meeting/chat:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Lever la main
app.post("/api/meeting/:meetingId/raise-hand", async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { userId } = req.body;
    
    const doc = await db.collection("meetings").doc(meetingId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "Réunion introuvable" });
    }
    
    const meeting = doc.data();
    if (meeting.status === "live" && meeting.roomId) {
      const room = roomManager.rooms.get(meeting.roomId);
      if (room) {
        const broadcastMessage = {
          type: "meeting-hand-raised",
          meetingId,
          userId
        };
        for (const [uid, data] of room.participants.entries()) {
          if (data.state === "JOINED") {
            const user = users.get(uid);
            if (user?.ws && user.ws.readyState === WebSocket.OPEN) {
              user.ws.send(JSON.stringify(broadcastMessage));
            }
          }
        }
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Erreur API POST /api/meeting/raise-hand:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Baisser la main
app.post("/api/meeting/:meetingId/lower-hand", async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { userId } = req.body;
    
    const doc = await db.collection("meetings").doc(meetingId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "Réunion introuvable" });
    }
    
    const meeting = doc.data();
    if (meeting.status === "live" && meeting.roomId) {
      const room = roomManager.rooms.get(meeting.roomId);
      if (room) {
        const broadcastMessage = {
          type: "meeting-hand-lowered",
          meetingId,
          userId
        };
        for (const [uid, data] of room.participants.entries()) {
          if (data.state === "JOINED") {
            const user = users.get(uid);
            if (user?.ws && user.ws.readyState === WebSocket.OPEN) {
              user.ws.send(JSON.stringify(broadcastMessage));
            }
          }
        }
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Erreur API POST /api/meeting/lower-hand:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Envoyer une réaction
app.post("/api/meeting/:meetingId/reaction", async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { userId, reaction, timestamp } = req.body;
    
    const doc = await db.collection("meetings").doc(meetingId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "Réunion introuvable" });
    }
    
    const meeting = doc.data();
    if (meeting.status === "live" && meeting.roomId) {
      const room = roomManager.rooms.get(meeting.roomId);
      if (room) {
        const broadcastMessage = {
          type: "meeting-reaction",
          meetingId,
          userId,
          reaction,
          timestamp: timestamp || Date.now()
        };
        for (const [uid, data] of room.participants.entries()) {
          if (data.state === "JOINED") {
            const user = users.get(uid);
            if (user?.ws && user.ws.readyState === WebSocket.OPEN) {
              user.ws.send(JSON.stringify(broadcastMessage));
            }
          }
        }
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Erreur API POST /api/meeting/reaction:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Obtenir les permissions d'un utilisateur
app.get("/api/meeting/:meetingId/permissions/:userId", async (req, res) => {
  try {
    const { meetingId, userId } = req.params;
    
    const doc = await db.collection("meetings").doc(meetingId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "Réunion introuvable" });
    }
    
    const meeting = doc.data();
    const isCreator = meeting.createdBy === userId;
    
    // Pour l'instant, permissions simples
    const permissions = {
      canModify: isCreator,
      canRemoveParticipants: isCreator,
      canEndMeeting: isCreator,
      canMuteOthers: isCreator, // Hôte peut forcer mute micro/cam via signal
      canChat: true
    };
    
    res.json(permissions);
  } catch (error) {
    console.error("❌ Erreur API GET /api/meeting/permissions:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Mettre à jour les permissions
app.patch("/api/meeting/:meetingId/permissions/:userId", async (req, res) => {
  try {
    const { meetingId, userId } = req.params;
    const permissions = req.body;
    
    const doc = await db.collection("meetings").doc(meetingId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "Réunion introuvable" });
    }
    
    const meeting = doc.data();
    const isCreator = meeting.createdBy === userId;
    
    // Seul le créateur peut modifier les permissions
    if (!isCreator) {
      return res.status(403).json({ error: "Non autorisé" });
    }
    
    // Stocker les permissions personnalisées dans Firestore
    const permissionsRef = db.collection("meetings").doc(meetingId).collection("permissions").doc(userId);
    await permissionsRef.set(permissions, { merge: true });
    
    res.json(permissions);
  } catch (error) {
    console.error("❌ Erreur API PATCH /api/meeting/permissions:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// =========================================================
// HEARTBEAT (Garde les connexions actives)
// =========================================================
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      ws.missedHeartbeatIntervals = (ws.missedHeartbeatIntervals || 0) + 1;
      if (ws.missedHeartbeatIntervals >= 2) {
        console.log(`[HEARTBEAT] Client removed after 2 missed checks: ${ws.userId || "unknown"}`);
        if (ws.userId && users.get(ws.userId)?.ws === ws) {
          const existingUser = users.get(ws.userId);
          users.set(ws.userId, { ws: null, pushToken: existingUser.pushToken });
          roomManager.markLeftInAllRooms(ws.userId);
        }
        return ws.terminate();
      }
      console.warn(`[HEARTBEAT] Missed check for ${ws.userId || "unknown"}; verifying again before disconnect.`);
    } else {
      ws.missedHeartbeatIntervals = 0;
    }

    ws.isAlive = false;

    try {
      ws.ping();
      ws.send(JSON.stringify({ type: "ping" }));
    } catch (e) {
      console.error("Erreur envoi ping :", e);
    }
  });
}, 22000);

wss.on("close", () => {
  clearInterval(interval);
});

// =========================================================
// GESTION DES CONNEXIONS WEBSOCKET
// =========================================================
wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.missedHeartbeatIntervals = 0;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", async (message) => {
    ws.isAlive = true;

    try {
      const data = JSON.parse(message);
      // Récupération de la propriété isVideo transmise par le client
      const {
        type,
        userId,
        pushToken,
        targetId,
        offer,
        answer,
        candidate,
        isVideo,
        isVideoUpgrade,
        callId,
      } = data;

      if (type === "pong") {
        return;
      }

      if (type === "ping" || data.action === "ping") {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "pong" }));
        }
        return;
      }

      // 1. Enregistrement / Reconnexion de l'utilisateur
      if (type === "register-user") {
        const { authToken } = data;
        cancelHostLeaveGraceTimers(userId);

        if (typeof data.displayName === "string") {
          const cleanName = data.displayName.replace(/[<>"'`]/g, "").trim().slice(0, 40);
          if (cleanName) userDisplayNames.set(userId, cleanName);
        }

        // VÉRIFICATION DE LA PRÉSENCE DANS LA MAP
        if (users.has(userId)) {
          const existingUser = users.get(userId);
          const storedTokenData = userAuthTokens.get(userId);

          // Vérifier le token d'authentification avec expiration
          if (storedTokenData && !validateAuthToken(userId, authToken)) {
            console.warn(`⚠️ Token invalide ou expiré pour ${userId}, rejet de l'enregistrement`);
            ws.send(
              JSON.stringify({
                type: "registration-error",
                reason: "Token d'authentification invalide ou expiré",
              }),
            );
            return;
          }

          console.log(
            `🔄 Utilisateur ${userId} déjà présent dans la Map. Mise à jour de la connexion...`,
          );

          // Fermer proprement l'ancien socket s'il existe encore (éviter 1006 brutal)
          if (existingUser.ws && existingUser.ws !== ws) {
            const oldWs = existingUser.ws;
            oldWs.userId = null;
            try {
              if (oldWs.readyState === WebSocket.OPEN) {
                oldWs.close(4001, "Replaced by new connection");
              } else if (oldWs.readyState === WebSocket.CONNECTING) {
                oldWs.terminate();
              }
            } catch (e) {
              try { oldWs.terminate(); } catch (_) {}
            }
          }

          // Mise à jour : Nouveau socket + mise à jour du token
          users.set(userId, {
            ws: ws,
            pushToken: pushToken || existingUser.pushToken || null,
          });
          
          // IMPORTANT: Définir ws.userId pour les vérifications ultérieures
          ws.userId = userId;
        } else {
          // Nouvel utilisateur : générer un token
          const newToken = generateAuthToken(userId);
          userAuthTokens.set(userId, { token: newToken, createdAt: Date.now() });

          console.log(
            `✨ Nouvel utilisateur enregistré dans la Map : ${userId} avec token`,
          );
          users.set(userId, {
            ws: ws,
            pushToken: pushToken || null,
          });

          // IMPORTANT: Définir ws.userId pour les vérifications ultérieures
          ws.userId = userId;
        }

        const currentUser = users.get(userId);
        const currentTokenData = userAuthTokens.get(userId);
        const currentToken = currentTokenData ? currentTokenData.token : null;

        console.log(
          `👤 Statut : ${userId} | Token FCM : ${currentUser.pushToken || "Aucun"} | Token Auth : ${currentToken ? "existant" : "généré"}`,
        );
        console.log(
          "👥 Liste globale des utilisateurs enregistrés :",
          Array.from(users.keys()),
        );

        // Annuler le délai de grâce si l'utilisateur se reconnecte
        roomManager.cancelGracePeriod(userId);

        // IMPORTANT: Définir ws.userId pour les vérifications ultérieures
        ws.userId = userId;

        // Vérifier si l'utilisateur a des notifications de meeting en attente
        if (typeof meetingManager !== 'undefined') {
          await meetingManager._checkPendingMeetingNotifications(userId);
        }

        ws.send(
          JSON.stringify({
            type: "registered",
            userId: userId,
            authToken: currentToken,
          }),
        );
        return;
      }

      // 2. Fournir les iceServers TURN (credentials sécurisés)
      if (type === "get-ice-servers") {
        ws.send(
          JSON.stringify({
            type: "ice-servers",
            iceServers: TURN_CONFIG.iceServers,
          }),
        );
        return;
      }

      // 1. Mise à jour dans 'call-user' pour inclure le statut RINGING et le notId
      // Dans wss.on("message"):
      if (type === "call-user") {
        const targetUser = users.get(targetId);
        const targetWs = targetUser?.ws;
        const callTypeLabel = isVideo ? "vidéo" : "audio";

        const newCallId = `call_${Date.now()}_${ws.userId}`;
        const notificationId =
          data.notId || Math.floor(100000 + Math.random() * 900000);

        // Enregistrement de l'appel avec le statut RINGING
        pendingCalls.set(newCallId, {
          from: ws.userId,
          targetId: targetId,
          offer: offer,
          isVideo: !!isVideo,
          status: "RINGING",
          notId: notificationId,
        });

        setTimeout(() => pendingCalls.delete(newCallId), 45000);

        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(
            JSON.stringify({
              type: "incoming-call",
              callId: newCallId,
              from: ws.userId,
              offer: offer,
              isVideo: !!isVideo,
              notId: notificationId,
            }),
          );

          if (targetUser.pushToken) {
            await envoyerNotificationPush(
              targetUser.pushToken,
              ws.userId,
              `Appel ${callTypeLabel} de ${ws.userId}`,
              ws.userId,
              newCallId,
              isVideo,
              notificationId,
            );
          }
        } else if (targetUser?.pushToken) {
          await envoyerNotificationPush(
            targetUser.pushToken,
            ws.userId,
            `Appel ${callTypeLabel} de ${ws.userId}`,
            ws.userId,
            newCallId,
            isVideo,
            notificationId,
          );

          ws.send(JSON.stringify({ type: "user-offline", targetId: targetId }));
        } else {
          ws.send(JSON.stringify({ type: "user-offline", targetId: targetId }));
        }
        return;
      }

      // 3. Récupérer l'offre SDP complète si l'application est ouverte via la notification FCM
      if (type === "get-offer") {
        const callData = pendingCalls.get(callId);
        if (callData) {
          ws.send(
            JSON.stringify({
              type: "call-offer-details",
              callId: callId,
              from: callData.from,
              offer: callData.offer,
              isVideo: callData.isVideo,
            }),
          );
        } else {
          ws.send(
            JSON.stringify({
              type: "call-expired",
              callId: callId,
            }),
          );
        }
        return;
      }

      // 4. Transmettre la réponse (B -> A)
      // Envoyé par : B (celui qui répond) -> Reçu par : A (l'appelant)
      // Pourquoi : Transmettre la réponse SDP à l'appelant
      if (type === "answer-call") {
        // Retrouver l'appel associé et passer son statut à ACCEPTED
        for (const [cId, callData] of pendingCalls.entries()) {
          if (callData.from === targetId || callData.targetId === ws.userId) {
            callData.status = "ACCEPTED";
            break;
          }
        }

        const targetWs = users.get(targetId)?.ws;
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(
            JSON.stringify({
              type: "call-answered",
              answer: answer,
              from: ws.userId, // Ajout de l'identifiant de l'expéditeur
            }),
          );
        }
        return;
      }

      // 5. Échanger les candidats ICE
      // Envoyé par : A ou B -> Reçu par : l'autre participant
      // Pourquoi : Relayer les candidats ICE pour établir la connexion WebRTC
      if (type === "ice-candidate") {
        const targetWs = users.get(targetId)?.ws;
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(
            JSON.stringify({
              type: "ice-candidate",
              candidate: candidate,
              from: ws.userId, // Ajout de l'identifiant de l'expéditeur
            }),
          );
        }
        return;
      }

      // 6. Refus d'un appel
      if (type === "call-refused") {
        const targetWs = users.get(targetId)?.ws;
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(
            JSON.stringify({
              type: "call-refused",
              from: ws.userId,
            }),
          );
        }
        return;
      }

      // 7. Fin d'un appel
      if (type === "call-end") {
        // Recherche si l'appel était toujours au statut RINGING lors du raccrochage
        for (const [cId, callData] of pendingCalls.entries()) {
          if (callData.from === ws.userId && callData.targetId === targetId) {
            if (callData.status === "RINGING") {
              const targetUser = users.get(targetId);
              if (targetUser && targetUser.pushToken) {
                // Envoi de la notification d'appel manqué avec le même notId pour remplacer l'ancienne
                envoyerNotificationAppelManque(
                  targetUser.pushToken,
                  ws.userId,
                  callData.isVideo,
                  callData.notId,
                );
              }
            }
            pendingCalls.delete(cId);
            break;
          }
        }

        const targetWs = users.get(targetId)?.ws;
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(
            JSON.stringify({
              type: type,
              from: ws.userId,
              target: targetId,
            }),
          );
        }
        return;
      }

      // 8. Restart ICE
      // Envoyé par : A ou B -> Reçu par : l'autre participant
      // Pourquoi : Relancer la négociation ICE suite à un changement de réseau
      if (type === "restart-offer") {
        const targetWs = users.get(targetId)?.ws;
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(
            JSON.stringify({
              type: "restart-offer",
              offer: offer,
              from: ws.userId, // Ajout de l'identifiant de l'expéditeur
              isVideo: data.isVideo,
              isVideoUpgrade: data.isVideoUpgrade, // Relayé pour gérer la transition audio → vidéo
            }),
          );
        }
        return;
      }

      // 9. Partage d'écran (1-à-1)
      // Envoyé par : A ou B -> Reçu par : l'autre participant
      // Pourquoi : Relayer l'état du partage d'écran
      if (type === "screen-share-state") {
        const targetWs = users.get(targetId)?.ws;
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(
            JSON.stringify({
              type: "screen-share-state",
              active: !!data.active,
              from: ws.userId,
            }),
          );
        }
        return;
      }

      // 10. Like pour appel vidéo 1-à-1
      // Envoyé par : A ou B -> Reçu par : l'autre participant
      // Pourquoi : Relayer les likes pendant les appels vidéo
      if (type === "call-like") {
        const targetWs = users.get(targetId)?.ws;
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(
            JSON.stringify({
              type: "call-like",
              emoji: data.emoji,
              userId: ws.userId,
            }),
          );
          console.log(`[LIKE-1TO1] Like relayé de ${ws.userId} vers ${targetId}`);
        }
        return;
      }

      // =========================================================
      // APPEL DE GROUPE — Gestion des messages de groupe (Style WhatsApp)
      // =========================================================

      // 9. Création d'une salle d'appel de groupe
      // Envoyé par : Créateur -> Reçu par : Créateur (confirmation) + Invités (invitation)
      // Pourquoi : Créer une nouvelle salle et inviter les participants simultanément
      if (type === "group-create") {
        try {
          const { isVideo, invitedIds } = data;

          console.log(`[GROUPE] group-create reçu de ${ws.userId || "?"} avec invitedIds:`, invitedIds);

          // a. Vérifier que ws.userId est défini (utilisateur enregistré via register-user)
          if (!ws.userId) {
            console.error(`[GROUPE] group-create refusé : utilisateur non enregistré`);
            ws.send(
              JSON.stringify({
                type: "group-error",
                roomId: null,
                reason: "Non enregistré",
              }),
            );
            return;
          }

          // b. Valider invitedIds : Array.isArray && length > 0
          if (!Array.isArray(invitedIds) || invitedIds.length === 0) {
            console.error(`[GROUPE] group-create refusé : invitedIds invalide`);
            ws.send(
              JSON.stringify({
                type: "group-error",
                roomId: null,
                reason: "invitedIds invalide",
              }),
            );
            return;
          }

          // c. createRoom(ws.userId, isVideo)
          const room = roomManager.createRoom(ws.userId, isVideo);
          console.log(`[GROUPE] Salle créée : ${room.roomId}`);

          // d. invite(roomId, invitedIds, ws.userId) AVANT de construire le roster
          const inviteResults = roomManager.invite(room.roomId, invitedIds, ws.userId);
          console.log(`[GROUPE] Résultats invitation :`, inviteResults);

          // e. getRoster(roomId) → roster COMPLET (créateur JOINED + invités RINGING)
          const roster = roomManager.getRoster(room.roomId);
          console.log(`[GROUPE] Roster complet :`, roster);

          // f. Envoyer IMMÉDIATEMENT au créateur, AVANT toute notif push
          ws.send(
            JSON.stringify({
              type: "group-created",
              roomId: room.roomId,
              roster,
            }),
          );
          console.log(`[GROUPE] group-created envoyé au créateur ${ws.userId}`);

          // g. Ensuite seulement : boucle invitations (ws ouvert → group-invite, sinon pushToken → push, sinon group-error)
          for (const result of inviteResults) {
            if (result.success) {
              const invitedUser = users.get(result.userId);
              if (invitedUser?.ws && invitedUser.ws.readyState === WebSocket.OPEN) {
                invitedUser.ws.send(
                  JSON.stringify({
                    type: "group-invite",
                    roomId: room.roomId,
                    from: ws.userId,
                    isVideo: isVideo,
                    roster,
                  }),
                );
                console.log(`[GROUPE] group-invite envoyé à ${result.userId} (WebSocket)`);
              } else if (invitedUser?.pushToken) {
                // Utilisateur hors-ligne : envoyer notification Push
                const notId = Math.floor(100000 + Math.random() * 900000);
                await envoyerNotificationPush(
                  invitedUser.pushToken,
                  ws.userId,
                  `Appel ${isVideo ? "vidéo" : "audio"} de groupe`,
                  ws.userId,
                  room.roomId,
                  isVideo,
                  notId,
                  "group-invite",
                );
                console.log(`[GROUPE] notification push envoyée à ${result.userId}`);
              } else {
                // Ni connecté ni token FCM → introuvable
                ws.send(
                  JSON.stringify({
                    type: "group-error",
                    roomId: room.roomId,
                    reason: `Introuvable: ${result.userId}`,
                  }),
                );
                console.log(`[GROUPE] utilisateur introuvable : ${result.userId}`);
              }
            } else if (result.reason === "Occupé") {
              // h. Pour reason === "Occupé" → envoyer group-busy au créateur
              ws.send(
                JSON.stringify({
                  type: "group-busy",
                  roomId: room.roomId,
                  userId: result.userId,
                }),
              );
              console.log(`[GROUPE] utilisateur occupé : ${result.userId}`);
            }
          }
        } catch (error) {
          // i. Tout le handler dans un try/catch : en cas d'exception, envoyer group-error au créateur
          console.error(`[GROUPE] Erreur dans group-create :`, error);
          ws.send(
            JSON.stringify({
              type: "group-error",
              roomId: null,
              reason: error.message || "Erreur serveur",
            }),
          );
        }
        return;
      }

      // 10. Ajouter des participants à une salle existante
      // Envoyé par : Participant JOINED -> Reçu par : Nouveaux invités (invitation)
      // Pourquoi : Permettre d'ajouter des personnes pendant l'appel
      if (type === "group-add") {
        try {
          const { roomId, invitedIds } = data;

          console.log(`[GROUPE] group-add reçu de ${ws.userId || "?"} pour salle ${roomId} avec invitedIds:`, invitedIds);

          // Vérifier que l'émetteur est JOINED dans la salle
          if (!roomManager.isJoinedInRoom(roomId, ws.userId)) {
            console.error(`[GROUPE] group-add refusé : ${ws.userId || "?"} n'est pas JOINED dans ${roomId}`);
            ws.send(
              JSON.stringify({
                type: "group-error",
                roomId,
                reason: "Non autorisé",
              }),
            );
            return;
          }

          // Validation : invitedIds doit être un tableau non vide
          if (!Array.isArray(invitedIds) || invitedIds.length === 0) {
            console.error(`[GROUPE] group-add refusé : invitedIds invalide`);
            ws.send(
              JSON.stringify({
                type: "group-error",
                roomId,
                reason: "invitedIds invalide",
              }),
            );
            return;
          }

          const room = roomManager.rooms.get(roomId);
          if (!room) {
            console.error(`[GROUPE] group-add refusé : salle ${roomId} introuvable`);
            ws.send(
              JSON.stringify({
                type: "group-error",
                roomId,
                reason: "Salle introuvable",
              }),
            );
            return;
          }

          // Inviter AVANT de lire le roster → roster complet
          const inviteResults = roomManager.invite(roomId, invitedIds, ws.userId);
          console.log(`[GROUPE] Résultats invitation (group-add) :`, inviteResults);

          const roster = roomManager.getRoster(roomId);
          console.log(`[GROUPE] Roster complet (group-add) :`, roster);

          // Envoyer les invitations
          for (const result of inviteResults) {
            if (result.success) {
              const invitedUser = users.get(result.userId);
              if (invitedUser?.ws && invitedUser.ws.readyState === WebSocket.OPEN) {
                invitedUser.ws.send(
                  JSON.stringify({
                    type: "group-invite",
                    roomId,
                    from: ws.userId,
                    isVideo: room.isVideo,
                    roster,
                  }),
                );
                console.log(`[GROUPE] group-invite envoyé à ${result.userId} (WebSocket)`);
              } else if (invitedUser?.pushToken) {
                const notId = Math.floor(100000 + Math.random() * 900000);
                await envoyerNotificationPush(
                  invitedUser.pushToken,
                  ws.userId,
                  `Appel ${room.isVideo ? "vidéo" : "audio"} de groupe`,
                  ws.userId,
                  roomId,
                  room.isVideo,
                  notId,
                  "group-invite",
                );
                console.log(`[GROUPE] notification push envoyée à ${result.userId}`);
              } else {
                // Ni connecté ni token FCM → introuvable
                ws.send(
                  JSON.stringify({
                    type: "group-error",
                    roomId,
                    reason: `Introuvable: ${result.userId}`,
                  }),
                );
                console.log(`[GROUPE] utilisateur introuvable : ${result.userId}`);
              }
            } else if (result.reason === "Occupé") {
              ws.send(
                JSON.stringify({
                  type: "group-busy",
                  roomId,
                  userId: result.userId,
                }),
              );
              console.log(`[GROUPE] utilisateur occupé : ${result.userId}`);
            }
          }
        } catch (error) {
          console.error(`[GROUPE] Erreur dans group-add :`, error);
          ws.send(
            JSON.stringify({
              type: "group-error",
              roomId: data.roomId || null,
              reason: error.message || "Erreur serveur",
            }),
          );
        }
        return;
      }

      // 11. Rejoindre une salle (accepter l'invitation ou rejoindre après refus)
      // Envoyé par : Invité -> Reçu par : Invité (confirmation) + Autres JOINED (roster)
      // Pourquoi : Accepter une invitation ou rejoindre une salle active
      if (type === "group-join") {
        const { roomId } = data;

        // Vérifier que la salle existe
        // Après un redémarrage, restaurer une salle live depuis Firestore si le
        // client se reconnecte avant la restauration générale au démarrage.
        let room = roomManager.rooms.get(roomId);
        if (!room && typeof roomId === "string" && roomId.startsWith("room_meeting_")) {
          const meetingId = roomId.slice("room_meeting_".length);
          try {
            const meetingDoc = await db.collection("meetings").doc(meetingId).get();
            if (meetingDoc.exists) {
              const meeting = meetingDoc.data();
              if (meeting.status === "live" && meeting.roomId === roomId && meeting.endsAt > Date.now()) {
                // Plusieurs personnes peuvent revenir simultanément : réutiliser
                // la salle créée par la première requête arrivée après la lecture.
                room = roomManager.rooms.get(roomId) ||
                  roomManager.createMeetingRoom(meetingId, meeting.isVideo, meeting.endsAt);
                console.log(`[MEETING] Salle live restaurée à la demande: ${roomId}`);
              }
            }
          } catch (error) {
            console.error(`[MEETING] Échec restauration salle ${roomId}:`, error);
          }
        }
        if (!room) {
          ws.send(JSON.stringify({
            type: "group-error",
            roomId,
            reason: "Salle introuvable ou réunion terminée",
          }));
          return;
        }
        if (room.isMeeting && !room.isWaitingRoom) {
          roomManager.leaveUserFromOtherRooms(ws.userId, roomId);
        }
        // Recover a stale membership in this meeting's own waiting room.
        if (room.isMeeting && !room.isWaitingRoom && String(roomId).startsWith("room_meeting_")) {
          const meetingId = String(roomId).slice("room_meeting_".length);
          const waitingRoomId = `room_waiting_${meetingId}`;
          const waitingRoom = roomManager.rooms.get(waitingRoomId);
          if (waitingRoom?.participants.has(ws.userId)) {
            roomManager.leave(waitingRoomId, ws.userId);
            console.log(`[MEETING] ${ws.userId} moved from ${waitingRoomId} to ${roomId}`);
          }
        }

        if (room.isWaitingRoom) {
          const waitingMeetingId = roomId.slice("room_waiting_".length);
          const waitingMeetingDoc = await db.collection("meetings").doc(waitingMeetingId).get();
          const waitingMeeting = waitingMeetingDoc.exists ? waitingMeetingDoc.data() : null;
          const waitingUsers = Array.isArray(waitingMeeting?.waitingUsers) ? waitingMeeting.waitingUsers : [];
          if (!waitingMeeting || waitingMeeting.status !== "scheduled" || waitingMeeting.createdBy === ws.userId || !waitingUsers.includes(ws.userId)) {
            ws.send(JSON.stringify({ type: "group-error", roomId, reason: "Acc?s r?serv? aux visiteurs en attente" }));
            return;
          }
        }
        if (roomManager.isUserInAnyRoom(ws.userId) && !room.participants.has(ws.userId)) {
          ws.send(
            JSON.stringify({
              type: "group-error",
              roomId,
              reason: "Occupé",
            }),
          );
          return;
        }

        // Rejoindre la salle
        const joined = roomManager.join(roomId, ws.userId);
        if (!joined) {
          ws.send(
            JSON.stringify({
              type: "group-error",
              roomId,
              reason: "Impossible de rejoindre",
            }),
          );
          return;
        }

        // Répondre au participant avec le roster
        const roster = roomManager.getRoster(roomId);
        ws.send(
          JSON.stringify({
            type: "group-joined",
            roomId,
            roster,
          }),
        );

        // Notifier les autres participants de l'arrivée (pour Meeting)
        const meetingRoom = roomManager.rooms.get(roomId);
        if (meetingRoom) {
          for (const [participantId, participant] of meetingRoom.participants) {
            if (participantId !== ws.userId) {
              const user = users.get(participantId);
              if (user?.ws && user.ws.readyState === WebSocket.OPEN) {
                user.ws.send(JSON.stringify({
                  type: "meeting-participant-joined",
                  userId: ws.userId,
                }));
              }
            }
          }
        }
        return;
      }

      // 12. Refuser une invitation
      // Envoyé par : Invité -> Reçu par : Tous JOINED (roster mis à jour)
      // Pourquoi : Refuser une invitation sans fermer l'appel pour les autres
      if (type === "group-decline") {
        const { roomId } = data;

        const declined = roomManager.decline(roomId, ws.userId);
        if (!declined) {
          ws.send(
            JSON.stringify({
              type: "group-error",
              roomId,
              reason: "Impossible de refuser",
            }),
          );
        }
        return;
      }

      // 13. Quitter une salle
      // Envoyé par : Participant JOINED -> Reçu par : Tous JOINED (roster mis à jour)
      // Pourquoi : Quitter l'appel sans couper pour les autres
      if (type === "group-leave") {
        const { roomId } = data;

        // Vérifier que l'utilisateur est JOINED dans la salle
        if (!roomManager.isJoinedInRoom(roomId, ws.userId)) {
          ws.send(
            JSON.stringify({
              type: "group-error",
              roomId,
              reason: "Non JOINED dans cette salle",
            }),
          );
          return;
        }

        const left = roomManager.leave(roomId, ws.userId);
        if (!left) {
          ws.send(
            JSON.stringify({
              type: "group-error",
              roomId,
              reason: "Impossible de quitter",
            }),
          );
        }

        // Si l'utilisateur qui quitte volontairement est l'hôte de la réunion, terminer pour tous
        if (String(roomId).startsWith("room_meeting_")) {
          const meetingId = roomId.slice("room_meeting_".length);
          const isHost = await meetingManager.isHost(meetingId, ws.userId);
          if (isHost) {
            await endMeetingByHost(meetingId, ws.userId, "host_left");
            return;
          }
        }

        // Notifier les autres participants du départ (pour Meeting)
        const room = roomManager.rooms.get(roomId);
        if (room) {
          for (const [participantId, participant] of room.participants) {
            const user = users.get(participantId);
            if (user?.ws && user.ws.readyState === WebSocket.OPEN) {
              user.ws.send(JSON.stringify({
                type: "meeting-participant-left",
                userId: ws.userId,
              }));
            }
          }
        }
        return;
      }

      // 14. Demander les informations d'une salle (application ouverte via notification)
      // Envoyé par : Utilisateur -> Reçu par : Utilisateur (infos) ou group-ended (si fermée)
      // Pourquoi : Récupérer les infos de la salle quand l'app est ouverte via notification
      if (type === "group-get-info") {
        const { roomId } = data;

        const room = roomManager.rooms.get(roomId);
        if (!room) {
          ws.send(
            JSON.stringify({
              type: "group-ended",
              roomId,
              reason: "Salle fermée",
            }),
          );
          return;
        }

        const roster = roomManager.getRoster(roomId);
        ws.send(
          JSON.stringify({
            type: "group-info",
            roomId,
            isVideo: room.isVideo,
            roster,
          }),
        );
        return;
      }

      // 15. Signal WebRTC entre participants d'un groupe
      // Envoyé par : Participant A JOINED -> Reçu par : Participant B JOINED
      // Pourquoi : Relayer les signaux WebRTC (offer, answer, ICE candidate) entre participants
      if (type === "group-signal") {
        const { roomId, targetId, payload } = data;

        // Vérifier que l'expéditeur est JOINED dans la salle
        if (!roomManager.isJoinedInRoom(roomId, ws.userId)) {
          console.warn(`⚠️ Utilisateur ${ws.userId} n'est pas JOINED dans la salle ${roomId}`);
          return;
        }

        // Vérifier que le destinataire est JOINED dans la salle
        if (!roomManager.isJoinedInRoom(roomId, targetId)) {
          console.warn(`⚠️ Destinataire ${targetId} n'est pas JOINED dans la salle ${roomId}`);
          return;
        }

        // Relayer le signal vers le destinataire
        const targetUser = users.get(targetId);
        if (targetUser?.ws && targetUser.ws.readyState === WebSocket.OPEN) {
          targetUser.ws.send(
            JSON.stringify({
              type: "group-signal",
              roomId,
              from: ws.userId,
              payload,
            }),
          );
        }
        return;
      }

      // 16. Like entre participants d'un groupe
      // Envoyé par : Participant A JOINED -> Reçu par : Tous les participants JOINED (sauf expéditeur)
      // Pourquoi : Permettre aux participants d'envoyer des likes (❤️) pendant l'appel
      if (type === "group-like") {
        const { roomId, emoji, userId } = data;

        console.log(`[LIKE] group-like reçu de ${userId} dans salle ${roomId}: ${emoji}`);

        // Vérifier que l'expéditeur est JOINED dans la salle
        if (!roomManager.isJoinedInRoom(roomId, ws.userId)) {
          console.warn(`⚠️ [LIKE] Utilisateur ${ws.userId} n'est pas JOINED dans la salle ${roomId}`);
          return;
        }

        // Relayer le like à tous les participants JOINED de la salle (sauf l'expéditeur)
        const room = roomManager.rooms.get(roomId);
        if (!room) {
          console.warn(`⚠️ [LIKE] Salle ${roomId} introuvable`);
          return;
        }

        for (const [participantId, participant] of room.participants) {
          if (participantId !== userId && participant.state === "JOINED") {
            const participantUser = users.get(participantId);
            if (participantUser?.ws && participantUser.ws.readyState === WebSocket.OPEN) {
              participantUser.ws.send(
                JSON.stringify({
                  type: "group-like",
                  roomId,
                  emoji,
                  userId,
                }),
              );
              console.log(`✅ [LIKE] Like relayé à ${participantId}`);
            }
          }
        }
        return;
      }

      // =========================================================
      // RÉUNIONS PLANIFIÉES — Gestion des messages meeting-*
      // =========================================================

      // 16. Créer une réunion planifiée
      // Envoyé par : Utilisateur -> Reçu par : Utilisateur (confirmation)
      // Pourquoi : Créer une réunion planifiée avec un code partageable
      if (type === "meeting-create" || type === "create-meeting") {
        const sendMeetingError = (msg) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: "meeting-error",
              reason: msg,
              message: msg,
            }));
          }
        };
        try {
          // Validation des données
          const validation = validateMeetingMessage(data, "meeting-create");
          if (!validation.valid) {
            console.warn(`[MEETING] ${type} refusé : ${validation.reason}`);
            sendMeetingError(validation.reason);
            return;
          }

          const { title, description, scheduledAt, durationMin, isVideo, participants, accessPolicy, hostName } = data;
          const scheduleCheck = normalizeScheduledAt(scheduledAt);
          if (!scheduleCheck.valid) {
            sendMeetingError(scheduleCheck.reason);
            return;
          }

          const waitingMusicTracks = Array.isArray(data.waitingMusicTracks) ? data.waitingMusicTracks : [];
          const validWaitingMusic = waitingMusicTracks.every((track) =>
            track && typeof track.dataUrl === "string" && /^data:audio\/[a-zA-Z0-9.+-]+;base64,/.test(track.dataUrl)
          ) && waitingMusicTracks.reduce((sum, track) => sum + track.dataUrl.length, 0) <= MAX_WAITING_MUSIC_TRANSFER_BYTES;
          if (!validWaitingMusic) {
            sendMeetingError("La liste audio est trop volumineuse pour être transmise");
            return;
          }

          console.log(`[MEETING] ${type} reçu de ${ws.userId || "?"} accessPolicy=${accessPolicy || "direct"}`);

          if (!ws.userId) {
            console.error(`[MEETING] ${type} refusé : utilisateur non enregistré`);
            sendMeetingError("Non enregistré");
            return;
          }

          // Sanitiser les chaînes
          const sanitizedTitle = sanitizeString(title, 100);
          const sanitizedDescription = description ? sanitizeString(description, 500) : "";
          const policy = (accessPolicy === "approval") ? "approval" : "direct";

          // Créer la réunion
          const meeting = await meetingManager.create({
            title: sanitizedTitle,
            description: sanitizedDescription,
            scheduledAt: scheduleCheck.value,
            durationMin,
            isVideo: !!isVideo,
            createdBy: ws.userId,
            hostName,
            participants: participants || [],
            accessPolicy: policy,
          });

          // Vérifier si la création a réussi
          if (meeting.success === false) {
            sendMeetingError(meeting.reason);
            console.log(`[MEETING] ${type} refusé: ${meeting.reason}`);
            return;
          }

          if (waitingMusicTracks.length) {
            meetingWaitingMusic.set(meeting.meetingId, {
              syncAt: Date.now(),
              tracks: waitingMusicTracks.map((track) => ({
                dataUrl: track.dataUrl,
                name: String(track.name || "Musique d’attente").slice(0, 120),
              })),
            });
          }

          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "meeting-created",
                meetingId: meeting.meetingId,
                code: meeting.code,
                link: meeting.link,
                title: meeting.title,
                description: meeting.description,
                scheduledAt: meeting.scheduledAt,
                endsAt: meeting.endsAt,
                durationMin: meeting.durationMin,
                isVideo: meeting.isVideo,
                hostName: meeting.hostName,
              }),
            );
          }
          console.log(`[MEETING] meeting-created envoyé à ${ws.userId}`);
        } catch (error) {
          console.error(`[MEETING] Erreur dans ${type} :`, error);
          sendMeetingError(error.message || "Erreur serveur");
        }
        return;
      }

      // 17. Rejoindre une réunion par code
      // Envoyé par : Utilisateur -> Reçu par : Utilisateur (waiting/joined/error)
      // Pourquoi : Rejoindre une réunion planifiée via son code
      if (type === "meeting-join") {
        try {
          // Validation des données
          const validation = validateMeetingMessage(data, "meeting-join");
          if (!validation.valid) {
            console.warn(`[MEETING] meeting-join refusé : ${validation.reason}`);
            ws.send(
              JSON.stringify({
                type: "meeting-error",
                reason: validation.reason,
              }),
            );
            return;
          }

          const { code } = data;

          console.log(`[MEETING] meeting-join reçu de ${ws.userId || "?"} pour code ${code}`);

          // Extraire l'IP du client pour le rate limiting
          const clientIP = ws._socket.remoteAddress || "unknown";

          // Vérifier le rate limiting
          if (!checkMeetingJoinRateLimit(clientIP)) {
            console.warn(`[MEETING] meeting-join refusé : rate limit atteint pour IP ${clientIP}`);
            ws.send(
              JSON.stringify({
                type: "meeting-error",
                reason: "Trop de tentatives, réessayez plus tard",
              }),
            );
            return;
          }

          if (!ws.userId) {
            console.error(`[MEETING] meeting-join refusé : utilisateur non enregistré`);
            ws.send(
              JSON.stringify({
                type: "meeting-error",
                reason: "Non enregistré",
              }),
            );
            return;
          }

          // Vérification supplémentaire des permissions avant le join
          const meetingDoc = await db.collection("meetings").where("code", "==", code).limit(1).get();
          if (meetingDoc.empty) {
            ws.send(JSON.stringify({ type: "meeting-error", reason: "Réunion introuvable" }));
            return;
          }
          const meeting = meetingDoc.docs[0].data();

          // Vérifier si la réunion est annulée ou terminée
          if (meeting.status === "cancelled") {
            ws.send(JSON.stringify({ type: "meeting-error", reason: "Réunion annulée" }));
            return;
          }
          if (meeting.status === "ended") {
            ws.send(JSON.stringify({ type: "meeting-error", reason: "Réunion terminée" }));
            return;
          }

          const result = await meetingManager.join(code, ws.userId);

          if (result.success) {
            // Réunion live : retourner roomId pour enchaîner sur group-join
            ws.send(
              JSON.stringify({
                type: "meeting-joined",
                meetingId: result.meetingId,
                roomId: result.roomId,
                isVideo: result.isVideo,
                title: result.title,
                code: result.code,
                createdBy: result.createdBy,
              }),
            );
            console.log(`[MEETING] meeting-joined envoyé à ${ws.userId} (salle ${result.roomId})`);
          } else if (result.status === "waiting") {
            // Trop tôt : afficher compte à rebours
            ws.send(
              JSON.stringify({
                type: "meeting-waiting",
                waitTimeMs: result.waitTimeMs,
                waitTimeMin: result.waitTimeMin,
                scheduledAt: result.scheduledAt,
                code: result.code,
                meetingId: result.meetingId,
                serverNow: result.serverNow,
                opensAt: result.opensAt,
                waitingRoomId: result.waitingRoomId,
                isVideo: result.isVideo,
                title: result.title,
                createdBy: result.createdBy,
                waitingMusic: meetingWaitingMusic.get(result.meetingId) || null,
              }),
            );
            console.log(`[MEETING] meeting-waiting envoyé à ${ws.userId} (${result.waitTimeMin}min restantes)`);
          } else if (result.status === "pending_approval") {
            // En attente d'approbation de l'hôte
            ws.send(
              JSON.stringify({
                type: "meeting-pending-approval",
                meetingId: result.meetingId,
                reason: result.reason,
              }),
            );
            console.log(`[MEETING] meeting-pending-approval envoyé à ${ws.userId}`);
          } else {
            // Erreur (code invalide, expiré, etc.)
            ws.send(
              JSON.stringify({
                type: "meeting-error",
                reason: result.reason,
              }),
            );
            console.log(`[MEETING] meeting-error envoyé à ${ws.userId} (${result.reason})`);
          }
        } catch (error) {
          console.error(`[MEETING] Erreur dans meeting-join :`, error);
          ws.send(
            JSON.stringify({
              type: "meeting-error",
              reason: error.message || "Erreur serveur",
            }),
          );
        }
        return;
      }

      // 18. Démarrer une réunion avant l'heure prévue (hôte)
      // Envoyé par : Host -> Reçu par : Host + participants en attente
      // Pourquoi : Forcer le lancement de la réunion et intégrer les utilisateurs en attente
      if (type === "meeting-waiting-music-set" || type === "meeting-waiting-music-stop") {
        try {
          const meetingId = typeof data.meetingId === "string" ? data.meetingId : "";
          if (!ws.userId || !meetingId || meetingId.length > 100) return;
          const meetingDoc = await db.collection("meetings").doc(meetingId).get();
          if (!meetingDoc.exists) return;
          const meeting = meetingDoc.data();
          if (meeting.createdBy !== ws.userId || meeting.status !== "scheduled") {
            ws.send(JSON.stringify({ type: "meeting-error", reason: "Seul l’hôte peut contrôler la musique d’attente" }));
            return;
          }
          const waitingUsers = Array.isArray(meeting.waitingUsers) ? meeting.waitingUsers.filter(Boolean) : [];
          if (type === "meeting-waiting-music-stop") {
            notifyWaitingMusicStopped(meetingId, waitingUsers, ws.userId);
            return;
          }
          const tracks = Array.isArray(data.tracks) ? data.tracks : [{ dataUrl: data.dataUrl, name: data.name }];
          const validTracks = tracks.length > 0 && tracks.every((track) =>
            track && typeof track.dataUrl === "string" && /^data:audio\/[a-zA-Z0-9.+-]+;base64,/.test(track.dataUrl)
          ) && tracks.reduce((sum, track) => sum + track.dataUrl.length, 0) <= MAX_WAITING_MUSIC_TRANSFER_BYTES;
          if (!validTracks) {
            ws.send(JSON.stringify({ type: "meeting-error", reason: "Liste audio invalide ou trop volumineuse pour être transmise" }));
            return;
          }
          // syncAt : horodatage serveur => les clients calculent la position
          // de lecture (seek) via leur clockOffset pour écouter le même
          // morceau au même moment.
          const music = { syncAt: Date.now(), tracks: tracks.map((track) => ({
            dataUrl: track.dataUrl,
            name: String(track.name || "Musique d’attente").slice(0, 120),
          })) };
          meetingWaitingMusic.set(meetingId, music);
          const recipients = new Set(waitingUsers);
          for (const recipientId of recipients) {
            const user = users.get(recipientId);
            if (user?.ws && user.ws.readyState === WebSocket.OPEN) {
              user.ws.send(JSON.stringify({ type: "meeting-waiting-music-set", meetingId, ...music }));
            }
          }
        } catch (error) {
          console.error("[MEETING] Erreur musique d’attente:", error);
        }
        return;
      }

      if (type === "meeting-force-start") {
        try {
          // Validation des données
          const validation = validateMeetingMessage(data, "meeting-force-start");
          if (!validation.valid) {
            console.warn(`[MEETING] meeting-force-start refusé : ${validation.reason}`);
            ws.send(JSON.stringify({ type: "meeting-error", reason: validation.reason }));
            return;
          }

          const { code } = data;

          console.log(`[MEETING] meeting-force-start reçu de ${ws.userId || "?"} pour code ${code}`);

          if (!ws.userId) {
            ws.send(JSON.stringify({ type: "meeting-error", reason: "Non enregistré" }));
            return;
          }

          // Vérifier que l'utilisateur est autorisé (hôte)
          const meetingDoc = await db.collection("meetings").where("code", "==", code).limit(1).get();
          if (meetingDoc.empty) {
            ws.send(JSON.stringify({ type: "meeting-error", reason: "Réunion introuvable" }));
            return;
          }
          const meeting = meetingDoc.docs[0].data();
          if (meeting.createdBy !== ws.userId) {
            ws.send(JSON.stringify({ type: "meeting-error", reason: "Non autorisé (seul l'hôte peut démarrer)" }));
            return;
          }

          const result = await meetingManager.forceStart(code, ws.userId);

          if (result.success) {
            ws.send(JSON.stringify({
              type: "meeting-joined",
              meetingId: result.meetingId,
              roomId: result.roomId,
              isVideo: result.isVideo,
              title: result.title,
              code: result.code,
              createdBy: result.createdBy || ws.userId,
            }));
            console.log(`[MEETING] meeting-force-start OK: ${result.roomId} pour ${ws.userId}`);
          } else {
            ws.send(JSON.stringify({
              type: "meeting-error",
              reason: result.reason,
            }));
          }
        } catch (error) {
          console.error(`[MEETING] Erreur dans meeting-force-start :`, error);
          ws.send(JSON.stringify({ type: "meeting-error", reason: error.message || "Erreur serveur" }));
        }
        return;
      }

      // 19. Annuler une réunion
      // Envoyé par : Host -> Reçu par : Host (confirmation)
      // Pourquoi : Annuler une réunion planifiée (réservé à l'hôte)
      // Retirer un visiteur de la liste d'attente lorsqu'il quitte.
      if (type === "meeting-waiting-leave") {
        if (!ws.userId || typeof data.meetingId !== "string" || data.meetingId.length > 100) return;
        const meetingDoc = await db.collection("meetings").doc(data.meetingId).get();
        if (!meetingDoc.exists) return;
        const waitingUsers = Array.isArray(meetingDoc.data().waitingUsers) ? meetingDoc.data().waitingUsers : [];
        if (waitingUsers.includes(ws.userId)) await meetingManager._removeWaitingUser(data.meetingId, ws.userId);
        return;
      }

      if (type === "meeting-cancel") {
        try {
          // Validation des données
          const validation = validateMeetingMessage(data, "meeting-cancel");
          if (!validation.valid) {
            console.warn(`[MEETING] meeting-cancel refusé : ${validation.reason}`);
            ws.send(
              JSON.stringify({
                type: "meeting-error",
                reason: validation.reason,
              }),
            );
            return;
          }

          const { meetingId } = data;

          console.log(`[MEETING] meeting-cancel reçu de ${ws.userId || "?"} pour ${meetingId}`);

          if (!ws.userId) {
            console.error(`[MEETING] meeting-cancel refusé : utilisateur non enregistré`);
            ws.send(
              JSON.stringify({
                type: "meeting-error",
                reason: "Non enregistré",
              }),
            );
            return;
          }

          // Vérifier que l'utilisateur est l'hôte
          const isHost = await meetingManager.isHost(meetingId, ws.userId);
          if (!isHost) {
            ws.send(JSON.stringify({ type: "meeting-error", reason: "Non autorisé (seul l'hôte peut annuler)" }));
            return;
          }

          const result = await meetingManager.cancel(meetingId, ws.userId);

          if (result.success) {
            ws.send(
              JSON.stringify({
                type: "meeting-cancelled",
                meetingId,
              }),
            );
            console.log(`[MEETING] meeting-cancelled envoyé à ${ws.userId}`);
          } else {
            ws.send(
              JSON.stringify({
                type: "meeting-error",
                reason: result.reason,
              }),
            );
            console.log(`[MEETING] meeting-error envoyé à ${ws.userId} (${result.reason})`);
          }
        } catch (error) {
          console.error(`[MEETING] Erreur dans meeting-cancel :`, error);
          ws.send(
            JSON.stringify({
              type: "meeting-error",
              reason: error.message || "Erreur serveur",
            }),
          );
        }
        return;
      }

      // 20. Approuver une demande d'accès (hôte)
      // Envoyé par : Host -> Reçu par : Participant + Host (confirmation)
      // Pourquoi : Permettre à l'hôte d'approuver un participant en attente
      if (type === "meeting-approve") {
        try {
          // Validation des données
          const validation = validateMeetingMessage(data, "meeting-approve");
          if (!validation.valid) {
            console.warn(`[MEETING] meeting-approve refusé : ${validation.reason}`);
            ws.send(JSON.stringify({ type: "meeting-error", reason: validation.reason }));
            return;
          }

          const { meetingId, userId } = data;

          console.log(`[MEETING] meeting-approve reçu de ${ws.userId} pour ${userId} dans ${meetingId}`);

          if (!ws.userId) {
            ws.send(JSON.stringify({ type: "meeting-error", reason: "Non enregistré" }));
            return;
          }

          // Vérifier que l'utilisateur est l'hôte
          const isHost = await meetingManager.isHost(meetingId, ws.userId);
          if (!isHost) {
            ws.send(JSON.stringify({ type: "meeting-error", reason: "Non autorisé (seul l'hôte peut approuver)" }));
            return;
          }

          const result = await meetingManager.approveRequest(meetingId, userId, ws.userId);

          if (result.success) {
            // Si l'approbation a démarré la salle, l'hôte doit aussi rejoindre
            // le client WebRTC ; l'ajout côté serveur seul laisse l'invité sur
            // « Connexion… » sans aucun pair actif.
            if (result.hostNeedsJoin) {
              ws.send(JSON.stringify({
                type: "meeting-joined",
                meetingId,
                roomId: result.roomId,
                isVideo: result.isVideo,
                title: result.title,
                code: result.code,
                createdBy: result.createdBy,
              }));
            }

            // Notifier le participant
            const participantUser = users.get(userId);
            if (participantUser?.ws && participantUser.ws.readyState === WebSocket.OPEN) {
              participantUser.ws.send(JSON.stringify({
                type: "meeting-approval-granted",
                meetingId,
                roomId: result.roomId,
                isVideo: result.isVideo,
                title: result.title,
                code: result.code,
                createdBy: result.createdBy,
              }));
            }
            // Confirmer à l'hôte
            ws.send(JSON.stringify({
              type: "meeting-approval-sent",
              meetingId,
              userId,
            }));
          } else {
            ws.send(JSON.stringify({
              type: "meeting-error",
              reason: result.reason,
            }));
          }
        } catch (error) {
          console.error(`[MEETING] Erreur dans meeting-approve :`, error);
          ws.send(JSON.stringify({ type: "meeting-error", reason: error.message || "Erreur serveur" }));
        }
        return;
      }

      // 21. Refuser une demande d'accès (hôte)
      // Envoyé par : Host -> Reçu par : Participant + Host (confirmation)
      // Pourquoi : Permettre à l'hôte de refuser un participant
      if (type === "meeting-reject") {
        try {
          // Validation des données
          const validation = validateMeetingMessage(data, "meeting-reject");
          if (!validation.valid) {
            console.warn(`[MEETING] meeting-reject refusé : ${validation.reason}`);
            ws.send(JSON.stringify({ type: "meeting-error", reason: validation.reason }));
            return;
          }

          const { meetingId, userId } = data;

          console.log(`[MEETING] meeting-reject reçu de ${ws.userId} pour ${userId} dans ${meetingId}`);

          if (!ws.userId) {
            ws.send(JSON.stringify({ type: "meeting-error", reason: "Non enregistré" }));
            return;
          }

          // Vérifier que l'utilisateur est l'hôte
          const isHost = await meetingManager.isHost(meetingId, ws.userId);
          if (!isHost) {
            ws.send(JSON.stringify({ type: "meeting-error", reason: "Non autorisé (seul l'hôte peut refuser)" }));
            return;
          }

          const result = await meetingManager.rejectRequest(meetingId, userId, ws.userId);

          if (result.success) {
            // Notifier le participant
            const participantUser = users.get(userId);
            if (participantUser?.ws && participantUser.ws.readyState === WebSocket.OPEN) {
              participantUser.ws.send(JSON.stringify({
                type: "meeting-approval-denied",
                meetingId,
                reason: result.reason || "Accès refusé par l'hôte",
              }));
            }
            // Confirmer à l'hôte
            ws.send(JSON.stringify({
              type: "meeting-rejection-sent",
              meetingId,
              userId,
            }));
          } else {
            ws.send(JSON.stringify({
              type: "meeting-error",
              reason: result.reason,
            }));
          }
        } catch (error) {
          console.error(`[MEETING] Erreur dans meeting-reject :`, error);
          ws.send(JSON.stringify({ type: "meeting-error", reason: error.message || "Erreur serveur" }));
        }
        return;
      }

      // 22. Synchronisation de l'état des participants
      // Envoyé par : Participant -> Reçu par : Tous les participants de la salle
      // Pourquoi : Synchroniser en temps réel l'état média (mic, caméra, etc.)
      if (type === "meeting-participant-state") {
        const { roomId, userId, state } = data;

        if (!roomManager.isJoinedInRoom(roomId, ws.userId)) {
          return;
        }

        const room = roomManager.rooms.get(roomId);
        if (!room) return;
        // SÉCURITÉ : un participant ne peut publier que SON état. Un userId du
        // payload différent de l'expéditeur permittrait de falsifier l'état
        // (micro/caméra) d'un autre participant.
        if (userId && userId !== ws.userId) return;
        // Ne relayer qu'un état borné (micro / caméra / partage) : évite
        // d'injecter des objets arbitraires dans l'UI des autres clients.
        const safeState = {
          micEnabled: state?.micEnabled === true,
          camEnabled: state?.camEnabled === true,
          screenSharing: state?.screenSharing === true,
        };

        for (const [participantId, participant] of room.participants) {
          if (participantId !== ws.userId) {
            const user = users.get(participantId);
            if (user?.ws && user.ws.readyState === WebSocket.OPEN) {
              user.ws.send(JSON.stringify({
                type: "meeting-participant-state",
                userId: ws.userId,
                state: safeState,
              }));
            }
          }
        }
        return;
      }

      // 23. Message de chat de réunion
      // Envoyé par : Participant -> Reçu par : Tous les participants de la salle
      // Pourquoi : Chat temps réel pendant la réunion
      if (type === "meeting-chat-message") {
        const validation = validateMeetingMessage(data, type);
        if (!validation.valid) {
          ws.send(JSON.stringify({ type: "meeting-chat-error", reason: validation.reason, clientMessageId: data.clientMessageId || null }));
          return;
        }

        const { roomId, meetingId, message, clientMessageId } = data;
        const room = roomManager.rooms.get(roomId);
        if (!ws.userId || !roomManager.isJoinedInRoom(roomId, ws.userId) ||
            !room || !room.isMeeting || roomId !== `room_meeting_${meetingId}`) {
          ws.send(JSON.stringify({ type: "meeting-chat-error", reason: "Vous n'êtes pas dans cette réunion.", clientMessageId: data.clientMessageId || null }));
          return;
        }

        const cleanMessage = sanitizeString(message).slice(0, 1000).trim();
        if (!cleanMessage) return;
        const chatMessage = {
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
          clientMessageId: typeof clientMessageId === "string" ? clientMessageId.slice(0, 100) : null,
          meetingId,
          message: cleanMessage,
          userId: ws.userId,
          displayName: getUserDisplayName(ws.userId) || ws.userId,
          timestamp: Date.now(),
        };

        try {
          await db.collection("meetings").doc(meetingId)
            .collection("chat").doc(chatMessage.id).set(chatMessage);
        } catch (error) {
          console.error("[MEETING CHAT] Échec de sauvegarde :", error);
          ws.send(JSON.stringify({
            type: "meeting-chat-error",
            reason: "Le message n'a pas pu être enregistré. Réessayez.",
            clientMessageId: chatMessage.clientMessageId,
          }));
          return;
        }

        // Persister avant de diffuser, puis envoyer l'écho à l'expéditeur aussi.
        for (const [participantId, participant] of room.participants) {
          if (participant.state !== "JOINED") continue;
          const user = users.get(participantId);
          if (user?.ws && user.ws.readyState === WebSocket.OPEN) {
            user.ws.send(JSON.stringify({
              type: "meeting-chat-message",
              ...chatMessage,
            }));
          }
        }
        return;
      }

      // 23b. Lever / baisser la main (WebSocket)
      if (type === "meeting-hand-raise" || type === "meeting-hand-lower") {
        const { roomId, meetingId } = data;
        if (!roomManager.isJoinedInRoom(roomId, ws.userId)) return;
        const room = roomManager.rooms.get(roomId);
        if (!room) return;
        const msg = {
          type: type === "meeting-hand-raise" ? "meeting-hand-raised" : "meeting-hand-lowered",
          meetingId,
          roomId,
          userId: ws.userId,
        };
        for (const [participantId] of room.participants) {
          const user = users.get(participantId);
          if (user?.ws && user.ws.readyState === WebSocket.OPEN) {
            user.ws.send(JSON.stringify(msg));
          }
        }
        return;
      }

      // 23c. Réaction emoji
      if (type === "meeting-reaction") {
        const { roomId, meetingId, reaction } = data;
        if (!roomManager.isJoinedInRoom(roomId, ws.userId)) return;
        const room = roomManager.rooms.get(roomId);
        if (!room) return;
        const msg = {
          type: "meeting-reaction",
          meetingId,
          roomId,
          userId: ws.userId,
          reaction: String(reaction || "").slice(0, 8),
          timestamp: Date.now(),
        };
        for (const [participantId] of room.participants) {
          const user = users.get(participantId);
          if (user?.ws && user.ws.readyState === WebSocket.OPEN) {
            user.ws.send(JSON.stringify(msg));
          }
        }
        return;
      }

      // 23d. Hôte coupe micro / caméra d'un participant
      if (type === "meeting-kick") {
        try {
          const { meetingId, roomId, targetUserId } = data;
          if (!ws.userId || !targetUserId || typeof targetUserId !== "string" || targetUserId.length > 100) return;
          if (!meetingId || typeof meetingId !== "string" || meetingId.length > 100
              || !roomId || typeof roomId !== "string" || roomId.length > 100) return;
          const isHost = await meetingManager.isHost(meetingId, ws.userId);
          if (!isHost) {
            ws.send(JSON.stringify({ type: "meeting-error", reason: "Seul l'hôte peut retirer un participant" }));
            return;
          }
          // SÉCURITÉ : la salle ciblée doit être celle de la réunion de l'hôte.
          // Sans cette liaison, n'importe quel organisateur pouvait éjecter
          // quelqu'un de N'IMPORTE QUELLE salle (roomIds prévisibles).
          const meetingDoc = await db.collection("meetings").doc(meetingId).get();
          const expectedRoomId = meetingDoc.exists ? meetingDoc.data().roomId : null;
          if (!expectedRoomId) {
            ws.send(JSON.stringify({ type: "meeting-error", reason: "Salle de réunion introuvable" }));
            return;
          }
          if (roomId !== expectedRoomId) {
            ws.send(JSON.stringify({ type: "meeting-error", reason: "Salle invalide pour cette réunion" }));
            return;
          }
          const room = roomManager.rooms.get(roomId);
          if (!room) return;
          // La cible doit être un participant réel de CETTE salle ; par sécurité
          // on empêche aussi l'hôte de s'éjecter lui-même par commande forgée.
          if (!room.participants.has(targetUserId) || targetUserId === ws.userId) {
            ws.send(JSON.stringify({ type: "meeting-error", reason: "Participant introuvable dans cette réunion" }));
            return;
          }
          roomManager.leave(roomId, targetUserId);
          const target = users.get(targetUserId);
          if (target?.ws && target.ws.readyState === WebSocket.OPEN) {
            target.ws.send(JSON.stringify({
              type: "meeting-kicked",
              meetingId,
              roomId,
              reason: "Vous avez été retiré de la réunion par l'hôte",
            }));
          }
          // Notifier les autres
          for (const [pid] of room.participants) {
            const u = users.get(pid);
            if (u?.ws && u.ws.readyState === WebSocket.OPEN) {
              u.ws.send(JSON.stringify({
                type: "meeting-participant-left",
                userId: targetUserId,
              }));
            }
          }
          console.log(`📅 [MEETING] ${targetUserId} retiré par l'hôte ${ws.userId}`);
        } catch (e) {
          console.error("[MEETING] kick error:", e);
        }
        return;
      }

      if (type === "meeting-host-mute") {
        try {
          const { meetingId, roomId, targetUserId, media, muted } = data;
          if (!ws.userId) return;
          if (!meetingId || typeof meetingId !== "string" || meetingId.length > 100
              || !roomId || typeof roomId !== "string" || roomId.length > 100
              || !targetUserId || typeof targetUserId !== "string" || targetUserId.length > 100) return;
          const isHost = await meetingManager.isHost(meetingId, ws.userId);
          if (!isHost) {
            ws.send(JSON.stringify({ type: "meeting-error", reason: "Seul l'hôte peut couper micro/caméra" }));
            return;
          }
          if (!["mic", "cam"].includes(media)) return;
          // SÉCURITÉ : même liaison que meeting-kick — la salle ciblée doit être
          // celle de la réunion de l'hôte, et la cible un participant réel.
          const meetingDoc = await db.collection("meetings").doc(meetingId).get();
          const expectedRoomId = meetingDoc.exists ? meetingDoc.data().roomId : null;
          if (!expectedRoomId || roomId !== expectedRoomId) {
            ws.send(JSON.stringify({ type: "meeting-error", reason: "Salle invalide pour cette réunion" }));
            return;
          }
          const room = roomManager.rooms.get(roomId);
          if (!room || !room.participants.has(targetUserId)) return;

          // Envoyer l'ordre au participant ciblé
          const target = users.get(targetUserId);
          if (target?.ws && target.ws.readyState === WebSocket.OPEN) {
            target.ws.send(JSON.stringify({
              type: "meeting-force-mute",
              meetingId,
              roomId,
              media,
              muted: muted !== false,
              byHost: ws.userId,
            }));
          }

          // Notifier tous les autres pour maj UI
          const broadcast = {
            type: "meeting-participant-state",
            userId: targetUserId,
            state: media === "mic"
              ? { micEnabled: muted === false }
              : { camEnabled: muted === false },
          };
          for (const [participantId] of room.participants) {
            const user = users.get(participantId);
            if (user?.ws && user.ws.readyState === WebSocket.OPEN) {
              user.ws.send(JSON.stringify(broadcast));
            }
          }
        } catch (e) {
          console.error("[MEETING] host-mute error:", e);
        }
        return;
      }

      // 24. Terminer une réunion pour tous (hôte)
      // Envoyé par : Host -> Reçu par : Tous les participants
      // Pourquoi : Terminer la réunion et déconnecter tous les participants
      if (type === "meeting-end") {
        try {
          // Validation des données
          const validation = validateMeetingMessage(data, "meeting-end");
          if (!validation.valid) {
            console.warn(`[MEETING] meeting-end refusé : ${validation.reason}`);
            ws.send(JSON.stringify({ type: "meeting-error", reason: validation.reason }));
            return;
          }

          const { meetingId } = data;

          if (!ws.userId) {
          ws.send(JSON.stringify({ type: "meeting-error", reason: "Non enregistré" }));
          return;
        }

        // Vérifier que l'utilisateur est l'hôte
        const isHost = await meetingManager.isHost(meetingId, ws.userId);
        if (!isHost) {
          ws.send(JSON.stringify({ type: "meeting-error", reason: "Non autorisé (seul l'hôte peut terminer)" }));
          return;
        }

        // Récupérer la réunion
        const doc = await db.collection("meetings").doc(meetingId).get();
        if (!doc.exists) {
          ws.send(JSON.stringify({ type: "meeting-error", reason: "Réunion introuvable" }));
          return;
        }

        const meeting = doc.data();

        // Notifier tous les participants AVANT de fermer la salle
        if (meeting.roomId) {
          const room = roomManager.rooms.get(meeting.roomId);
          if (room) {
            for (const [participantId] of room.participants) {
              const user = users.get(participantId);
              if (user?.ws && user.ws.readyState === WebSocket.OPEN) {
                user.ws.send(JSON.stringify({
                  type: "meeting-ended",
                  meetingId,
                  reason: "Réunion terminée par l'hôte",
                }));
              }
            }
          }
        }

        // Marquer comme terminée
        await db.collection("meetings").doc(meetingId).update({ status: "ended" });

        // Arrêter la musique d'attente pour tous les participants
        const waitingUsersEnd = Array.isArray(meeting.waitingUsers) ? meeting.waitingUsers.filter(Boolean) : [];
        if (waitingUsersEnd.length) {
          notifyWaitingMusicStopped(meetingId, waitingUsersEnd, ws.userId);
        }

        // Fermer la salle
        if (meeting.roomId) {
          roomManager.closeRoom(meeting.roomId, "Réunion terminée par l'hôte");
        }

        console.log(`📅 Réunion ${meetingId} terminée par ${ws.userId}`);
        return;
        } catch (error) {
          console.error(`[MEETING] Erreur dans meeting-end :`, error);
          ws.send(JSON.stringify({ type: "meeting-error", reason: error.message || "Erreur serveur" }));
        }
        return;
      }

      if (type === "meeting-leave") {
        try {
          const meetingId = typeof data.meetingId === "string" ? data.meetingId : "";
          if (!ws.userId || !meetingId) return;
          const isHost = await meetingManager.isHost(meetingId, ws.userId);
          if (isHost) {
            await endMeetingByHost(meetingId, ws.userId, "host_left");
          }
        } catch (error) {
          console.error("[MEETING] Erreur meeting-leave:", error);
        }
        return;
      }

      // ===== TABLEAU BLANC COLLABORATIF (WHITEBOARD) =====
      if (
        type === "whiteboard-toggle" ||
        type === "whiteboard-draw" ||
        type === "whiteboard-clear" ||
        type === "whiteboard-sync"
      ) {
        try {
          const meetingId = typeof data.meetingId === "string" ? data.meetingId.trim() : "";
          if (!ws.userId || !meetingId || meetingId.length > 100) return;

          const liveRoomId = `room_meeting_${meetingId}`;
          const room = roomManager.rooms.get(liveRoomId);
          const doc = await db.collection("meetings").doc(meetingId).get();
          if (!doc.exists) return;
          const meeting = doc.data();

          const isHost = meeting.createdBy === ws.userId;
          const isCoHost = Array.isArray(meeting.coHosts) && meeting.coHosts.includes(ws.userId);
          const inRoom = !!(room && room.participants.has(ws.userId));
          const isListed = Array.isArray(meeting.participants) && meeting.participants.includes(ws.userId);
          if (!inRoom && !isHost && !isCoHost && !isListed) {
            ws.send(JSON.stringify({ type: "meeting-error", reason: "Accès tableau blanc non autorisé" }));
            return;
          }

          if (!meetingWhiteboards.has(meetingId)) {
            meetingWhiteboards.set(meetingId, {
              isOpen: false,
              allowParticipantsDraw: true,
              strokes: [],
            });
          }
          const wb = meetingWhiteboards.get(meetingId);

          const broadcastToMeeting = (payloadObj, excludeUserId = null) => {
            if (!room) return;
            const msg = JSON.stringify(payloadObj);
            for (const [pid] of room.participants) {
              if (excludeUserId && pid === excludeUserId) continue;
              const u = users.get(pid);
              if (u?.ws && u.ws.readyState === WebSocket.OPEN) {
                u.ws.send(msg);
              }
            }
          };

          if (type === "whiteboard-sync") {
            ws.send(JSON.stringify({
              type: "whiteboard-state",
              meetingId,
              isOpen: wb.isOpen,
              allowParticipantsDraw: wb.allowParticipantsDraw,
              strokes: wb.strokes,
            }));
            return;
          }

          if (type === "whiteboard-toggle") {
            if (!isHost && !isCoHost) {
              ws.send(JSON.stringify({ type: "meeting-error", reason: "Seul l'hôte peut ouvrir/fermer le tableau" }));
              return;
            }
            if (typeof data.isOpen === "boolean") wb.isOpen = data.isOpen;
            if (typeof data.allowParticipantsDraw === "boolean") wb.allowParticipantsDraw = data.allowParticipantsDraw;
            broadcastToMeeting({
              type: "whiteboard-state",
              meetingId,
              isOpen: wb.isOpen,
              allowParticipantsDraw: wb.allowParticipantsDraw,
              strokes: wb.strokes,
            });
            return;
          }

          if (type === "whiteboard-clear") {
            if (!isHost && !isCoHost) {
              ws.send(JSON.stringify({ type: "meeting-error", reason: "Seul l'hôte peut effacer le tableau" }));
              return;
            }
            wb.strokes = [];
            broadcastToMeeting({
              type: "whiteboard-cleared",
              meetingId,
              by: ws.userId,
            });
            return;
          }

          if (type === "whiteboard-draw") {
            if (!wb.isOpen) return;
            if (!isHost && !isCoHost && !wb.allowParticipantsDraw) return;
            const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
            const stroke = {
              x0: clamp01(data.x0),
              y0: clamp01(data.y0),
              x1: clamp01(data.x1),
              y1: clamp01(data.y1),
              color: typeof data.color === "string" ? data.color.slice(0, 20) : "#111827",
              size: Math.max(1, Math.min(32, Number(data.size) || 3)),
              tool: data.tool === "eraser" ? "eraser" : "pen",
            };
            if (wb.strokes.length >= MAX_WHITEBOARD_STROKES) {
              wb.strokes.shift();
            }
            wb.strokes.push(stroke);
            broadcastToMeeting({
              type: "whiteboard-draw",
              meetingId,
              from: ws.userId,
              ...stroke,
            }, ws.userId);
            return;
          }
        } catch (error) {
          console.error("[WHITEBOARD] Erreur:", error);
        }
        return;
      }

      // 19. Lister les réunions d'un utilisateur
      // Envoyé par : Utilisateur -> Reçu par : Utilisateur (liste)
      // Pourquoi : Récupérer les réunions à venir et passées
      if (type === "meeting-list") {
        try {
          console.log(`[MEETING] meeting-list reçu de ${ws.userId || "?"}`);

          if (!ws.userId) {
            console.error(`[MEETING] meeting-list refusé : utilisateur non enregistré`);
            ws.send(
              JSON.stringify({
                type: "meeting-error",
                reason: "Non enregistré",
              }),
            );
            return;
          }

          const { upcoming, past } = await meetingManager.listForUser(ws.userId);

          ws.send(
            JSON.stringify({
              type: "meeting-list",
              upcoming,
              past,
            }),
          );
          console.log(`[MEETING] meeting-list envoyé à ${ws.userId} (${upcoming.length} à venir, ${past.length} passées)`);
        } catch (error) {
          console.error(`[MEETING] Erreur dans meeting-list :`, error);
          ws.send(
            JSON.stringify({
              type: "meeting-error",
              reason: error.message || "Erreur serveur",
            }),
          );
        }
        return;
      }
    } catch (error) {
      console.error("❌ Erreur de lecture du message :", error);
    }
  });

  // Nettoyage à la déconnexion
  ws.on("close", () => {
    if (ws.userId) {
      const existingUser = users.get(ws.userId);
      if (existingUser?.ws === ws) {
        users.set(ws.userId, {
          ws: null,
          pushToken: existingUser.pushToken,
        });
        console.log(
          `❌ Socket déconnecté pour ${ws.userId} (Utilisateur et Token FCM conservés)`,
        );

        // =========================================================
        // APPEL DE GROUPE — Nettoyage des salles à la déconnexion
        // =========================================================
        // Si l'utilisateur déconnecté est hôte d'une réunion live, lancer un délai de grâce de 8s
        for (const [roomId, room] of roomManager.rooms.entries()) {
          if (String(roomId).startsWith("room_meeting_") && room.participants.has(ws.userId)) {
            const meetingId = roomId.slice("room_meeting_".length);
            const disconnectedUserId = ws.userId;
            meetingManager.isHost(meetingId, disconnectedUserId).then((isHost) => {
              if (!isHost) return;
              const graceKey = `${meetingId}:${disconnectedUserId}`;
              if (hostLeaveGraceTimers.has(graceKey)) return;
              const timer = setTimeout(async () => {
                hostLeaveGraceTimers.delete(graceKey);
                const current = users.get(disconnectedUserId);
                if (current?.ws && current.ws.readyState === WebSocket.OPEN) {
                  return; // L'hôte s'est reconnecté entre-temps
                }
                await endMeetingByHost(meetingId, disconnectedUserId, "host_left");
              }, 8000);
              hostLeaveGraceTimers.set(graceKey, timer);
            }).catch(() => {});
          }
        }

        // Marquer l'utilisateur comme LEFT dans toutes ses salles
        roomManager.markLeftInAllRooms(ws.userId);
      }
    }
  });

  ws.on("error", (error) => {
    console.error(
      `❌ Erreur WebSocket sur l'utilisateur ${ws.userId || "Inconnu"} :`,
      error,
    );
  });
});

/**
 * Fonction d'envoi de notification Push FCM optimisée (Taille < 500 octets)
 */
async function envoyerNotificationPush(
  tokenDestinataire,
  nomExpediteur,
  texteMessage,
  from,
  callId,
  isVideo = false,
  notId = null,  // ✅ FIX : accepter le notId fourni par l'appelant
  notificationType = "incoming-call", // Type de notification (incoming-call ou group-invite)
) {
  if (!tokenDestinataire) {
    console.warn(
      "⚠️ Impossible d'envoyer la notification : Aucun token FCM fourni.",
    );
    return;
  }

  // ✅ FIX : utiliser le notId fourni, sinon en générer un
  if (notId === null) notId = Math.floor(100000 + Math.random() * 900000);

  // Construction du payload de base
  const baseData = {
    title: isVideo ? "📹 Appel vidéo entrant" : "📞 Appel entrant",
    message: texteMessage || `Appel de ${from}`,
    type: notificationType,
    callerId: String(from),
    callerName: String(nomExpediteur || from),
    isVideo: String(isVideo),
    notId: String(notId),
  };

  // Ajout de champs spécifiques selon le type de notification
  if (notificationType === "incoming-call") {
    baseData.callId = String(callId);
    baseData.actions = JSON.stringify([
      {
        title: "Refuser",
        callback: "reject",
        foreground: false,
      },
      {
        title: "Accepter",
        callback: "accept",
        foreground: true,
      },
    ]);
  } else if (notificationType === "group-invite") {
    baseData.roomId = String(callId); // Pour group-invite, callId contient le roomId
    baseData.from = String(from);
    baseData.actions = JSON.stringify([
      {
        title: "Refuser",
        callback: "reject",
        foreground: false,
      },
      {
        title: "Accepter",
        callback: "accept",
        foreground: true,
      },
    ]);
  }

  const payload = {
    token: tokenDestinataire,
    data: baseData,
    android: {
      priority: "high",
    },
  };

  try {
    const response = await getMessaging().send(payload);
    console.log("📲 Notification Push FCM envoyée avec succès, ID :", response);
  } catch (error) {
    console.error("❌ Erreur lors de l'envoi FCM :", error);
  }
}

// 5. Ajout de la fonction pour envoyer la notification "Appel manqué"
async function envoyerNotificationAppelManque(
  tokenDestinataire,
  nomExpediteur,
  isVideo,
  notId,
  isGroup = false, // Indique si c'est un appel de groupe
) {
  const payload = {
    token: tokenDestinataire,
    data: {
      type: "missed-call",
      title: isGroup ? "Appel de groupe manqué" : "Appel manqué",
      message: isGroup
        ? `Vous avez manqué un appel ${isVideo ? "vidéo" : "audio"} de groupe`
        : `Vous avez manqué un appel ${isVideo ? "vidéo" : "audio"} de ${nomExpediteur}`,
      callerId: String(nomExpediteur),
      notId: notId ? String(notId) : null,
      isGroup: String(isGroup),
    },
    android: {
      priority: "high",
    },
  };

  try {
    await getMessaging().send(payload);
    console.log(`📵 Notification Appel Manqué envoyée (${isGroup ? "groupe" : "1-à-1"})`);
  } catch (error) {
    console.error(
      "❌ Erreur lors de l'envoi de la notification appel manqué :",
      error,
    );
  }
}

const PORT = process.env.PORT || 3000;

// =========================================================
//  GESTION GLOBALE DES ERREURS ASYNCHRONES NON CAPTURÉES
// =========================================================
// Ne pas masquer les états fatals : on journalise seulement pour éviter
// qu'une promesse rejetée (Firestore, FCM, WebSocket…) ne fasse
// tomber tout le serveur et toutes les réunions en cours.
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Promesse rejetée non gérée :", reason);
});

process.on("uncaughtException", (error) => {
  console.error("❌ Exception non capturée :", error);
});

server.listen(PORT, () =>
  console.log(`🚀 Serveur WebSocket actif sur le port ${PORT}`),
);
