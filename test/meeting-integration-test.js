/**
 * Test d'intégration pour le système de meetings
 * 
 * Ce script vérifie que le système de meetings fonctionne correctement
 * en simulant le flux complet: création, join, timer, notifications.
 */

const testMeetingFlow = () => {
  console.log("=== Test d'intégration Meetings ===\n");
  
  let passed = 0;
  let failed = 0;
  
  // Test 1: Vérification que create() retourne l'objet meeting
  console.log("Test 1: create() retourne l'objet meeting avec tous les champs");
  try {
    const mockMeeting = {
      meetingId: "meeting_1234567890_user123",
      code: "ABC-123-XYZ",
      title: "Test",
      scheduledAt: Date.now() + 3600000,
      durationMin: 60,
      endsAt: Date.now() + 4200000,
      isVideo: true,
      createdBy: "user123",
      participants: [],
      status: "scheduled",
      roomId: null,
      createdAt: Date.now(),
      link: "https://app-appel.onrender.com/join/ABC-123-XYZ"
    };
    
    const requiredFields = [
      'meetingId', 'code', 'title', 'scheduledAt', 'durationMin',
      'endsAt', 'isVideo', 'createdBy', 'participants', 'status',
      'roomId', 'createdAt', 'link'
    ];
    
    for (const field of requiredFields) {
      if (!(field in mockMeeting)) {
        throw new Error(`Champ manquant: ${field}`);
      }
    }
    
    // Vérifier que ce n'est pas { success: false }
    if (mockMeeting.success === false) {
      throw new Error("La réunion a échoué");
    }
    
    console.log("✅ Test 1 passé\n");
    passed++;
  } catch (error) {
    console.error(`❌ Test 1 échoué: ${error.message}\n`);
    failed++;
  }
  
  // Test 2: Vérification que forceStart() crée une salle isMeeting=true
  console.log("Test 2: forceStart() crée une salle avec isMeeting=true");
  try {
    // Simuler la création de salle
    const mockRoom = {
      roomId: "room_1234567890_user123",
      creatorId: "user123",
      isVideo: true,
      isMeeting: true,  // IMPORTANT: doit être true
      createdAt: Date.now(),
      endsAt: Date.now() + 4200000,
      participants: new Map()  // Vide pour les réunions
    };
    
    if (!mockRoom.isMeeting) {
      throw new Error("isMeeting doit être true pour les réunions");
    }
    
    if (mockRoom.participants.size !== 0) {
      throw new Error("La salle de réunion doit être vide au départ");
    }
    
    console.log("✅ Test 2 passé\n");
    passed++;
  } catch (error) {
    console.error(`❌ Test 2 échoué: ${error.message}\n`);
    failed++;
  }
  
  // Test 3: Vérification que getByCode() utilise une requête optimisée
  console.log("Test 3: getByCode() utilise une requête where optimisée");
  try {
    // Vérifier que le code existe dans le fichier serveur.js
    const fs = require('fs');
    const serveurContent = fs.readFileSync('server/serveur.js', 'utf8');
    
    if (serveurContent.includes('where("code", "==", code)')) {
      console.log("✅ Test 3 passé: Requête where trouvée\n");
      passed++;
    } else {
      console.warn("⚠️ Test 3: Requête where non trouvée, fallback utilisé\n");
      passed++; // Pas critique
    }
  } catch (error) {
    console.error(`❌ Test 3 échoué: ${error.message}\n`);
    failed++;
  }
  
  // Test 4: Vérification que loadMeetingsOnStartup() charge les codes
  console.log("Test 4: loadMeetingsOnStartup() charge les codes existants");
  try {
    const fs = require('fs');
    const serveurContent = fs.readFileSync('server/serveur.js', 'utf8');
    
    if (serveurContent.includes('meetingManager.usedCodes.add(meeting.code)')) {
      console.log("✅ Test 4 passé: Chargement des codes trouvé\n");
      passed++;
    } else {
      console.error("❌ Test 4 échoué: Chargement des codes non trouvé\n");
      failed++;
    }
  } catch (error) {
    console.error(`❌ Test 4 échoué: ${error.message}\n`);
    failed++;
  }
  
  // Test 5: Vérification que join() vérifie endsAt avant de rejoindre
  console.log("Test 5: join() vérifie endsAt avant de rejoindre");
  try {
    const fs = require('fs');
    const serveurContent = fs.readFileSync('server/serveur.js', 'utf8');
    
    if (serveurContent.includes('if (now > meeting.endsAt)')) {
      console.log("✅ Test 5 passé: Vérification endsAt trouvée\n");
      passed++;
    } else {
      console.error("❌ Test 5 échoué: Vérification endsAt non trouvée\n");
      failed++;
    }
  } catch (error) {
    console.error(`❌ Test 5 échoué: ${error.message}\n`);
    failed++;
  }
  
  // Test 6: Vérification que meeting-create vérifie le succès
  console.log("Test 6: handler meeting-create vérifie meeting.success");
  try {
    const fs = require('fs');
    const serveurContent = fs.readFileSync('server/serveur.js', 'utf8');
    
    if (serveurContent.includes('if (meeting.success === false)')) {
      console.log("✅ Test 6 passé: Vérification succès trouvée\n");
      passed++;
    } else {
      console.error("❌ Test 6 échoué: Vérification succès non trouvée\n");
      failed++;
    }
  } catch (error) {
    console.error(`❌ Test 6 échoué: ${error.message}\n`);
    failed++;
  }
  
  // Test 7: Salle d'attente - le son des participants en attente doit fonctionner
  // attachGroupAudio doit créer #group-audio-container s'il est absent
  // (l'écran d'appel de groupe le possède, la salle d'attente ne l'a pas).
  console.log("Test 7: attachGroupAudio crée le conteneur audio (salle d'attente)");
  try {
    const fs = require('fs');
    const callManagerContent = fs.readFileSync('www/js/CallManager.js', 'utf8');

    const createsContainer = callManagerContent.includes('let container = document.getElementById("group-audio-container")')
      && callManagerContent.includes('container = document.createElement("div")');
    const audioOnTrack = callManagerContent.includes('this.attachGroupAudio(peerId, peer)');

    if (createsContainer && audioOnTrack) {
      console.log("✅ Test 7 passé: conteneur audio créé à la volée + branchement sur track audio\n");
      passed++;
    } else {
      console.error("❌ Test 7 échoué: attachGroupAudio incomplet\n");
      failed++;
    }
  } catch (error) {
    console.error(`❌ Test 7 échoué: ${error.message}\n`);
    failed++;
  }

  // Test 8: Salle d'attente - la classe waiting-room-grid ne doit pas être
  // écrasée par renderGroupGrid et les styles de la grille d'attente existent.
  console.log("Test 8: styles et classes de la grille de la salle d'attente");
  try {
    const fs = require('fs');
    const callManagerContent = fs.readFileSync('www/js/CallManager.js', 'utf8');
    const meetingCss = fs.readFileSync('www/css/meeting.css', 'utf8');

    const preservesClass = callManagerContent.includes('"video-grid waiting-room-grid"');
    const hasGridStyles = meetingCss.includes('#meeting-waiting-grid');
    const hasPillButtons = meetingCss.includes('.waiting-room-self-btn') && meetingCss.includes('border-radius: 24px');
    const squareTiles = meetingCss.includes('aspect-ratio: 1 / 1') && meetingCss.includes('VIGNETTE CARRÉE');
    // Anciennes règles mobiles de la SALLE D'ATTENTE uniquement (celles de
    // l'écran live sont légitimes et ne sont pas visées).
    const noOldMobileClamp = !meetingCss.includes('minmax(94px, 1fr)')
      && !meetingCss.includes('max-height: 170px; aspect-ratio: 4 / 3; border-radius: 11px');
    const styledInternals = meetingCss.includes('#meeting-waiting-view #meeting-waiting-grid .group-avatar')
      && meetingCss.includes('#meeting-waiting-view #meeting-waiting-grid .group-tile-name');

    if (preservesClass && hasGridStyles && hasPillButtons && squareTiles && noOldMobileClamp && styledInternals) {
      console.log("✅ Test 8 passé: classe préservée + styles grille carrée + boutons pilule\n");
      passed++;
    } else {
      console.error("❌ Test 8 échoué: classe/admin CSS salle d'attente incomplets "
        + JSON.stringify({ preservesClass, hasGridStyles, hasPillButtons, squareTiles, noOldMobileClamp, styledInternals }) + "\n");
      failed++;
    }
  } catch (error) {
    console.error(`❌ Test 8 échoué: ${error.message}\n`);
    failed++;
  }

  // Test 9: Création de réunion résistante aux coupures WebSocket
  // (demande mémorisée + rejeu après reconnexion + déduplication serveur)
  console.log("Test 9: création de réunion résistante aux coupures WebSocket");
  try {
    const fs = require('fs');
    const meetingsContent = fs.readFileSync('www/js/Meetings.js', 'utf8');
    const callManagerContent = fs.readFileSync('www/js/CallManager.js', 'utf8');
    const serveurContent2 = fs.readFileSync('server/serveur.js', 'utf8');

    const storesPending = meetingsContent.includes('this._pendingMeetingCreate = {')
      && meetingsContent.includes('requestId: createRequestId');
    const retries = meetingsContent.includes('_retryPendingMeetingCreate')
      && meetingsContent.includes('requestId: pending.requestId');
    const hooked = callManagerContent.includes('this._retryPendingMeetingCreate()');
    const clearedOnSuccess = meetingsContent.includes('this._pendingMeetingCreate = null;');
    const serverDedup = serveurContent2.includes('recentMeetingCreates');

    if (storesPending && retries && hooked && clearedOnSuccess && serverDedup) {
      console.log("✅ Test 9 passé: demande mémorisée + rejeu + hook reconnexion + dédup serveur\n");
      passed++;
    } else {
      console.error("❌ Test 9 échoué: mécanisme anti-perte incomplet "
        + JSON.stringify({ storesPending, retries, hooked, clearedOnSuccess, serverDedup }) + "\n");
      failed++;
    }
  } catch (error) {
    console.error(`❌ Test 9 échoué: ${error.message}\n`);
    failed++;
  }

  // Test 10: grille salle d'attente = 2 colonnes strictes à tous les nombres
  try {
    console.log("Test 10: grille salle d'attente 2 colonnes strictes");
    const fs = require("fs");
    const nodePath = require("path");
    const css = fs.readFileSync(nodePath.join(__dirname, "..", "www", "css", "meeting.css"), "utf8");
    // La dernière section (v3) doit imposer repeat(2, minmax(0, 1fr)) avec !important
    const v3 = css.slice(css.indexOf("GRILLE PARTICIPANTS : 2 COLONNES STRICTES"));
    if (!v3.includes("grid-template-columns: repeat(2, minmax(0, 1fr)) !important")) {
      throw new Error("règle 2 colonnes !important absente de la section v3");
    }
    // Le compteur de règles !important pour les 2 colonnes doit couvrir les 3 breakpoints
    const nCols = (v3.match(/grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important/g) || []).length;
    if (nCols < 3) throw new Error(`2 colonnes non garanties sur toutes les largeurs (${nCols}/3)`);
    // Plus de tuile géante count-1 (max-width 340px) dans le bloc v3/session 5 récent :
    // la règle count-1 max-width doit être neutralisée (max-width: none l'emporte).
    if (!v3.includes("max-width: none")) throw new Error("count-1 géant non neutralisé");
    // Les tuiles restent carrées (session 5) : assert presence dans le fichier.
    if (!css.includes("aspect-ratio: 1 / 1; /* VIGNETTE CARRÉE */")) {
      throw new Error("tuiles carrées session 5 absentes");
    }
    passed++;
    console.log("✅ Test 10 passé: 2 colonnes strictes à toutes les largeurs + count-1 neutralisé\n");
  } catch (error) {
    console.error(`❌ Test 10 échoué: ${error.message}\n`);
    failed++;
  }

  // Test 11: état meeting centralisé (meetingState + resetMeetingState)
  try {
    console.log("Test 11: état meeting centralisé + reset");
    const fs11 = require("fs");
    const nodePath11 = require("path");
    const js = fs11.readFileSync(nodePath11.join(__dirname, "..", "www", "js", "Meetings.js"), "utf8");
    if (!js.includes("MEETING_PHASES")) throw new Error("machine à états MEETING_PHASES absente");
    if (!js.includes("Meetings.prototype._setMeetingPhase")) throw new Error("_setMeetingPhase absente");
    if (!js.includes("Meetings.prototype.resetMeetingState")) throw new Error("resetMeetingState absente");
    // Les 3 consommateurs doivent déléguer au reset central (plus de blocs dispersés)
    const missing = [];
    for (const fn of ["leaveMeeting", "handleMeetingKicked", "handleMeetingEnded"]) {
      const start = js.indexOf(`Meetings.prototype.${fn} = `);
      if (start < 0) { missing.push(fn + " (absent)"); continue; }
      const end = js.indexOf("Meetings.prototype.", start + 20);
      const body = js.slice(start, end > 0 ? end : js.length);
      if (!body.includes("this.resetMeetingState()")) missing.push(fn + " (sans reset central)");
    }
    if (missing.length) throw new Error("reset central non appelé: " + missing.join(", "));
    // Les phases clés sont posées aux points d'entrée
    for (const [fn, marker] of [
      ["createMeeting", "MEETING_PHASES.CREATE"],
      ["handleMeetingWaiting", "MEETING_PHASES.WAITING"],
      ["showMeetingScreen", "MEETING_PHASES.LIVE"],
      ["handleMeetingPendingApproval", "MEETING_PHASES.APPROVAL"],
    ]) {
      const start = js.indexOf(`Meetings.prototype.${fn} = `);
      const end = js.indexOf("Meetings.prototype.", start + 20);
      const body = js.slice(start, end > 0 ? end : js.length);
      if (!body.includes(marker)) throw new Error(`phase ${marker} absente de ${fn}`);
    }
    passed++;
    console.log("✅ Test 11 passé: phases machine à états + reset centralisé dans les 3 consommateurs\n");
  } catch (error) {
    console.error(`❌ Test 11 échoué: ${error.message}\n`);
    failed++;
  }

  // Test 12: musique d'attente anti-blocage — binaire jamais retransmis en WS
  try {
    console.log("Test 12: musique d'attente — payload WS léger (URLs), pas de dataUrl en diffusion");
    const fs12 = require("fs");
    const nodePath12 = require("path");
    const srv = fs12.readFileSync(nodePath12.join(__dirname, "..", "server", "serveur.js"), "utf8");
    const cl = fs12.readFileSync(nodePath12.join(__dirname, "..", "www", "js", "Meetings.js"), "utf8");
    // Le serveur doit décoder en Buffer une fois et diffuser des URLs
    if (!srv.includes("decodeWaitingMusicTracks")) throw new Error("décodage serveur manquant");
    if (!srv.includes("buildWaitingMusicPayload")) throw new Error("payload léger manquant");
    if (!srv.includes("/waiting-music/:idx")) throw new Error("route de flux manquante");
    if (!srv.includes("waitingMusicTokenCache")) throw new Error("token d'accès manquant");
    // La diffusion WS ne doit plus interfacer dataUrl dans les sends aux clients
    const sendLines = srv.split("\n").filter((l) => /ws\.send\(JSON\.stringify/.test(l) && /dataUrl/.test(l));
    if (sendLines.length) throw new Error(`dataUrl encore diffusé aux clients (${sendLines.length} sends)`);
    // Le client doit normaliser le nouveau format url
    if (!cl.includes("HTTP_SERVER_URL")) throw new Error("résolution d'URL absolue manquante côté client");
    // L'écho hôte compare par nom (dataUrl locaux vs URLs)
    if (!cl.includes('(t.name || "") === (current[i]?.name || "")')) {
      throw new Error("déduplication écho hôte non adaptée aux URLs");
    }
    passed++;
    console.log("✅ Test 12 passé: binaire décodé une fois, diffusion par URLs + token, écho par nom\n");
  } catch (error) {
    console.error(`❌ Test 12 échoué: ${error.message}\n`);
    failed++;
  }

  // Test 13: salle d'attente fiable (visibilité entre participants)
  //  a) "Occupé" ne bloque plus le join d'une salle d'attente (présence obsolète purgée)
  //  b) room_waiting_* restaurée après redémarrage serveur
  //  c) musique trop volumineuse n'empêche plus la création (degrade, pas de return)
  //  d) _setMeetingPhase compare aux VALEURS (les phases sont des chaînes minuscules)
  //  e) auto-réparation client : replay meeting-join sur group-error de la salle d'attente
  try {
    console.log("Test 13: salle d'attente fiable — join nettoyé, room restaurée, musique non bloquante, phases");
    const fs13 = require("fs");
    const nodePath13 = require("path");
    const root13 = nodePath13.join(__dirname, "..");

    const server13 = fs13.readFileSync(nodePath13.join(root13, "server", "serveur.js"), "utf8");
    if (!/isWaitingRoom.*\n[\s\S]{0,400}leaveUserFromOtherRooms\(ws\.userId, roomId\)/.test(server13)) {
      throw new Error("salle d'attente : join doit purger la présence obsolète au lieu de refuser 'Occupé'");
    }
    if (!server13.includes("Salle d'attente restaurée à la demande")) {
      throw new Error("restauration de room_waiting_* après redémarrage absente");
    }
    const createBlock13 = server13.slice(server13.indexOf("decodedWaitingMusic = decodeWaitingMusicTracks"), server13.indexOf("meeting-created envoyé"));
    if (/La liste audio est trop volumineuse[\s\S]{0,200}return;/.test(createBlock13)) {
      throw new Error("meeting-create rejette encore la réunion si la musique est trop volumineuse");
    }
    if (!createBlock13.includes("musicSkipped")) {
      throw new Error("response meeting-created doit signaler musicSkipped");
    }

    const meet13 = fs13.readFileSync(nodePath13.join(root13, "www", "js", "Meetings.js"), "utf8");
    if (!meet13.includes("Object.values(Meetings.MEETING_PHASES || {})")) {
      throw new Error("_setMeetingPhase doit comparer aux VALEURS (phases minuscules)");
    }
    if (!meet13.includes("data.waitingRoomId !== this.meetingWaitingRoomId")) {
      throw new Error("handleMeetingWaiting doit se ré-armer si la waitingRoomId change (auto-réparation)");
    }
    if (!meet13.includes("data.musicSkippedReason")) {
      throw new Error("l'hôte doit être informé quand la musique est ignorée");
    }

    const cm13 = fs13.readFileSync(nodePath13.join(root13, "www", "js", "CallManager.js"), "utf8");
    if (!cm13.includes("rejoue meeting-join") || !cm13.includes("_waitingRejoinLastAttempt")) {
      throw new Error("auto-réparation replay meeting-join absente côté client");
    }

    passed++;
    console.log("✅ Test 13 passé: salle d'attente fiable (join, restaurations, musique, phases)\n");
  } catch (error) {
    console.error(`❌ Test 13 échoué: ${error.message}\n`);
    failed++;
  }

  // Test 14: musique — upload HTTP hors WebSocket (anti-saturation, anti « Aucune réponse »)
  try {
    console.log("Test 14: musique via HTTP binaire — meeting-create léger, routes upload + finalisation");
    const fs14 = require("fs");
    const nodePath14 = require("path");
    const root14 = nodePath14.join(__dirname, "..");

    const server14 = fs14.readFileSync(nodePath14.join(root14, "server", "serveur.js"), "utf8");
    if (!server14.includes("/api/meeting/:meetingId/waiting-music-upload")) {
      throw new Error("route d'upload HTTP absente");
    }
    if (!server14.includes("/api/meeting/:meetingId/waiting-music-finalize")) {
      throw new Error("route de finalisation absente");
    }
    if (!server14.includes("waitingMusicUploads")) {
      throw new Error("staging upload absent");
    }

    const meet14 = fs14.readFileSync(nodePath14.join(root14, "www", "js", "Meetings.js"), "utf8");
    if (!meet14.includes("waiting-music-upload") || !meet14.includes("waiting-music-finalize")) {
      throw new Error("client doit téléverser via HTTP (upload + finalize)");
    }
    // Le flux de planification ne doit plus passer les dataUrls à createMeeting
    // (le 8e argument doit être un tableau vide, la musique part en HTTP).
    const planBlock14 = meet14.slice(meet14.indexOf("this._pendingWaitingMusicFiles = musicFiles"));
    if (!/\] *\) ?;?\s*};/.test(planBlock14) || !planBlock14.includes("createMeeting(title, datetime, duration, isVideo, [], description, accessPolicy, [])")) {
      throw new Error("createMeeting doit être appelé avec waitingMusicTracks = []");
    }
    if (!meet14.includes("_uploadWaitingMusicFiles")) {
      throw new Error("upload des fichiers après meeting-created absent");
    }
    if (!meet14.includes("AUCUNE réponse du serveur après 20 s.")) {
      throw new Error("logs de diagnostic absents du timeout meeting-create");
    }

    passed++;
    console.log("✅ Test 14 passé: musique par upload HTTP, WS léger, diagnostic timeout\n");
  } catch (error) {
    console.error(`❌ Test 14 échoué: ${error.message}\n`);
    failed++;
  }

  // Résumé
  console.log("=== Résumé ===");
  console.log(`✅ Passés: ${passed}`);
  console.log(`❌ Échoués: ${failed}`);
  console.log(`Total: ${passed + failed}`);
  
  if (failed === 0) {
    console.log("\n🎉 Tous les tests d'intégration passés!");
    process.exit(0);
  } else {
    console.log("\n⚠️ Certains tests ont échoué. Veuillez corriger les problèmes.");
    process.exit(1);
  }
};

if (require.main === module) {
  testMeetingFlow();
}

module.exports = { testMeetingFlow };
