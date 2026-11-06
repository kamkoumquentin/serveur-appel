const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// MODIFICATION RENDER : Utilisation du port dynamique
const PORT = process.env.PORT || 8080;

// ======================================================
// TOKENS & SESSIONS EN MEMOIRE & PERSISTANCE DISQUE
// ======================================================
const fcmTokens = new Map();
const TOKENS_CACHE_FILE = path.join(__dirname, "fcm_tokens_cache.json");

function chargerTokensFCM() {
    try {
        if (fs.existsSync(TOKENS_CACHE_FILE)) {
            const data = fs.readFileSync(TOKENS_CACHE_FILE, "utf-8");
            const parsed = JSON.parse(data);
            Object.entries(parsed).forEach(([id, token]) => {
                if (id && token) fcmTokens.set(String(id), String(token));
            });
            console.log(`💾 ${fcmTokens.size} tokens FCM chargés depuis le cache local (${TOKENS_CACHE_FILE})`);
        }
    } catch (e) {
        console.warn("⚠️ Impossible de charger fcm_tokens_cache.json :", e.message);
    }
}

function sauvegarderTokensFCM() {
    try {
        const obj = {};
        fcmTokens.forEach((token, id) => {
            obj[id] = token;
        });
        fs.writeFileSync(TOKENS_CACHE_FILE, JSON.stringify(obj, null, 2), "utf-8");
    } catch (e) {
        console.warn("⚠️ Impossible d'écrire dans fcm_tokens_cache.json :", e.message);
    }
}

chargerTokensFCM();

const utilisateurs = new Map();
const sessionTokens = new Map(); // identifiant -> jeton de session client
const userAppStates = new Map(); // identifiant -> isForeground (boolean)
const userScreenStates = new Map(); // identifiant -> "SCREEN_ON" | "SCREEN_OFF"
const appels = new Map();
const pendingOffers = new Map();
const MAX_PARTICIPANTS = 4;
const MAX_JOIN_ATTEMPTS_PER_CONNECTION = 10;
const ROOM_STATE_INTERVAL_MS = 100;
const CHAT_RATE_LIMIT_COUNT = 5;
const CHAT_RATE_LIMIT_WINDOW_MS = 5000;
const MAX_ROOM_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MAX_ROOM_VOICE_DURATION_MS = 120000;
const ROOM_ATTACHMENT_AUTH_TTL_MS = 10 * 60 * 1000;
const ROOM_ATTACHMENT_ORPHAN_TTL_MS = 2 * 60 * 60 * 1000;
const ROOM_ATTACHMENT_PURGE_INTERVAL_MS = 10 * 60 * 1000;
const ROOM_UPLOADS_DIR = path.join(__dirname, "uploads", "rooms");
const ROOM_FILE_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf"
]);
const ROOM_VOICE_MIME_TYPES = new Set([
    "audio/webm",
    "audio/ogg",
    "audio/mp4"
]);
const ROOM_CODE_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const rooms = new Map();
const roomCodes = new Map();
const roomAttachments = new Map();

// MACHINE À ÉTATS SERVEUR & DÉDUPLICATION
// callSessions : callId -> { callId, from, to, state: "RINGING" | "ACCEPTING" | "CONNECTED" | "REJECTED" | "ENDED", offer, createdAt }
const callSessions = new Map();
// endedCalls : callId -> timestamp (TTL 60s pour empêcher le replay d'anciens appels)
const endedCalls = new Map();
// Seul agent IVR autorisé à recevoir une demande de conseiller (touche 1).
const IVR_AGENT_ID = "SERVICE-001";

function logCall(event, details = {}) {
    console.log(`[CALL] ${event} | callId=${details.callId || "n/a"} | from=${details.from || "n/a"} | to=${details.to || "n/a"} | state=${details.state || "n/a"} | info=${details.info || ""}`);
}

function normaliserHasVideo(value) {
    return value === true || value === "true";
}

function markCallEnded(callId) {
    if (!callId) return;
    endedCalls.set(String(callId), Date.now());
    const session = callSessions.get(String(callId));
    if (session) {
        session.state = "ENDED";
    }
}

function isCallEnded(callId) {
    if (!callId) return false;
    return endedCalls.has(String(callId));
}

// Nettoyage périodique (toutes les 30s) des appels terminés et sessions expirées (> 60s / 5min)
setInterval(() => {
    const now = Date.now();
    endedCalls.forEach((timestamp, callId) => {
        if (now - timestamp > 60000) {
            endedCalls.delete(callId);
        }
    });
    callSessions.forEach((session, callId) => {
        if (now - session.createdAt > 300000) { // 5 minutes max par session
            callSessions.delete(callId);
        }
    });
}, 30000);

// ======================================================
// INITIALISATION FIREBASE notification firebase
// ======================================================
const { initializeApp, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
let messaging = null;

try {
    let serviceAccount = null;

    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        try {
            serviceAccount = typeof process.env.FIREBASE_SERVICE_ACCOUNT === "string"
                ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
                : process.env.FIREBASE_SERVICE_ACCOUNT;
            console.log("🔑 Clé Firebase chargée depuis FIREBASE_SERVICE_ACCOUNT");
        } catch (e) {
            console.error("❌ Erreur parsing FIREBASE_SERVICE_ACCOUNT JSON :", e.message);
        }
    } else if (process.env.FIREBASE_KEY) {
        try {
            serviceAccount = typeof process.env.FIREBASE_KEY === "string"
                ? JSON.parse(process.env.FIREBASE_KEY)
                : process.env.FIREBASE_KEY;
            console.log("🔑 Clé Firebase chargée depuis FIREBASE_KEY");
        } catch (e) {
            console.error("❌ Erreur parsing FIREBASE_KEY JSON :", e.message);
        }
    }

    if (!serviceAccount) {
        try {
            serviceAccount = require("./firebase-key.json");
            console.log("🔑 Clé Firebase chargée depuis firebase-key.json local");
        } catch (e) {
            try {
                serviceAccount = require("/etc/secrets/firebase-key.json");
                console.log("🔑 Clé Firebase chargée depuis /etc/secrets/firebase-key.json");
            } catch (e2) {
                console.warn("⚠️ Fichier firebase-key.json introuvable :", e.message);
            }
        }
    }

    if (serviceAccount) {
        // Important pour Render : transforme les \n échappés en vrais retours à la ligne
        if (serviceAccount.private_key && typeof serviceAccount.private_key === "string") {
            serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
        }

        initializeApp({
            credential: cert(serviceAccount)
        });

        messaging = getMessaging();
        console.log("✅ Firebase Admin initialisé avec succès !");
        console.log("🔥 Projet Firebase :", serviceAccount.project_id);
    } else {
        console.warn("⚠️ Aucune clé de service Firebase trouvée. Les notifications push FCM seront désactivées.");
    }
} catch (err) {
    console.error("❌ Impossible d'initialiser Firebase Admin :", err.message);
}

// =============================================================================
// FONCTIONS DE NOTIFICATION PUSH DÉDIÉES (TEST 1 vs TEST 2)
// =============================================================================

function gererErreurFCM(error, to) {
    console.error(`❌ Erreur envoi Push FCM à ${to} :`, error.message);
    if (error.code === "messaging/registration-token-not-registered" ||
        error.code === "messaging/invalid-registration-token") {
        console.log(`🗑️ Suppression du token périmé pour ${to}`);
        fcmTokens.delete(to);
        sauvegarderTokensFCM();
    }
}

// =============================================================================
// FONCTION TEST 1 : Bannière interactive (écran allumé / arrière-plan standard)
// - Utilise calls_channel_v5 sans force-start
// - Affiche les deux boutons [Refuser] et [Accepter]
// - Ne force PAS l'ouverture de l'application (zéro concurrence avec l'interface)
// =============================================================================
function envoyerPushTest1Banniere(tokenDestinataire, to, from, callId, offerStr, hasVideo, notIdVal) {
    if (!messaging) {
        console.error("⚠️ Firebase Messaging n'est pas initialisé.");
        return;
    }
    const payload = {
        token: tokenDestinataire,
        data: {
            type: "APPEL",
            mode: "TEST_1_BANNIERE",
            callId: String(callId),
            callerId: String(from),
            caller_name: String(from),
            appelant: String(from),
            app_name: "KamSoft",
            title: "KamSoft - Appel entrant",
            subText: "Appel entrant",
            message: `${from} vous appelle`,
            body: `${from} vous appelle`,
            notId: String(notIdVal),
            icon: "ic_launcher",
            color: "#00A884",
            offer: offerStr || "",
            hasVideo: String(normaliserHasVideo(hasVideo)),
            actions: JSON.stringify([
                {
                    title: "Refuser",
                    callback: "rejectCallAction",
                    foreground: false
                },
                {
                    title: "Accepter",
                    callback: "acceptCallAction",
                    foreground: true
                }
            ]),
            android_channel_id: "calls_channel_v5",
            channelId: "calls_channel_v5",
            priority: "2",
            visibility: "1",
            importance: "5",
            sound: "default",
            vibrate: "true",
            vibrationPattern: "[0, 500, 250, 500]",
            category: "call"
        },
        android: {
            priority: "high",
            ttl: 60 * 1000
        }
    };

    logCall("FCM_SENT", { callId, from, to, info: `[TEST 1 BANNIÈRE] Envoi push avec boutons [Accepter/Refuser] (notId=${notIdVal})` });

    messaging.send(payload)
        .then(response => {
            logCall("FCM_DELIVERED", { callId, from, to, info: `[TEST 1 BANNIÈRE] FCM envoyé avec succès (${response})` });
        })
        .catch(error => {
            gererErreurFCM(error, to);
        });
}

// =============================================================================
// FONCTION TEST 2 : Réveil de l'écran en veille & affichage Interface 2 au-dessus du schéma
// - Payload Data-Only silencieux (AUCUNE notification système affichée dans la barre)
// - Déclenche le réveil matériel de l'écran via backgroundMode.wakeUp() et l'Interface 2
// =============================================================================
function envoyerPushTest2Veille(tokenDestinataire, to, from, callId, offerStr, hasVideo, notIdVal) {
    if (!messaging) {
        console.error("⚠️ Firebase Messaging n'est pas initialisé.");
        return;
    }
    // Payload Data-Only pur : sans title, body, message, ni actions
    // Sur Android, cela ne crée aucune notification dans la barre de notifications
    // mais délivre immédiatement les données à l'application pour allumer l'écran
    const payload = {
        token: tokenDestinataire,
        data: {
            type: "APPEL",
            mode: "TEST_2_VEILLE",
            screen_wake: "true",
            target_mode: "LOCKSCREEN_WAKE",
            callId: String(callId),
            callerId: String(from),
            caller_name: String(from),
            appelant: String(from),
            app_name: "KamSoft",
            offer: offerStr || "",
            hasVideo: String(normaliserHasVideo(hasVideo)),
            "force-start": "1",
            "content-available": "1"
        },
        android: {
            priority: "high",
            ttl: 60 * 1000
        }
    };

    logCall("FCM_SENT", { callId, from, to, info: `[TEST 2 RÉVEIL VEILLE] Envoi push réveil écran (Data-only sans notification)` });

    messaging.send(payload)
        .then(response => {
            logCall("FCM_DELIVERED", { callId, from, to, info: `[TEST 2 RÉVEIL VEILLE] FCM envoyé avec succès (${response})` });
        })
        .catch(error => {
            gererErreurFCM(error, to);
        });
}

// ======================================================
// SERVEUR HTTP (Pour le reveil Render, Diagnostic & Health Check)
// ======================================================
function repondreJsonHttp(res, statusCode, payload) {
    if (res.headersSent) return;
    res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
}

function authentifierAccesSalleHttp(req, roomId) {
    const userId = String(req.headers["x-user-id"] || "").trim();
    const sessionToken = String(req.headers["x-session-token"] || "").trim();
    if (!userId || !sessionToken || sessionTokens.get(userId) !== sessionToken) {
        return { error: { status: 401, code: "AUTH_REQUIRED", message: "Session invalide ou expirée." } };
    }

    const room = rooms.get(roomId);
    const participant = room && room.participants.get(userId);
    if (!participant) {
        return { error: { status: 403, code: "NOT_IN_ROOM", message: "Vous ne participez pas à cette salle." } };
    }
    return { userId, room, participant };
}

async function lireCorpsJsonHttp(req, maxBytes = 16 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > maxBytes) {
            const error = new Error("La requête est trop volumineuse.");
            error.code = "REQUEST_TOO_LARGE";
            throw error;
        }
        chunks.push(chunk);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
        if (error.code === "REQUEST_TOO_LARGE") throw error;
        const invalidJson = new Error("Le corps JSON est invalide.");
        invalidJson.code = "INVALID_JSON";
        throw invalidJson;
    }
}

function ecrireFluxPieceJointe(req, fileHandle, maxBytes) {
    return new Promise((resolve, reject) => {
        let receivedSize = 0;
        let signatureSize = 0;
        const signatureChunks = [];
        let writing = false;
        let ended = false;
        let settled = false;

        const cleanup = () => {
            req.off("data", onData);
            req.off("end", onEnd);
            req.off("error", onError);
            req.off("aborted", onAborted);
        };
        const fail = (error, drainRequest = false) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (drainRequest) req.resume();
            reject(error);
        };
        const finish = () => {
            if (settled || !ended || writing) return;
            settled = true;
            cleanup();
            resolve({
                size: receivedSize,
                signature: Buffer.concat(signatureChunks)
            });
        };
        const onData = chunk => {
            if (settled) return;
            receivedSize += chunk.length;
            if (receivedSize > maxBytes) {
                const error = new Error("La taille maximale est de 10 MiB.");
                error.code = "FILE_TOO_LARGE";
                fail(error, true);
                return;
            }
            if (signatureSize < 16) {
                const part = chunk.subarray(0, 16 - signatureSize);
                signatureChunks.push(part);
                signatureSize += part.length;
            }

            writing = true;
            req.pause();
            (async () => {
                let offset = 0;
                while (offset < chunk.length) {
                    const result = await fileHandle.write(chunk, offset, chunk.length - offset, null);
                    offset += result.bytesWritten;
                }
            })().then(() => {
                writing = false;
                if (ended) finish();
                else req.resume();
            }, error => fail(error, true));
        };
        const onEnd = () => {
            ended = true;
            finish();
        };
        const onError = error => fail(error);
        const onAborted = () => {
            const error = new Error("Le transfert a été interrompu.");
            error.code = "UPLOAD_ABORTED";
            fail(error);
        };

        req.on("data", onData);
        req.once("end", onEnd);
        req.once("error", onError);
        req.once("aborted", onAborted);
    });
}

function nettoyerNomPieceJointe(name) {
    const basename = path.basename(String(name || "").replace(/\\/g, "/"));
    const cleaned = basename
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
        .trim()
        .slice(0, 120);
    return cleaned || "fichier";
}

function cheminRepertoireSalle(roomId) {
    return path.join(ROOM_UPLOADS_DIR, roomId);
}

function cheminPieceJointe(roomId, attachmentId) {
    return path.join(cheminRepertoireSalle(roomId), attachmentId);
}

function verifierSignaturePieceJointe(mimeType, signature) {
    if (mimeType === "image/jpeg") {
        return signature.length >= 3 && signature[0] === 0xff &&
            signature[1] === 0xd8 && signature[2] === 0xff;
    }
    if (mimeType === "image/png") {
        return signature.length >= 8 &&
            signature.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    if (mimeType === "image/webp") {
        return signature.length >= 12 &&
            signature.toString("ascii", 0, 4) === "RIFF" &&
            signature.toString("ascii", 8, 12) === "WEBP";
    }
    if (mimeType === "application/pdf") {
        return signature.toString("ascii", 0, 5) === "%PDF-";
    }
    if (mimeType === "audio/webm") {
        return signature.length >= 4 &&
            signature.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    }
    if (mimeType === "audio/ogg") {
        return signature.toString("ascii", 0, 4) === "OggS";
    }
    if (mimeType === "audio/mp4") {
        return signature.length >= 12 && signature.toString("ascii", 4, 8) === "ftyp";
    }
    return false;
}

async function supprimerPieceJointe(record) {
    const paths = [
        cheminPieceJointe(record.roomId, record.id),
        `${cheminPieceJointe(record.roomId, record.id)}.uploading`
    ];
    for (const filePath of paths) {
        try {
            await fs.promises.unlink(filePath);
        } catch (error) {
            if (error.code !== "ENOENT") {
                console.warn(`[RoomUpload] Suppression impossible (${filePath}) :`, error.message);
            }
        }
    }
}

async function supprimerPiecesJointesSalle(roomId) {
    for (const [attachmentId, record] of roomAttachments) {
        if (record.roomId !== roomId) continue;
        roomAttachments.delete(attachmentId);
    }
    try {
        await fs.promises.rm(cheminRepertoireSalle(roomId), { recursive: true, force: true });
    } catch (error) {
        console.error(`[RoomUpload] Purge de la salle ${roomId} impossible :`, error);
    }
}

async function purgerPiecesJointesOrphelines() {
    let roomDirectories;
    try {
        roomDirectories = await fs.promises.readdir(ROOM_UPLOADS_DIR, { withFileTypes: true });
    } catch (error) {
        if (error.code !== "ENOENT") {
            console.error("[RoomUpload] Lecture du dossier des uploads impossible :", error);
        }
        return;
    }

    const now = Date.now();
    for (const [attachmentId, record] of roomAttachments) {
        const roomClosed = !rooms.has(record.roomId);
        const authorizationExpired = record.status === "authorized" && record.expiresAt <= now;
        if (!roomClosed && !authorizationExpired) continue;
        roomAttachments.delete(attachmentId);
        await supprimerPieceJointe(record);
    }

    for (const roomDirectory of roomDirectories) {
        if (!roomDirectory.isDirectory() || !/^[0-9a-f-]{36}$/i.test(roomDirectory.name)) continue;
        const roomId = roomDirectory.name;
        let files;
        try {
            files = await fs.promises.readdir(cheminRepertoireSalle(roomId), { withFileTypes: true });
        } catch (error) {
            console.warn(`[RoomUpload] Lecture des uploads de ${roomId} impossible :`, error.message);
            continue;
        }

        for (const file of files) {
            if (!file.isFile()) continue;
            const isTemporary = file.name.endsWith(".uploading");
            const attachmentId = isTemporary ? file.name.slice(0, -".uploading".length) : file.name;
            const record = roomAttachments.get(attachmentId);
            const isTracked = record && record.roomId === roomId;
            let modifiedAt;
            try {
                const stat = await fs.promises.stat(path.join(cheminRepertoireSalle(roomId), file.name));
                modifiedAt = stat.mtimeMs;
            } catch (error) {
                console.warn(`[RoomUpload] Métadonnées indisponibles pour ${file.name} :`, error.message);
                continue;
            }
            const expiredAuthorization = isTracked &&
                record.status !== "uploaded" &&
                record.expiresAt <= now;
            const orphanTooOld = !isTracked && now - modifiedAt > ROOM_ATTACHMENT_ORPHAN_TTL_MS;
            if (!expiredAuthorization && !orphanTooOld) continue;

            try {
                await fs.promises.unlink(path.join(cheminRepertoireSalle(roomId), file.name));
            } catch (error) {
                if (error.code !== "ENOENT") {
                    console.warn(`[RoomUpload] Suppression de ${file.name} impossible :`, error.message);
                }
            }
            if (isTracked && expiredAuthorization) roomAttachments.delete(attachmentId);
        }
    }
}

const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-User-Id, X-Session-Token");
    res.setHeader("Vary", "Origin");
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
    }

    if (parsedUrl.pathname === "/room-upload-auth") {
        if (req.method !== "POST") {
            return repondreJsonHttp(res, 405, { code: "METHOD_NOT_ALLOWED", message: "Méthode non autorisée." });
        }
        let payload;
        try {
            payload = await lireCorpsJsonHttp(req);
        } catch (error) {
            const tooLarge = error.code === "REQUEST_TOO_LARGE";
            return repondreJsonHttp(res, tooLarge ? 413 : 400, {
                code: tooLarge ? "REQUEST_TOO_LARGE" : "INVALID_JSON",
                message: error.message
            });
        }

        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            return repondreJsonHttp(res, 400, { code: "INVALID_JSON", message: "Le corps de la requête est invalide." });
        }
        const roomId = typeof payload.roomId === "string" ? payload.roomId : "";
        const access = authentifierAccesSalleHttp(req, roomId);
        if (access.error) {
            return repondreJsonHttp(res, access.error.status, access.error);
        }

        const attachmentType = payload.type;
        const mimeType = typeof payload.mimeType === "string" ? payload.mimeType.trim().toLowerCase() : "";
        const size = payload.size;
        if (!Number.isSafeInteger(size) || size <= 0) {
            return repondreJsonHttp(res, 400, { code: "INVALID_SIZE", message: "La taille du fichier est invalide." });
        }
        if (size > MAX_ROOM_ATTACHMENT_SIZE) {
            return repondreJsonHttp(res, 413, { code: "FILE_TOO_LARGE", message: "La taille maximale est de 10 MiB." });
        }

        const allowedMimeTypes = attachmentType === "voice"
            ? ROOM_VOICE_MIME_TYPES
            : attachmentType === "file"
                ? ROOM_FILE_MIME_TYPES
                : null;
        if (!allowedMimeTypes || !allowedMimeTypes.has(mimeType)) {
            return repondreJsonHttp(res, 415, { code: "INVALID_MIME", message: "Ce type de fichier n’est pas autorisé." });
        }

        let durationMs = null;
        if (attachmentType === "voice") {
            durationMs = payload.durationMs;
            if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
                return repondreJsonHttp(res, 400, { code: "INVALID_DURATION", message: "La durée du message vocal est invalide." });
            }
            if (durationMs > MAX_ROOM_VOICE_DURATION_MS) {
                return repondreJsonHttp(res, 400, { code: "VOICE_TOO_LONG", message: "Un message vocal ne peut pas dépasser 120 secondes." });
            }
        } else if (payload.durationMs !== undefined) {
            return repondreJsonHttp(res, 400, { code: "INVALID_METADATA", message: "Une durée n’est autorisée que pour un message vocal." });
        }

        const attachmentId = crypto.randomUUID();
        const expiresAt = Date.now() + ROOM_ATTACHMENT_AUTH_TTL_MS;
        roomAttachments.set(attachmentId, {
            id: attachmentId,
            roomId,
            userId: access.userId,
            type: attachmentType,
            mimeType,
            size,
            durationMs,
            name: attachmentType === "file" ? nettoyerNomPieceJointe(payload.name) : null,
            status: "authorized",
            createdAt: Date.now(),
            expiresAt
        });
        return repondreJsonHttp(res, 201, {
            attachmentId,
            uploadUrl: `/room-upload/${attachmentId}`,
            expiresAt
        });
    }

    const uploadMatch = parsedUrl.pathname.match(/^\/room-upload\/([0-9a-f-]{36})$/i);
    if (uploadMatch) {
        if (req.method !== "PUT") {
            return repondreJsonHttp(res, 405, { code: "METHOD_NOT_ALLOWED", message: "Méthode non autorisée." });
        }
        const attachmentId = uploadMatch[1];
        const record = roomAttachments.get(attachmentId);
        if (!record) {
            return repondreJsonHttp(res, 404, { code: "ATTACHMENT_NOT_FOUND", message: "Pièce jointe introuvable." });
        }
        const access = authentifierAccesSalleHttp(req, record.roomId);
        if (access.error) {
            return repondreJsonHttp(res, access.error.status, access.error);
        }
        if (record.userId !== access.userId) {
            return repondreJsonHttp(res, 403, { code: "ATTACHMENT_FORBIDDEN", message: "Cette autorisation d’upload ne vous appartient pas." });
        }
        if (record.status !== "authorized" || record.expiresAt <= Date.now()) {
            return repondreJsonHttp(res, 409, { code: "ATTACHMENT_NOT_READY", message: "L’autorisation d’upload est expirée ou déjà utilisée." });
        }

        const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
        if (contentType && contentType !== record.mimeType) {
            return repondreJsonHttp(res, 415, { code: "INVALID_MIME", message: "Le type envoyé ne correspond pas à l’autorisation." });
        }
        const contentLength = Number(req.headers["content-length"]);
        if (Number.isFinite(contentLength) && contentLength > MAX_ROOM_ATTACHMENT_SIZE) {
            return repondreJsonHttp(res, 413, { code: "FILE_TOO_LARGE", message: "La taille maximale est de 10 MiB." });
        }

        record.status = "uploading";
        const roomDirectory = cheminRepertoireSalle(record.roomId);
        const destination = cheminPieceJointe(record.roomId, record.id);
        const temporaryPath = `${destination}.uploading`;
        let output = null;
        try {
            await fs.promises.mkdir(roomDirectory, { recursive: true });
            output = await fs.promises.open(temporaryPath, "wx");
            const uploaded = await ecrireFluxPieceJointe(req, output, MAX_ROOM_ATTACHMENT_SIZE);
            const receivedSize = uploaded.size;
            await output.close();
            output = null;

            if (receivedSize !== record.size) {
                await fs.promises.unlink(temporaryPath).catch(error => {
                    if (error.code !== "ENOENT") console.warn("[RoomUpload] Suppression du fichier invalide impossible :", error.message);
                });
                record.status = "authorized";
                return repondreJsonHttp(res, 400, {
                    code: "ATTACHMENT_METADATA_MISMATCH",
                    message: "La taille réelle ne correspond pas à la taille autorisée."
                });
            }
            if (!verifierSignaturePieceJointe(record.mimeType, uploaded.signature)) {
                await fs.promises.unlink(temporaryPath).catch(error => {
                    if (error.code !== "ENOENT") console.warn("[RoomUpload] Suppression du fichier de type invalide impossible :", error.message);
                });
                record.status = "authorized";
                return repondreJsonHttp(res, 415, { code: "INVALID_MIME", message: "Le contenu ne correspond pas au type de fichier annoncé." });
            }
            await fs.promises.rename(temporaryPath, destination);
            record.status = "uploaded";
            record.uploadedAt = Date.now();
            return repondreJsonHttp(res, 201, { attachmentId, status: "uploaded" });
        } catch (error) {
            if (output) {
                await output.close().catch(closeError => {
                    console.warn("[RoomUpload] Fermeture du fichier incomplet impossible :", closeError.message);
                });
            }
            record.status = "authorized";
            await fs.promises.unlink(temporaryPath).catch(unlinkError => {
                if (unlinkError.code !== "ENOENT") console.warn("[RoomUpload] Nettoyage du transfert échoué impossible :", unlinkError.message);
            });
            if (error.code === "FILE_TOO_LARGE") {
                return repondreJsonHttp(res, 413, { code: "FILE_TOO_LARGE", message: error.message });
            }
            if (error.code === "EEXIST") {
                return repondreJsonHttp(res, 409, { code: "ATTACHMENT_NOT_READY", message: "Un transfert est déjà en cours." });
            }
            console.error(`[RoomUpload] Échec du transfert ${attachmentId} :`, error);
            return repondreJsonHttp(res, 500, { code: "UPLOAD_FAILED", message: "Le transfert de la pièce jointe a échoué." });
        }
    }

    const attachmentMatch = parsedUrl.pathname.match(/^\/room-attachment\/([0-9a-f-]{36})$/i);
    if (attachmentMatch) {
        if (req.method !== "GET") {
            return repondreJsonHttp(res, 405, { code: "METHOD_NOT_ALLOWED", message: "Méthode non autorisée." });
        }
        const attachmentId = attachmentMatch[1];
        const record = roomAttachments.get(attachmentId);
        if (!record) {
            return repondreJsonHttp(res, 404, { code: "ATTACHMENT_NOT_FOUND", message: "Pièce jointe introuvable." });
        }
        const access = authentifierAccesSalleHttp(req, record.roomId);
        if (access.error) {
            return repondreJsonHttp(res, access.error.status, access.error);
        }
        if (record.status !== "uploaded") {
            return repondreJsonHttp(res, 409, { code: "ATTACHMENT_NOT_READY", message: "La pièce jointe n’est pas disponible." });
        }
        const filePath = cheminPieceJointe(record.roomId, record.id);
        try {
            await fs.promises.access(filePath, fs.constants.R_OK);
        } catch (error) {
            if (error.code === "ENOENT") {
                roomAttachments.delete(attachmentId);
                return repondreJsonHttp(res, 404, { code: "ATTACHMENT_NOT_FOUND", message: "Pièce jointe introuvable." });
            }
            console.error(`[RoomUpload] Vérification de lecture impossible pour ${attachmentId} :`, error);
            return repondreJsonHttp(res, 500, { code: "ATTACHMENT_READ_FAILED", message: "Lecture de la pièce jointe impossible." });
        }

        const isImage = record.mimeType.startsWith("image/");
        res.writeHead(200, {
            "Content-Type": record.mimeType,
            "Content-Length": record.size,
            "Content-Disposition": isImage ? "inline" : "attachment",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store"
        });
        const fileStream = fs.createReadStream(filePath);
        fileStream.on("error", error => {
            console.error(`[RoomUpload] Lecture de ${attachmentId} interrompue :`, error);
            if (!res.headersSent) repondreJsonHttp(res, 500, { code: "ATTACHMENT_READ_FAILED", message: "Lecture de la pièce jointe impossible." });
            else res.destroy(error);
        });
        return fileStream.pipe(res);
    }

    // Endpoint d'enregistrement de token FCM direct via HTTP
    if (parsedUrl.pathname === "/register-token") {
        const userId = parsedUrl.searchParams.get("id");
        const token = parsedUrl.searchParams.get("token");

        if (userId && token) {
            fcmTokens.set(String(userId).trim(), String(token).trim());
            sauvegarderTokensFCM();
            console.log(`📲 [HTTP] Token FCM synchronisé pour ${userId} : ${token.substring(0, 15)}...`);
            return res.end(JSON.stringify({ success: true, message: `Token enregistré pour ${userId}` }));
        } else {
            return res.end(JSON.stringify({ error: "Paramètres 'id' et 'token' requis." }));
        }
    }

    // Endpoint de synchronisation de l'état de l'écran (veille vs allumé) via HTTP
    if (parsedUrl.pathname === "/set-screen-state") {
        const userId = parsedUrl.searchParams.get("id");
        const state = parsedUrl.searchParams.get("state"); // "SCREEN_ON" ou "SCREEN_OFF"
        if (userId && state) {
            userScreenStates.set(String(userId).trim(), state);
            console.log(`📱 [HTTP] État écran mis à jour pour ${userId} : ${state}`);
            return res.end(JSON.stringify({ success: true, userId, screenState: state }));
        }
        return res.end(JSON.stringify({ error: "Paramètres 'id' et 'state' requis." }));
    }

    // Endpoint de diagnostic
    if (parsedUrl.pathname === "/status" || parsedUrl.pathname === "/") {
        const tokensList = {};
        fcmTokens.forEach((token, id) => {
            tokensList[id] = token ? `${token.substring(0, 15)}...` : null;
        });

        return res.end(JSON.stringify({
            status: "ok",
            message: "Serveur d'appel operationnel",
            firebaseAdminReady: messaging !== null,
            connectedUsers: Array.from(utilisateurs.keys()),
            activeCallsCount: appels.size / 2,
            activeSessionsCount: callSessions.size,
            registeredFcmTokensCount: fcmTokens.size,
            registeredFcmTokens: tokensList
        }, null, 2));
    }

    // Endpoints de test push FCM directs :
    // - /test-push-banniere?to=ID-123456 (Test 1 : Bannière interactive sans forcer l'app)
    // - /test-push-veille?to=ID-123456   (Test 2 : Réveil de l'écran en veille)
    // - /test-push?to=ID-123456          (Par défaut : Test 1)
    if (parsedUrl.pathname === "/test-push" || parsedUrl.pathname === "/test-push-banniere" || parsedUrl.pathname === "/test-push-veille") {
        const targetId = parsedUrl.searchParams.get("to");
        if (!targetId) {
            return res.end(JSON.stringify({ error: "Parametre 'to' manquant. Exemple: /test-push?to=ID-123456" }));
        }

        const token = fcmTokens.get(targetId);
        if (!token) {
            return res.end(JSON.stringify({ error: `Aucun token FCM enregistre pour l'ID ${targetId}` }));
        }

        if (!messaging) {
            return res.end(JSON.stringify({ error: "Firebase Admin n'est pas initialise sur le serveur." }));
        }

        const isTestVeille = parsedUrl.pathname === "/test-push-veille";
        const notIdVal = "9999";

        try {
            if (isTestVeille) {
                envoyerPushTest2Veille(token, targetId, "TEST-APPELANT", "CALL-TEST-VEILLE", "", false, notIdVal);
                return res.end(JSON.stringify({ success: true, mode: "TEST 2 (Réveil Veille)", target: targetId }));
            } else {
                envoyerPushTest1Banniere(token, targetId, "TEST-APPELANT", "CALL-TEST-BANNIERE", "", false, notIdVal);
                return res.end(JSON.stringify({ success: true, mode: "TEST 1 (Bannière Interactive)", target: targetId }));
            }
        } catch (pushErr) {
            return res.end(JSON.stringify({ success: false, error: pushErr.message }));
        }
    }

    res.end(JSON.stringify({ status: "ok" }));
});

// ======================================================
// SERVEUR WEBSOCKET
// ======================================================
const wss = new WebSocket.Server({ server });

void purgerPiecesJointesOrphelines();
const roomAttachmentPurgeTimer = setInterval(
    () => void purgerPiecesJointesOrphelines(),
    ROOM_ATTACHMENT_PURGE_INTERVAL_MS
);
if (typeof roomAttachmentPurgeTimer.unref === "function") roomAttachmentPurgeTimer.unref();

// ======================================================
// DEMARRAGE DU SERVEUR
// ======================================================
server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Serveur WebSocket & HTTP demarre sur le port ${PORT}`);
});

// ======================================================
// UTILITAIRE : ENVOYER UN MESSAGE WEBSOCKET
// ======================================================
function envoyer(ws, message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

// ======================================================
// UTILITAIRE : ENVOYER A UN UTILISATEUR
// ======================================================
function envoyerAUtilisateur(identifiant, message) {
    const ws = utilisateurs.get(identifiant);
    if (!ws) {
        console.log(`Utilisateur non connecte en WS : ${identifiant}`);
        return false;
    }
    envoyer(ws, message);
    return true;
}

// ======================================================
// UTILITAIRES D'ETAT
// ======================================================
function utilisateurExiste(identifiant) {
    return utilisateurs.has(identifiant);
}

function utilisateurOccupe(identifiant) {
    return appels.has(identifiant);
}

function creerAppel(utilisateurA, utilisateurB) {
    appels.set(utilisateurA, utilisateurB);
    appels.set(utilisateurB, utilisateurA);
    console.log(`📞 APPEL CREE : ${utilisateurA} <--> ${utilisateurB}`);
}

function supprimerAppel(utilisateurA, utilisateurB) {
    if (utilisateurA) {
        appels.delete(utilisateurA);
        pendingOffers.delete(utilisateurA);
    }
    if (utilisateurB) {
        appels.delete(utilisateurB);
        pendingOffers.delete(utilisateurB);
    }
    console.log(`📴 APPEL TERMINE : ${utilisateurA} <--> ${utilisateurB}`);
}

function genererCodeSalle() {
    let code;
    do {
        code = Array.from({ length: 6 }, () =>
            ROOM_CODE_CHARACTERS[crypto.randomInt(ROOM_CODE_CHARACTERS.length)]
        ).join("");
    } while (roomCodes.has(code));
    return code;
}

function trouverSalleParticipant(participantId) {
    for (const room of rooms.values()) {
        if (room.participants.has(participantId)) return room;
    }
    return null;
}

function nettoyerDisplayName(value) {
    const cleaned = (typeof value === "string" ? value : "")
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
        .trim()
        .slice(0, 30)
        .trim();
    return cleaned || "Participant";
}

function roomPayload(room) {
    return {
        roomId: room.id,
        code: room.code,
        hostId: room.hostId,
        state: room.state,
        locked: room.locked,
        participants: Array.from(room.participants.values())
    };
}

function envoyerErreurSalle(ws, code, message, requestType) {
    envoyer(ws, { type: "ROOM_ERROR", code, message, requestType });
}

function relayerRoomSignalisation(wsClient, from, message) {
    const type = message.type;
    const roomId = String(message.roomId || "");
    const to = String(message.to || "").trim();
    const room = rooms.get(roomId);

    if (!room || !to || !room.participants.has(from) || !room.participants.has(to)) {
        envoyerErreurSalle(wsClient, "NOT_IN_ROOM", "L’expéditeur et le destinataire doivent être dans la même salle.", type);
        return;
    }

    const recipient = utilisateurs.get(to);
    if (!recipient || recipient.readyState !== WebSocket.OPEN) {
        envoyerErreurSalle(wsClient, "NOT_IN_ROOM", "Le destinataire n’est pas connecté dans cette salle.", type);
        return;
    }

    envoyer(recipient, { type, roomId, to, from, payload: message.payload });
}

function fermerSalle(room, reason) {
    room.state = "closed";
    rooms.delete(room.id);
    roomCodes.delete(room.code);
    void supprimerPiecesJointesSalle(room.id);
    for (const participantId of room.participants.keys()) {
        envoyerAUtilisateur(participantId, {
            type: "ROOM_CLOSED",
            roomId: room.id,
            code: room.code,
            reason
        });
    }
    room.participants.clear();
}

function retirerParticipantSalle(room, participantId, reason) {
    if (!room || !room.participants.has(participantId)) return;
    if (room.hostId === participantId) {
        fermerSalle(room, reason || "host_left");
        return;
    }

    room.participants.delete(participantId);
    for (const remainingId of room.participants.keys()) {
        envoyerAUtilisateur(remainingId, {
            type: "PARTICIPANT_LEFT",
            roomId: room.id,
            participantId,
            reason
        });
    }
    if (room.participants.size === 0) fermerSalle(room, "empty");
}

function nettoyerSallesParticipant(participantId) {
    for (const room of Array.from(rooms.values())) {
        if (room.participants.has(participantId)) {
            retirerParticipantSalle(room, participantId, "disconnected");
        }
    }
}

// ======================================================
// CONNEXION CLIENT WEBSOCKET
// ======================================================
wss.on("connection", (ws) => {
    console.log("Nouveau client connecte.");
    let identifiant = null;
    ws.joinRoomAttempts = 0;

    ws.isAlive = true;
    ws.on("pong", () => {
        ws.isAlive = true;
    });

    ws.on("message", (data) => {
        try {
            const message = JSON.parse(data.toString());
            traiterMessage(ws, message);
        } catch (error) {
            console.error("Message JSON invalide :", error);
            envoyer(ws, {
                type: "ERROR",
                message: "Message invalide."
            });
        }
    });

    ws.on("close", () => {
        console.log(`Client deconnecte : ${identifiant || "inconnu"}`);
        // ⚠️ Si cette socket a été remplacée par une nouvelle socket active (isReplaced = true),
        // NE PAS exécuter gererDeconnexion pour ne pas raccrocher l'appel !
        if (identifiant && !ws.isReplaced) {
            gererDeconnexion(identifiant, ws);
        }
    });

    ws.on("error", (error) => {
        console.error(`Erreur WebSocket ${identifiant || ""} :`, error);
    });

    // ==================================================
    // TRAITEMENT DES MESSAGES
    // ==================================================
    function traiterMessage(wsClient, message) {
        if (message.targetId) message.to = message.targetId;

        // Normalisation
        if (message.type === "call-user") message.type = "CALLING";
        if (message.type === "answer-call") message.type = "CALL_ACCEPTED";
        if (message.type === "ice-candidate") message.type = "ICE_CANDIDATE";
        if (message.type === "hang-up") message.type = "CALL_ENDED";
        if (message.type === "call-refused") message.type = "CALL_REJECTED";

        const type = message.type;

        if (type === "PING" || type === "ping") {
            ws.isAlive = true;
            envoyer(wsClient, { type: "PONG" });
            return;
        }

        if (type === "REGISTER" || type === "UPDATE_TOKEN") {
            enregistrerUtilisateur(wsClient, message);
            return;
        }

        if (type === "SET_APP_STATE" || type === "SET_SCREEN_STATE") {
            const isFg = !!message.isForeground;
            const screenState = message.screenState || (isFg ? "SCREEN_ON" : undefined);
            if (identifiant) {
                userAppStates.set(identifiant, isFg);
                if (screenState) {
                    userScreenStates.set(identifiant, screenState);
                }
                console.log(`📱 État app pour ${identifiant} : ${isFg ? "FOREGROUND" : "BACKGROUND"} | Écran : ${userScreenStates.get(identifiant) || "n/a"}`);
            }
            return;
        }

        if (!identifiant) {
            envoyer(wsClient, {
                type: "ERROR",
                message: "Vous devez etre enregistre avant d'envoyer des messages."
            });
            return;
        }

        if (
            (type === "CREATE_ROOM" || type === "JOIN_ROOM" || type === "LEAVE_ROOM" ||
                type === "ROOM_OFFER" || type === "ROOM_ANSWER" || type === "ROOM_ICE" ||
            type === "ROOM_STATE" || type === "CHAT_MESSAGE" ||
            type === "RAISE_HAND" || type === "MUTE_ALL" ||
            type === "KICK_PARTICIPANT" || type === "LOCK_ROOM") &&
        !wsClient.sessionAuthenticated
        ) {
            envoyerErreurSalle(wsClient, "AUTH_REQUIRED", "Un jeton de session est requis pour gérer les salles.", type);
            return;
        }

        if (type === "CALLING") return traiterCalling(message);
        if (type === "CALL_ACCEPTED") return traiterCallAccepted(message);
        if (type === "CALL_REJECTED") return traiterCallRejected(message);
        if (type === "CALL_ENDED") return traiterCallEnded(message);
        if (type === "IVR_TRANSFER") return traiterTransfertIvr(message);
        if (type === "CREATE_ROOM") return creerSalle(wsClient, identifiant, message);
        if (type === "JOIN_ROOM") return rejoindreSalle(wsClient, identifiant, message);
        if (type === "LEAVE_ROOM") return quitterSalle(wsClient, identifiant, message);
        if (type === "ROOM_STATE") return mettreAJourEtatSalle(wsClient, identifiant, message);
        if (type === "CHAT_MESSAGE") return traiterMessageChat(wsClient, identifiant, message);
        if (type === "RAISE_HAND") return traiterLeverMain(wsClient, identifiant, message);
        if (type === "MUTE_ALL") return traiterCouperTousMicros(wsClient, identifiant, message);
        if (type === "KICK_PARTICIPANT") return traiterExpulserParticipant(wsClient, identifiant, message);
        if (type === "LOCK_ROOM") return traiterVerrouillerSalle(wsClient, identifiant, message);
        if (type === "ROOM_OFFER" || type === "ROOM_ANSWER" || type === "ROOM_ICE") {
            return relayerRoomSignalisation(wsClient, identifiant, message);
        }
        if (type === "ICE_CANDIDATE" || type === "WEBRTC_OFFER" || type === "WEBRTC_ANSWER" || type === "renegotiate-offer" || type === "renegotiate-answer") {
            return relayerSignalisation(message);
        }

        envoyer(wsClient, {
            type: "ERROR",
            message: `Type de message inconnu : ${type}`
        });
    }

    function creerSalle(wsClient, participantId, message) {
        if (utilisateurOccupe(participantId)) {
            envoyerErreurSalle(wsClient, "CALL_ACTIVE", "Terminez l’appel en cours avant de créer une réunion.", "CREATE_ROOM");
            return;
        }
        if (trouverSalleParticipant(participantId)) {
            envoyerErreurSalle(wsClient, "ALREADY_IN_ROOM", "Vous êtes déjà dans une salle.", "CREATE_ROOM");
            return;
        }

        const room = {
            id: crypto.randomUUID(),
            code: genererCodeSalle(),
            hostId: participantId,
            state: "open",
            locked: false,
            participants: new Map(),
            createdAt: Date.now()
        };
        room.participants.set(participantId, {
            id: participantId,
            displayName: nettoyerDisplayName(message.displayName),
            audio: message.audio !== false,
            video: message.video !== false,
            raised: false,
            role: "host",
            joinedAt: Date.now()
        });
        rooms.set(room.id, room);
        roomCodes.set(room.code, room.id);
        envoyer(wsClient, { type: "ROOM_CREATED", ...roomPayload(room) });
    }

    function rejoindreSalle(wsClient, participantId, message) {
        ws.joinRoomAttempts += 1;
        if (ws.joinRoomAttempts > MAX_JOIN_ATTEMPTS_PER_CONNECTION) {
            envoyerErreurSalle(wsClient, "JOIN_RATE_LIMITED", "Trop de tentatives de rejoindre une salle.", "JOIN_ROOM");
            ws.close(1008, "Too many JOIN_ROOM attempts");
            return;
        }

        if (utilisateurOccupe(participantId)) {
            envoyerErreurSalle(wsClient, "CALL_ACTIVE", "Terminez l’appel en cours avant de rejoindre une réunion.", "JOIN_ROOM");
            return;
        }

        const code = typeof message.code === "string" ? message.code.trim().toUpperCase() : "";
        if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code)) {
            envoyerErreurSalle(wsClient, "INVALID_CODE", "Code de salle invalide.", "JOIN_ROOM");
            return;
        }

        const roomId = roomCodes.get(code);
        const room = roomId && rooms.get(roomId);
        if (!room || room.state !== "open") {
            envoyerErreurSalle(wsClient, "ROOM_NOT_FOUND", "Salle introuvable.", "JOIN_ROOM");
            return;
        }
        if (room.locked) {
            envoyerErreurSalle(wsClient, "ROOM_LOCKED", "Cette réunion est verrouillée.", "JOIN_ROOM");
            return;
        }
        if (trouverSalleParticipant(participantId)) {
            envoyerErreurSalle(wsClient, "ALREADY_IN_ROOM", "Vous êtes déjà dans une salle.", "JOIN_ROOM");
            return;
        }
        if (room.participants.size >= MAX_PARTICIPANTS) {
            envoyerErreurSalle(wsClient, "ROOM_FULL", "La salle est complète.", "JOIN_ROOM");
            return;
        }

        const participant = {
            id: participantId,
            displayName: nettoyerDisplayName(message.displayName),
            audio: message.audio !== false,
            video: message.video !== false,
            raised: false,
            role: "participant",
            joinedAt: Date.now()
        };
        room.participants.set(participantId, participant);
        envoyer(wsClient, { type: "ROOM_JOINED", ...roomPayload(room) });
        for (const existingId of room.participants.keys()) {
            if (existingId !== participantId) {
                envoyerAUtilisateur(existingId, {
                    type: "PARTICIPANT_JOINED",
                    roomId: room.id,
                    participant
                });
            }
        }
    }

    function mettreAJourEtatSalle(wsClient, participantId, message) {
        const roomId = String(message.roomId || "");
        const room = rooms.get(roomId);
        if (!room || !room.participants.has(participantId)) {
            envoyerErreurSalle(wsClient, "NOT_IN_ROOM", "Vous ne participez pas à cette salle.", "ROOM_STATE");
            return;
        }
        if (typeof message.audio !== "boolean" || typeof message.video !== "boolean") {
            envoyerErreurSalle(wsClient, "INVALID_STATE", "L’état audio/vidéo doit être booléen.", "ROOM_STATE");
            return;
        }

        const now = Date.now();
        if (ws.lastRoomStateAt !== undefined && now - ws.lastRoomStateAt < ROOM_STATE_INTERVAL_MS) {
            envoyerErreurSalle(wsClient, "STATE_RATE_LIMITED", "Trop de changements d’état. Réessayez dans un instant.", "ROOM_STATE");
            return;
        }
        ws.lastRoomStateAt = now;

        const participant = room.participants.get(participantId);
        participant.audio = message.audio;
        participant.video = message.video;
        for (const otherId of room.participants.keys()) {
            if (otherId === participantId) continue;
            envoyerAUtilisateur(otherId, {
                type: "PARTICIPANT_STATE",
                roomId,
                participantId,
                audio: participant.audio,
                video: participant.video
            });
        }
    }

    function trouverSalleControle(wsClient, participantId, message, requestType, hostOnly = false) {
        const room = rooms.get(String(message.roomId || ""));
        if (!room || !room.participants.has(participantId)) {
            envoyerErreurSalle(wsClient, "NOT_IN_ROOM", "Vous ne participez pas à cette salle.", requestType);
            return null;
        }
        if (hostOnly && room.hostId !== participantId) {
            envoyerErreurSalle(wsClient, "HOST_REQUIRED", "Seul l’hôte peut effectuer cette action.", requestType);
            return null;
        }
        return room;
    }

    function traiterLeverMain(wsClient, participantId, message) {
        const room = trouverSalleControle(wsClient, participantId, message, "RAISE_HAND");
        if (!room) return;
        if (typeof message.raised !== "boolean") {
            envoyerErreurSalle(wsClient, "INVALID_STATE", "L’état de la main levée doit être booléen.", "RAISE_HAND");
            return;
        }

        const participant = room.participants.get(participantId);
        participant.raised = message.raised;
        for (const recipientId of room.participants.keys()) {
            envoyerAUtilisateur(recipientId, {
                type: "PARTICIPANT_HAND",
                roomId: room.id,
                participantId,
                raised: participant.raised,
                displayName: participant.displayName
            });
        }
    }

    function traiterCouperTousMicros(wsClient, participantId, message) {
        const room = trouverSalleControle(wsClient, participantId, message, "MUTE_ALL", true);
        if (!room) return;
        for (const participant of room.participants.values()) {
            participant.audio = false;
            for (const recipientId of room.participants.keys()) {
                envoyerAUtilisateur(recipientId, {
                    type: "PARTICIPANT_MUTED",
                    roomId: room.id,
                    participantId: participant.id
                });
            }
        }
    }

    function traiterExpulserParticipant(wsClient, participantId, message) {
        const room = trouverSalleControle(wsClient, participantId, message, "KICK_PARTICIPANT", true);
        if (!room) return;
        const targetId = typeof message.targetId === "string" ? message.targetId.trim() : "";
        if (!targetId || targetId === room.hostId || !room.participants.has(targetId)) {
            envoyerErreurSalle(wsClient, "INVALID_TARGET", "Le participant à expulser est invalide.", "KICK_PARTICIPANT");
            return;
        }

        for (const recipientId of room.participants.keys()) {
            envoyerAUtilisateur(recipientId, {
                type: "PARTICIPANT_KICKED",
                roomId: room.id,
                participantId: targetId,
                reason: "kicked"
            });
        }
        room.participants.delete(targetId);
    }

    function traiterVerrouillerSalle(wsClient, participantId, message) {
        const room = trouverSalleControle(wsClient, participantId, message, "LOCK_ROOM", true);
        if (!room) return;
        if (typeof message.locked !== "boolean") {
            envoyerErreurSalle(wsClient, "INVALID_STATE", "L’état du verrouillage doit être booléen.", "LOCK_ROOM");
            return;
        }

        room.locked = message.locked;
        for (const recipientId of room.participants.keys()) {
            envoyerAUtilisateur(recipientId, {
                type: "ROOM_LOCKED",
                roomId: room.id,
                locked: room.locked
            });
        }
    }

    function traiterMessageChat(wsClient, participantId, message) {
        const roomId = String(message.roomId || "");
        const room = rooms.get(roomId);
        const participant = room && room.participants.get(participantId);
        if (!participant) {
            envoyerErreurSalle(wsClient, "NOT_IN_ROOM", "Vous ne participez pas à cette salle.", "CHAT_MESSAGE");
            return;
        }

        const versionTwo = message.version === 2;
        if (message.version !== undefined && !versionTwo) {
            envoyerErreurSalle(wsClient, "CHAT_VERSION_UNSUPPORTED", "Version de message chat non prise en charge.", "CHAT_MESSAGE");
            return;
        }

        let content;
        let text;
        let attachmentRecord = null;
        if (!versionTwo) {
            text = (typeof message.text === "string" ? message.text : "")
                .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, "")
                .trim();
            if (!text) {
                envoyerErreurSalle(wsClient, "CHAT_EMPTY", "Le message ne peut pas être vide.", "CHAT_MESSAGE");
                return;
            }
            if (text.length > 500) {
                envoyerErreurSalle(wsClient, "CHAT_TOO_LONG", "Le message dépasse la limite de 500 caractères.", "CHAT_MESSAGE");
                return;
            }
        } else {
            const payload = message.message;
            if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
                envoyerErreurSalle(wsClient, "INVALID_CHAT_MESSAGE", "Le contenu du message est invalide.", "CHAT_MESSAGE");
                return;
            }
            if (typeof message.clientMessageId !== "string" ||
                !/^[A-Za-z0-9._:-]{1,128}$/.test(message.clientMessageId)) {
                envoyerErreurSalle(wsClient, "INVALID_MESSAGE_ID", "L’identifiant du message est invalide.", "CHAT_MESSAGE");
                return;
            }

            if (payload.type === "text") {
                text = (typeof payload.text === "string" ? payload.text : "")
                    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, "")
                    .trim();
                if (!text) {
                    envoyerErreurSalle(wsClient, "CHAT_EMPTY", "Le message ne peut pas être vide.", "CHAT_MESSAGE");
                    return;
                }
                if (text.length > 500) {
                    envoyerErreurSalle(wsClient, "CHAT_TOO_LONG", "Le message dépasse la limite de 500 caractères.", "CHAT_MESSAGE");
                    return;
                }
                content = { type: "text", text };
            } else if (payload.type === "file" || payload.type === "voice") {
                const attachmentId = typeof payload.attachmentId === "string" ? payload.attachmentId : "";
                attachmentRecord = roomAttachments.get(attachmentId);
                if (!attachmentRecord) {
                    envoyerErreurSalle(wsClient, "ATTACHMENT_NOT_FOUND", "Pièce jointe introuvable.", "CHAT_MESSAGE");
                    return;
                }
                if (attachmentRecord.userId !== participantId || attachmentRecord.roomId !== roomId ||
                    attachmentRecord.type !== payload.type) {
                    envoyerErreurSalle(wsClient, "ATTACHMENT_FORBIDDEN", "Cette pièce jointe ne vous appartient pas ou n’est pas destinée à cette salle.", "CHAT_MESSAGE");
                    return;
                }
                if (attachmentRecord.status !== "uploaded") {
                    envoyerErreurSalle(wsClient, "ATTACHMENT_NOT_READY", "La pièce jointe n’est pas encore disponible.", "CHAT_MESSAGE");
                    return;
                }

                if (!Number.isSafeInteger(payload.size) || payload.size > MAX_ROOM_ATTACHMENT_SIZE) {
                    envoyerErreurSalle(wsClient, "FILE_TOO_LARGE", "La taille maximale est de 10 MiB.", "CHAT_MESSAGE");
                    return;
                }
                const allowedMimeTypes = payload.type === "voice"
                    ? ROOM_VOICE_MIME_TYPES
                    : ROOM_FILE_MIME_TYPES;
                if (typeof payload.mimeType !== "string" ||
                    !allowedMimeTypes.has(payload.mimeType) ||
                    payload.mimeType !== attachmentRecord.mimeType) {
                    envoyerErreurSalle(wsClient, "INVALID_MIME", "Le type de fichier ne correspond pas à la pièce jointe.", "CHAT_MESSAGE");
                    return;
                }
                if (payload.size !== attachmentRecord.size) {
                    envoyerErreurSalle(wsClient, "ATTACHMENT_METADATA_MISMATCH", "La taille annoncée ne correspond pas à la pièce jointe.", "CHAT_MESSAGE");
                    return;
                }
                if (payload.type === "voice") {
                    if (!Number.isSafeInteger(payload.durationMs) || payload.durationMs <= 0) {
                        envoyerErreurSalle(wsClient, "INVALID_DURATION", "La durée du message vocal est invalide.", "CHAT_MESSAGE");
                        return;
                    }
                    if (payload.durationMs > MAX_ROOM_VOICE_DURATION_MS) {
                        envoyerErreurSalle(wsClient, "VOICE_TOO_LONG", "Un message vocal ne peut pas dépasser 120 secondes.", "CHAT_MESSAGE");
                        return;
                    }
                    if (payload.durationMs !== attachmentRecord.durationMs) {
                        envoyerErreurSalle(wsClient, "ATTACHMENT_METADATA_MISMATCH", "La durée annoncée ne correspond pas au message vocal.", "CHAT_MESSAGE");
                        return;
                    }
                }

                content = {
                    type: payload.type,
                    attachmentId,
                    mimeType: attachmentRecord.mimeType,
                    size: attachmentRecord.size
                };
                if (payload.type === "file") {
                    content.name = attachmentRecord.name;
                    text = `Fichier joint : ${attachmentRecord.name}`.slice(0, 500);
                } else {
                    content.durationMs = attachmentRecord.durationMs;
                    text = "Message vocal";
                }
            } else {
                envoyerErreurSalle(wsClient, "INVALID_CHAT_MESSAGE", "Type de contenu chat non pris en charge.", "CHAT_MESSAGE");
                return;
            }
        }

        const now = Date.now();
        wsClient.chatMessageTimes = (wsClient.chatMessageTimes || []).filter(
            (sentAt) => now - sentAt < CHAT_RATE_LIMIT_WINDOW_MS
        );
        if (wsClient.chatMessageTimes.length >= CHAT_RATE_LIMIT_COUNT) {
            envoyerErreurSalle(wsClient, "CHAT_RATE_LIMITED", "Vous envoyez des messages trop rapidement. Réessayez dans quelques secondes.", "CHAT_MESSAGE");
            return;
        }
        wsClient.chatMessageTimes.push(now);

        const chatMessage = {
            type: "CHAT",
            roomId,
            id: crypto.randomUUID(),
            from: participantId,
            displayName: participant.displayName,
            text,
            sentAt: now
        };
        if (versionTwo) {
            chatMessage.version = 2;
            chatMessage.message = content;
            chatMessage.clientMessageId = message.clientMessageId;
        } else if (typeof message.clientMessageId === "string" &&
            /^[A-Za-z0-9._:-]{1,128}$/.test(message.clientMessageId)) {
            chatMessage.clientMessageId = message.clientMessageId;
        }
        for (const recipientId of room.participants.keys()) {
            envoyerAUtilisateur(recipientId, chatMessage);
        }
    }

    function quitterSalle(wsClient, participantId, message) {
        const room = rooms.get(String(message.roomId || ""));
        if (!room || !room.participants.has(participantId)) {
            envoyerErreurSalle(wsClient, "ROOM_NOT_FOUND", "Salle introuvable.", "LEAVE_ROOM");
            return;
        }
        retirerParticipantSalle(room, participantId, "left");
    }

    // ==================================================
    // ENREGISTRER UTILISATEUR ET TOKEN FCM
    // ==================================================
    function enregistrerUtilisateur(wsClient, message) {
        const nouvelIdentifiant = String(message.id || message.userId || "").trim();

        if (nouvelIdentifiant === "") {
            envoyer(wsClient, {
                type: "ERROR",
                message: "Identifiant obligatoire."
            });
            return;
        }

        const sessionToken = typeof message.sessionToken === "string"
            ? message.sessionToken.trim()
            : "";
        const registeredToken = sessionTokens.get(nouvelIdentifiant);

        if (!sessionToken) {
            if (registeredToken) {
                envoyer(wsClient, {
                    type: "ERROR",
                    code: "ID_ALREADY_CONNECTED",
                    message: "Un jeton de session est requis pour cet identifiant."
                });
                wsClient.close(1008, "Jeton de session requis");
                return;
            }
            console.warn(`⚠️ Client ancien sans jeton de session : ${nouvelIdentifiant}`);
        } else if (registeredToken && registeredToken !== sessionToken) {
            envoyer(wsClient, {
                type: "ERROR",
                code: "ID_ALREADY_CONNECTED",
                message: "Jeton de session invalide pour cet identifiant."
            });
            wsClient.close(1008, "Jeton de session invalide");
            return;
        } else if (!registeredToken) {
            sessionTokens.set(nouvelIdentifiant, sessionToken);
        }

        wsClient.sessionAuthenticated = !!sessionToken;

        // Marquer l'ancienne socket avec isReplaced = true AVANT de la fermer
        if (utilisateurs.has(nouvelIdentifiant)) {
            const ancienneWs = utilisateurs.get(nouvelIdentifiant);
            if (ancienneWs && ancienneWs !== wsClient) {
                console.log(`🔄 Remplacement de l'ancienne socket pour ${nouvelIdentifiant}`);
                ancienneWs.isReplaced = true;
                try { ancienneWs.close(); } catch (e) { }
            }
        }

        identifiant = nouvelIdentifiant;
        utilisateurs.set(identifiant, wsClient);

        // Sauvegarde du token FCM
        if (message.fcmToken) {
            fcmTokens.set(identifiant, message.fcmToken);
            sauvegarderTokensFCM();
            console.log(`📲 TOKEN FCM ENREGISTRE pour ${identifiant} : ${message.fcmToken.substring(0, 20)}...`);
        } else if (fcmTokens.has(identifiant)) {
            console.log(`📲 Token FCM deja conserve en memoire pour ${identifiant}`);
        } else {
            console.log(`⚠️ Aucun token FCM fourni lors du REGISTER pour ${identifiant}`);
        }

        logCall("REGISTER", { from: identifiant, info: `Utilisateur enregistré (${identifiant})` });

        envoyer(wsClient, {
            type: "REGISTERED",
            id: identifiant
        });

        // ⚠️ TRANSMISSION SÉCURISÉE DE L'OFFRE EN ATTENTE :
        // On vérifie STRICTEMENT que l'offre est toujours dans l'état RINGING.
        // Si l'appel a déjà été accepté (state === 'ACCEPTING' ou 'CONNECTED'), ou terminé ('ENDED' / 'REJECTED'),
        // NE SURTOUT PAS renvoyer incoming-call !
        if (pendingOffers.has(identifiant)) {
            const pending = pendingOffers.get(identifiant);
            if (pending && pending.from) {
                const callId = pending.callId;
                const session = callId ? callSessions.get(callId) : null;

                if (isCallEnded(callId)) {
                    logCall("PENDING_OFFER_IGNORED", { callId, to: identifiant, info: "Appel déjà terminé dans endedCalls" });
                    pendingOffers.delete(identifiant);
                } else if (session && session.state !== "RINGING") {
                    logCall("PENDING_OFFER_IGNORED", { callId, to: identifiant, state: session.state, info: `Appel non 'RINGING' (${session.state}), pas de renvoi incoming-call` });
                    if (session.state === "CONNECTED" || session.state === "ENDED" || session.state === "REJECTED") {
                        pendingOffers.delete(identifiant);
                    }
                } else if (utilisateurExiste(pending.from) && appels.get(pending.from) === identifiant) {
                    logCall("PENDING_OFFER_SENT", { callId, from: pending.from, to: identifiant, state: "RINGING" });
                    envoyer(wsClient, {
                        type: "incoming-call",
                        from: pending.from,
                        to: identifiant,
                        offer: pending.offer,
                        hasVideo: normaliserHasVideo(pending.hasVideo),
                        callId: callId
                    });
                } else {
                    logCall("PENDING_OFFER_EXPIRED", { callId, to: identifiant, info: `L'appelant ${pending.from} n'est plus en ligne/occupé` });
                    pendingOffers.delete(identifiant);
                    appels.delete(identifiant);
                }
            }
        }
    }

    // ==================================================
    // TRAITER L'APPEL
    // ==================================================
    function traiterCalling(message) {
        const from = identifiant;
        const to = String(message.to || "").trim();
        const callId = String(message.callId || (Date.now().toString() + "-" + Math.random().toString(36).substring(2, 9)));
        const hasVideo = normaliserHasVideo(message.hasVideo);

        if (to === "") {
            envoyer(ws, { type: "ERROR", message: "Destinataire manquant." });
            return;
        }

        if (from === to) {
            envoyer(ws, { type: "ERROR", message: "Vous ne pouvez pas vous appeler vous-meme." });
            return;
        }

        if (isCallEnded(callId)) {
            logCall("CALLING_IGNORED", { callId, from, to, info: "callId présent dans endedCalls" });
            return;
        }

        if (trouverSalleParticipant(from) || trouverSalleParticipant(to)) {
            envoyer(ws, { type: "BUSY", from: to, message: "Quittez la réunion avant de passer un appel." });
            return;
        }

        const destinataireEnLigne = utilisateurExiste(to);
        const tokenDestinataire = fcmTokens.get(to);

        if (!destinataireEnLigne && !tokenDestinataire) {
            logCall("CALLING_FAILED", { callId, from, to, info: "Destinataire ni connecté ni token FCM" });
            envoyer(ws, { type: "ERROR", message: "Le correspondant est hors ligne ou introuvable." });
            return;
        }

        if (utilisateurOccupe(from)) {
            envoyer(ws, { type: "BUSY", from: to, message: "Vous etes deja en appel." });
            return;
        }

        if (utilisateurOccupe(to)) {
            envoyer(ws, { type: "BUSY", from: to, to: from, message: "Le correspondant est occupe." });
            logCall("CALLING_BUSY", { callId, from, to, info: `${to} est déjà occupé` });
            return;
        }

        creerAppel(from, to);

        // Enregistrement de la session d'appel serveur
        const session = {
            callId: callId,
            from: from,
            to: to,
            state: "RINGING",
            offer: message.offer,
            hasVideo: hasVideo,
            createdAt: Date.now()
        };
        callSessions.set(callId, session);

        if (message.offer) {
            pendingOffers.set(to, {
                from: from,
                offer: message.offer,
                hasVideo: hasVideo,
                callId: callId,
                createdAt: Date.now()
            });
        }

        let transmisWs = false;
        const isDestinataireAuPremierPlan = destinataireEnLigne && (userAppStates.get(to) === true);

        // 1. Envoi direct via WebSocket UNIQUEMENT si le destinataire est au premier plan
        if (destinataireEnLigne && isDestinataireAuPremierPlan) {
            transmisWs = envoyerAUtilisateur(to, {
                type: "incoming-call",
                from: from,
                to: to,
                offer: message.offer,
                hasVideo: hasVideo,
                callId: callId
            });
            if (transmisWs) {
                logCall("WS_RECEIVED", { callId, from, to, state: "RINGING", info: "Transmis par WS direct (app au 1er plan)" });
            }
        }

        // 2. Envoi via Push Firebase FCM (Arrière-plan et Veille) :
        // ⚠️ Si l'app est au premier plan, aucun push n'est requis (l'interface interne s'affiche).
        let pushTente = false;

        if (!isDestinataireAuPremierPlan && tokenDestinataire && messaging) {
            pushTente = true;
            const offerStr = message.offer
                ? (typeof message.offer === "string" ? message.offer : JSON.stringify(message.offer))
                : "";

            const notIdVal = String(Math.floor(10000 + Math.random() * 89999));
            const screenState = userScreenStates.get(to);

            // ── SÉPARATION STRICTE TEST 1 vs TEST 2 ──────────────────────────
            // Si le destinataire a son écran EXPLICITEMENT allumé en arrière-plan ET est connecté en WS :
            // 👉 Utiliser TEST 1 (Bannière interactive avec [Refuser] et [Accepter], sans forçage)
            // Dans TOUS les autres cas (veille, écran noir avec schéma, app fermée, hors-ligne) :
            // 👉 Utiliser TEST 2 (Réveil physique de l'écran + Interface 2 active au-dessus du lockscreen)
            const isStrictementEcranAllume = (screenState === "SCREEN_ON") && destinataireEnLigne;
            if (isStrictementEcranAllume) {
                console.log(`☀️ [TEST 1] Destinataire ${to} écran allumé et en ligne -> Push bannière interactive`);
                envoyerPushTest1Banniere(tokenDestinataire, to, from, callId, offerStr, hasVideo, notIdVal);
            } else {
                console.log(`🌙 [TEST 2] Destinataire ${to} en veille ou hors ligne (${screenState || "défaut"}) -> Push réveil écran`);
                envoyerPushTest2Veille(tokenDestinataire, to, from, callId, offerStr, hasVideo, notIdVal);
            }
        } else if (isDestinataireAuPremierPlan) {
            console.log(`ℹ️ Destinataire ${to} a l'application ouverte au premier plan : push FCM non requis.`);
        } else if (!tokenDestinataire) {
            console.log(`⚠️ Aucun token FCM enregistré pour ${to}.`);
        } else if (!messaging) {
            console.error("⚠️ Firebase Messaging n'est pas configuré sur le serveur.");
        }

        if (!transmisWs && !pushTente) {
            supprimerAppel(from, to);
            callSessions.delete(callId);
            envoyer(ws, {
                type: "ERROR",
                message: "Impossible de joindre le correspondant (hors ligne)."
            });
            return;
        }

        // Timeout de sécurité : si le destinataire ne répond pas après 60 secondes
        setTimeout(() => {
            const currentSession = callSessions.get(callId);
            if (currentSession && currentSession.state === "RINGING") {
                logCall("TIMEOUT", { callId, from, to, info: "Délai d'attente 60s dépassé" });
                markCallEnded(callId);
                pendingOffers.delete(to);
                supprimerAppel(from, to);
                envoyerAUtilisateur(from, {
                    type: "hang-up",
                    from: to,
                    to: from,
                    reason: "timeout",
                    callId: callId
                });
                // Notifier le destinataire pour effacer la notification
                const token = fcmTokens.get(to);
                if (token && messaging) {
                    messaging.send({
                        token: token,
                        data: {
                            type: "CANCEL_CALL",
                            action: "cancel_call",
                            from: String(from),
                            callerId: String(from),
                            callId: String(callId)
                        },
                        android: { priority: "high" }
                    }).catch(() => { });
                }
            }
        }, 60000);

        logCall("CREATED", { callId, from, to, state: "RINGING", info: `WS direct: ${transmisWs}, Push FCM: ${pushTente}` });
    }
    // ==================================================
    // TRAITER CALL ACCEPTED (ATOMIQUE)
    // ==================================================
    function traiterCallAccepted(message) {
        const from = identifiant;
        const to = String(message.to || "").trim();
        const callId = String(message.callId || "");

        if (to === "") return;

        if (callId && isCallEnded(callId)) {
            logCall("ACCEPT_IGNORED_DUPLICATE", { callId, from, to, info: "callId dans endedCalls" });
            return;
        }

        const session = callId ? callSessions.get(callId) : null;
        if (session) {
            if (session.state === "CONNECTED") {
                logCall("ACCEPT_IGNORED_DUPLICATE", { callId, from, to, state: "CONNECTED", info: "Session déjà connectée" });
                return;
            }
            session.state = "CONNECTED";
        }

        // Suppression immédiate et absolue des pendingOffers pour les deux parties
        pendingOffers.delete(from);
        pendingOffers.delete(to);

        envoyerAUtilisateur(to, {
            type: "call-answered",
            from: from,
            to: to,
            callId: callId,
            answer: message.answer
        });

        logCall("ANSWER_SENT", { callId, from, to, state: "CONNECTED", info: "Réponse WebRTC relayée à l'appelant" });
    }

    // ==================================================
    // TRAITER CALL REJECTED
    // ==================================================
    function traiterCallRejected(message) {
        const from = identifiant;
        const to = String(message.to || "").trim();
        const callId = String(message.callId || "");

        if (to === "") return;

        if (callId) {
            markCallEnded(callId);
            const session = callSessions.get(callId);
            if (session) session.state = "REJECTED";
        }

        pendingOffers.delete(from);
        pendingOffers.delete(to);

        envoyerAUtilisateur(to, {
            type: "call-refused",
            from: from,
            to: to,
            callId: callId
        });
        supprimerAppel(from, to);
        logCall("REJECTED", { callId, from, to, state: "REJECTED" });
    }

    // ==================================================
    // TRAITER CALL ENDED
    // ==================================================
    function traiterCallEnded(message) {
        const from = identifiant;
        const to = String(message.to || "").trim();
        const callId = String(message.callId || "");

        if (to === "") return;

        if (callId) {
            markCallEnded(callId);
            const session = callSessions.get(callId);
            if (session) session.state = "ENDED";
        }

        // Si l'appel était en attente (destinataire n'avait pas encore répondu), envoyer un push d'annulation
        if (pendingOffers.has(to)) {
            const tokenTo = fcmTokens.get(to);
            if (tokenTo && messaging) {
                messaging.send({
                    token: tokenTo,
                    data: {
                        type: "CANCEL_CALL",
                        action: "cancel_call",
                        from: String(from),
                        callerId: String(from),
                        callId: String(callId || "")
                    },
                    android: { priority: "high" }
                }).catch(() => { });
            }
        }

        pendingOffers.delete(from);
        pendingOffers.delete(to);

        envoyerAUtilisateur(to, {
            type: "hang-up",
            from: from,
            to: to,
            callId: callId
        });
        supprimerAppel(from, to);
        logCall("ENDED", { callId, from, to, state: "ENDED" });
    }

    // ==================================================
    // TRANSFERT IVR (TOUCHE 1)
    // ==================================================
    function traiterTransfertIvr(message) {
        const from = identifiant;
        const to = String(message.to || "").trim();
        const callId = String(message.callId || "");
        const digit = String(message.digit || "");

        if (!to || !callId || digit !== "1") {
            logCall("IVR_TRANSFER_IGNORED", { callId, from, to, info: "Champs invalides ou touche non autorisee" });
            envoyer(ws, {
                type: "ERROR",
                message: "Demande de transfert invalide : champs manquants ou touche non autorisee."
            });
            return;
        }

        if (to !== IVR_AGENT_ID) {
            logCall("IVR_TRANSFER_REFUSED", { callId, from, to, info: "Destination differente de l'agent IVR attendu" });
            envoyer(ws, {
                type: "ERROR",
                message: `Transfert refuse : la destination doit etre l'agent IVR ${IVR_AGENT_ID}.`
            });
            return;
        }

        const session = callSessions.get(callId);
        if (
            !session ||
            session.callId !== callId ||
            session.from !== from ||
            session.to !== to ||
            session.state !== "CONNECTED"
        ) {
            logCall("IVR_TRANSFER_REFUSED", {
                callId,
                from,
                to,
                state: session ? session.state : "ABSENTE",
                info: "Session IVR non valide pour cet emetteur"
            });
            envoyer(ws, {
                type: "ERROR",
                message: "Transfert refuse : aucun appel connecte ne correspond a cette demande."
            });
            return;
        }

        if (session.ivrTransferRequested) {
            logCall("IVR_TRANSFER_IGNORED", { callId, from, to, state: "CONNECTED", info: "Demande deja transmise pour cet appel" });
            envoyer(ws, {
                type: "ERROR",
                message: "Une demande de conseiller a deja ete transmise pour cet appel."
            });
            return;
        }

        const wsIvr = utilisateurs.get(to);
        if (!wsIvr || wsIvr.readyState !== WebSocket.OPEN) {
            logCall("IVR_TRANSFER_FAILED", { callId, from, to, info: "Agent IVR non connecte en WebSocket" });
            envoyer(ws, {
                type: "ERROR",
                message: "Transfert impossible : l'agent IVR n'est pas connecte."
            });
            return;
        }

        if (appels.get(from) !== to) {
            logCall("IVR_TRANSFER_REFUSED", { callId, from, to, info: "Aucun appel actif entre l'emetteur et l'agent IVR" });
            envoyer(ws, {
                type: "ERROR",
                message: "Transfert refuse : l'appel avec l'agent IVR n'est plus actif."
            });
            return;
        }

        const transmis = envoyerAUtilisateur(to, {
            type: "ivr-transfer",
            from: from,
            to: to,
            callId: callId,
            digit: digit
        });

        if (!transmis) {
            logCall("IVR_TRANSFER_FAILED", { callId, from, to, info: "Agent IVR non connecte en WebSocket" });
            envoyer(ws, {
                type: "ERROR",
                message: "Transfert impossible : l'agent IVR n'est pas connecte."
            });
            return;
        }

        session.ivrTransferRequested = true;
        logCall("IVR_TRANSFER", { callId, from, to, state: "CONNECTED", info: "Touche 1 relayee a l'agent IVR" });
    }

    // ==================================================
    // SIGNALISATION WEBRTC
    // ==================================================
    function relayerSignalisation(message) {
        const from = identifiant;
        const to = String(message.to || "").trim();
        const callId = message.callId;

        if (to === "" || appels.get(from) !== to) return;

        const eventType = (message.type === "ICE_CANDIDATE") ? "ice-candidate" : message.type;

        const signal = {
            type: eventType,
            candidate: message.candidate,
            offer: message.offer,
            answer: message.answer,
            callId: callId,
            from: from,
            to: to
        };

        envoyerAUtilisateur(to, signal);
        console.log(`[CALL] SIGNAL | ${eventType} | callId=${callId || "n/a"} | ${from} -> ${to}`);
    }

    // ==================================================
    // GESTION DECONNEXION
    // ==================================================
    function gererDeconnexion(id, wsOrigine) {
        // 1. Si l'utilisateur est enregistré avec une AUTRE socket active plus récente, on ne touche à rien
        if (utilisateurs.get(id) && utilisateurs.get(id) !== wsOrigine) {
            console.log(`ℹ️ Fermeture d'une socket obsolète pour ${id}, session active préservée.`);
            return;
        }

        // 2. Nettoyer la map utilisateurs si c'est bien la socket active qui a fermé
        if (utilisateurs.get(id) === wsOrigine) {
            utilisateurs.delete(id);
            userAppStates.delete(id);
            userScreenStates.set(id, "SCREEN_OFF");
        }

        nettoyerSallesParticipant(id);

        const correspondant = appels.get(id);

        if (correspondant) {
            // Si un appel est en attente (sonnerie / réveil push) et que l'utilisateur déconnecté est le destinataire,
            // on ne détruit PAS l'appel : le destinataire est probablement en train d'ouvrir l'application via le push !
            if (pendingOffers.has(id)) {
                console.log(`⏳ Destinataire ${id} déconnecté temporairement pendant la sonnerie/push. Appel maintenu.`);
                return;
            }

            envoyerAUtilisateur(correspondant, {
                type: "hang-up",
                from: id,
                to: correspondant,
                reason: "disconnected"
            });

            supprimerAppel(id, correspondant);
        }

        console.log(`❌ UTILISATEUR DECONNECTE : ${id}`);
    }
});

// ======================================================
// HEARTBEAT KEEP-ALIVE (30s)
// ======================================================
const intervalKeepAlive = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log("Connexion inactive terminee (timeout keep-alive)");
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on("close", () => {
    clearInterval(intervalKeepAlive);
});

wss.on("error", (error) => {
    console.error("ERREUR SERVEUR WEBSOCKET :", error);
});
