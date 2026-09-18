/**

* Serveur de signalisation WebSocket + Push VoIP APNs (iOS) + FCM (Android).

*

* Déployer tel quel sur Render (Web Service, Node).

* Variables d'environnement : voir .env.example

*

* Contrat client (veille.js / ios-callkit-bridge.js) :

* register-user, register-voip-token, call-user, get-offer,

* answer-call, ice-candidate, call-refused, call-end, restart-offer, pong

*/

const fs = require("fs");

const path = require("path");

const express = require("express");

const http = require("http");

const { WebSocketServer, WebSocket } = require("ws");

const apn = require("@parse/node-apn");



const app = express();

app.use((_req, res, next) => {

res.setHeader("Access-Control-Allow-Origin", "*");

next();

});

const server = http.createServer(app);

const wss = new WebSocketServer({ server });



// =========================================================

// CONFIG (env > valeurs par défaut du projet CallApp)

// =========================================================

const APP_BUNDLE_ID = process.env.APNS_BUNDLE_ID || "NGOKO.CEDRIC.fm";

const APNS_KEY_ID = process.env.APNS_KEY_ID || "48YTL8938V";

const APNS_TEAM_ID = process.env.APNS_TEAM_ID || "C55D4CX59A";

const APNS_PRODUCTION =

String(process.env.APNS_PRODUCTION || "").toLowerCase() === "true";

const FCM_PROJECT_ID = process.env.FCM_PROJECT_ID || "furthermarket-1975a";

const CALL_TTL_MS = Number(process.env.CALL_TTL_MS || 45000);

const PORT = Number(process.env.PORT || 3000);



const users = new Map(); // userId -> { ws, pushToken, voipToken }

const pendingCalls = new Map(); // callId -> { from, targetId, offer, isVideo, status, notId, timer }



// =========================================================

// APNs VoIP

// =========================================================

function loadApnKey() {

if (process.env.APNS_KEY_CONTENT) {

return process.env.APNS_KEY_CONTENT.replace(/\\n/g, "\n");

}

const p =

process.env.APNS_KEY_PATH ||

path.join(__dirname, "AuthKey_48YTL8938V.p8");

if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");

return null;

}



let apnProvider = null;

(function initApn() {

const key = loadApnKey();

if (!key) {

console.warn("⚠️ APNs : pas de clé .p8 (APNS_KEY_CONTENT ou APNS_KEY_PATH). VoIP iOS inactif.");

return;

}

try {

apnProvider = new apn.Provider({

token: { key, keyId: APNS_KEY_ID, teamId: APNS_TEAM_ID },

production: APNS_PRODUCTION,

});

console.log(

`🍏 APNs VoIP prêt | topic=${APP_BUNDLE_ID}.voip | env=${APNS_PRODUCTION ? "production" : "sandbox"}`

);

} catch (err) {

console.warn("⚠️ Init APNs échouée :", err.message);

}

})();



function maskToken(t) {

if (!t || typeof t !== "string") return "aucun";

if (t.length <= 12) return t;

return t.slice(0, 6) + "…" + t.slice(-4);

}



function invalidateVoipToken(userId, reason) {

const u = users.get(userId);

if (!u || !u.voipToken) return;

console.warn(`🗑️ Token VoIP invalidé (${reason}) pour ${userId}`);

users.set(userId, { ...u, voipToken: null });

}



function invalidateFcmToken(userId, reason) {

const u = users.get(userId);

if (!u || !u.pushToken) return;

console.warn(`🗑️ Token FCM invalidé (${reason}) pour ${userId}`);

users.set(userId, { ...u, pushToken: null });

}



async function envoyerNotificationVoipIOS(userId, voipToken, callerId, callId, isVideo, cancel) {

if (!apnProvider || !voipToken) return { sent: false };



const note = new apn.Notification();

note.topic = `${APP_BUNDLE_ID}.voip`;

note.pushType = "voip";

note.priority = 10;

note.expiry = 0;

note.collapseId = String(callId || "").slice(0, 64);



note.alert = cancel ? "Appel annulé" : "Appel entrant";

const caller = {

Username: String(callerId),

ConnectionId: String(callId),

isVideo: isVideo ? "true" : "false",

};

if (cancel) caller.CancelPush = "true";

note.payload = { data: JSON.stringify({ Caller: caller }) };



try {

const result = await apnProvider.send(note, voipToken);

const failed = result.failed || [];

console.log(

`🍏 VoIP ${cancel ? "CANCEL" : "RING"} → ${userId} sent=${result.sent.length} fail=${failed.length}`

);

for (const f of failed) {

const status = f.status;

const reason = (f.response && f.response.reason) || f.error;

console.error("❌ Échec VoIP :", status, reason);

if (

status === 410 ||

reason === "Unregistered" ||

reason === "BadDeviceToken" ||

reason === "DeviceTokenNotForTopic"

) {

invalidateVoipToken(userId, String(reason || status));

}

}

return { sent: result.sent.length > 0, failed };

} catch (error) {

console.error("❌ Exception Push VoIP :", error);

return { sent: false, error };

}

}



async function envoyerAnnulationVoipIOS(userId, voipToken, callerId, callId, isVideo) {

return envoyerNotificationVoipIOS(userId, voipToken, callerId, callId, isVideo, true);

}



// =========================================================

// FCM HTTP v1

// =========================================================

let googleAuth = null;

let fcmServiceAccount = null;



function loadServiceAccount() {

if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {

try {

return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

} catch (e) {

console.warn("⚠️ FIREBASE_SERVICE_ACCOUNT_JSON invalide");

}

}

const p =

process.env.GOOGLE_APPLICATION_CREDENTIALS ||

path.join(__dirname, "servicesAccountKey.json");

if (fs.existsSync(p)) {

try {

return JSON.parse(fs.readFileSync(p, "utf8"));

} catch (e) {

console.warn("⚠️ Impossible de lire le compte de service FCM :", e.message);

}

}

return null;

}



async function getFcmAccessToken() {

if (!fcmServiceAccount) {

fcmServiceAccount = loadServiceAccount();

if (!fcmServiceAccount) return null;

}

if (!googleAuth) {

const { GoogleAuth } = require("google-auth-library");

googleAuth = new GoogleAuth({

credentials: fcmServiceAccount,

scopes: ["https://www.googleapis.com/auth/firebase.messaging"],

});

}

const client = await googleAuth.getClient();

const tok = await client.getAccessToken();

return tok && tok.token;

}



async function sendFcmHttpV1Message(messagePayload, userId) {

try {

const accessToken = await getFcmAccessToken();

if (!accessToken) {

console.warn("⚠️ FCM inactif : pas de compte de service (FIREBASE_SERVICE_ACCOUNT_JSON).");

return null;

}

const projectId = (fcmServiceAccount && fcmServiceAccount.project_id) || FCM_PROJECT_ID;

const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

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

console.error("❌ FCM v1 :", result);

const code = result.error && result.error.details && result.error.details[0] && result.error.details[0].errorCode;

if (code === "UNREGISTERED" && userId) invalidateFcmToken(userId, "UNREGISTERED");

return null;

}

return result;

} catch (error) {

console.error("❌ REST FCM :", error);

return null;

}

}



async function envoyerNotificationPush(userId, tokenDestinataire, nomExpediteur, from, callId, isVideo, notId) {

if (!tokenDestinataire) return;

const currentNotId = notId || Math.floor(100000 + Math.random() * 900000);

const title = isVideo ? "Appel vidéo entrant" : "Appel entrant";

const body = `Appel de ${from}`;



const payload = {

token: tokenDestinataire,

data: {

title,

message: body,

type: "incoming-call",

callerId: String(from),

callerName: String(nomExpediteur || from),

callId: String(callId),

isVideo: String(!!isVideo),

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

alert: { title, body },

sound: "default",

badge: 1,

"content-available": 1,

},

},

},

};

const result = await sendFcmHttpV1Message(payload, userId);

if (result) console.log("📲 FCM incoming-call →", userId);

}



async function envoyerNotificationAppelManque(userId, tokenDestinataire, nomExpediteur, isVideo, notId) {

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

notId: String(notId || ""),

},

android: {

priority: "high",

notification: { channel_id: "incoming_calls" },

},

apns: {

headers: { "apns-priority": "10", "apns-push-type": "alert" },

payload: {

aps: {

alert: {

title: "Appel manqué",

body: `Vous avez manqué un appel ${isVideo ? "vidéo" : "audio"} de ${nomExpediteur}`,

},

sound: "default",

},

},

},

};

const result = await sendFcmHttpV1Message(payload, userId);

if (result) console.log("📵 FCM missed-call →", userId);

}



// =========================================================

// HTTP (wake Render + santé)

// =========================================================

app.get("/", (_req, res) => {

res.json({

ok: true,

service: "callapp-signaling",

users: users.size,

pendingCalls: pendingCalls.size,

apns: !!apnProvider,

apnsEnv: APNS_PRODUCTION ? "production" : "sandbox",

});

});



app.get("/health", (_req, res) => res.send("ok"));



// =========================================================

// HEARTBEAT

// =========================================================

const interval = setInterval(() => {

wss.clients.forEach((ws) => {

if (ws.isAlive === false) {

if (ws.userId && users.get(ws.userId)?.ws === ws) {

const existing = users.get(ws.userId);

users.set(ws.userId, { ...existing, ws: null });

}

return ws.terminate();

}

ws.isAlive = false;

try {

ws.ping();

ws.send(JSON.stringify({ type: "ping" }));

} catch (e) {}

});

}, 30000);



wss.on("close", () => clearInterval(interval));



function sendJson(ws, obj) {

if (ws && ws.readyState === WebSocket.OPEN) {

ws.send(JSON.stringify(obj));

return true;

}

return false;

}



function findPendingCall(fromId, targetId) {

for (const [cId, callData] of pendingCalls.entries()) {

if (

(callData.from === fromId && callData.targetId === targetId) ||

(callData.from === targetId && callData.targetId === fromId)

) {

return { cId, callData };

}

}

return null;

}



function dropPending(cId) {

const call = pendingCalls.get(cId);

if (call && call.timer) clearTimeout(call.timer);

pendingCalls.delete(cId);

}



// =========================================================

// WEBSOCKET

// =========================================================

wss.on("connection", (ws) => {

ws.isAlive = true;

ws.on("pong", () => {

ws.isAlive = true;

});



ws.on("message", async (message) => {

ws.isAlive = true;

let data;

try {

data = JSON.parse(message);

} catch (e) {

return;

}



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



if (type === "pong") return;



if (type === "register-user") {

if (!userId) return;

ws.userId = userId;

const existing = users.get(userId) || {};

if (existing.ws && existing.ws !== ws) {

existing.ws.userId = null;

try { existing.ws.terminate(); } catch (e) {}

}

users.set(userId, {

...existing,

ws,

pushToken: pushToken || existing.pushToken || null,

});

const u = users.get(userId);

console.log(

`👤 ${userId} | FCM=${maskToken(u.pushToken)} | VoIP=${maskToken(u.voipToken)} | online=${!!u.ws}`

);

sendJson(ws, { type: "registered", userId });

return;

}



if (type === "register-voip-token") {

if (!userId || !voipToken) return;

ws.userId = userId;

const existing = users.get(userId) || {};

users.set(userId, {

...existing,

ws,

voipToken: String(voipToken).toLowerCase(),

});

console.log(`🍏 Token VoIP ${maskToken(voipToken)} pour ${userId}`);

sendJson(ws, { type: "voip-registered", userId });

return;

}



if (type === "call-user") {

if (!ws.userId || !targetId || !offer) {

sendJson(ws, { type: "call-error", reason: "missing-fields" });

return;

}

const targetUser = users.get(targetId);

const newCallId = `call_${Date.now()}_${ws.userId}`;

const notificationId = data.notId || Math.floor(100000 + Math.random() * 900000);



const timer = setTimeout(() => {

const still = pendingCalls.get(newCallId);

if (still && still.status === "RINGING") {

sendJson(users.get(still.from)?.ws, { type: "call-expired", callId: newCallId });

sendJson(users.get(still.targetId)?.ws, { type: "call-expired", callId: newCallId });

if (still.voipTokenSnapshot || (users.get(targetId) || {}).voipToken) {

envoyerAnnulationVoipIOS(

targetId,

(users.get(targetId) || {}).voipToken || still.voipTokenSnapshot,

still.from,

newCallId,

still.isVideo

);

}

}

dropPending(newCallId);

}, CALL_TTL_MS);



pendingCalls.set(newCallId, {

from: ws.userId,

targetId,

offer,

isVideo: !!isVideo,

status: "RINGING",

notId: notificationId,

timer,

voipTokenSnapshot: targetUser?.voipToken || null,

});



sendJson(ws, {

type: "call-started",

callId: newCallId,

targetId,

isVideo: !!isVideo,

});



const targetWs = targetUser?.ws;

if (targetWs && targetWs.readyState === WebSocket.OPEN) {

sendJson(targetWs, {

type: "incoming-call",

callId: newCallId,

from: ws.userId,

offer,

isVideo: !!isVideo,

notId: notificationId,

});

}



if (targetUser?.voipToken) {

await envoyerNotificationVoipIOS(

targetId,

targetUser.voipToken,

ws.userId,

newCallId,

!!isVideo,

false

);

} else if (targetUser?.pushToken) {

await envoyerNotificationPush(

targetId,

targetUser.pushToken,

ws.userId,

ws.userId,

newCallId,

!!isVideo,

notificationId

);

} else if (!targetWs || targetWs.readyState !== WebSocket.OPEN) {

sendJson(ws, { type: "user-offline", targetId });

}

return;

}



if (type === "get-offer") {

const callData = pendingCalls.get(callId);

if (callData) {

sendJson(ws, {

type: "call-offer-details",

callId,

from: callData.from,

offer: callData.offer,

isVideo: callData.isVideo,

});

} else {

sendJson(ws, { type: "call-expired", callId });

}

return;

}



if (type === "answer-call") {

const found = findPendingCall(ws.userId, targetId);

if (found) found.callData.status = "ACCEPTED";

sendJson(users.get(targetId)?.ws, {

type: "call-answered",

answer,

from: ws.userId,

callId: found ? found.cId : callId || null,

});

return;

}



if (type === "ice-candidate") {

sendJson(users.get(targetId)?.ws, {

type: "ice-candidate",

candidate,

from: ws.userId,

});

return;

}



if (type === "call-refused") {

const found = findPendingCall(ws.userId, targetId);

if (found) dropPending(found.cId);

sendJson(users.get(targetId)?.ws, {

type: "call-refused",

from: ws.userId,

callId: found ? found.cId : null,

});

return;

}



if (type === "call-end") {

const found = findPendingCall(ws.userId, targetId);

if (found) {

const { cId, callData } = found;

if (callData.status === "RINGING") {

const calleeId = callData.targetId;

const callee = users.get(calleeId);

if (callee?.voipToken) {

await envoyerAnnulationVoipIOS(

calleeId,

callee.voipToken,

callData.from,

cId,

callData.isVideo

);

}

if (callee?.pushToken) {

envoyerNotificationAppelManque(

calleeId,

callee.pushToken,

callData.from,

callData.isVideo,

callData.notId

);

}

}

dropPending(cId);

}



sendJson(users.get(targetId)?.ws, {

type: "call-end",

from: ws.userId,

target: targetId,

});

return;

}



if (type === "restart-offer") {

sendJson(users.get(targetId)?.ws, {

type: "restart-offer",

offer,

from: ws.userId,

});

}

});



ws.on("close", () => {

if (ws.userId) {

const existing = users.get(ws.userId);

if (existing?.ws === ws) {

users.set(ws.userId, { ...existing, ws: null });

console.log(`❌ Socket fermé ${ws.userId} (tokens conservés)`);

}

}

});



ws.on("error", (error) => {

console.error(`❌ WS ${ws.userId || "?"} :`, error.message);

});

});



server.listen(PORT, "0.0.0.0", () => {

console.log(`🚀 Signalisation WebSocket sur :${PORT}`);

}); 

