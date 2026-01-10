/* =========================================================
 *  Eisenbahn WebUI – Safety & Status (WebSocket-only)
 * ========================================================= */

const DEBUG_WS = true;
const DEBUG_UI = false;

// Wenn du nach einem Firmware-Flash "alte" Buttons siehst:
// -> unbedingt auch "Upload File System Image" (UploadFS) ausführen.
// Diese Version hilft beim Verifizieren, dass Browser + LittleFS wirklich neu sind.
const UI_VERSION = "2026-01-06-p20-ackpending";

let socket = null;
let wsConnected = false;

// letzter empfangener safety-state vom WS
let lastSafetyState = null;
// letzter empfangener mega2-state (online/flags)
let lastMega2Online = false;

// letzter kompletter WS-State (für Button/Disable-Regeln)
let lastStateMsg = null;

// ACK wurde gesendet, aber Safety-Lock ist (noch) aktiv.
// Wird zurückgesetzt, sobald safety.lock wieder false ist.
let ackPending = false;

/* =========================================================
 *  INIT
 * ========================================================= */

window.addEventListener("load", () => {
  const v = document.getElementById("ui-version");
  if (v) v.textContent = UI_VERSION;
  console.log("[UI] version", UI_VERSION);
  connectWebSocket();
});

/* =========================================================
 *  WS CONNECT
 * ========================================================= */

function connectWebSocket() {
  socket = new WebSocket(`ws://${location.host}/ws`);

  socket.onopen = () => {
    wsConnected = true;
    logLine("WS connected");
    if (lastStateMsg) {
      const uiState = getUiStateFromWs(lastStateMsg, lastSafetyState, lastMega2Online);
      applyUiState(uiState, lastStateMsg);
    }
  };

  socket.onclose = () => {
    wsConnected = false;
    logLine("WS closed - retry...");
    if (lastStateMsg) {
      const uiState = getUiStateFromWs(lastStateMsg, lastSafetyState, lastMega2Online);
      applyUiState(uiState, lastStateMsg);
    }
    setTimeout(connectWebSocket, 1000);
  };

  socket.onerror = () => {
    // onclose kommt meist danach sowieso, aber fürs Log ok
    wsConnected = false;
    logLine("WS error");
  };

  socket.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      handleWsMessage(msg);
    } catch (e) {
      console.warn("WS parse error", e);
    }
  };
}

/* =========================================================
 *  WS SEND (Actions)
 * ========================================================= */

function wsSend(obj) {
  if (!socket || wsConnected !== true) {
    logLine("WS nicht verbunden – Aktion nicht möglich");
    return false;
  }
  try {
    socket.send(JSON.stringify(obj));
    return true;
  } catch (e) {
    console.warn("WS send error", e);
    logLine("WS send error");
    return false;
  }
}

function sendPollNow() {
  wsSend({ action: "pollNow" });
  logLine("↻ Prüfen gesendet");
}


function wsSendAction(action, okMsg) {
  const ok = wsSend({ action: action });
  if (ok && okMsg) logLine(okMsg);
}

/* =========================================================
 *  WS MESSAGE HANDLER
 * ========================================================= */

function handleWsMessage(msg) {
  if (DEBUG_WS) console.log("[WS MSG]", msg);
  if (!msg || msg.type !== "state") return;

  // Debug/Inspection helper (Browser-Konsole)
  window.lastState = msg;

  lastSafetyState = msg.safety || null;
	// Sobald Safety-Lock wieder weg ist, ist ein evtl. laufender Quittierungs-/Test-Flow beendet.
	if (lastSafetyState && lastSafetyState.lock === false) {
	  ackPending = false;
	}
  lastMega2Online = !!(msg.mega2 && msg.mega2.online);
  lastStateMsg = msg;

  const uiState = getUiStateFromWs(msg, lastSafetyState, lastMega2Online);
  applyUiState(uiState, msg);

  // Schritt 2: rechts "Meldungen" befüllen (Safety + SBHF Masken)
  renderPowerWarningsEmergencies(msg);

  // Schritt 3.5: links Betriebsübersicht (SBHF/Blöcke/Weichen) + FROM→TO Signale
  renderOverviewLeft(msg);
}

/* =========================================================
 *  UI STATE FROM WS
 * ========================================================= */

function getSafetyOverlayTexts(safety) {
  try {
    // Prefer numeric codes (errType/errIndex) -> text mapping from safety_ui_texts.js
    if (window.SAFETY_UI_TEXTS && typeof window.SAFETY_UI_TEXTS.fromCodes === 'function') {
      const t = window.SAFETY_UI_TEXTS.fromCodes(safety?.errType, safety?.errIndex);
      if (t && (t.title || (t.lines && t.lines.length))) {
        return { title: t.title || '⚠ Sicherheitsquittierung', lines: t.lines || [] };
      }
    }
  } catch (e) {
    console.warn('SAFETY_UI_TEXTS error', e);
  }
  // Fallback: backend-provided text
  if (safety && safety.text) {
    return { title: '⚠ Sicherheitsquittierung', lines: [String(safety.text)] };
  }
  return { title: '⚠ Sicherheitsquittierung', lines: ['🔴 Safety aktiv – Bedienung gesperrt'] };
}

function getUiStateFromWs(msg, safety, mega2online) {
  // Default OK
  let level = "OK";
  let text = ["🟢 System OK"];
  let title = "";
  let overlay = false;
  let ackRequired = false;
  let hasWarn = false;

  if (!mega2online) {
    level = "WARN";
    text = ["🟡 Mega2 offline"];
    return { level, text, title, overlay, ackRequired, hasWarn };
  }
  // Safety lock dominates everything
  if (safety && safety.lock === true) {
    level = 'ERR';
    overlay = true;
    ackRequired = true;

    const t = getSafetyOverlayTexts(safety);
    title = t.title || '⚠ Sicherheitsquittierung';
    text = (t.lines && t.lines.length) ? t.lines : ['🔴 Safety aktiv – Bedienung gesperrt'];

    return { level, text, title, overlay, ackRequired, hasWarn };
  }

  // Warnings (z.B. Weichenfehler / Restricted Mode) -> Systemstatus = WARNING
  const sb = msg && msg.mega2 && msg.mega2.sbhf;
  if (sb) {
    const allowed = (sb.allowedMask ?? 0) & 0xff;
    const warn    = (sb.warningMask ?? 0) & 0xff;

    const restricted = (allowed !== 0x07 && allowed !== 0x00);
    hasWarn = (warn !== 0) || restricted;

    if (hasWarn) {
      level = "WARN";
      text = ["🟡 Warning aktiv"];
    }
  }

  return { level, text, title, overlay, ackRequired, hasWarn };
}

/* =========================================================
 *  UI APPLY
 * ========================================================= */

function applyUiState(ui, msg) {
  const panel = document.getElementById("safety-panel");
  const status = document.getElementById("safety-status");

  if (!panel || !status) return;

  panel.className = "safety-panel " + ui.level.toLowerCase();
  status.textContent = ui.text[0] || "";

  if (ui.overlay) {
    showOverlay(ui.title, ui.text, ui.ackRequired);
  } else {
    hideOverlay();
  }

  // --------------------------------------------------
  // Disable rules + states
  // --------------------------------------------------

  const mega2online = !!(msg && msg.mega2 && msg.mega2.online);
const mega1online = !!(msg.mega1 && msg.mega1.online);
  const wsOk = (wsConnected === true);
  const lock = !!(lastSafetyState && lastSafetyState.lock === true);
  const notausActive = !!(lastSafetyState && lastSafetyState.notausActive === true);
  const powerOn = !!(lastSafetyState && lastSafetyState.powerOn === true);

// --------------------------------------------------
// Status-Badges (oben rechts)
// --------------------------------------------------
const bWs = document.getElementById("badge-ws");
const bM2 = document.getElementById("badge-mega2");
const bM1 = document.getElementById("badge-mega1");
const bMode = document.getElementById("badge-mode");   // <-- NEU
const bPw = document.getElementById("badge-power");
const bNo = document.getElementById("badge-notaus");

// --- NEU: Auto/Manuell Badge ---
if (bMode) {
  const modeRaw = msg?.mega1?.diag?.mode;
  const mode = (modeRaw === undefined || modeRaw === null) ? -1 : Number(modeRaw);

  // Annahme: 1 = Auto, 0 = Manuell (wenn falsch herum, drehen wir es)
  const isAuto = (mode === 1);

  if (mode < 0 || Number.isNaN(mode)) {
    bMode.className = "badge badge-warn";
    bMode.textContent = "Mode: ?";
  } else {
    bMode.className = "badge " + (isAuto ? "badge-ok" : "badge-info");
    bMode.textContent = isAuto ? "Auto" : "Manuell";
  }
}

if (bWs) {
  bWs.className = "badge " + (wsOk ? "badge-ok" : "badge-err");
  bWs.textContent = "WS: " + (wsOk ? "verbunden" : "getrennt");
}
if (bM2) {
  bM2.className = "badge " + (mega2online ? "badge-ok" : "badge-err");
  bM2.textContent = "Mega2: " + (mega2online ? "online" : "offline");
}
if (bM1) {
  bM1.className = "badge " + (mega1online ? "badge-ok" : "badge-err");
  bM1.textContent = "Mega1: " + (mega1online ? "online" : "offline");
}
if (bPw) {
  bPw.className = "badge " + (powerOn ? "badge-ok" : "badge-warn");
  bPw.textContent = "Power: " + (powerOn ? "AN" : "aus");
}
if (bNo) {
  bNo.className = "badge " + (notausActive ? "badge-err" : "badge-ok");
  bNo.textContent = "HW-NOT AUS: " + (notausActive ? "AKTIV" : "nein");
}


  // STOP (UI) – immer erlaubt (wenn WS verbunden), auch bei Safety lock.
// (STOP ist UI-Command "PowerOff". HW-NOT-AUS ist rein Anzeige.)

// POWER – wenn Mega2 offline, alles außer STOP sperren.

  // POWER – wenn Mega2 offline, alles außer STOP sperren.
  const btnPower = document.getElementById("btn-power");
  if (btnPower) {
    btnPower.textContent = powerOn ? "⏻ STOP / POWER OFF" : "⚡ POWER ON";
    btnPower.classList.toggle("is-on", powerOn);
    btnPower.classList.toggle("is-off", !powerOn);
    btnPower.classList.toggle("is-offline", !mega2online);

    // Regeln:
    // - Wenn WS down oder Mega2 offline: disable
    // - Wenn Power bereits an: POWER OFF erlauben
    // - Wenn Power aus: POWER ON nur erlauben, wenn nicht gelockt und HW-NOT-AUS nicht aktiv
    if (!wsOk || !mega2online) {
      btnPower.disabled = true;
    } else if (powerOn) {
      btnPower.disabled = false;
    } else {
      btnPower.disabled = (lock || notausActive);
    }
  }
}

/* =========================================================
 *  ACTIONS (WebSocket-only)
 * ========================================================= */

function sendNothalt() {
  wsSendAction("nothalt", "NOTAUS gesendet");
}


function sendPowerOn() {
  const powerOn = !!(lastSafetyState && lastSafetyState.powerOn === true);

  // Verbindung prüfen (damit der Klick nicht "ins Leere" läuft)
  if (!wsConnected || !socket || socket.readyState !== 1) {
    logLine("WS nicht verbunden – Aktion nicht gesendet");
    return;
  }

  // Mega2-Online prüfen (optional: STOP bleibt trotzdem erlaubt, aber PowerToggle nicht)
  if (!lastMega2Online) {
    logLine("Mega2 offline – Aktion nicht gesendet");
    return;
  }

  const notausActive = !!(lastSafetyState && lastSafetyState.notausActive === true);
  const safetyLock   = !!(lastSafetyState && lastSafetyState.lock === true);

  // Toggle-Logik:
  // - wenn Power bereits AN -> UI-STOP = PowerOff
  // - wenn Power AUS -> nur PowerOn, wenn kein Safety-Lock und kein HW-NOT-AUS
  if (powerOn) {
    wsSendAction("powerOff", "STOP / POWER OFF gesendet");
    return;
  }

  if (safetyLock || notausActive) {
    showAckOverlay(
      (lastSafetyState && lastSafetyState.text) ||
        "Power On nicht möglich – Safety aktiv oder HW-NOT-AUS"
    );
    return;
  }

  wsSendAction("powerOn", "POWER ON gesendet");
}


/* =========================================================
 *  ACK OVERLAY
 * ========================================================= */

function showOverlay(title, lines, requireChecked) {
  const overlay = document.getElementById("ack-overlay");
  const titleEl = document.getElementById("ack-title");
  const textEl = document.getElementById("ack-text");
  const checkbox = overlay?.querySelector("input[type=checkbox]");
  const ackBtn = overlay?.querySelector(".btn-ack");

  if (!overlay || !titleEl || !textEl) return;

  const wasHidden = overlay.classList.contains("hidden");

  overlay.classList.remove("hidden");

  titleEl.textContent = title || "⚠ Sicherheitsquittierung";

  const safeLines = (Array.isArray(lines) ? lines : [lines])
    .filter(Boolean)
    .map((l) => escapeHtml(String(l)));

  textEl.innerHTML = safeLines.join("<br>");

  // Wenn bereits ACK gesendet wurde, aber der Safety-Lock noch aktiv ist,
  // dann läuft (z.B. im SBHF) typischerweise ein automatischer Selbsttest.
  // In dieser Phase darf die Checkbox/ACK nicht weiter bedient werden.
  if (ackPending) {
    titleEl.textContent = "🔄 SBHF Weichentest läuft";
    textEl.innerHTML = [
      "Bitte warten …",
      "Der Selbsttest läuft im Hintergrund und wird automatisch abgeschlossen.",
    ].map((l) => escapeHtml(String(l))).join("<br>");
    if (checkbox) {
      checkbox.disabled = true;
    }
    if (ackBtn) {
      ackBtn.disabled = true;
      ackBtn.textContent = "Bitte warten …";
    }
    return;
  }

  // ACK senden ist nur sinnvoll, wenn WS ok und Mega2 online.
  const canAckSend = (wsConnected === true) && (lastMega2Online === true);
  if (ackBtn) {
    ackBtn.disabled = !canAckSend;
    ackBtn.textContent = "ACK";
  }

  if (checkbox) {
    // Wichtig: Checkbox ist User-Interaktion. Nicht bei jedem WS-State-Update zurücksetzen.
    if (wasHidden) {
      checkbox.checked = false;
    }
    checkbox.disabled = !requireChecked;
  }
}

function hideOverlay() {
  const overlay = document.getElementById("ack-overlay");
  if (!overlay) return;
  overlay.classList.add("hidden");
}

function closeOverlay() {
  hideOverlay();
}

function confirmAck() {
  const overlay = document.getElementById("ack-overlay");
  const checkbox = overlay?.querySelector("input[type=checkbox]");
  if (checkbox && checkbox.disabled === false && checkbox.checked === false) {
    logLine("Bitte vor Ort prüfen und Checkbox bestätigen.");
    return;
  }

  const ok = wsSend({ action: "safetyAck" });
  if (ok) {
    logLine("ACK gesendet – Selbsttest läuft …");
    ackPending = true;
    // Overlay absichtlich offen lassen, aber UI sperren + "läuft" anzeigen.
    showOverlay("🔄 SBHF Weichentest läuft", ["Bitte warten …"], false);
  }
}

/* =========================================================
 *  LOG
 * ========================================================= */

function logLine(txt) {
  const win = document.getElementById("log-window");
  if (!win) return;

  const p = document.createElement("div");
  p.textContent = txt;
  win.appendChild(p);
  win.scrollTop = win.scrollHeight;
}

/* =========================================================
 *  HELPER
 * ========================================================= */

function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =========================================================
 *  Schritt 2: POWER / WARNINGS / EMERGENCIES (rechts)
 * ========================================================= */

function renderPowerWarningsEmergencies(msg) {
  const el = document.getElementById("safety-messages-list");
  if (!el) return;

  const items = [];

  // 1) Emergencies / Safety-Text
  const safety = msg && msg.safety;
  if (safety && safety.text) {
    items.push(`⛔ ${escapeHtml(String(safety.text))}`);
  }

  // 2) Mega2 SBHF Masken
  const m2 = msg && msg.mega2;
  const sb = m2 && m2.sbhf;

  if (m2 && m2.online && sb) {
    const allowed = (sb.allowedMask ?? 0) & 0xff;
    const warn    = (sb.warningMask ?? 0) & 0xff;

    // Bits (Contract)
    const WARN_RESTRICTED_MODE      = 0x01;
    const WARN_W12_DEFECT           = 0x02;
    const WARN_W13_DEFECT           = 0x04;
    const WARN_W14_DEFECT           = 0x08;
    const WARN_W15_DEFECT           = 0x10;
    const WARN_SBH_SERVICE_REQUIRED = 0x20;

    // Allowed tracks
    const tracks = [];
    if (allowed & 0x01) tracks.push("G1");
    if (allowed & 0x02) tracks.push("G2");
    if (allowed & 0x04) tracks.push("G3");

    if (allowed === 0x00) {
      items.push("⛔ SBHF gesperrt (kein sicherer Pfad)");
    } else {
      items.push(`🚦 SBHF erlaubte Gleise: ${tracks.length ? tracks.join(", ") : "—"}`);
    }

    const restricted =
      ((warn & WARN_RESTRICTED_MODE) !== 0) ||
      (allowed !== 0x07 && allowed !== 0x00);

    if (restricted) items.push("⚠ SBHF: Restricted Mode aktiv");
    if (warn & WARN_W12_DEFECT) items.push("⚠ W12 defekt");
    if (warn & WARN_W13_DEFECT) items.push("⚠ W13 defekt");
    if (warn & WARN_W14_DEFECT) items.push("ℹ W14 Störung");
    if (warn & WARN_W15_DEFECT) items.push("ℹ W15 Störung");
    if (warn & WARN_SBH_SERVICE_REQUIRED) items.push("🛠 Service erforderlich");
  }

  

// 3) "↻ Prüfen" (PollNow), wenn Warnings/Restricted aktiv sind
let warningActive = false;
if (m2 && m2.sbhf) {
  const warn = Number(m2.sbhf.warningMask || 0);
  const allowed = Number(m2.sbhf.allowedMask || 0);
	  const restrictedFlag = !!m2.sbhf.restricted;
	  const restricted =
	    restrictedFlag ||
	    (warn !== 0) ||
	    (allowed !== 0x07 && allowed !== 0x00);
	  warningActive = restricted;
}

const canPollNow = wsConnected && !!(msg && msg.mega2 && msg.mega2.online);
const pollBtnHtml = warningActive
  ? `<div class="msg-actions"><button class="btn-mini" ${canPollNow ? "" : "disabled"} onclick="sendPollNow()">↻ Prüfen</button></div>`
  : "";

  el.innerHTML = (items.length ? items.map(t => `<div>${t}</div>`).join("") : "<em>Keine Meldungen</em>") + pollBtnHtml;
}

/* =========================================================
 *  Schritt 3.5: Links – Betriebsübersicht + Block-Signale
 * ========================================================= */

function bit(mask, i) {
  return ((mask >>> i) & 1) !== 0;
}

function renderOverviewLeft(msg) {
  renderSbhfLeft(msg);
  renderTurnoutsLeft(msg);
  renderBlocksLeft(msg);
  renderStationsLeft(msg);
}

function fmtHex(v, width) {
  const n = Number(v) >>> 0;
  const s = n.toString(16).toUpperCase();
  return "0x" + s.padStart(width || 2, "0");
}

function renderStationsLeft(msg) {
  const el = document.getElementById("ov-stations");
  if (!el) return;

  const m1 = msg?.mega1;
  const online = !!m1?.online;
  const diag = m1?.diag;

  if (!online || !diag) {
    el.innerHTML = online ? "<em>keine Daten</em>" : "<em>offline</em>";
    return;
  }

  const mode = Number(diag.mode ?? 0);
  const powerMask = Number(diag.powerMask ?? 0);
  const ist = Number(diag.weicheIstBits ?? 0);
  const soll = Number(diag.weicheSollBits ?? 0);
  const slow = Number(diag.weicheSlowBits ?? 0);

  const mkBadge = (text, cls) => `<span class="badge ${cls}">${text}</span>`;

  // Power channels (P1..P4)
  const pBadges = [];
  for (let i = 0; i < 4; i++) {
    const on = ((powerMask >>> i) & 1) !== 0;
    pBadges.push(mkBadge(`P${i + 1}: ${on ? "AN" : "AUS"}`, on ? "badge-ok" : "badge-warn"));
  }

  // Turnouts (W1..W12)
  const W_COUNT = 12;
  const wBadges = [];
  for (let i = 0; i < W_COUNT; i++) {
    const s = ((soll >>> i) & 1) !== 0;
    const a = ((ist >>> i) & 1) !== 0;
    const sl = ((slow >>> i) & 1) !== 0;

    let cls = "badge-ok";
    if (s !== a) cls = "badge-err";
    else if (sl) cls = "badge-warn";

    // Keep semantics neutral: show bits, not G/R, to avoid wrong interpretation.
    wBadges.push(mkBadge(`W${i + 1} S${s ? 1 : 0} I${a ? 1 : 0}${sl ? " slow" : ""}`, cls));
  }

  el.innerHTML = `
    <div>Mode: <b>${mode}</b></div>
    <div style="margin-top:8px"><b>Power</b></div>
    <div class="badge-wrap">${pBadges.join(" ")}</div>
    <div style="margin-top:10px"><b>Weichen</b></div>
    <div class="badge-wrap">${wBadges.join(" ")}</div>
    <div style="margin-top:10px; opacity:0.75; font-size:0.9em">
      Roh: PowerMask <b>${fmtHex(powerMask, 2)}</b> · Soll <b>${fmtHex(soll, 4)}</b> · Ist <b>${fmtHex(ist, 4)}</b> · Slow <b>${fmtHex(slow, 4)}</b>
    </div>
  `;
}

function renderSbhfLeft(msg) {
  const el = document.getElementById("ov-sbhf");
  if (!el) return;

  const online = !!msg?.mega2?.online;
  const sb = msg?.mega2?.sbhf;

  if (!online || !sb) {
    el.innerHTML = "<em>keine Daten</em>";
    return;
  }

  const state = sb.state ?? 0;
  const g = sb.currentGleis ?? 0;
  const occ = sb.occupiedMask ?? 0;
  const allowed = (sb.allowedMask ?? 0) & 0xff;
  const restricted = !!sb.restricted;

  const occList = [];
  if (occ & 0x01) occList.push("G1");
  if (occ & 0x02) occList.push("G2");
  if (occ & 0x04) occList.push("G3");

  const allowList = [];
  if (allowed & 0x01) allowList.push("G1");
  if (allowed & 0x02) allowList.push("G2");
  if (allowed & 0x04) allowList.push("G3");

  el.innerHTML = `
    <div>State: <b>${state}</b></div>
    <div>Ausfahr-Gleis: <b>${g}</b></div>
    <div>Belegt: ${occList.length ? occList.join(", ") : "—"}</div>
    <div>Erlaubt: ${allowList.length ? allowList.join(", ") : "—"}</div>
    <div>Restricted: <b>${restricted ? "ja" : "nein"}</b></div>
  `;
}

function renderTurnoutsLeft(msg) {
  const el = document.getElementById("ov-turnouts");
  if (!el) return;

  const online = !!msg?.mega2?.online;
  const t = msg?.mega2?.turnouts;

  if (!online || !t) {
    el.innerHTML = "<em>keine Daten</em>";
    return;
  }

  const soll = t.sollMask ?? 0;
  const ist  = t.istMask ?? 0;

  const names = ["W12", "W13", "W14", "W15"];
  let html = `<div class="badge-wrap">`;
  for (let i = 0; i < 4; i++) {
    const s = bit(soll, i) ? "A" : "G";
    const r = bit(ist, i)  ? "A" : "G";
    const ok = (s === r);
    html += `<span class="badge ${ok ? "badge-green" : "badge-red"}">${names[i]} Soll:${s} Ist:${r}</span>`;
  }
  html += `</div>`;
  el.innerHTML = html;
}

function renderBlocksLeft(msg) {
  const el = document.getElementById("ov-blocks");
  if (!el) return;

  const online = !!msg?.mega2?.online;
  if (!online) {
    el.innerHTML = "<em>keine Daten</em>";
    return;
  }

  const occMask = msg?.mega2?.blockOccupiedMask ?? 0;
  const entryNow = msg?.mega2?.entryAllowed;
  const entryPrev = msg?.mega2?.entryPreview;

  // 1) Occupancy
  let html = `<div><b>Belegung:</b></div><div class="badge-wrap">`;
  for (let i = 0; i < 9; i++) {
    const occ = bit(occMask, i);
    html += `<span class="badge ${occ ? "badge-red" : "badge-green"}">B${i+1} ${occ ? "belegt" : "frei"}</span>`;
  }
  html += `</div>`;

  // 2) FROM→TO Signale (fixe Liste nach Topologie)
  if (Array.isArray(entryPrev) && entryPrev.length >= 9 && Array.isArray(entryNow) && entryNow.length >= 9) {
    const edges = [
      [1,2],[2,3],[3,4],[4,1],[4,5],
      [5,7],[5,8],[5,9],
      [7,6],[8,6],[9,6],
      [6,4]
    ];

    html += `<div style="margin-top:0.8rem;"><b>Signale (FROM → TO):</b></div>`;
    html += `<div class="badge-wrap">`;

    for (const [from,to] of edges) {
      const maskPrev = entryPrev[from-1] >>> 0;
      const maskNow  = entryNow[from-1] >>> 0;

      const prevOk = (maskPrev & (1 << (to-1))) !== 0;
      const nowOk  = (maskNow  & (1 << (to-1))) !== 0;

      html += `<span class="badge ${prevOk ? "badge-green" : "badge-red"}" style="line-height:1.15; padding-top:6px; padding-bottom:6px;">
        <div style="font-size:0.85em; opacity:0.85;">P: B${from}→B${to}</div>
        <div style="font-weight:700;">N: ${nowOk ? "OK" : "STOP"}</div>
      </span>`;
    }

    html += `</div>`;
  } else {
    html += `<div style="margin-top:0.8rem;"><em>Signale: keine Daten</em></div>`;
  }

  el.innerHTML = html;
}

