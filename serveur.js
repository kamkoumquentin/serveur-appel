const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

// MODIFICATION RENDER : Utilisation du port dynamique
const PORT = process.env.PORT || 8080;

// ======================================================
// TOKENS & SESSIONS EN MEMOIRE & SUR DISQUE (PERSISTANCE)
// ======================================================
const fcmTokens = new Map();
const utilisateurs = new Map();
const appels = new Map();
const pendingOffers = new Map();

const TOKENS_FILE = path.join(__dirname, "fcm_tokens.json");

function saveTokensToFile() {
    try {
        const obj = Object.fromEntries(fcmTokens);
        fs.writeFileSync(TOKENS_FILE, JSON.stringify(obj, null, 2), "utf8");
    } catch (e) {
        console.error("❌ Erreur sauvegarde fcm_tokens.json :", e.message);
    }
}

function loadTokensFromFile() {
    try {
        if (fs.existsSync(TOKENS_FILE)) {
            const data = fs.readFileSync(TOKENS_FILE, "utf8");
            const obj = JSON.parse(data);
            for (const [id, token] of Object.entries(obj)) {
                if (id && token) fcmTokens.set(id, token);
            }
            console.log(`📦 ${fcmTokens.size} tokens FCM chargés depuis fcm_tokens.json`);
        }
    } catch (e) {
        console.error("❌ Erreur chargement fcm_tokens.json :", e.message);
    }
}

// Charger les tokens enregistrés au démarrage
loadTokensFromFile();

// MACHINE À ÉTATS SERVEUR & DÉDUPLICATION
// callSessions : callId -> { callId, from, to, state: "RINGING" | "ACCEPTING" | "CONNECTED" | "REJECTED" | "ENDED", offer, createdAt }
const callSessions = new Map();
// endedCalls : callId -> timestamp (TTL 60s pour empêcher le replay d'anciens appels)
const endedCalls = new Map();

function logCall(event, details = {}) {
    console.log(`[CALL] ${event} | callId=${details.callId || "n/a"} | from=${details.from || "n/a"} | to=${details.to || "n/a"} | state=${details.state || "n/a"} | info=${details.info || ""}`);
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

// ======================================================
// SERVEUR HTTP (Pour le reveil Render, Diagnostic & Health Check)
// ======================================================
const server = http.createServer(async (req, res) => {
    res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    });

    const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

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

    // Endpoint de test push FCM direct : /test-push?to=ID-123456
    if (parsedUrl.pathname === "/test-push") {
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

        try {
            const testPayload = {
                token: token,
                notification: {
                    title: "Test de Notification",
                    body: "Ceci est un test de notification push reussi !"
                },
                data: {
                    type: "TEST",
                    time: new Date().toISOString(),
                    android_channel_id: "calls_channel",
                    channelId: "calls_channel",
                    priority: "2",
                    visibility: "1"
                },
                android: {
                    priority: "high",
                    notification: {
                        channelId: "calls_channel",
                        sound: "default",
                        priority: "max",
                        visibility: "public"
                    }
                }
            };

            const response = await messaging.send(testPayload);
            return res.end(JSON.stringify({ success: true, messageId: response }));
        } catch (pushErr) {
            return res.end(JSON.stringify({ success: false, error: pushErr.message }));
        }
    }

    // Endpoint d'enregistrement de token FCM via HTTP : POST /register-token
    if (req.method === "POST" && parsedUrl.pathname === "/register-token") {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end", () => {
            try {
                const data = JSON.parse(body);
                const id = String(data.id || data.userId || "").trim();
                const fcmToken = String(data.fcmToken || data.token || "").trim();
                if (id && fcmToken) {
                    fcmTokens.set(id, fcmToken);
                    saveTokensToFile();
                    console.log(`📲 Token FCM enregistré via HTTP pour ${id} : ${fcmToken.substring(0, 20)}...`);
                    return res.end(JSON.stringify({ success: true, id: id, totalTokens: fcmTokens.size }));
                }
            } catch (e) {
                console.error("Erreur parsing /register-token :", e.message);
            }
            res.end(JSON.stringify({ success: false, error: "Identifiant ou token invalide." }));
        });
        return;
    }

    res.end(JSON.stringify({ status: "ok" }));
});

// ======================================================
// SERVEUR WEBSOCKET
// ======================================================
const wss = new WebSocket.Server({ server });

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

// ======================================================
// CONNEXION CLIENT WEBSOCKET
// ======================================================
wss.on("connection", (ws) => {
    console.log("Nouveau client connecte.");
    let identifiant = null;

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

        if (!identifiant) {
            envoyer(wsClient, {
                type: "ERROR",
                message: "Vous devez etre enregistre avant d'envoyer des messages."
            });
            return;
        }

        if (type === "CALLING") return traiterCalling(message);
        if (type === "CALL_ACCEPTED") return traiterCallAccepted(message);
        if (type === "CALL_REJECTED") return traiterCallRejected(message);
        if (type === "CALL_ENDED") return traiterCallEnded(message);
        if (type === "ICE_CANDIDATE" || type === "WEBRTC_OFFER" || type === "WEBRTC_ANSWER" || type === "renegotiate-offer" || type === "renegotiate-answer") {
            return relayerSignalisation(message);
        }

        envoyer(wsClient, {
            type: "ERROR",
            message: `Type de message inconnu : ${type}`
        });
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

        // Marquer l'ancienne socket avec isReplaced = true AVANT de la fermer
        if (utilisateurs.has(nouvelIdentifiant)) {
            const ancienneWs = utilisateurs.get(nouvelIdentifiant);
            if (ancienneWs && ancienneWs !== wsClient) {
                console.log(`🔄 Remplacement de l'ancienne socket pour ${nouvelIdentifiant}`);
                ancienneWs.isReplaced = true;
                try { ancienneWs.close(); } catch (e) {}
            }
        }

        identifiant = nouvelIdentifiant;
        utilisateurs.set(identifiant, wsClient);

        // Sauvegarde du token FCM
        if (message.fcmToken) {
            fcmTokens.set(identifiant, message.fcmToken);
            saveTokensToFile();
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
            createdAt: Date.now()
        };
        callSessions.set(callId, session);

        if (message.offer) {
            pendingOffers.set(to, { from: from, offer: message.offer, callId: callId, createdAt: Date.now() });
        }

        let transmisWs = false;

        // 1. Envoi direct via WebSocket si connecté
        if (destinataireEnLigne) {
            transmisWs = envoyerAUtilisateur(to, {
                type: "incoming-call",
                from: from,
                to: to,
                offer: message.offer,
                callId: callId
            });
            if (transmisWs) {
                logCall("WS_RECEIVED", { callId, from, to, state: "RINGING", info: "Transmis par WebSocket direct" });
            }
        }

        // 2. Envoi via Push Firebase FCM (Format DATA-ONLY avec boutons interactifs)
        let pushTente = false;

        if (tokenDestinataire && messaging) {
            pushTente = true;
            const offerStr = message.offer
                ? (typeof message.offer === "string" ? message.offer : JSON.stringify(message.offer))
                : "";

            const payload = {
                token: tokenDestinataire,
                data: {
                    type: "APPEL",
                    callId: String(callId),
                    callerId: String(from),
                    caller_name: String(from),
                    appelant: String(from),
                    app_name: "KamSoft",
                    title: "KamSoft",
                    subText: "Appel entrant",
                    message: `${from} vous appelle`,
                    body: `${from} vous appelle`,
                    color: "#00A884",
                    offer: offerStr,
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
                    android_channel_id: "calls_channel",
                    channelId: "calls_channel",
                    priority: "high",
                    visibility: "1",
                    importance: "5",
                    sound: "default",
                    vibrate: "true",
                    category: "call",
                    forceShow: "1",
                    "content-available": "1"
                },
                android: {
                    priority: "high",
                    ttl: 60 * 1000
                },
                apns: {
                    payload: {
                        aps: {
                            sound: "default",
                            contentAvailable: true
                        }
                    }
                }
            };

            logCall("FCM_SENT", { callId, from, to, info: "Envoi push FCM interactif" });

            messaging.send(payload)
                .then(response => {
                    logCall("FCM_DELIVERED", { callId, from, to, info: `FCM envoyé avec succès (${response})` });
                })
                .catch(error => {
                    console.error(`❌ Erreur envoi Push FCM à ${to} :`, error.message);
                    if (error.code === "messaging/registration-token-not-registered" || 
                        error.code === "messaging/invalid-registration-token") {
                        console.log(`🗑️ Suppression du token périmé pour ${to}`);
                        fcmTokens.delete(to);
                    }
                });
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
                    }).catch(() => {});
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
                }).catch(() => {});
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
        }

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
