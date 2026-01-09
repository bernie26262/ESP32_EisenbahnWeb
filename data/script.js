/* =========================================================
 *  Eisenbahn WebUI – Safety & Status (WebSocket-only)
 * ========================================================= */

const DEBUG_WS = true;
const DEBUG_UI = false;

// Wenn du nach einem Firmware-Flash "alte" Buttons siehst:
// -> unbedingt auch "Upload File System Image" (UploadFS) ausführen.
// Diese Version hilft beim Verifizieren, dass Browser + LittleFS wirklich neu sind.
const UI_VERSION = "2026-01-09-p06-layout-status-in-panel";

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

  // Robust pointer handlers (Desktop+Mobile)
  bindPointer(document.getElementById("btn-power"), () => sendPowerOn());
  bindPointer(document.getElementById("btn-m1-mode"), () => sendMega1ModeToggle());

  // Delegation: Mega1 Bahnhöfe + Weichen
  bindPointer(document.getElementById("ov-stations"), (ev) => {
    const btn = ev.target?.closest?.("button[data-bhf]");
    if (!btn) return;
    const idx = Number(btn.getAttribute("data-bhf"));
    const on = btn.getAttribute("data-on") === "1";
    if (Number.isFinite(idx)) sendMega1BhfSet(idx, !on);
  });
  bindPointer(document.getElementById("ov-m1weichen"), (ev) => {
    const btn = ev.target?.closest?.("button[data-weiche]");
    if (!btn) return;
    const idx = Number(btn.getAttribute("data-weiche"));
    const g = btn.getAttribute("data-gerade") === "1";
    if (Number.isFinite(idx)) sendMega1WeicheSet(idx, !g);
  });
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

function sendSbhfRetry() {
  const ok = wsSend({ action: "sbhfSelftestRetry" });
  if (ok) logLine("🔄 Retry Selftest gesendet");
}


function wsSendAction(action, okMsg) {
  const ok = wsSend({ action: action });
  if (ok && okMsg) logLine(okMsg);
}


/* =========================================================
 *  Pointer (Desktop+Mobile) – robust statt click
 * ========================================================= */
function bindPointer(el, fn) {
  if (!el) return;
  el.addEventListener("pointerup", (ev) => {
    // Wichtig: verhindert doppeltes Auslösen (click + pointerup) und stoppt Bubbling.
    ev.preventDefault();
    ev.stopPropagation();

    // Simple debounce pro Element (verhindert Queue-Flooding bei wackeligen Klicks)
    const now = Date.now();
    const last = Number(el.dataset._lastPtrUp || 0);
    if (now - last < 200) return;
    el.dataset._lastPtrUp = String(now);

    fn(ev);
  }, { passive: false });
}

/* =========================================================
 *  WS MESSAGE HANDLER
 * ========================================================= */



/* =========================================================
 *  Mega1 Actions (WS)
 * ========================================================= */
function sendMega1BhfSet(bhf1based, on) {
  wsSend({ action: "m1PowerSet", bhf: bhf1based, on: !!on });
}

function sendMega1WeicheSet(idx0based, gerade) {
  wsSend({ action: "m1TurnoutSet", idx: idx0based, gerade: !!gerade });
}

function sendMega1ModeToggle() {
  // Best-effort: wenn wir den aktuellen Mode kennen, togglen wir.
  const diag = lastStateMsg?.mega1?.diag;
  const cur = getMega1Mode(diag);
  const next = cur === null ? 0 : (cur ? 0 : 1); // null -> Auto als Default
  wsSend({ action: "m1SetMode", mode: next });
}

function handleWsMessage(msg) {
  if (DEBUG_WS) console.log("[WS MSG]", msg);
  if (!msg || msg.type !== "state") return;

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
  updateMega1ModePill(msg);
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

  const mega2onlineVal = (msg && msg.mega2 && typeof msg.mega2.online === 'boolean') ? msg.mega2.online : null;
  const mega2online = (mega2onlineVal === true);
  const mega1onlineVal = (msg && msg.mega1 && typeof msg.mega1.online === 'boolean') ? msg.mega1.online : null;
  const mega1online = (mega1onlineVal === true);
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
const bPw = document.getElementById("badge-power");
const bNo = document.getElementById("badge-notaus");

if (bWs) {
  bWs.className = "badge " + (wsOk ? "badge-ok" : "badge-err");
  bWs.textContent = "WS: " + (wsOk ? "verbunden" : "getrennt");
}
if (bM2) {
  if (mega2onlineVal === null) {
    bM2.className = "badge badge-warn";
    bM2.textContent = "Mega2: ?";
  } else {
    bM2.className = "badge " + (mega2online ? "badge-ok" : "badge-err");
    bM2.textContent = "Mega2: " + (mega2online ? "online" : "offline");
  }
}
if (bM1) {
  if (mega1onlineVal === null) {
    bM1.className = "badge badge-warn";
    bM1.textContent = "Mega1: ?";
  } else {
    bM1.className = "badge " + (mega1online ? "badge-ok" : "badge-err");
    bM1.textContent = "Mega1: " + (mega1online ? "online" : "offline");
  }
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

  

// 3) Aktionen bei Warnings/Restricted
let warningActive = false;
if (m2 && m2.sbhf) {
  const warn = Number(m2.sbhf.warningMask || 0);
  const allowed = Number(m2.sbhf.allowedMask || 0);
  const restrictedFlag = !!m2.sbhf.restricted;
  const restricted = restrictedFlag || (warn !== 0) || (allowed !== 0x07 && allowed !== 0x00);
  warningActive = restricted;
}

const canPollNow = wsConnected && !!(msg && msg.mega2 && msg.mega2.online);
const selftestRunning = !!(msg && msg.mega2 && msg.mega2.sbhf && msg.mega2.sbhf.selftestRunning);
const canRetry = canPollNow && !selftestRunning;

const actionsHtml = warningActive ? `
  <div class="msg-actions"><button class="btn-mini" ${canRetry ? "" : "disabled"} type="button" onpointerup="sendSbhfRetry()">🔄 Retry Selftest</button>
  </div>
` : "";

el.innerHTML = (items.length ? items.map(t => `<div>${t}</div>`).join("") : "<em>Keine Meldungen</em>") + actionsHtml;
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
  renderMega1Stations(msg);
  renderMega1Turnouts(msg);
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
  const el = document.getElementById("ov-m2-turnouts");
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


/* =========================================================
 *  Mega1 – Mapping (diag)
 * ========================================================= */

function getMega1Diag(msg) {
  return msg && msg.mega1 && msg.mega1.diag ? msg.mega1.diag : null;
}

function renderMega1Stations(msg) {
  const el = document.getElementById("ov-stations");
  if (!el) return;

  const online = !!msg?.mega1?.online;
  const diag = getMega1Diag(msg);

  if (!online) {
    el.innerHTML = "<em>Mega1 offline</em>";
    return;
  }
  if (!diag) {
    el.innerHTML = "<em>keine Daten</em>";
    return;
  }

  const mask = Number(diag.powerMask ?? diag.bhfPowerMask ?? 0) & 0xFF;
  const btns = [];
  for (let i = 0; i < 4; i++) { // BHF1..BHF4
    const on = ((mask >>> i) & 1) !== 0;
    btns.push(
      `<button class="btn pill-btn" type="button" data-bhf="${i+1}" aria-pressed="${on ? 'true' : 'false'}" data-on="${on ? "1" : "0"}">`+
        `BHF${i+1}: ${on ? 'AN' : 'aus'}`+
      `</button>`
    );
  }
  el.innerHTML = `<div class="badge-wrap">${btns.join('')}</div>`;
}

function renderMega1Turnouts(msg) {
  const el = document.getElementById("ov-m1weichen");
  if (!el) return;

  const online = !!msg?.mega1?.online;
  const diag = getMega1Diag(msg);

  if (!online) {
    el.innerHTML = "<em>Mega1 offline</em>";
    return;
  }
  if (!diag) {
    el.innerHTML = "<em>keine Daten</em>";
    return;
  }

  const soll = Number(diag.weicheSollBits ?? 0) >>> 0;
  const ist  = Number(diag.weicheIstBits ?? 0) >>> 0;
  const slow = Number(diag.weicheSlowBits ?? 0) >>> 0;

  const items = [];
  for (let i = 0; i < 12; i++) { // W0..W11
    const s = ((soll >>> i) & 1) !== 0;
    const a = ((ist  >>> i) & 1) !== 0;
    const sl = ((slow >>> i) & 1) !== 0;
    const ok = (s === a);
    const cls = ok ? 'badge-ok' : 'badge-err';
    const label = `W${i}: ${a ? 'G' : 'A'}${sl ? ' (slow)' : ''}`;
    items.push(
      `<button class="badge ${cls} is-clickable" type="button" data-weiche="${i}" title="Soll ${s ? 'G' : 'A'} / Ist ${a ? 'G' : 'A'}" data-gerade="${a ? "1" : "0"}" data-soll="${s ? "1" : "0"}">${label}</button>`
    );
  }
  el.innerHTML = `<div class="badge-wrap">${items.join('')}</div>`;
}

function updateMega1ModePill(msg) {
  const el = document.getElementById('pill-m1-mode');
  if (!el) return;

  const diag = getMega1Diag(msg);
  // Wir akzeptieren mehrere mögliche Feldnamen.
  let mode = null; // 0=Auto, 1=Manuell
  if (diag) {
    if (diag.mode !== undefined && diag.mode !== null) mode = Number(diag.mode);
    else if (diag.auto !== undefined && diag.auto !== null) mode = Number(!diag.auto);
    else if (diag.isAuto !== undefined && diag.isAuto !== null) mode = Number(!diag.isAuto);
    else if (diag.manual !== undefined && diag.manual !== null) mode = Number(!!diag.manual);
  }

  if (mode === 0) {
    el.className = 'badge badge-ok';
    el.textContent = 'Mode: Auto';
  } else if (mode === 1) {
    el.className = 'badge badge-info';
    el.textContent = 'Mode: Manuell';
  } else {
    el.className = 'badge badge-warn';
    el.textContent = 'Mode: ?';
  }
}


