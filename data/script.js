/* =========================================================
 *  Eisenbahn WebUI – Safety & Status
 * ========================================================= */

const DEBUG_WS = false;
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
  if (DEBUG_UI) console.log("script.js loaded");
  initWebSocket();
});

/* =========================================================
 *  WEBSOCKET
 * ========================================================= */

function initWebSocket() {
  const proto = location.protocol === "https:" ? "wss://" : "ws://";
  const url = proto + location.host + "/ws";

  log(`[WS] connect ${url}`);
  socket = new WebSocket(url);

  socket.onopen = () => {
    wsConnected = true;
    log("[WS] verbunden");
  };

  socket.onclose = () => {
    wsConnected = false;
    log("[WS] getrennt – Reconnect in 2s");
    setTimeout(initWebSocket, 2000);
  };

  socket.onmessage = (event) => {
    if (DEBUG_WS) console.log("[WS RAW]", event.data);

    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      console.error("JSON parse error", e);
      return;
    }

    handleWsMessage(msg);
  };
}

/* =========================================================
 *  WS DISPATCH
 * ========================================================= */

function handleWsMessage(msg) {
  if (DEBUG_WS) console.log("[WS MSG]", msg);
  if (!msg || msg.type !== "state") return;

  lastSafetyState = msg.safety || null;
  lastMega2Online = !!(msg.mega2 && msg.mega2.online);

  const uiState = getUiStateFromWs(msg, lastSafetyState, lastMega2Online);
  applyUiState(uiState);
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

  // Power nur erlauben, wenn NICHT locked und Mega2 online
  updatePowerButton(ui.locked === true || ui.mega2Online === false);
}

/* =========================================================
 *  COMMANDS
 * ========================================================= */

function sendNothalt() {
  sendAction("nothalt");
}

function sendPowerOn() {
  // UI-Sperre: wenn locked, zeigen wir Overlay – und senden NICHT.
  if (lastSafetyState && lastSafetyState.lock === true) {
    const lines = normalizeTextLines(lastSafetyState.text);
    showOverlay(
      "Power On nicht möglich",
      lines.length ? lines : ["Safety-Lock aktiv (erst quittieren)"],
      true
    );
    return;
  }

  // optional: wenn mega2 offline -> nicht senden
  if (!lastMega2Online) {
    showOverlay("Power On nicht möglich", ["Mega2 offline"], false);
    return;
  }

  sendAction("powerOn");
}

function confirmAck() {
  sendAction("safetyAck");
}

function sendAction(action) {
  if (!socket || !wsConnected) {
    log(`[WS] nicht verbunden – action '${action}' verworfen`);
    return;
  }
  socket.send(JSON.stringify({ action }));
}

/* =========================================================
 *  OVERLAY
 * ========================================================= */

function showOverlay(title, lines, ackRequired) {
  const titleEl = document.getElementById("ack-title");
  const textEl = document.getElementById("ack-text");
  const btnEl = document.getElementById("ack-confirm-btn");
  const overlayEl = document.getElementById("ack-overlay");

  if (!titleEl || !textEl || !btnEl || !overlayEl) return;

  titleEl.textContent = title || "";
  const safeLines = Array.isArray(lines) ? lines : [String(lines || "")];

  textEl.innerHTML = safeLines
    .filter((l) => l !== null && l !== undefined && String(l).trim() !== "")
    .map((l) => `<div>${escapeHtml(String(l))}</div>`)
    .join("");

  btnEl.disabled = !ackRequired;
  overlayEl.classList.remove("hidden");
}

function hideOverlay() {
  const overlayEl = document.getElementById("ack-overlay");
  if (!overlayEl) return;
  overlayEl.classList.add("hidden");
}

/* =========================================================
 *  POWER
 * ========================================================= */

function updatePowerButton(disabled) {
  const btn = document.getElementById("btn-power");
  if (!btn) return;
  btn.disabled = !!disabled;
  btn.classList.toggle("disabled", !!disabled);
}

/* =========================================================
 *  WS → UI STATE
 * =========================================================
 *
 * Erwartete WS-Felder (minimal):
 *  msg.mega2.online
 *  msg.safety.lock
 *  msg.safety.text (string/leer/array)
 * optional (wenn vorhanden, nutzen wir es):
 *  msg.safety.blockReason  (0 none, 1 boot, 2 emergency)
 *  msg.safety.notaus       (0/1)
 */
function getUiStateFromWs(msg, safety, mega2Online) {
  // Mega2 offline → Overlay, aber ACK deaktiviert
  if (!mega2Online) {
    return {
      mega2Online: false,
      level: "ERROR",
      overlay: true,
      ackRequired: false,
      locked: true,
      title: "Mega2 offline",
      text: ["Keine Verbindung – I2C/Power prüfen"]
    };
  }

  // Kein safety-object → OK
  if (!safety) {
    return {
      mega2Online: true,
      level: "OK",
      overlay: false,
      ackRequired: false,
      locked: false,
      title: "",
      text: []
    };
  }

  const lock = safety.lock === true;
  const reason = typeof safety.blockReason === "number" ? safety.blockReason : null;
  const notaus = safety.notaus === true || safety.notaus === 1;

  if (lock) {
    // Text robust normalisieren (string/leer/array)
    const lines = normalizeTextLines(safety.text);

    // Boot-Lock priorisieren, wenn blockReason vorhanden
    if (reason === 1 /* SAFETY_BLOCK_BOOT */) {
      return {
        mega2Online: true,
        level: "WARN",
        overlay: true,
        ackRequired: true,
        locked: true,
        title: "Systemstart – Quittierung erforderlich",
        text: lines.length ? lines : ["Bitte ACK drücken, dann Power On möglich"]
      };
    }

    // Not-Aus / Emergency
    if (reason === 2 /* SAFETY_BLOCK_EMERGENCY */ || notaus) {
      return {
        mega2Online: true,
        level: "EMERGENCY",
        overlay: true,
        ackRequired: true,
        locked: true,
        title: "NOT-AUS – Anlage gestoppt",
        text: lines.length ? lines : ["Sicherheitsabschaltung aktiv"]
      };
    }

    // generischer Safety-Lock (z.B. Fehler present)
    return {
      mega2Online: true,
      level: "ERROR",
      overlay: true,
      ackRequired: true,
      locked: true,
      title: "Safety-Lock aktiv",
      text: lines.length ? lines : ["Fehler vorhanden – bitte ACK drücken"]
    };
  }

  // lock false → OK
  return {
    mega2Online: true,
    level: "OK",
    overlay: false,
    ackRequired: false,
    locked: false,
    title: "",
    text: []
  };
}

/* =========================================================
 *  Helpers
 * ========================================================= */

function normalizeTextLines(text) {
  if (Array.isArray(text)) {
    return text.map((x) => String(x || "").trim()).filter((s) => s.length > 0);
  }
  if (typeof text === "string") {
    const t = text.trim();
    return t ? [t] : [];
  }
  return [];
}

function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =========================================================
 *  LOG WINDOW
 * ========================================================= */

function log(msg) {
  const win = document.getElementById("log-window");
  if (!win) return;

  const d = document.createElement("div");
  d.textContent = msg;
  win.appendChild(d);

  // optional: Log begrenzen
  const MAX = 200;
  while (win.childNodes.length > MAX) {
    win.removeChild(win.firstChild);
  }
}
