const WebSocket = require("ws");

const PORT = 8080;


// ======================================================
// SERVEUR WEBSOCKET
// ======================================================

const wss = new WebSocket.Server({
    port: PORT,
    host: "0.0.0.0" // <-- AJOUTEZ CETTE LIGNE
});


//INITIALISATION FIREBASE notification firebase


// REMPLACEZ PAR CECI :
const { initializeApp, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const serviceAccount = require("./firebase-key.json"); // Votre fichier téléchargé

// Initialisation de Firebase Admin (Nouvelle syntaxe)
initializeApp({
    credential: cert(serviceAccount)
});
// ======================================================
// TOKENS DE NOTIFICATION FCM
// ======================================================
// Structure : fcmTokens = { "quentin": "epsk5az...", "paul": "fghj4kl..." }
const fcmTokens = new Map();









// ======================================================
// UTILISATEURS CONNECTÉS
// ======================================================
//
// Structure :
//
// utilisateurs = {
//     "quentin": websocket,
//     "paul": websocket
// }
//

const utilisateurs = new Map();


// ======================================================
// APPELS ACTIFS
// ======================================================
//
// Structure :
//
// appels = {
//     "quentin": "paul",
//     "paul": "quentin"
// }
//
// Cela permet de savoir immédiatement si
// un utilisateur est déjà en appel.
//

const appels = new Map();


// ======================================================
// DÉMARRAGE
// ======================================================

console.log(
    `Serveur WebSocket démarré sur le port ${PORT}`
);


// ======================================================
// UTILITAIRE : ENVOYER UN MESSAGE
// ======================================================

function envoyer(ws, message) {

    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {

        ws.send(
            JSON.stringify(message)
        );

    }

}


// ======================================================
// UTILITAIRE : ENVOYER À UN UTILISATEUR
// ======================================================

function envoyerAUtilisateur(
    identifiant,
    message
) {

    const ws =
        utilisateurs.get(
            identifiant
        );


    if (
        !ws
    ) {

        console.log(
            `Utilisateur introuvable : ${identifiant}`
        );

        return false;

    }


    envoyer(
        ws,
        message
    );


    return true;

}


// ======================================================
// UTILITAIRE : UTILISATEUR DISPONIBLE
// ======================================================

function utilisateurExiste(
    identifiant
) {

    return utilisateurs.has(
        identifiant
    );

}


// ======================================================
// UTILITAIRE : UTILISATEUR OCCUPÉ
// ======================================================

function utilisateurOccupe(
    identifiant
) {

    return appels.has(
        identifiant
    );

}


// ======================================================
// UTILITAIRE : CRÉER UN APPEL
// ======================================================

function creerAppel(
    utilisateurA,
    utilisateurB
) {

    appels.set(
        utilisateurA,
        utilisateurB
    );


    appels.set(
        utilisateurB,
        utilisateurA
    );


    console.log(
        `APPEL CRÉÉ : ${utilisateurA} <--> ${utilisateurB}`
    );

}


// ======================================================
// UTILITAIRE : SUPPRIMER UN APPEL
// ======================================================

function supprimerAppel(
    utilisateurA,
    utilisateurB
) {

    if (
        utilisateurA
    ) {

        appels.delete(
            utilisateurA
        );

    }


    if (
        utilisateurB
    ) {

        appels.delete(
            utilisateurB
        );

    }


    console.log(
        `APPEL TERMINÉ : ${utilisateurA} <--> ${utilisateurB}`
    );

}


// ======================================================
// CONNEXION CLIENT
// ======================================================

wss.on(
    "connection",
    (ws) => {

        console.log(
            "Nouveau client connecté."
        );


        // Identifiant associé à cette connexion

        let identifiant =
            null;



        // ==================================================
        // MESSAGE
        // ==================================================

        ws.on(
            "message",
            (data) => {

                try {

                    const message =
                        JSON.parse(
                            data.toString()
                        );


                    console.log(
                        "\nMESSAGE REÇU :",
                        message
                    );


                    traiterMessage(
                        ws,
                        message
                    );

                }
                catch (error) {

                    console.error(
                        "Message JSON invalide :",
                        error
                    );


                    envoyer(
                        ws,
                        {

                            type:
                                "ERROR",

                            message:
                                "Message invalide."

                        }
                    );

                }

            }
        );



        // ==================================================
        // DÉCONNEXION
        // ==================================================

        ws.on(
            "close",
            () => {

                console.log(
                    `Client déconnecté : ${identifiant || "inconnu"}`
                );


                if (
                    identifiant
                ) {

                    gererDeconnexion(
                        identifiant
                    );

                }

            }
        );



        // ==================================================
        // ERREUR
        // ==================================================

        ws.on(
            "error",
            (error) => {

                console.error(
                    `Erreur WebSocket ${identifiant || ""} :`,
                    error
                );

            }
        );



        // ==================================================
        // TRAITEMENT DES MESSAGES
        // ==================================================

        function traiterMessage(
            wsClient,
            message
        ) {

            const type =
                message.type;



            // ==================================================
            // REGISTER
            // ==================================================

            if (
                type ===
                "REGISTER"
            ) {

                enregistrerUtilisateur(
                    wsClient,
                    message
                );

                return;

            }



            // ==================================================
            // VÉRIFICATION CONNEXION
            // ==================================================

            if (
                !identifiant
            ) {

                envoyer(
                    wsClient,
                    {

                        type:
                            "ERROR",

                        message:
                            "Vous devez être enregistré avant d'envoyer des messages."

                    }
                );


                return;

            }



            // ==================================================
            // APPEL
            // ==================================================

            if (
                type ===
                "CALLING"
            ) {

                traiterCalling(
                    message
                );

                return;

            }



            // ==================================================
            // APPEL ACCEPTÉ
            // ==================================================

            if (
                type ===
                "CALL_ACCEPTED"
            ) {

                traiterCallAccepted(
                    message
                );

                return;

            }



            // ==================================================
            // APPEL REFUSÉ
            // ==================================================

            if (
                type ===
                "CALL_REJECTED"
            ) {

                traiterCallRejected(
                    message
                );

                return;

            }



            // ==================================================
            // APPEL TERMINÉ
            // ==================================================

            if (
                type ===
                "CALL_ENDED"
            ) {

                traiterCallEnded(
                    message
                );

                return;

            }



            // ==================================================
            // WEBRTC OFFER
            // ==================================================

            if (
                type ===
                "WEBRTC_OFFER"
            ) {

                relayerSignalisation(
                    message
                );

                return;

            }



            // ==================================================
            // WEBRTC ANSWER
            // ==================================================

            if (
                type ===
                "WEBRTC_ANSWER"
            ) {

                relayerSignalisation(
                    message
                );

                return;

            }



            // ==================================================
            // ICE CANDIDATE
            // ==================================================

            if (
                type ===
                "ICE_CANDIDATE"
            ) {

                relayerSignalisation(
                    message
                );

                return;

            }



            // ==================================================
            // TYPE INCONNU
            // ==================================================

            envoyer(
                wsClient,
                {

                    type:
                        "ERROR",

                    message:
                        `Type de message inconnu : ${type}`

                }
            );

        }



        // ==================================================
        // ENREGISTRER UTILISATEUR
        // ==================================================

        function enregistrerUtilisateur(
            wsClient,
            message
        ) {

            const nouvelIdentifiant =
                String(
                    message.id || ""
                ).trim();


            if (
                nouvelIdentifiant === ""
            ) {

                envoyer(
                    wsClient,
                    {

                        type:
                            "ERROR",

                        message:
                            "Identifiant obligatoire."

                    }
                );


                return;

            }



            // ==============================================
            // IDENTIFIANT DÉJÀ UTILISÉ
            // ==============================================

            if (
                utilisateurs.has(
                    nouvelIdentifiant
                )
            ) {

                envoyer(
                    wsClient,
                    {

                        type:
                            "ERROR",

                        message:
                            "Cet identifiant est déjà connecté."

                    }
                );


                console.log(
                    `IDENTIFIANT REFUSÉ : ${nouvelIdentifiant}`
                );


                return;

            }



            // ==============================================
            // ENREGISTREMENT
            // ==============================================

            identifiant =
                nouvelIdentifiant;


            utilisateurs.set(
                identifiant,
                wsClient
            );


            // NOUVEAU : Sauvegarder le token s'il est fourni lors de l'enregistrement
            if (message.fcmToken) {
                fcmTokens.set(identifiant, message.fcmToken);
            }


                

            console.log(
                `UTILISATEUR ENREGISTRÉ : ${identifiant}`
            );


            envoyer(
                wsClient,
                {

                    type:
                        "REGISTERED",

                    id:
                        identifiant

                }
            );

        }



        // ==================================================
        // TRAITER CALLING
        // ==================================================

        function traiterCalling(
            message
        ) {

            const from =
                identifiant;


            const to =
                String(
                    message.to || ""
                ).trim();



            // ==============================================
            // DESTINATAIRE MANQUANT
            // ==============================================

            if (
                to === ""
            ) {

                envoyer(
                    ws,
                    {

                        type:
                            "ERROR",

                        message:
                            "Destinataire manquant."

                    }
                );


                return;

            }



            // ==============================================
            // S'APPELER SOI-MÊME
            // ==============================================

            if (
                from === to
            ) {

                envoyer(
                    ws,
                    {

                        type:
                            "ERROR",

                        message:
                            "Vous ne pouvez pas vous appeler vous-même."

                    }
                );


                return;

            }



            // ==============================================
            // DESTINATAIRE INEXISTANT
            // ==============================================

            if (
                !utilisateurExiste(
                    to
                )
            ) {

                envoyer(
                    ws,
                    {

                        type:
                            "ERROR",

                        message:
                            "Le correspondant est hors ligne ou introuvable."

                    }
                );


                return;

            }



            // ==============================================
            // APPELANT DÉJÀ OCCUPÉ
            // ==============================================

            if (
                utilisateurOccupe(
                    from
                )
            ) {

                envoyer(
                    ws,
                    {

                        type:
                            "BUSY",

                        from:
                            to,

                        message:
                            "Vous êtes déjà en appel."

                    }
                );


                return;

            }



            // ==============================================
            // DESTINATAIRE DÉJÀ OCCUPÉ
            // ==============================================

            if (
                utilisateurOccupe(
                    to
                )
            ) {

                envoyer(
                    ws,
                    {

                        type:
                            "BUSY",

                        from:
                            to,

                        to:
                            from

                    }
                );


                console.log(
                    `APPEL REFUSÉ : ${to} est occupé.`
                );


                return;

            }



            // ==============================================
            // CRÉATION DE L'APPEL
            // ==============================================

            creerAppel(
                from,
                to
            );


            // ==============================================
            // TRANSMETTRE CALLING
            // ==============================================


            // ==============================================
            // 1. TENTATIVE VIA WEBSOCKET (En direct)
            // ==============================================
            const transmis =
                envoyerAUtilisateur(
                    to,
                    {

                        type:
                            "CALLING",

                        from:
                            from,

                        to:
                            to

                    }
                );


               // ==============================================
            // 2. TENTATIVE VIA FIREBASE PUSH (En arrière-plan)
            // ==============================================
            const tokenDestinataire = fcmTokens.get(to);

            if (tokenDestinataire) {
                const payload = {
                    token: tokenDestinataire,
                    notification: {
                        title: "Appel entrant",
                        body: `${from} essaie de vous joindre !`
                    },
                    data: { 
                        type: "APPEL", 
                        appelant: from 
                    }
                };

                getMessaging().send(payload)
                    .then(response => console.log("Push envoyé avec succès :", response))
                    .catch(error => console.error("Erreur Push :", error));
            } else {
                console.log(`Aucun token FCM pour ${to}.`);
            }

            // ==============================================
            // 3. VÉRIFICATION DE L'ÉCHEC TOTAL
            // ==============================================
            // Si le message n'est pas passé en direct ET qu'on n'a pas de moyen de le réveiller par Push
            if (!transmis && !tokenDestinataire) {
                
                supprimerAppel(from, to);

                envoyer(ws, {
                    type: "ERROR",
                    message: "Impossible de joindre le correspondant (hors ligne)."
                });

                return;
            }

            console.log(`CALLING traité : ${from} -> ${to}`);
        
        }


    
        
        
        
        



        // ==================================================
        // CALL ACCEPTED
        // ==================================================

        function traiterCallAccepted(
            message
        ) {

            const from =
                identifiant;


            const to =
                String(
                    message.to || ""
                ).trim();


            if (
                to === ""
            ) {

                return;

            }



            // ==============================================
            // VÉRIFICATION APPEL
            // ==============================================

            if (
                appels.get(
                    from
                ) !== to
            ) {

                console.log(
                    `CALL_ACCEPTED ignoré : aucun appel entre ${from} et ${to}`
                );


                return;

            }



            // ==============================================
            // TRANSMISSION
            // ==============================================

            envoyerAUtilisateur(
                to,
                {

                    type:
                        "CALL_ACCEPTED",

                    from:
                        from,

                    to:
                        to

                }
            );


            console.log(
                `CALL_ACCEPTED : ${from} -> ${to}`
            );

        }



        // ==================================================
        // CALL REJECTED
        // ==================================================

        function traiterCallRejected(
            message
        ) {

            const from =
                identifiant;


            const to =
                String(
                    message.to || ""
                ).trim();


            if (
                to === ""
            ) {

                return;

            }



            envoyerAUtilisateur(
                to,
                {

                    type:
                        "CALL_REJECTED",

                    from:
                        from,

                    to:
                        to

                }
            );


            supprimerAppel(
                from,
                to
            );


            console.log(
                `CALL_REJECTED : ${from} -> ${to}`
            );

        }



        // ==================================================
        // CALL ENDED
        // ==================================================

        function traiterCallEnded(
            message
        ) {

            const from =
                identifiant;


            const to =
                String(
                    message.to || ""
                ).trim();


            if (
                to === ""
            ) {

                return;

            }



            envoyerAUtilisateur(
                to,
                {

                    type:
                        "CALL_ENDED",

                    from:
                        from,

                    to:
                        to

                }
            );


            supprimerAppel(
                from,
                to
            );


            console.log(
                `CALL_ENDED : ${from} -> ${to}`
            );

        }



        // ==================================================
        // SIGNALISATION WEBRTC
        // ==================================================

        function relayerSignalisation(
            message
        ) {

            const from =
                identifiant;


            const to =
                String(
                    message.to || ""
                ).trim();


            if (
                to === ""
            ) {

                console.log(
                    "Signalisation sans destinataire."
                );


                return;

            }



            // ==============================================
            // VÉRIFIER QUE LES DEUX UTILISATEURS
            // SONT BIEN ENSEMBLE
            // ==============================================

            if (
                appels.get(
                    from
                ) !== to
            ) {

                console.log(
                    `Signalisation refusée : ${from} -> ${to}`
                );


                return;

            }



            // ==============================================
            // COPIE DU MESSAGE
            // ==============================================

            const signal =
                {
                    ...message,

                    from:
                        from,

                    to:
                        to
                };



            // ==============================================
            // TRANSMISSION
            // ==============================================

            envoyerAUtilisateur(
                to,
                signal
            );


            console.log(
                `${message.type} : ${from} -> ${to}`
            );

        }



        // ==================================================
        // DÉCONNEXION
        // ==================================================

        function gererDeconnexion(
            id
        ) {

            const correspondant =
                appels.get(
                    id
                );



            // ==============================================
            // SI APPEL EN COURS
            // ==============================================

            if (
                correspondant
            ) {

                envoyerAUtilisateur(
                    correspondant,
                    {

                        type:
                            "CALL_ENDED",

                        from:
                            id,

                        to:
                            correspondant,

                        reason:
                            "disconnected"

                    }
                );


                supprimerAppel(
                    id,
                    correspondant
                );

            }



            // ==============================================
            // SUPPRIMER UTILISATEUR
            // ==============================================

            if (
                utilisateurs.get(
                    id
                ) === ws
            ) {

                utilisateurs.delete(
                    id
                );

            }


            console.log(
                `UTILISATEUR SUPPRIMÉ : ${id}`
            );

        }

    }

);



// ======================================================
// GESTION ERREUR SERVEUR
// ======================================================

wss.on(
    "error",
    error => {

        console.error(
            "ERREUR SERVEUR WEBSOCKET :",
            error
        );

    }
);