const http = require("http");
const WebSocket = require("ws");

// MODIFICATION RENDER : Utilisation du port dynamique
const PORT = process.env.PORT || 8080;

// ======================================================
// SERVEUR HTTP (Pour le reveil Render & Health Check)
// ======================================================
const server = http.createServer((req, res) => {
    res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify({ status: "ok", message: "Serveur d'appel operationnel" }));
});

// ======================================================
// SERVEUR WEBSOCKET
// ======================================================
const wss = new WebSocket.Server({ server });

// ======================================================
// INITIALISATION FIREBASE notification firebase
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
    console.log("🔥 Firebase Admin initialise avec succes.");
} catch (err) {
    console.error("⚠️ Impossible d'initialiser Firebase Admin :", err.message);
}

// ======================================================
// TOKENS DE NOTIFICATION FCM
// ======================================================
const fcmTokens = new Map();

// ======================================================
// UTILISATEURS CONNECTES
// ======================================================
const utilisateurs = new Map();

// ======================================================
// APPELS ACTIFS
// ======================================================
const appels = new Map();

// ======================================================
// OFFRES EN ATTENTE (Pour reveil Push FCM hors-ligne)
// ======================================================
const pendingOffers = new Map();

// ======================================================
// DEMARRAGE
// ======================================================
server.listen(PORT, "0.0.0.0", () => {
    console.log(`Serveur WebSocket & HTTP demarre sur le port ${PORT}`);
});

// ======================================================
// UTILITAIRE : ENVOYER UN MESSAGE
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
        console.log(`Utilisateur introuvable : ${identifiant}`);
        return false;
    }
    envoyer(ws, message);
    return true;
}

// ======================================================
// UTILITAIRE : UTILISATEUR DISPONIBLE
// ======================================================
function utilisateurExiste(identifiant) {
    return utilisateurs.has(identifiant);
}

// ======================================================
// UTILITAIRE : UTILISATEUR OCCUPE
// ======================================================
function utilisateurOccupe(identifiant) {
    return appels.has(identifiant);
}

// ======================================================
// UTILITAIRE : CREER UN APPEL
// ======================================================
function creerAppel(utilisateurA, utilisateurB) {
    appels.set(utilisateurA, utilisateurB);
    appels.set(utilisateurB, utilisateurA);
    console.log(`APPEL CREE : ${utilisateurA} <--> ${utilisateurB}`);
}

// ======================================================
// UTILITAIRE : SUPPRIMER UN APPEL
// ======================================================
function supprimerAppel(utilisateurA, utilisateurB) {
    if (utilisateurA) {
        appels.delete(utilisateurA);
        pendingOffers.delete(utilisateurA);
    }
    if (utilisateurB) {
        appels.delete(utilisateurB);
        pendingOffers.delete(utilisateurB);
    }
    console.log(`APPEL TERMINE : ${utilisateurA} <--> ${utilisateurB}`);
}

// ======================================================
// CONNEXION CLIENT
// ======================================================
wss.on("connection", (ws) => {
    console.log("Nouveau client connecte.");
    let identifiant = null;

    // HEARTBEAT / KEEP-ALIVE : Marquer la connexion comme active
    ws.isAlive = true;
    ws.on("pong", () => {
        ws.isAlive = true;
    });

    // ==================================================
    // MESSAGE
    // ==================================================
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

    // ==================================================
    // DECONNEXION
    // ==================================================
    ws.on("close", () => {
        console.log(`Client deconnecte : ${identifiant || "inconnu"}`);
        if (identifiant) {
            gererDeconnexion(identifiant);
        }
    });

    // ==================================================
    // ERREUR
    // ==================================================
    ws.on("error", (error) => {
        console.error(`Erreur WebSocket ${identifiant || ""} :`, error);
    });

    // ==================================================
    // TRAITEMENT DES MESSAGES
    // ==================================================
    function traiterMessage(wsClient, message) {
        // --- TRADUCTEUR CLIENT -> SERVEUR ---
        if (message.targetId) message.to = message.targetId;

        if (message.type === "call-user") message.type = "CALLING";
        if (message.type === "answer-call") message.type = "CALL_ACCEPTED";
        if (message.type === "ice-candidate") message.type = "ICE_CANDIDATE";
        if (message.type === "hang-up") message.type = "CALL_ENDED";
        if (message.type === "call-refused") message.type = "CALL_REJECTED";

        const type = message.type;

        // ==================================================
        // PING / PONG (Heartbeat applicatif)
        // ==================================================
        if (type === "PING" || type === "ping") {
            ws.isAlive = true;
            envoyer(wsClient, { type: "PONG" });
            return;
        }

        // ==================================================
        // REGISTER
        // ==================================================
        if (type === "REGISTER") {
            enregistrerUtilisateur(wsClient, message);
            return;
        }

        // ==================================================
        // VERIFICATION CONNEXION
        // ==================================================
        if (!identifiant) {
            envoyer(wsClient, {
                type: "ERROR",
                message: "Vous devez etre enregistre avant d'envoyer des messages."
            });
            return;
        }

        // ==================================================
        // APPEL
        // ==================================================
        if (type === "CALLING") {
            traiterCalling(message);
            return;
        }

        // ==================================================
        // APPEL ACCEPTE
        // ==================================================
        if (type === "CALL_ACCEPTED") {
            traiterCallAccepted(message);
            return;
        }

        // ==================================================
        // APPEL REFUSE
        // ==================================================
        if (type === "CALL_REJECTED") {
            traiterCallRejected(message);
            return;
        }

        // ==================================================
        // APPEL TERMINE
        // ==================================================
        if (type === "CALL_ENDED") {
            traiterCallEnded(message);
            return;
        }

        // ==================================================
        // WEBRTC OFFER / ANSWER / ICE CANDIDATE
        // ==================================================
        if (type === "WEBRTC_OFFER" || type === "WEBRTC_ANSWER" || type === "ICE_CANDIDATE") {
            relayerSignalisation(message);
            return;
        }

        // ==================================================
        // TYPE INCONNU
        // ==================================================
        envoyer(wsClient, {
            type: "ERROR",
            message: `Type de message inconnu : ${type}`
        });
    }

    // ==================================================
    // ENREGISTRER UTILISATEUR
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

        // Nettoyage de l'ancienne session en doublon
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

        console.log(`UTILISATEUR ENREGISTRE : ${identifiant}`);

        envoyer(wsClient, {
            type: "REGISTERED",
            id: identifiant
        });

        // Si un appel etait en attente (reveil suite au push FCM)
        if (pendingOffers.has(identifiant)) {
            const pending = pendingOffers.get(identifiant);
            if (appels.get(identifiant) === pending.from) {
                console.log(`Transmission de l'offre en attente a ${identifiant} de la part de ${pending.from}`);
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
    // TRAITER CALLING
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

        // Si le correspondant n'est ni connecte en direct, ni joignable par Push FCM
        if (!destinataireEnLigne && !tokenDestinataire) {
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

        // Memoriser l'offre en attente pour le reveil par push
        if (message.offer) {
            pendingOffers.set(to, { from: from, offer: message.offer });
        }

        let transmisWs = false;

        // ==============================================
        // 1. TENTATIVE VIA WEBSOCKET (En direct)
        // ==============================================
        if (destinataireEnLigne) {
            transmisWs = envoyerAUtilisateur(to, {
                type: "incoming-call",
                from: from,
                to: to,
                offer: message.offer
            });
        }

        // ==============================================
        // 2. TENTATIVE VIA FIREBASE PUSH (En arriere-plan)
        // ==============================================
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
                .then(response => console.log("Push envoye avec succes :", response))
                .catch(error => {
                    console.error("Erreur Push :", error);
                    if (error.code === "messaging/registration-token-not-registered" || 
                        error.code === "messaging/invalid-registration-token") {
                        fcmTokens.delete(to);
                    }
                });
        } else if (tokenDestinataire) {
            console.log("Firebase Messaging non disponible.");
        } else {
            console.log(`Aucun token FCM pour ${to}.`);
        }

        // ==============================================
        // 3. VERIFICATION DE L'ECHEC TOTAL
        // ==============================================
        if (!transmisWs && !pushTente) {
            supprimerAppel(from, to);
            envoyer(ws, {
                type: "ERROR",
                message: "Impossible de joindre le correspondant (hors ligne)."
            });
            return;
        }

        console.log(`CALLING traite : ${from} -> ${to} (WS direct: ${transmisWs}, Push: ${pushTente})`);
    }

    // ==================================================
    // CALL ACCEPTED
    // ==================================================
    function traiterCallAccepted(message) {
        const from = identifiant;
        const to = String(message.to || "").trim();

        if (to === "") return;

        if (appels.get(from) !== to) {
            console.log(`CALL_ACCEPTED ignore : aucun appel entre ${from} et ${to}`);
            return;
        }

        // Nettoyage de l'offre en attente une fois accepte
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
    // CALL REJECTED
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
    // CALL ENDED
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
    // SIGNALISATION WEBRTC (ICE CANDIDATES / SDP)
    // ==================================================
    function relayerSignalisation(message) {
        const from = identifiant;
        const to = String(message.to || "").trim();

        if (to === "") {
            console.log("Signalisation sans destinataire.");
            return;
        }

        if (appels.get(from) !== to) {
            console.log(`Signalisation refusee : ${from} -> ${to}`);
            return;
        }

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
    // DECONNEXION
    // ==================================================
    function gererDeconnexion(id) {
        const correspondant = appels.get(id);

        if (correspondant) {
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

        console.log(`UTILISATEUR SUPPRIME : ${id}`);
    }
});

// ======================================================
// HEARTBEAT SERVEUR (PING / PONG PERIODIQUE - 30 SECONDES)
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

// ======================================================
// GESTION ERREUR SERVEUR
// ======================================================
wss.on("error", (error) => {
    console.error("ERREUR SERVEUR WEBSOCKET :", error);
});
