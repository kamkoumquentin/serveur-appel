const express = require("express");
const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const apn = require("@parse/node-apn"); // Integration APNs
const { GoogleAuth } = require("google-auth-library");

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
      key: process.env.APNS_KEY_CONTENT?.replace(/\\n/g, "\n"), // Clé .p8 Apple
      keyId: process.env.APNS_KEY_ID || "48YTL8938V", // Key ID Apple
      teamId: process.env.APNS_TEAM_ID || "C55D4CX59A", // Team ID Apple
    },
    production: false, // Passer à true pour la production / App Store
  });
  console.log("🍏 Configuration APNs VoIP initialisée.");
} catch (err) {
  console.warn(
    "⚠️ Impossible d'initialiser APNs VoIP (Vérifiez la clé p8) :",
    err.message,
  );
}

const APP_BUNDLE_ID = "NGOKO.CEDRIC.fm"; // Bundle ID iOS

// Carte globale persistante (RAM) pour conserver les utilisateurs, leurs tokens FCM et VoIP
const users = new Map();

// Stockage temporaire en mémoire RAM pour les offres d'appel
const pendingCalls = new Map();

// =========================================================
// ENVOI NOTIFICATION FCM VIA HTTP REST (v1)
// =========================================================
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "fmmm-51566";

// Initialisation de l'authentification Google OAuth 2.0
const auth = new GoogleAuth({
  credentials: {
    client_email:
      process.env.FIREBASE_CLIENT_EMAIL ||
      "firebase-adminsdk-fbsvc@fmmm-51566.iam.gserviceaccount.com",
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
});

/**
 * Récupère dynamiquement un jeton d'accès OAuth 2.0 valide
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
    const accessToken = await getAccessToken();
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

// -------------------------------------------------

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

        if (users.has(userId)) {
          const existingUser = users.get(userId);
          console.log(
            `🔄 Utilisateur ${userId} déjà présent dans la Map. Mise à jour de la connexion...`,
          );

          if (existingUser.ws && existingUser.ws !== ws) {
            existingUser.ws.userId = null;
            existingUser.ws.terminate();
          }

          users.set(userId, {
            ...existingUser,
            ws: ws,
            pushToken: pushToken || existingUser.pushToken || null,
          });
        } else {
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

          ws.send(
            JSON.stringify({ type: "user-offline", targetId: targetId }),
          );
        } else {
          ws.send(
            JSON.stringify({ type: "user-offline", targetId: targetId }),
          );
        }
        return;
      }

      // 3. Récupérer l'offre SDP
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
        for (const [cId, callData] of pendingCalls.entries()) {
          if (callData.from === targetId || callData.targetId === ws.userId) {
            callData.status = "ACCEPTED";
            break;
          }
        }

        const targetUserForAnswer = users.get(targetId);
        const targetWs = targetUserForAnswer?.ws;
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          console.log("Le récepteur a décroché");
          targetWs.send(
            JSON.stringify({
              type: "call-answered",
              answer: answer,
            }),
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
        for (const [cId, callData] of pendingCalls.entries()) {
          if (callData.from === ws.userId && callData.targetId === targetId) {
            if (callData.status === "RINGING") {
              const targetUser = users.get(targetId);
              if (targetUser && targetUser.pushToken) {
                envoyerNotificationAppelManque(
                  targetUser.pushToken,
                  ws.userId,
                  callData.isVideo,
                  callData.notId,
                );
              }

              if (targetUser && targetUser.voipToken) {
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

      // 8. Statut du micro
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

      // 10. Demande de passage vidéo
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

      // 11. Réponse passage vidéo
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
 * Notification Push FCM v1 "Appel Entrant"
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
  if (!tokenDestinataire) return;

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
        { title: "Refuser", callback: "reject", foreground: false },
        { title: "Accepter", callback: "accept", foreground: true },
      ]),
    },
    android: { priority: "high" },
    apns: {
      headers: { "apns-priority": "10", "apns-push-type": "alert" },
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
 * Notification Push FCM v1 "Appel Manqué"
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
    data: {
      type: "missed-call",
      callerId: String(nomExpediteur),
      isVideo: String(isVideo),
      notId: String(notId),
    },
    android: { priority: "high" },
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

  note.alert = "Appel entrant";
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
  } catch (error) {
    console.error("❌ Erreur Push VoIP APNs :", error);
  }
}

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
