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
      key:process.env.APNS_KEY_CONTENT,
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

const RING_TIMEOUT_MS = Number(process.env.RING_TIMEOUT_MS) || 30000;
const missedCallsQueue = new Map(); // userId -> [{callId, from, isVideo, at, reason}], max 50, 7 jours
const MISSED_CALL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours
const MAX_MISSED_CALLS = 50;

function sendIfOpen(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function findCall(fromId, toId, statuses) {
  let lastMatch = null;
  for (const [id, call] of pendingCalls.entries()) {
    if (call.from === fromId && call.targetId === toId) {
      if (!statuses || statuses.includes(call.status)) {
        lastMatch = { id, call };
      }
    }
  }
  return lastMatch;
}

function queueMissedCall(userId, entry) {
  if (!userId) return;
  let queue = missedCallsQueue.get(userId) || [];
  const now = Date.now();
  queue = queue.filter(
    (item) => now - item.at < MISSED_CALL_TTL_MS && item.callId !== entry.callId,
  );
  queue.push(entry);
  if (queue.length > MAX_MISSED_CALLS) {
    queue = queue.slice(-MAX_MISSED_CALLS);
  }
  missedCallsQueue.set(userId, queue);
}

function sendPendingMissedCalls(userId, ws) {
  if (!userId) return;
  let queue = missedCallsQueue.get(userId);
  if (!queue || queue.length === 0) return;
  const now = Date.now();
  queue = queue.filter((item) => now - item.at < MISSED_CALL_TTL_MS);
  if (queue.length === 0) {
    missedCallsQueue.delete(userId);
    return;
  }
  missedCallsQueue.set(userId, queue);
  sendIfOpen(ws, {
    type: "missed-calls",
    calls: queue,
  });
}

function acknowledgeMissedCalls(userId, callIds) {
  if (!userId || !Array.isArray(callIds) || callIds.length === 0) return;
  const queue = missedCallsQueue.get(userId);
  if (!queue || queue.length === 0) return;
  const idSet = new Set(callIds);
  const remaining = queue.filter((item) => !idSet.has(item.callId));
  if (remaining.length === 0) {
    missedCallsQueue.delete(userId);
  } else {
    missedCallsQueue.set(userId, remaining);
  }
}

function declareMissedCall(callId, reason) {
  const call = pendingCalls.get(callId);
  if (!call || call.status !== "RINGING") {
    return;
  }
  if (call.ringTimer) {
    clearTimeout(call.ringTimer);
    call.ringTimer = null;
  }
  call.status = reason === "timeout" ? "MISSED" : "CANCELED";

  const entry = {
    callId,
    from: call.from,
    isVideo: call.isVideo,
    at: Date.now(),
    reason,
  };

  queueMissedCall(call.targetId, entry);

  const targetUser = users.get(call.targetId);
  sendIfOpen(targetUser?.ws, {
    type: "call-missed",
    ...entry,
  });

  if (targetUser && targetUser.pushToken) {
    envoyerNotificationAppelManque(
      targetUser.pushToken,
      call.from,
      call.isVideo,
      call.notId,
    );
  }

  if (reason === "timeout") {
    const callerUser = users.get(call.from);
    sendIfOpen(callerUser?.ws, {
      type: "call-no-answer",
      callId,
      targetId: call.targetId,
    });
  }
}

// =========================================================
// ENVOI NOTIFICATION FCM VIA HTTP REST (v1)
// =========================================================
async function sendFcmHttpV1Message(messagePayload) {
  try {
    const accessToken =
      "ya29.a0AdMD6EgvncMrEPMh0JgPCwJx2ysZ3dwleiHyTGMXdJnSYxDlcdLwaJwpx4iNhD3W2qDf0ttt0ICIABztuk6cJoXgUdETR1drEYSS6fNOyIu85ldWLJrWeV_TNvjTvOPVr4kxgKgOaNlZBuctqHcwqN2Vj-a-cwrp8LWn6u9njkZfI_YRz9qnznCcGgI4Sg1RLNswJgMaCgYKAUASARISFQHGX2Misxfrryu9mxWnfyPRE11WVg0206";
    const url =
      "https://fcm.googleapis.com/v1/projects/furthermarket-1975a/messages:send";

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

        console.log(`✅ [ÉTAPE 1/6 serveur] register-user traité pour ${userId}, accusé 'registered' envoyé.`);
        ws.send(
          JSON.stringify({
            type: "registered",
            userId: userId,
          }),
        );
        sendPendingMissedCalls(userId, ws);
        return;
      }

      if (type === "missed-calls-ack") {
        acknowledgeMissedCalls(ws.userId, data.callIds);
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
          ringTimer: setTimeout(
            () => declareMissedCall(newCallId, "timeout"),
            RING_TIMEOUT_MS,
          ),
        });

        // ✅ Généreux volontairement (2 minutes) : entre la sonnerie CallKit (qui peut
        // durer longtemps si le destinataire met du temps à décrocher) et le temps de
        // reconnexion WebSocket côté client (jusqu'à ~30s si le serveur était en veille),
        // 45s était trop court et faisait expirer l'appel avant même que get-offer arrive.
        setTimeout(() => pendingCalls.delete(newCallId), 120000);

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
        if (callData && (callData.status === "RINGING" || callData.status === "ACCEPTED")) {
          console.log(
            `📨 [ÉTAPE 2/6 serveur] get-offer trouvé pour callId=${callId} (from=${callData.from}, status=${callData.status}) → envoi de call-offer-details à ${ws.userId || "?"}`,
          );
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
          console.warn(
            `⚠️ [ÉTAPE 2/6 serveur] get-offer : callId=${callId} introuvable ou non valide dans pendingCalls (expiré ou jamais enregistré). pendingCalls actuels :`,
            Array.from(pendingCalls.keys()),
          );
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
        console.log(`📤 [ÉTAPE 6/6 serveur] answer-call reçu de ${ws.userId || "?"} pour targetId=${targetId}.`);

        const answered = findCall(targetId, ws.userId);
        if (answered) {
          if (answered.call.status === "MISSED" || answered.call.status === "CANCELED") {
            sendIfOpen(ws, { type: "call-expired", callId: answered.id });
            return;
          }
          if (answered.call.status === "RINGING") {
            if (answered.call.ringTimer) {
              clearTimeout(answered.call.ringTimer);
              answered.call.ringTimer = null;
            }
            answered.call.status = "ACCEPTED";
          }
        }

        const targetUserForAnswer = users.get(targetId);
        const targetWs = targetUserForAnswer?.ws;
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          console.log("✅ [ÉTAPE 6/6 serveur] le recepteur a decrocher — call-answered transmis à l'émetteur.");
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
        const refused = findCall(targetId, ws.userId, ["RINGING"]);
        if (refused) {
          if (refused.call.ringTimer) {
            clearTimeout(refused.call.ringTimer);
            refused.call.ringTimer = null;
          }
          refused.call.status = "REFUSED";
        }

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
        const live = findCall(ws.userId, targetId, ["RINGING", "ACCEPTED"]);
        if (live) {
          if (live.call.status === "RINGING") {
            declareMissedCall(live.id, "cancelled");
          } else {
            pendingCalls.delete(live.id);
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

      // 8. Restart ICE
      if (type === "restart-offer") {
        const targetWs = users.get(targetId)?.ws;
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(
            JSON.stringify({
              type: "restart-offer",
              offer: offer,
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
    notification: {
      title: "Appel manqué",
      body: `Vous avez manqué un appel ${isVideo ? "vidéo" : "audio"} de ${nomExpediteur}`,
    },
    data: {
      type: "missed-call",
      callerId: String(nomExpediteur),
      notId: String(notId),
    },
    android: {
      priority: "high",
      notification: {
        channel_id: "incoming_calls",
      },
    },

    apns: {
      headers: {
        "apns-priority": "10",
        "apns-push-type": "alert",
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
        // ✅ Sans ça, CordovaCall.m (didReceiveIncomingPushWithPayload) ne peut pas
        // savoir si l'appel entrant est vidéo : CXCallUpdate.hasVideo resterait
        // toujours à false, et iOS ne déclencherait jamais l'écran de déverrouillage
        // automatique avant de lancer l'app (comportement natif CallKit réservé aux
        // appels avec hasVideo=true).
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
async function envoyerAnnulationVoipIOS(voipToken, callerId) {
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
