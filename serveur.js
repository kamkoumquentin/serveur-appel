const http = require("http");
const WebSocket = require("ws");

// MODIFICATION RENDER : Utilisation du port dynamique
const PORT = process.env.PORT || 8080;

// ======================================================
// TOKENS & SESSIONS EN MEMOIRE
// ======================================================
const fcmTokens = new Map();
const utilisateurs = new Map();
const appels = new Map();
const pendingOffers = new Map();

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
            console.log("\nMESSAGE RECU :", message);
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
        // ⚠️ CORRECTION CRITIQUE 1 :
        // Si cette socket a été remplacée par une nouvelle socket active (isReplaced = true),
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

        // ⚠️ CORRECTION CRITIQUE 2 :
        // Marquer l'ancienne socket avec isReplaced = true AVANT de la fermer
        // afin d'empêcher son gestionnaire on("close") d'annuler l'appel en cours
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
            console.log(`📲 TOKEN FCM ENREGISTRE pour ${identifiant} : ${message.fcmToken.substring(0, 20)}...`);
        } else if (fcmTokens.has(identifiant)) {
            console.log(`📲 Token FCM deja conserve en memoire pour ${identifiant}`);
        } else {
            console.log(`⚠️ Aucun token FCM fourni lors du REGISTER pour ${identifiant}`);
        }

        console.log(`✅ UTILISATEUR ENREGISTRE : ${identifiant}`);

        envoyer(wsClient, {
            type: "REGISTERED",
            id: identifiant
        });

        // ⚠️ CORRECTION CRITIQUE 3 :
        // Envoi immédiat et fiable de l'offre en attente lors de la reconnexion / réveil push
        if (pendingOffers.has(identifiant)) {
            const pending = pendingOffers.get(identifiant);
            if (pending && pending.from) {
                if (utilisateurExiste(pending.from) && appels.get(pending.from) === identifiant) {
                    console.log(`📦 Transmission de l'offre en attente a ${identifiant} de la part de ${pending.from}`);
                    envoyer(wsClient, {
                        type: "incoming-call",
                        from: pending.from,
                        to: identifiant,
                        offer: pending.offer
                    });
                } else {
                    console.log(`⚠️ Offre en attente expiree pour ${identifiant} (l'appelant ${pending.from} a quitte)`);
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

        if (to === "") {
            envoyer(ws, { type: "ERROR", message: "Destinataire manquant." });
            return;
        }

        if (from === to) {
            envoyer(ws, { type: "ERROR", message: "Vous ne pouvez pas vous appeler vous-meme." });
            return;
        }

        const destinataireEnLigne = utilisateurExiste(to);
        const tokenDestinataire = fcmTokens.get(to);

        if (!destinataireEnLigne && !tokenDestinataire) {
            console.log(`❌ Echec appel : ${to} n'est ni connecte en direct ni joignable via Push FCM.`);
            envoyer(ws, { type: "ERROR", message: "Le correspondant est hors ligne ou introuvable." });
            return;
        }

        if (utilisateurOccupe(from)) {
            envoyer(ws, { type: "BUSY", from: to, message: "Vous etes deja en appel." });
            return;
        }

        if (utilisateurOccupe(to)) {
            envoyer(ws, { type: "BUSY", from: to, to: from, message: "Le correspondant est occupe." });
            console.log(`APPEL REFUSE : ${to} est occupe.`);
            return;
        }

        creerAppel(from, to);

        if (message.offer) {
            pendingOffers.set(to, { from: from, offer: message.offer });
        }

        let transmisWs = false;

        // 1. Envoi direct via WebSocket si connecte
        if (destinataireEnLigne) {
            transmisWs = envoyerAUtilisateur(to, {
                type: "incoming-call",
                from: from,
                to: to,
                offer: message.offer
            });
        }

        // 2. Envoi via Push Firebase FCM
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
                    appelant: String(from),
                    callerId: String(from),
                    title: `${from}`,
                    message: "Appel vocal entrant",
                    body: "Appel vocal entrant",
                    color: "#00A884",
                    offer: offerStr,
                    actions: JSON.stringify([
                        {
                            icon: "phone_hangup",
                            title: "Refuser",
                            callback: "rejectCallAction",
                            foreground: false
                        },
                        {
                            icon: "phone",
                            title: "Répondre",
                            callback: "acceptCallAction",
                            foreground: true
                        }
                    ]),
                    android_channel_id: "calls_channel",
                    channelId: "calls_channel",
                    priority: "2",
                    visibility: "1",
                    importance: "4",
                    sound: "default",
                    vibrate: "true",
                    category: "call",
                    "content-available": "1",
                    "force-start": "1"
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

            console.log(`📡 Envoi de la notification d'appel avec boutons [Refuser] / [Répondre] vers ${to}...`);

            messaging.send(payload)
                .then(response => console.log(`✅ Push FCM envoye avec succes a ${to} :`, response))
                .catch(error => {
                    console.error(`❌ Erreur envoi Push FCM a ${to} :`, error.message);
                    if (error.code === "messaging/registration-token-not-registered" || 
                        error.code === "messaging/invalid-registration-token") {
                        console.log(`🗑️ Suppression du token perime pour ${to}`);
                        fcmTokens.delete(to);
                    }
                });
        } else if (!tokenDestinataire) {
            console.log(`⚠️ Aucun token FCM enregistre pour ${to}.`);
        } else if (!messaging) {
            console.error("⚠️ Firebase Messaging n'est pas configure sur le serveur.");
        }

        if (!transmisWs && !pushTente) {
            supprimerAppel(from, to);
            envoyer(ws, {
                type: "ERROR",
                message: "Impossible de joindre le correspondant (hors ligne)."
            });
            return;
        }

        // Timeout de sécurité : si le destinataire ne répond pas après 60 secondes
        setTimeout(() => {
            if (pendingOffers.has(to) && pendingOffers.get(to).from === from) {
                console.log(`⏰ Délai d'attente dépassé (60s) pour l'appel ${from} -> ${to}`);
                pendingOffers.delete(to);
                supprimerAppel(from, to);
                envoyerAUtilisateur(from, {
                    type: "hang-up",
                    from: to,
                    to: from,
                    reason: "timeout"
                });
            }
        }, 60000);

        console.log(`CALLING traite : ${from} -> ${to} (WS direct: ${transmisWs}, Push FCM: ${pushTente})`);
    }

    // ==================================================
    // TRAITER CALL ACCEPTED
    // ==================================================
    function traiterCallAccepted(message) {
        const from = identifiant;
        const to = String(message.to || "").trim();

        if (to === "" || appels.get(from) !== to) return;

        pendingOffers.delete(from);
        pendingOffers.delete(to);

        envoyerAUtilisateur(to, {
            type: "call-answered",
            from: from,
            to: to,
            answer: message.answer
        });

        console.log(`CALL_ACCEPTED : ${from} -> ${to}`);
    }

    // ==================================================
    // TRAITER CALL REJECTED
    // ==================================================
    function traiterCallRejected(message) {
        const from = identifiant;
        const to = String(message.to || "").trim();

        if (to === "") return;

        envoyerAUtilisateur(to, { type: "call-refused", from: from, to: to });
        supprimerAppel(from, to);
        console.log(`CALL_REJECTED : ${from} -> ${to}`);
    }

    // ==================================================
    // TRAITER CALL ENDED
    // ==================================================
    function traiterCallEnded(message) {
        const from = identifiant;
        const to = String(message.to || "").trim();

        if (to === "") return;

        envoyerAUtilisateur(to, { type: "hang-up", from: from, to: to });
        supprimerAppel(from, to);
        console.log(`CALL_ENDED : ${from} -> ${to}`);
    }

    // ==================================================
    // SIGNALISATION WEBRTC
    // ==================================================
    function relayerSignalisation(message) {
        const from = identifiant;
        const to = String(message.to || "").trim();

        if (to === "" || appels.get(from) !== to) return;

        const eventType = (message.type === "ICE_CANDIDATE") ? "ice-candidate" : message.type;

        const signal = {
            type: eventType,
            candidate: message.candidate,
            offer: message.offer,
            answer: message.answer,
            from: from,
            to: to
        };

        envoyerAUtilisateur(to, signal);
        console.log(`${eventType} : ${from} -> ${to}`);
    }

    // ==================================================
    // GESTION DECONNEXION
    // ==================================================
    function gererDeconnexion(id, wsOrigine) {
        // ⚠️ CORRECTION CRITIQUE 4 :
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
            // ⚠️ CORRECTION CRITIQUE 5 :
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
   
