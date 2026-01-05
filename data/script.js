/* =========================================================
 *  Eisenbahn WebUI – Safety & Status
 * ========================================================= */

const DEBUG_WS = true;
const DEBUG_UI = false;

let socket = null;
let wsConnected = false;

// letzter empfangener safety-state vom WS
let lastSafetyState = null;
// letzter empfangener mega2-state (online/flags)
let lastMega2Online = false;

/* =========================================================
 *  INIT
 * ========================================================= */

window.addEventListener("load", () => {
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
  };

  socket.onclose = () => {
    wsConnected = false;
    logLine("WS closed - retry...");
    setTimeout(connectWebSocket, 1000);
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
 *  WS MESSAGE HANDLER
 * ========================================================= */

function handleWsMessage(msg) {
  if (DEBUG_WS) console.log("[WS MSG]", msg);
  if (!msg || msg.type !== "state") return;

  lastSafetyState = msg.safety || null;
  lastMega2Online = !!(msg.mega2 && msg.mega2.online);

  const uiState = getUiStateFromWs(msg, lastSafetyState, lastMega2Online);
  applyUiState(uiState);

  // Schritt 2: rechts "Meldungen" befüllen (Safety + SBHF Masken)
  renderPowerWarningsEmergencies(msg);

  // Schritt 3.5: links Betriebsübersicht (SBHF/Blöcke/Weichen) + FROM→TO Signale
  renderOverviewLeft(msg);
}

/* =========================================================
 *  UI STATE FROM WS
 * ========================================================= */

function getUiStateFromWs(msg, safety, mega2online) {
  // Default OK
  let level = "OK";
  let text = ["🟢 System OK"];
  let title = "";
  let overlay = false;
  let ackRequired = false;

  if (!mega2online) {
    level = "WARN";
    text = ["🟡 Mega2 offline"];
    return { level, text, title, overlay, ackRequired };
  }

  if (safety && safety.lock === true) {
    level = "ERR";
    text = ["🔴 Safety aktiv – Bedienung gesperrt"];
    title = "⚠ Sicherheitsquittierung";
    overlay = true;
    ackRequired = true;

    if (safety.text) {
      text = [String(safety.text)];
    }
  }

  return { level, text, title, overlay, ackRequired };
}

/* =========================================================
 *  UI APPLY
 * ========================================================= */

function applyUiState(ui) {
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

  // Power nur erlauben, wenn nicht locked
  const btnPower = document.getElementById("btn-power");
  if (btnPower) {
    btnPower.disabled = !!(lastSafetyState && lastSafetyState.lock === true);
  }
}

/* =========================================================
 *  ACTIONS (HTTP)
 * ========================================================= */

function sendAction(action, okMsg) {
  fetch(`/action?action=${encodeURIComponent(action)}`)
    .then((r) => r.text())
    .then(() => logLine(okMsg))
    .catch(() => logLine("Action error"));
}

function sendNothalt() {
  sendAction("nothalt", "NOTAUS gesendet");
}

function sendPowerOn() {
  // Safety aktiv?
  if (window.lastSafetyState && window.lastSafetyState.lock === true) {
    showAckOverlay(
      window.lastSafetyState.text ||
      "Power On nicht möglich – Safety aktiv"
    );
    return;
  }
  sendAction("powerOn", "POWER ON gesendet");
}

/* =========================================================
 *  ACK OVERLAY
 * ========================================================= */

function showOverlay(title, lines, requireChecked) {
  const overlay = document.getElementById("ack-overlay");
  const titleEl = document.getElementById("ack-title");
  const textEl = document.getElementById("ack-text");
  const checkbox = overlay?.querySelector("input[type=checkbox]");

  if (!overlay || !titleEl || !textEl) return;

  overlay.classList.remove("hidden");

  titleEl.textContent = title || "⚠ Sicherheitsquittierung";

  const safeLines = (Array.isArray(lines) ? lines : [lines])
    .filter(Boolean)
    .map((l) => escapeHtml(String(l)));

  textEl.innerHTML = safeLines.join("<br>");

  if (checkbox) {
    checkbox.checked = false;
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
  sendAction("ack", "ACK gesendet");
  hideOverlay();
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

  el.innerHTML = items.length
    ? items.map(t => `<div>${t}</div>`).join("")
    : "<em>Keine Meldungen</em>";
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
  // Mega1 Stations folgt später
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

      // Zwei Ebenen: Preview (prinzipiell) + Now (jetzt)
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
