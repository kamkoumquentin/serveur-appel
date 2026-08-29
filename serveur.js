const http = require("http");
const WebSocket = require("ws");

// Port dynamique pour Render
const PORT = process.env.PORT || 8080;

// ======================================================
// SERVEUR HTTP (Pour le réveil Render & Health Check)
// ======================================================
const server = http.createServer((req, res) => {
    // Répondre 200 OK aux requêtes HTTP de réveil du client
    res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify({ status: "ok", message: "Serveur d'appel opérationnel" }));
});

// ======================================================
// SERVEUR WEBSOCKET ATTACHÉ AU SERVEUR HTTP
// ======================================================
const wss = new WebSocket.Server({ server });

// ======================================================
// INITIALISATION FIREBASE ADMIN
// ======================================================
const { initializeApp, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
let messaging = null;

try {
    const serviceAccount = require("./firebase-key.json");
    initializeApp({
        credential: cert(serviceAccount)
    });
    messaging = getMessaging();
    console.log("🔥 Firebase Admin initialisé avec succès.");
} catch (err) {
    console.error("⚠️ Impossible d'initialiser Firebase Admin :", err.message);
}

// ======================================================
// ÉTATS EN MÉMOIRE
// ======================================================
const fcmTokens = new Map();      // ID -> Token FCM
const utilisateurs = new Map();   // ID -> WebSocket
const appels = new Map();         // ID -> ID Correspondant
const pendingOffers = new Map();  // ID -> { from, offer }

// ======================================================
// DÉMARRAGE
// ======================================================
server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Serveur HTTP & WebSocket démarré sur le port ${PORT}`);
});

// ======================================================
// UTILITAIRES
// ======================================================
function envoyer(ws, message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

function envoyerAUtilisateur(identifiant, message) {
    const ws = utilisateurs.get(identifiant);
    if (!ws) {
        console.log(`Utilisateur introuvable : ${identifiant}`);
        return false;
    }
    envoyer(ws, message);
    return true;
}

function utilisateurExiste(identifiant) {
    return utilisateurs.has(identifiant);
}

function utilisateurOccupe(identifiant) {
    return appels.has(identifiant);
}

function creerAppel(utilisateurA, utilisateurB) {
    appels.set(utilisateurA, utilisateurB);
    appels.set(utilisateurB, utilisateurA);
    console.log(`📞 APPEL CRÉÉ : ${utilisateurA} <--> ${utilisateurB}`);
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
    console.log(`📴 APPEL TERMINÉ : ${utilisateurA} <--> ${utilisateurB}`);
}

// ======================================================
// GESTION DES CONNEXIONS WEBSOCKET
// ======================================================
wss.on("connection", (ws) => {
    console.log("Nouveau client connecté.");
    let identifiant = null;

    ws.isAlive = true;
    ws.on("pong", () => {
        ws.isAlive = true;
    });

    ws.on("message", (data) => {
        try {
            const message = JSON.parse(data.toString());
            console.log("\nMESSAGE REÇU :", message);
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
        console.log(`Client déconnecté : ${identifiant || "inconnu"}`);
        if (identifiant) {
            gererDeconnexion(identifiant);
        }
    });

    ws.on("error", (error) => {
        console.error(`Erreur WebSocket ${identifiant || ""} :`, error);
    });

    // ==================================================
    // TRAITEMENT DES MESSAGES
    // ==================================================
    function traiterMessage(wsClient, message) {
        // Normalisation de la cible
        if (message.targetId) message.to = message.targetId;

        // Normalisation des types de messages entrants
        if (message.type === "call-user") message.type = "CALLING";
        if (message.type === "answer-call") message.type = "CALL_ACCEPTED";
        if (message.type === "ice-candidate") message.type = "ICE_CANDIDATE";
        if (message.type === "hang-up") message.type = "CALL_ENDED";
        if (message.type === "call-refused") message.type = "CALL_REJECTED";

        const type = message.type;

        // PING / PONG applicatif
        if (type === "PING" || type === "ping") {
            wsClient.isAlive = true;
            envoyer(wsClient, { type: "PONG" });
            return;
        }

        // REGISTER
        if (type === "REGISTER") {
            enregistrerUtilisateur(wsClient, message);
            return;
        }

        // Vérification de connexion préalable
        if (!identifiant) {
            envoyer(wsClient, {
                type: "ERROR",
                message: "Vous devez être enregistré avant d'envoyer des messages."
            });
            return;
        }

        if (type === "CALLING") return traiterCalling(message);
        if (type === "CALL_ACCEPTED") return traiterCallAccepted(message);
        if (type === "CALL_REJECTED") return traiterCallRejected(message);
        if (type === "CALL_ENDED") return traiterCallEnded(message);
        if (type === "ICE_CANDIDATE" || type === "WEBRTC_OFFER" || type === "WEBRTC_ANSWER") {
            return relayerSignalisation(message);
        }

        envoyer(wsClient, {
            type: "ERROR",
            message: `Type de message inconnu : ${type}`
        });
    }

    // ==================================================
    // ENREGISTREMENT DE L'UTILISATEUR
    // ==================================================
    function enregistrerUtilisateur(wsClient, message) {
        const nouvelIdentifiant = String(message.id || "").trim();

        if (nouvelIdentifiant === "") {
            envoyer(wsClient, {
                type: "ERROR",
                message: "Identifiant obligatoire."
            });
            return;
        }

        // Nettoyage de l'ancienne session si existante
        if (utilisateurs.has(nouvelIdentifiant)) {
            console.log(`Reconnexion : nettoyage de l'ancienne session pour ${nouvelIdentifiant}`);
            const ancienneWs = utilisateurs.get(nouvelIdentifiant);
            if (ancienneWs && ancienneWs !== wsClient) {
                try { ancienneWs.close(); } catch (e) {}
            }
        }

        identifiant = nouvelIdentifiant;
        utilisateurs.set(identifiant, wsClient);

        if (message.fcmToken) {
            fcmTokens.set(identifiant, message.fcmToken);
        }

        console.log(`UTILISATEUR ENREGISTRÉ : ${identifiant}`);

        envoyer(wsClient, {
            type: "REGISTERED",
            id: identifiant
        });

        // Transmission de l'offre en attente (si réveil Push)
        if (pendingOffers.has(identifiant)) {
            const pending = pendingOffers.get(identifiant);
            if (appels.get(identifiant) === pending.from) {
                console.log(`Transmission de l'offre en attente à ${identifiant} de la part de ${pending.from}`);
                // ✅ FORMAT ATTENDU PAR LE CLIENT : "incoming-call"
                envoyer(wsClient, {
                    type: "incoming-call",
                    from: pending.from,
                    to: identifiant,
                    offer: pending.offer
                });
            }
        }
    }

    // ==================================================
    // TRAITER L'APPEL (OFFRE)
    // ==================================================
    function traiterCalling(message) {
        const from = identifiant;
        const to = String(message.to || "").trim();

        if (to === "") {
            envoyer(ws, { type: "ERROR", message: "Destinataire manquant." });
            return;
        }

        if (from === to) {
            envoyer(ws, { type: "ERROR", message: "Vous ne pouvez pas vous appeler vous-même." });
            return;
        }

        const destinataireEnLigne = utilisateurExiste(to);
        const tokenDestinataire = fcmTokens.get(to);

        if (!destinataireEnLigne && !tokenDestinataire) {
            envoyer(ws, { type: "ERROR", message: "Le correspondant est hors ligne ou introuvable." });
            return;
        }

        if (utilisateurOccupe(from)) {
            envoyer(ws, { type: "BUSY", from: to, message: "Vous êtes déjà en appel." });
            return;
        }

        if (utilisateurOccupe(to)) {
            envoyer(ws, { type: "BUSY", from: to, to: from, message: "Le correspondant est occupé." });
            console.log(`APPEL REFUSÉ : ${to} est occupé.`);
            return;
        }

        creerAppel(from, to);

        if (message.offer) {
            pendingOffers.set(to, { from: from, offer: message.offer });
        }

        let transmisWs = false;

        // 1. Envoi direct par WebSocket
        if (destinataireEnLigne) {
            // ✅ FORMAT ATTENDU PAR LE CLIENT : "incoming-call"
            transmisWs = envoyerAUtilisateur(to, {
                type: "incoming-call",
                from: from,
                to: to,
                offer: message.offer
            });
        }

        // 2. Envoi par Push FCM en arrière-plan
        let pushTente = false;
        if (tokenDestinataire && messaging) {
            pushTente = true;
            const payload = {
                token: tokenDestinataire,
                notification: {
                    title: "Appel entrant",
                    body: `${from} essaie de vous joindre !`
                },
                data: {
                    type: "APPEL",
                    appelant: from,
                    offer: message.offer ? JSON.stringify(message.offer) : ""
                },
                android: {
                    priority: "high"
                }
            };

            messaging.send(payload)
                .then(response => console.log("Push FCM envoyé avec succès :", response))
                .catch(error => {
                    console.error("Erreur Push FCM :", error);
                    if (error.code === "messaging/registration-token-not-registered" ||
                        error.code === "messaging/invalid-registration-token") {
                        fcmTokens.delete(to);
                    }
                });
        }

        if (!transmisWs && !pushTente) {
            supprimerAppel(from, to);
            envoyer(ws, {
                type: "ERROR",
                message: "Impossible de joindre le correspondant (hors ligne)."
            });
            return;
        }

        console.log(`CALLING traité : ${from} -> ${to} (WS direct: ${transmisWs}, Push: ${pushTente})`);
    }

    // ==================================================
    // TRAITER L'ACCEPTATION (RÉPONSE)
    // ==================================================
    function traiterCallAccepted(message) {
        const from = identifiant;
        const to = String(message.to || "").trim();

        if (to === "" || appels.get(from) !== to) return;

        pendingOffers.delete(from);
        pendingOffers.delete(to);

        // ✅ FORMAT ATTENDU PAR LE CLIENT : "call-answered"
        envoyerAUtilisateur(to, {
            type: "call-answered",
            from: from,
            to: to,
            answer: message.answer
        });

        console.log(`CALL_ACCEPTED : ${from} -> ${to}`);
    }

    // ==================================================
    // TRAITER LE REFUS
    // ==================================================
    function traiterCallRejected(message) {
        const from = identifiant;
        const to = String(message.to || "").trim();

        if (to === "") return;

        // ✅ FORMAT ATTENDU PAR LE CLIENT : "call-refused"
        envoyerAUtilisateur(to, { type: "call-refused", from: from, to: to });
        supprimerAppel(from, to);
        console.log(`CALL_REJECTED : ${from} -> ${to}`);
    }

    // ==================================================
    // TRAITER LA FIN D'APPEL (RACCROCHER)
    // ==================================================
    function traiterCallEnded(message) {
        const from = identifiant;
        const to = String(message.to || "").trim();

        if (to === "") return;

        // ✅ FORMAT ATTENDU PAR LE CLIENT : "hang-up"
        envoyerAUtilisateur(to, { type: "hang-up", from: from, to: to });
        supprimerAppel(from, to);
        console.log(`CALL_ENDED : ${from} -> ${to}`);
    }

    // ==================================================
    // RELAIS SIGNALISATION (ICE CANDIDATES / SDP)
    // ==================================================
    function relayerSignalisation(message) {
        const from = identifiant;
        const to = String(message.to || "").trim();

        if (to === "" || appels.get(from) !== to) return;

        // ✅ FORMAT ATTENDU PAR LE CLIENT : "ice-candidate"
        const eventType = (message.type === "ICE_CANDIDATE") ? "ice-candidate" : message.type;

        const signal = {
            type: eventType,
            candidate: message.candidate,
            from: from,
            to: to
        };

        envoyerAUtilisateur(to, signal);
        console.log(`${eventType} : ${from} -> ${to}`);
    }

    // ==================================================
    // GESTION DE LA DÉCONNEXION
    // ==================================================
    function gererDeconnexion(id) {
        const correspondant = appels.get(id);

        if (correspondant) {
            // ✅ FORMAT ATTENDU PAR LE CLIENT : "hang-up"
            envoyerAUtilisateur(correspondant, {
                type: "hang-up",
                from: id,
                to: correspondant,
                reason: "disconnected"
            });
            supprimerAppel(id, correspondant);
        }

        if (utilisateurs.get(id) === ws) {
            utilisateurs.delete(id);
        }

        console.log(`UTILISATEUR SUPPRIMÉ : ${id}`);
    }
});

// ======================================================
// HEARTBEAT SERVEUR (PING PÉRIODIQUE - 30 SECONDES)
// ======================================================
const intervalKeepAlive = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log("Connexion inactive fermée (timeout keep-alive)");
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
