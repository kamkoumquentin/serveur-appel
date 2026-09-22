const express = require("express");
const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const apn = require("@parse/node-apn"); // Integration APNs

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// =========================================================
// CONFIGURATION APPLE PUSH NOTIFICATION (APNs VoIP / CallKit)
// =========================================================
let apnProvider = null;
try {
  apnProvider = new apn.Provider({
    token: {
      key:process.env.APNS_KEY_CONTENT, // Chemin vers la clé p8
      keyId: "48YTL8938V", // Key ID Apple
      teamId: "C55D4CX59A", // Team ID Apple
    },
    production: false, // Passer à true pour la production / App Store
  });
  console.log("🍏 Configuration APNs VoIP initialisée.");
} catch (err) {
  console.warn(
    "⚠️ Impossible d'initialiser APNs VoIP (Vérifiez le fichier AuthKey p8) :",
    err.message,
  );
}

const APP_BUNDLE_ID = "NGOKO.CEDRIC.fm"; // Remplacez par votre Bundle ID iOS

// Carte globale persistante (RAM) pour conserver les utilisateurs, leurs tokens FCM et VoIP
const users = new Map();

// Stockage temporaire en mémoire RAM pour les offres d'appel (évite de surcharger FCM)
const pendingCalls = new Map();

// =========================================================
// ENVOI NOTIFICATION FCM VIA HTTP REST (v1)
// =========================================================


const { GoogleAuth } = require("google-auth-library");
const path = require("path");

// Chargement sécurisé du fichier de compte de service
const serviceAccount = require(process.env.APNS_KEY_CONTENT);
const PROJECT_ID = serviceAccount.project_id; // Récupère l'ID exact du projet dynamiquement

// Initialisation de l'authentification Google OAuth 2.0
const auth = new GoogleAuth({
  keyFile: path.join(__dirname, "serviceAccountKey.json"),
  scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
});

const auth = new GoogleAuth({
  credentials: {
    client_email: "firebase-adminsdk-fbsvc@fmmm-51566.iam.gserviceaccount.com",
    private_key: process.env.APNS_KEY_CONTENT,
  },
  scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
});

/**
 * Récupère dynamiquement un jeton d'accès OAuth 2.0 valide et à jour
 */
async function getAccessToken() {
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token;
}

/**
 * Fonction générique pour envoyer un message HTTP v1 REST à FCM
 */
async function sendFcmHttpV1Message(messagePayload) {
  try {
    const accessToken = await getAccessToken(); // Récupération dynamique sans code en dur
    const url = `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: messagePayload }),
    });

    const result = await response.json();
    if (!response.ok) {
      console.error("❌ Erreur API FCM v1 :", result);
      return null;
    }
    return result;
  } catch (error) {
    console.error("❌ Erreur REST FCM :", error);
    return null;
  }
}

//-------------------------------------------------

app.get("/", (req, res) => {
  res.send("Serveur WebSocket actif");
});

// =========================================================
// HEARTBEAT (Garde les connexions actives)
// =========================================================
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log(`⚠️ Client inactif expulsé : ${ws.userId || "Inconnu"}`);
      if (ws.userId && users.get(ws.userId)?.ws === ws) {
        // Déconnexion : Passe le socket à null sans supprimer l'utilisateur de la Map
        const existingUser = users.get(ws.userId);
        users.set(ws.userId, {
          ...existingUser,
          ws: null,
        });
      }
      return ws.terminate();
    }

    ws.isAlive = false;

    try {
      ws.ping();
      ws.send(JSON.stringify({ type: "ping" }));
    } catch (e) {
      console.error("Erreur envoi ping :", e);
    }
  });
}, 30000);

wss.on("close", () => {
  clearInterval(interval);
});

// =========================================================
// GESTION DES CONNEXIONS WEBSOCKET
// =========================================================
wss.on("connection", (ws) => {
  ws.isAlive = true;

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
        voipToken,
        targetId,
        offer,
        answer,
        candidate,
        isVideo,
        callId,
        accepted,
        muted,
      } = data;

      if (type === "pong") {
        return;
      }

      console.log(
        `📩 Message reçu | type=${type} | de=${ws.userId || "?"} | targetId=${targetId || "-"} | callId=${callId || "-"}`,
      );

      // 1. Enregistrement / Reconnexion de l'utilisateur
      if (type === "register-user") {
        ws.userId = userId;

        // VÉRIFICATION DE LA PRÉSENCE DANS LA MAP
        if (users.has(userId)) {
          const existingUser = users.get(userId);
          console.log(
            `🔄 Utilisateur ${userId} déjà présent dans la Map. Mise à jour de la connexion...`,
          );

          // Fermer l'ancien socket s'il existe et qu'il est encore actif
          if (existingUser.ws && existingUser.ws !== ws) {
            existingUser.ws.userId = null;
            existingUser.ws.terminate();
          }

          // Mise à jour : Nouveau socket + mise à jour du token
          users.set(userId, {
            ...existingUser,
            ws: ws,
            pushToken: pushToken || existingUser.pushToken || null,
          });
        } else {
          // Nouvel utilisateur
          console.log(
            `✨ Nouvel utilisateur enregistré dans la Map : ${userId}`,
          );
          users.set(userId, {
            ws: ws,
            pushToken: pushToken || null,
            voipToken: null,
          });
        }

        const currentUser = users.get(userId);
        console.log(
          `👤 Statut : ${userId} | Token FCM : ${currentUser.pushToken || "Aucun"} | Token VoIP : ${currentUser.voipToken || "Aucun"}`,
        );
        console.log(
          "👥 Liste globale des utilisateurs enregistrés :",
          Array.from(users.keys()),
        );

        ws.send(
          JSON.stringify({
            type: "registered",
            userId: userId,
          }),
        );
        return;
      }

      // 1b. Enregistrement spécifique du Token APNs VoIP (iOS CallKit)
      if (type === "register-voip-token") {
        ws.userId = userId;
        const existingUser = users.get(userId) || {};
        users.set(userId, {
          ...existingUser,
          ws: ws,
          voipToken: voipToken || existingUser.voipToken || null,
        });

        console.log(`🍏 Token VoIP iOS enregistré pour : ${userId}`);
        return;
      }

      // 2. Appel de l'utilisateur ('call-user')
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

          // Envoi Push APNs VoIP si l'utilisateur possède un token VoIP iOS
          if (targetUser?.voipToken) {
            await envoyerNotificationVoipIOS(
              targetUser.voipToken,
              ws.userId,
              newCallId,
              isVideo,
            );
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
          }
        } else if (targetUser?.voipToken || targetUser?.pushToken) {
          if (targetUser.voipToken) {
            await envoyerNotificationVoipIOS(
              targetUser.voipToken,
              ws.userId,
              newCallId,
              isVideo,
            );
          } else if (targetUser.pushToken) {
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
      if (type === "answer-call") {
        // Retrouver l'appel associé et passer son statut à ACCEPTED
        for (const [cId, callData] of pendingCalls.entries()) {
          if (callData.from === targetId || callData.targetId === ws.userId) {
            callData.status = "ACCEPTED";
            break;
          }
        }

        const targetUserForAnswer = users.get(targetId);
        const targetWs = targetUserForAnswer?.ws;
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          console.log("le recepteur a decrocher");
          targetWs.send(
            JSON.stringify({
              type: "call-answered",
              answer: answer,
            }),
          );
        } else if (!targetUserForAnswer) {
          console.warn(
            `⚠️ answer-call : aucun utilisateur "${targetId}" trouvé dans la Map (émetteur introuvable).`,
          );
        } else {
          console.warn(
            `⚠️ answer-call : émetteur "${targetId}" trouvé mais son socket est fermé (readyState=${targetWs?.readyState}). La notification "call-answered" n'a pas pu être envoyée.`,
          );
        }
        return;
      }

      // 5. Échanger les candidats ICE
      if (type === "ice-candidate") {
        const targetWs = users.get(targetId)?.ws;
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(
            JSON.stringify({
              type: "ice-candidate",
              candidate: candidate,
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

              if (targetUser && targetUser.voipToken) {
                // Annuler le push token et fermer le callkit
                envoyerAnnulationVoipIOS(targetUser.voipToken, ws.userId, cId);
              }
            }
            pendingCalls.delete(cId);
            break;
          }
        }

        const targetUser = users.get(targetId);
        const targetWs = targetUser?.ws;

        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(
            JSON.stringify({
              type: type,
              from: ws.userId,
              target: targetId,
            }),
          );
        }
      }

      // 8. Informer le correspondant du statut du micro sans renégocier WebRTC
      if (type === "microphone-status") {
        const targetWs = users.get(targetId)?.ws;
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(
            JSON.stringify({
              type: "microphone-status",
              muted: muted === true,
            }),
          );
        }
        return;
      }

      // 9. Restart ICE
      // 9. Restart ICE ou passage audio -> vidéo
      if (type === "restart-offer") {
        const targetWs = users.get(targetId)?.ws;
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(
            JSON.stringify({
              type: "restart-offer",
              offer: offer,
              isVideoUpgrade: !!isVideo,
            }),
          );
        }
        return;
      }

      // 10. Demande de confirmation avant de passer en appel vidéo
      if (type === "video-upgrade-request") {
        const targetWs = users.get(targetId)?.ws;
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(
            JSON.stringify({
              type: "video-upgrade-request",
              from: ws.userId,
            }),
          );
        }
        return;
      }

      // 11. Réponse à la demande (accepté ou refusé)
      if (type === "video-upgrade-response") {
        const targetWs = users.get(targetId)?.ws;
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(
            JSON.stringify({
              type: "video-upgrade-response",
              accepted: !!accepted,
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
          ...existingUser,
          ws: null,
        });
        console.log(
          `❌ Socket déconnecté pour ${ws.userId} (Utilisateur et Tokens conservés)`,
        );
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
 * Fonction d'envoi de notification "Appel Entrant" via HTTP REST Bearer FCM v1
 */
async function envoyerNotificationPush(
  tokenDestinataire,
  nomExpediteur,
  texteMessage,
  from,
  callId,
  isVideo = false,
  notId = null,
) {
  if (!tokenDestinataire) {
    console.warn(
      "⚠️ Impossible d'envoyer la notification : Aucun token FCM fourni.",
    );
    return;
  }

  const currentNotId = notId || Math.floor(100000 + Math.random() * 900000);

  const payload = {
    token: tokenDestinataire,
    data: {
      title: isVideo ? "📹 Appel vidéo entrant" : "📞 Appel entrant",
      message: texteMessage || `Appel de ${from}`,
      type: "incoming-call",
      callerId: String(from),
      callerName: String(nomExpediteur || from),
      callId: String(callId),
      isVideo: String(isVideo),
      notId: String(currentNotId),
      actions: JSON.stringify([
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
      ]),
    },
    android: {
      priority: "high",
    },
    apns: {
      headers: {
        "apns-priority": "10",
        "apns-push-type": "alert",
      },
      payload: {
        aps: {
          alert: {
            title: isVideo ? "📹 Appel vidéo entrant" : "📞 Appel entrant",
            body: texteMessage || `Appel de ${from}`,
          },
          sound: "default",
          badge: 1,
          "content-available": 1,
        },
      },
    },
  };

  const result = await sendFcmHttpV1Message(payload);
  if (result) {
    console.log("📲 Notification Push FCM envoyée avec succès :", result.name);
  }
}

/**
 * Fonction d'envoi de notification "Appel Manqué" via HTTP REST Bearer FCM v1
 */
async function envoyerNotificationAppelManque(
  tokenDestinataire,
  nomExpediteur,
  isVideo,
  notId,
) {
  if (!tokenDestinataire) return;

  const payload = {
    token: tokenDestinataire,
    // Pas de champ "notification" de premier niveau : si l'app Android est en
    // arrière-plan ou tuée, un message hybride notification+data est affiché
    // directement par le système et n'invoque JAMAIS onMessageReceived(), donc
    // la notification d'appel entrant ne serait jamais annulée. En restant en
    // data-only (comme pour "incoming-call"), CallMessagingService reçoit
    // toujours ce message et gère lui-même l'annulation + l'affichage.
    data: {
      type: "missed-call",
      callerId: String(nomExpediteur),
      isVideo: String(isVideo),
      notId: String(notId),
    },
    android: {
      priority: "high",
    },

    apns: {
      headers: {
        "apns-priority": "10",
        "apns-push-type": "alert",
        "apns-collapse-id": String(notId),
      },
      payload: {
        aps: {
          alert: {
            title: "Appel manqué",
            body: `Vous avez manqué un appel ${isVideo ? "vidéo" : "audio"} de ${nomExpediteur}`,
          },
          sound: "default",
          badge: 1,
        },
      },
    },
  };

  const result = await sendFcmHttpV1Message(payload);
  if (result) {
    console.log(`📵 Notification Appel Manqué envoyée pour notId : ${notId}`);
  }
}

// =========================================================
// ENVOI PUSH VOIP APPLE DIRECT (iOS CallKit)
// =========================================================
async function envoyerNotificationVoipIOS(
  voipToken,
  callerId,
  callId,
  isVideo = false,
) {
  if (!apnProvider || !voipToken) return;

  const note = new apn.Notification();
  note.topic = `${APP_BUNDLE_ID}.voip`;
  note.priority = 10;
  note.pushType = "voip";

  // CordovaCall.m (didReceiveIncomingPushWithPayload) lit :
  //   payload["aps"]["alert"]  -> doit être une string non-nil (sinon crash)
  //   payload["data"]          -> doit être une STRING contenant du JSON,
  //                                pas un objet imbriqué directement.
  note.alert = "Appel entrant"; // valeur peu importe le contenu, juste non-nil
  note.payload = {
    data: JSON.stringify({
      Caller: {
        Username: String(callerId),
        ConnectionId: String(callId),
        isVideo: !!isVideo,
      },
    }),
  };

  try {
    const result = await apnProvider.send(note, voipToken);
    console.log(
      "🍏 Push VoIP envoyé :",
      result.sent.length,
      "| échecs :",
      result.failed.length,
    );
    if (result.failed.length > 0) {
      console.error(
        "❌ Détail échec VoIP :",
        JSON.stringify(result.failed, null, 2),
      );
    }
  } catch (error) {
    console.error("❌ Erreur Push VoIP APNs :", error);
  }
}

// Notification d'annulation pour fermer l'écran CallKit si l'émetteur raccroche
async function envoyerAnnulationVoipIOS(voipToken, callerId, callId) {
  if (!apnProvider || !voipToken) return;

  const note = new apn.Notification();
  note.topic = `${APP_BUNDLE_ID}.voip`;
  note.priority = 10;
  note.pushType = "voip";

  note.alert = "Appel annulé";
  note.payload = {
    data: JSON.stringify({
      Caller: {
        Username: String(callerId),
        ConnectionId: String(callId),
        CancelPush: "true",
      },
    }),
  };

  try {
    await apnProvider.send(note, voipToken);
  } catch (error) {
    console.error("❌ Erreur annulation VoIP APNs :", error);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`🚀 Serveur WebSocket actif sur le port ${PORT}`),
);
