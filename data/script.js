/* =========================================================
 *  Eisenbahn WebUI - Safety & Status (WebSocket-only)
 * ========================================================= */

const DEBUG_WS = true;
const DEBUG_UI = false;



// Wenn du nach einem Firmware-Flash "alte" Buttons siehst:
// -> unbedingt auch "Upload File System Image" (UploadFS) ausfuehren.
// Diese Version hilft beim Verifizieren, dass Browser + LittleFS wirklich neu sind.
const UI_VERSION = "2026-01-14-p01";

// ============ UI INVARIANTS (DO NOT BREAK) ============
// 1) Overlay is driven ONLY by WS state; clicks may queue actions but never "pretend" state.
// 2) window.lastStateMsg MUST be set for every received state before any render.
// 3) If safety.lock === false AND selftestRunning === false -> overlay must be closed.
// 4) "Selftest running" may be shown only if WS state explicitly indicates it.
// ======================================================


/* =========================================================
 *  UI Contract Self-Test (IDs + Functions)
 *  - prevents "silent regressions" (e.g. Mega1 shows "keine Daten")
 * ========================================================= */

function uiContractBannerShow(lines) {
  try {
    const id = "ui-contract-banner";
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("div");
      el.id = id;
      el.style.position = "fixed";
      el.style.left = "0";
      el.style.right = "0";
      el.style.bottom = "0";
      el.style.zIndex = "99999";
      el.style.padding = "10px 12px";
      el.style.background = "#7f1d1d"; // dark red
      el.style.color = "#fff";
      el.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
      el.style.fontSize = "13px";
      el.style.lineHeight = "1.35";
      el.style.boxShadow = "0 -6px 18px rgba(0,0,0,0.35)";
      el.style.whiteSpace = "pre-line";
      el.style.opacity = "0.98";
      el.style.cursor = "pointer";
      el.title = "Klicken zum Ausblenden";
      el.addEventListener("click", () => el.remove());
      document.body.appendChild(el);
    }
    el.textContent = String(lines || "").trim();
  } catch (_) { /* ignore */ }
}

function uiContractSelfTest() {
  const missing = [];

  // --- Required DOM IDs (minimum viable UI wiring) ---
  const requiredIds = [
    "ov-m1-stations",
    "ov-m1-turnouts",
    "ack-overlay",
    "ack-title",
    "ack-text",
  ];

  requiredIds.forEach((id) => {
    if (!document.getElementById(id)) missing.push(`DOM fehlt: #${id}`);
  });

  // --- Required JS functions (minimum viable render path) ---
  const requiredFns = [
    "renderOverviewLeft",
    "renderMega1StationsLeft",
    "renderMega1TurnoutsLeft",
    "showOverlay",
  ];

  requiredFns.forEach((fn) => {
    if (typeof window[fn] !== "function") missing.push(`Function fehlt: ${fn}()`);
  });

  // --- State plumbing sanity (optional but helpful) ---
  try {
  if (typeof lastStateMsg === "undefined") {
    // not fatal, but helps debugging
    // (some versions used a different global; we standardize on lastStateMsg)
    // We'll still flag it because it breaks console debugging.
    missing.push("State fehlt: lastStateMsg (wird fuer Debug genutzt)");
  }
} catch (_) { missing.push("State fehlt: lastStateMsg (wird fuer Debug genutzt)"); }

  window.__uiContractOk = (missing.length === 0);

  if (!window.__uiContractOk) {
    const headline = `WEBUI CONTRACT BROKEN (UI_VERSION=${typeof UI_VERSION !== "undefined" ? UI_VERSION : "?"})`;
    console.error(headline, missing);
    uiContractBannerShow([headline, ...missing, "", "=> Ursache ist meist: inkonsistente Datei-Kombination (index/style/script) oder fehlende Render-Funktionen."].join("\n"));
  } else {
    // small, unobtrusive debug log
    console.log(`[UI] contract ok (UI_VERSION=${typeof UI_VERSION !== "undefined" ? UI_VERSION : "?"})`);
  }
}

// Run contract test once DOM is ready (and again shortly after, to catch late-inserted DOM)
(function bootUiContractSelfTest() {
  const run = () => {
    uiContractSelfTest();
    setTimeout(uiContractSelfTest, 750);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
})();


// ------------------------------------------------------------
// Fix: sporadisch verlorene click-Events auf Toggle-Buttons
// -> pointerup erzeugt click nur dann, wenn kein click kam.
// ------------------------------------------------------------
(function installTogglePointerupFallback() {
  const pending = new WeakMap(); // btn -> boolean

  // Wenn click normal kommt: pending zurücksetzen
  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target.closest("button.toggle-btn");
      if (!btn) return;
      pending.set(btn, false);
    },
    true
  );

  document.addEventListener(
    "pointerup",
    (e) => {
      const btn = e.target.closest("button.toggle-btn");
      if (!btn || btn.disabled) return;

      // Markiere click als "erwartet"
      pending.set(btn, true);

      // Nächster Tick: wenn kein click kam, triggern wir ihn
      setTimeout(() => {
        if (pending.get(btn) === true) {
          pending.set(btn, false);
          btn.click();
        }
      }, 0);
    },
    true
  );
})();

/* =========================================================
 *  UI Contract Checks (Runtime Invariants)
 *  - makes regressions visible immediately (banner + console.error)
 *  - does NOT change behavior, only diagnostics
 * ========================================================= */

function contractFail(msg) {
  try {
    console.error(`[UI-CONTRACT] ${msg}`);
    if (typeof uiContractBannerShow === "function") {
      uiContractBannerShow(`UI CONTRACT FAIL:\n${msg}`);
    }
  } catch (_) { /* ignore */ }
}

function getSelftestActiveFromState(s) {
  // IMPORTANT:
  // Only return true if WS state explicitly indicates selftest.
  // Conservative by design to avoid false "selftest running" UI states.
  // normalizeWsState() sets mega2.sbhf.selftestRunning from occupiedMask bit 0x80.
  return !!s?.mega2?.sbhf?.selftestRunning;
}

function runUiContractChecks(state) {
  // C1: lastStateMsg must be present for debugging + render decisions
  if (!window.lastStateMsg) {
    contractFail("window.lastStateMsg is not set (must be set before rendering).");
  }

  const lock = !!state?.safety?.lock;

  // C2: If lock is false, ackPending must not remain true (stuck guard invariant)
  if (!lock && ackPending === true) {
    contractFail("ackPending==true while safety.lock==false (stuck risk / wrong transition).");
  }

  // C3: If UI would claim \"selftest running\", WS must explicitly say so.
  const selftestWs = getSelftestActiveFromState(state);
  if (ackPending === true && lock === true && !selftestWs) {
    contractFail("ackPending==true but WS does not indicate selftestRunning (false selftest UI).");
  }
}




let socket = null;
let wsConnected = false;

// letzter empfangener safety-state vom WS
let lastSafetyState = null;
// letzter empfangener mega2-state (online/flags)
let lastMega2Online = false;

// letzter kompletter WS-State (fuer Button/Disable-Regeln)
let lastStateMsg = null;



// Normalize WS state for backwards compatibility.
// Older firmware sends Mega2 fields flat (allowedMask, warningMask, sbhfState, turnoutSollMask...).
// Newer UI code expects nested objects: mega2.sbhf and mega2.turnouts.
function normalizeWsState(msg) {
  if (!msg || !msg.mega2) return msg;

  const m2 = msg.mega2;

  // Build mega2.sbhf if missing.
  if (!m2.sbhf) {
    const allowedMask = (typeof m2.allowedMask === "number") ? (m2.allowedMask & 0xff) : 0;
    const warningMask = (typeof m2.warningMask === "number") ? (m2.warningMask & 0xff) : 0;

    const occupiedMask = (typeof m2.sbhfOccupiedMask === "number") ? m2.sbhfOccupiedMask : 0;

    m2.sbhf = {
      state: (typeof m2.sbhfState === "number") ? m2.sbhfState : 0,
      currentGleis: (typeof m2.sbhfCurrentGleis === "number") ? m2.sbhfCurrentGleis : 0,
      occupiedMask: occupiedMask,
      allowedMask: allowedMask,
      warningMask: warningMask,
      restricted: (allowedMask !== 0x07 && allowedMask !== 0x00),
      // optional convenience
      selftestRunning: (occupiedMask & 0x80) !== 0
    };
  }

  // Build mega2.turnouts if missing.
  if (!m2.turnouts) {
    const soll = (typeof m2.turnoutSollMask === "number") ? m2.turnoutSollMask : undefined;
    const ist  = (typeof m2.turnoutIstMask === "number") ? m2.turnoutIstMask : undefined;
    if (soll !== undefined || ist !== undefined) {
      m2.turnouts = {
        sollMask: soll ?? 0,
        istMask: ist ?? 0
      };
    }
  }

  return msg;
}
// ACK wurde gesendet, aber Safety-Lock ist (noch) aktiv.
// Wird zurueckgesetzt, sobald safety.lock wieder false ist.
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
    // onclose kommt meist danach sowieso, aber fuers Log ok
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
    logLine("WS nicht verbunden - Aktion nicht moeglich");
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
  logLine(" Pruefen gesendet");
}

function sendSbhfSelftestRetry() {
  wsSend({ action: "sbhfSelftestRetry" });
  logLine(" SBHF Selftest-Retry gesendet");
}


function wsSendAction(action, okMsg) {
  const ok = wsSend({ action: action });
  if (ok && okMsg) logLine(okMsg);
}

/* =========================================================
 *  WS MESSAGE HANDLER
 * ========================================================= */

function handleWsMessage(msg) {
  if (DEBUG_WS) console.log("[WS MSG json]", JSON.stringify(msg));
  if (!msg || msg.type !== "state") return;

  // Backwards compatible shape for renderers (flat vs nested)
  msg = normalizeWsState(msg);

  // Debug/Inspection helper (Browser-Konsole)
  window.lastState = msg;
  window.lastStateMsg = msg;

  // Contract checks (never throw; only diagnostics)
  try {
    runUiContractChecks(msg);
  } catch (e) {
    console.error("[UI-CONTRACT] checks threw", e);
  }


  lastSafetyState = msg.safety || null;
	// Sobald Safety-Lock wieder weg ist, ist ein evtl. laufender Quittierungs-/Test-Flow beendet.
	if (lastSafetyState && lastSafetyState.lock === false) {
	  ackPending = false;
	}
  lastMega2Online = !!(msg.mega2 && msg.mega2.online);
  lastStateMsg = msg;

  const uiState = getUiStateFromWs(msg, lastSafetyState, lastMega2Online);
  applyUiState(uiState, msg);

  // Schritt 2: rechts "Meldungen" befuellen (Safety + SBHF Masken)
  renderPowerWarningsEmergencies(msg);

  // Schritt 3.5: links Betriebsuebersicht (SBHF/Bloecke/Weichen) + FROM->TO Signale
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
        return { title: t.title || '! Sicherheitsquittierung', lines: t.lines || [] };
      }
    }
  } catch (e) {
    console.warn('SAFETY_UI_TEXTS error', e);
  }
  // Fallback: backend-provided text
  if (safety && safety.text) {
    return { title: '! Sicherheitsquittierung', lines: [String(safety.text)] };
  }
  return { title: '! Sicherheitsquittierung', lines: [' Safety aktiv - Bedienung gesperrt'] };
}

function getUiStateFromWs(msg, safety, mega2online) {
  // Default OK
  let level = "OK";
  let text = [" System OK"];
  let title = "";
  let overlay = false;
  let ackRequired = false;
  let hasWarn = false;
  let overlayMode = undefined; // "ack" | "info" | undefined

  if (!mega2online) {
    level = "WARN";
    text = [" Mega2 offline"];
    return { level, text, title, overlay, ackRequired, overlayMode, hasWarn };
  }
  // --- SBHF Selftest Overlay (WS-driven, independent of safety.lock) ---
  const selftestRunning = !!(msg?.mega2?.sbhf?.selftestRunning);
  if (selftestRunning) {
    level = "WARN";
    overlay = true;
    ackRequired = false;
    title = " SBHF Weichentest laeuft";
    text = [
        "Bitte warten ...",
        "Der Selbsttest laeuft im Hintergrund und wird automatisch abgeschlossen.",
    ];

    overlayMode = "info"; // Info-only -> keine Buttons/Checkbox
    return { level, text, title, overlay, ackRequired, overlayMode, hasWarn };
  }


  // Safety lock dominates everything
  if (safety && safety.lock === true) {
    level = 'ERR';
    overlay = true;
    ackRequired = true;
    overlayMode = "ack";

    const t = getSafetyOverlayTexts(safety);
    title = t.title || '! Sicherheitsquittierung';
    text = (t.lines && t.lines.length) ? t.lines : [' Safety aktiv - Bedienung gesperrt'];

    return { level, text, title, overlay, ackRequired, overlayMode, hasWarn };
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
      text = [" Warning aktiv"];
    }
  }

  return { level, text, title, overlay, ackRequired, overlayMode, hasWarn };
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
    showOverlay(ui.title, ui.text, ui.ackRequired, { mode: ui.overlayMode });
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
const bMode = document.getElementById("badge-mode");
const bPw = document.getElementById("badge-power");
const bNo = document.getElementById("badge-notaus");

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
if (bMode) {
  const modeRaw = msg?.mega1?.diag?.mode;
  const mode = (modeRaw === undefined || modeRaw === null) ? -1 : Number(modeRaw);
  const isAuto = (mode === 1);
  if (mode < 0 || Number.isNaN(mode)) {
    bMode.className = "badge badge-warn";
    bMode.textContent = "Mode: ?";
  } else {
    bMode.className = "badge " + (isAuto ? "badge-ok" : "badge-info");
    bMode.textContent = isAuto ? "Auto" : "Manuell";
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



  // --------------------------------------------------
  // Buttons: Power (2 buttons) + Mode (toggle)
  // --------------------------------------------------

  const btnPowerOn = document.getElementById("btn-power-on");
  const btnPowerOff = document.getElementById("btn-power-off");

  if (btnPowerOn) {
    // fixed label (Aktion). Status ist ueber Pill/Badge sichtbar.
    btnPowerOn.textContent = " POWER ON";
    btnPowerOn.classList.toggle("is-offline", !mega2online);
    // enabled nur wenn Power aus und keine Sperre
    btnPowerOn.disabled = (!wsOk || !mega2online) ? true : (powerOn || lock || notausActive);
  }

  if (btnPowerOff) {
    btnPowerOff.textContent = " STOP / POWER OFF";
    btnPowerOff.classList.toggle("is-offline", !mega2online);
    // enabled nur wenn Power an
    btnPowerOff.disabled = (!wsOk || !mega2online) ? true : (!powerOn);
  }

  const btnMode = document.getElementById("btn-mode");
  if (btnMode) {
    btnMode.textContent = "AUTO / MANUELL";

    const modeRaw = msg?.mega1?.diag?.mode;
    const mode = (modeRaw === undefined || modeRaw === null) ? -1 : Number(modeRaw);
    const isAuto = (mode === 1);
    const canUseMode = wsOk && mega2online && mega1online && !lock && !notausActive && (mode >= 0) && !Number.isNaN(mode);

    btnMode.disabled = !canUseMode;
    btnMode.classList.toggle("is-auto", isAuto && canUseMode);
    btnMode.classList.toggle("is-manual", (!isAuto) && canUseMode);
    btnMode.classList.toggle("is-offline", !mega1online);
  }
}

/* =========================================================
 *  ACTIONS (WebSocket-only)
 * ========================================================= */

function sendNothalt() {
  wsSendAction("nothalt", "NOTAUS gesendet");
}


function sendPowerOn() {
  // Verbindung pruefen (damit der Klick nicht "ins Leere" laeuft)
  if (!wsConnected || !socket || socket.readyState !== 1) {
    logLine("WS nicht verbunden - Aktion nicht gesendet");
    return;
  }

  // Mega2-Online pruefen
  if (!lastMega2Online) {
    logLine("Mega2 offline - Aktion nicht gesendet");
    return;
  }

  const powerOn = !!(lastSafetyState && lastSafetyState.powerOn === true);
  if (powerOn) {
    logLine("Power ist bereits AN");
    return;
  }

  const notausActive = !!(lastSafetyState && lastSafetyState.notausActive === true);
  const safetyLock   = !!(lastSafetyState && lastSafetyState.lock === true);
  if (safetyLock || notausActive) {
    showAckOverlay(
      (lastSafetyState && lastSafetyState.text) ||
        "Power On nicht moeglich - Safety aktiv oder HW-NOT-AUS"
    );
    return;
  }

  wsSendAction("powerOn", "POWER ON gesendet");
}
function sendPowerOff() {
  // Verbindung pruefen
  if (!wsConnected || !socket || socket.readyState !== 1) {
    logLine("WS nicht verbunden - Aktion nicht gesendet");
    return;
  }

  // Mega2-Online pruefen
  if (!lastMega2Online) {
    logLine("Mega2 offline - Aktion nicht gesendet");
    return;
  }

  const powerOn = !!(lastSafetyState && lastSafetyState.powerOn === true);
  if (!powerOn) {
    logLine("Power ist bereits AUS");
    return;
  }

  // STOP/POWER OFF ist auch bei Safety-Lock erlaubt (UI-STOP).
  wsSendAction("powerOff", "STOP / POWER OFF gesendet");
}
function sendModeToggle() {
  // Voraussetzung: WS + Mega1 online
  const mega1online = !!(lastStateMsg && lastStateMsg.mega1 && lastStateMsg.mega1.online);

  if (!wsConnected || !socket || socket.readyState !== 1) {
    logLine("WS nicht verbunden - Aktion nicht gesendet");
    return;
  }
  if (!mega1online) {
    logLine("Mega1 offline - Aktion nicht gesendet");
    return;
  }

  const notausActive = !!(lastSafetyState && lastSafetyState.notausActive === true);
  const safetyLock   = !!(lastSafetyState && lastSafetyState.lock === true);
  if (safetyLock || notausActive) {
    logLine("Mode-Umschaltung gesperrt (Safety/HW-NOT-AUS)");
    return;
  }

  const modeRaw = lastStateMsg?.mega1?.diag?.mode;
  const mode = (modeRaw === undefined || modeRaw === null) ? -1 : Number(modeRaw);
  if (mode < 0 || Number.isNaN(mode)) {
    logLine("Mode unbekannt - Aktion nicht gesendet");
    return;
  }

  // Toggle: 1 <-> 0
  const newMode = (mode === 1) ? 0 : 1;

  const ok = wsSend({ action: "m1SetMode", mode: newMode });
  if (ok) logLine("Mode gesetzt: " + (newMode === 1 ? "Auto" : "Manuell"));
}


function sendM1BhfToggle(bhf1) {
  const mega1online = !!(lastStateMsg && lastStateMsg.mega1 && lastStateMsg.mega1.online);
  if (!wsConnected || !socket || socket.readyState !== 1) {
    logLine("WS nicht verbunden - Aktion nicht gesendet");
    return;
  }
  if (!mega1online) {
    logLine("Mega1 offline - Aktion nicht gesendet");
    return;
  }
  const notausActive = !!(lastSafetyState && lastSafetyState.notausActive === true);
  const safetyLock   = !!(lastSafetyState && lastSafetyState.lock === true);
  if (safetyLock || notausActive) {
    logLine("Bahnhof-Toggle gesperrt (Safety/HW-NOT-AUS)");
    return;
  }

  const diag = lastStateMsg?.mega1?.diag;
  const powerMask = Number(diag?.powerMask ?? 0);
  const idx0 = Number(bhf1) - 1;
  if (idx0 < 0 || idx0 >= 4) return;

  const curOn = ((powerMask >> idx0) & 1) === 1;
  const newOn = !curOn;

  const ok = wsSend({ action: "m1PowerSet", bhf: idx0, on: newOn });
  if (ok) logLine(`BHF${bhf1} -> ${newOn ? "AN" : "aus"}`);
}

function sendM1WeicheToggle(idxW) {
  const mega1online = !!(lastStateMsg && lastStateMsg.mega1 && lastStateMsg.mega1.online);
  if (!wsConnected || !socket || socket.readyState !== 1) {
    logLine("WS nicht verbunden - Aktion nicht gesendet");
    return;
  }
  if (!mega1online) {
    logLine("Mega1 offline - Aktion nicht gesendet");
    return;
  }
  const notausActive = !!(lastSafetyState && lastSafetyState.notausActive === true);
  const safetyLock   = !!(lastSafetyState && lastSafetyState.lock === true);
  if (safetyLock || notausActive) {
    logLine("Weichen-Toggle gesperrt (Safety/HW-NOT-AUS)");
    return;
  }

  const diag = lastStateMsg?.mega1?.diag;
  const istBits = Number(diag?.weicheIstBits ?? 0);
  const i = Number(idxW);
  if (i < 0 || i >= 12) return;

  const curGerade = ((istBits >> i) & 1) === 1;
  const newGerade = !curGerade;

  const ok = wsSend({ action: "m1TurnoutSet", idx: i, gerade: newGerade });
  if (ok) logLine(`W${i} -> ${newGerade ? "Gerade" : "Abzweig"}`);
}



/* =========================================================
 *  ACK OVERLAY
 * ========================================================= */

function showOverlay(title, lines, requireChecked, options = {}) {
  const overlay = document.getElementById("ack-overlay");
  const titleEl = document.getElementById("ack-title");
  const textEl = document.getElementById("ack-text");
  const checkbox = overlay?.querySelector("input[type=checkbox]");
  const ackBtn = overlay?.querySelector(".btn-ack");
  const cancelBtn = overlay?.querySelector(".btn-cancel"); // falls vorhanden

  if (!overlay || !titleEl || !textEl) return;

  const wasHidden = overlay.classList.contains("hidden");
  overlay.classList.remove("hidden");

  // Modes:
  // - "ack": normaler ACK-Overlay mit Checkbox
  // - "info": reine Info (z.B. Selftest läuft) -> keine Buttons/Checkbox
  const mode = options.mode || (requireChecked === false ? "info" : "ack");

  titleEl.textContent = title || "! Sicherheitsquittierung";

  const safeLines = (Array.isArray(lines) ? lines : [lines])
    .filter(Boolean)
    .map((l) => escapeHtml(String(l)));

  textEl.innerHTML = safeLines.join("<br>");

  // ---------- INFO ONLY ----------
  if (mode === "info") {
    // Alles an Interaktion ausblenden
    if (ackBtn) ackBtn.style.display = "none";
    if (cancelBtn) cancelBtn.style.display = "none";
    if (checkbox) checkbox.style.display = "none";
    return;
  }

  // ---------- ACK MODE ----------
  // Interaktion sichtbar machen (falls zuvor "info")
  if (ackBtn) ackBtn.style.display = "";
  if (cancelBtn) cancelBtn.style.display = "";
  if (checkbox) checkbox.style.display = "";

  // ACK senden ist nur sinnvoll, wenn WS ok und Mega2 online.
  const canAckSend = (wsConnected === true) && (lastMega2Online === true);

  // Checkbox handling
  if (checkbox) {
    // Nicht bei jedem WS-State-Update zuruecksetzen.
    if (wasHidden) checkbox.checked = false;
    checkbox.disabled = false;
  }

  // ACK button
  if (ackBtn) {
    const enabled = canAckSend && (checkbox?.checked === true);
    ackBtn.disabled = !enabled;
    ackBtn.textContent = "ACK";
  }

  // Live-Enable/Disable ACK Button bei Checkbox-Änderung
  if (checkbox && ackBtn) {
    if (!checkbox.__ackListenerInstalled) {
      checkbox.__ackListenerInstalled = true;

      const syncAckEnabled = () => {
        const enabled = (wsConnected === true) && (lastMega2Online === true) && (checkbox.checked === true);
        ackBtn.disabled = !enabled;
      };

      checkbox.addEventListener("change", syncAckEnabled);
      syncAckEnabled();
    }
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
    logLine("Bitte vor Ort pruefen und Checkbox bestaetigen.");
    return;
  }

  const ok = wsSend({ action: "safetyAck" });
  if (ok) {
    logLine("ACK gesendet.");
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
    items.push(` ${escapeHtml(String(safety.text))}`);
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
      items.push(" SBHF gesperrt (kein sicherer Pfad)");
    } else {
      items.push(` SBHF erlaubte Gleise: ${tracks.length ? tracks.join(", ") : "-"}`);
    }

    const restricted =
      ((warn & WARN_RESTRICTED_MODE) !== 0) ||
      (allowed !== 0x07 && allowed !== 0x00);

    if (restricted) items.push("! SBHF: Restricted Mode aktiv");
    if (warn & WARN_W12_DEFECT) items.push("! W12 defekt");
    if (warn & WARN_W13_DEFECT) items.push("! W13 defekt");
    if (warn & WARN_W14_DEFECT) items.push("i W14 Stoerung");
    if (warn & WARN_W15_DEFECT) items.push("i W15 Stoerung");
    if (warn & WARN_SBH_SERVICE_REQUIRED) items.push(" Service erforderlich");
  }

  

// 3) " Pruefen" (PollNow), wenn Warnings/Restricted aktiv sind
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

const canMega2 = wsConnected && !!(msg && msg.mega2 && msg.mega2.online);
const selftestRunning = !!(msg?.mega2?.sbhf?.selftestRunning);
const lock = !!(msg?.safety?.lock);

let weicheWarnActive = false;
if (m2 && m2.sbhf) {
  const warn = Number(m2.sbhf.warningMask || 0) & 0xff;
  // W12..W15 + Service erforderlich (UI-contract bits)
  const WEICHE_WARN_MASK = 0x02 | 0x04 | 0x08 | 0x10 | 0x20;
  weicheWarnActive = (warn & WEICHE_WARN_MASK) !== 0;
}

const retryBtn = weicheWarnActive
  ? `<button class="btn-mini" ${(canMega2 && !selftestRunning && !lock) ? "" : "disabled"} onclick="sendSbhfSelftestRetry()"> SBHF Selftest erneut</button>`
  : "";

const actionsHtml = retryBtn
  ? `<div class="msg-actions">${retryBtn}</div>`
  : "";

el.innerHTML = (items.length ? items.map(t => `<div>${t}</div>`).join("") : "<em>Keine Meldungen</em>") + actionsHtml;

}

/* =========================================================
 *  Schritt 3.5: Links - Betriebsuebersicht + Block-Signale
 * ========================================================= */

function bit(mask, i) {
  return ((mask >>> i) & 1) !== 0;
}

function renderOverviewLeft(msg) {
  renderSbhfLeft(msg);
  renderTurnoutsLeft(msg);
  renderBlocksLeft(msg);

  // Mega1 ist in zwei Panels aufgeteilt (Layout 2x2):
  renderMega1StationsLeft(msg);   // -> #ov-m1-stations
  renderMega1TurnoutsLeft(msg);   // -> #ov-m1-turnouts
}

function getMega1DiagContext(msg) {
  const mega1online = !!(msg?.mega1?.online);
  const hasDiag = !!(msg?.mega1?.hasDiag);
  const diag = msg?.mega1?.diag || null;

  const wsOk = (wsConnected === true);
  const lock = !!(lastSafetyState?.lock === true);
  const notausActive = !!(lastSafetyState?.notausActive === true);

  // Enable rules for CMD buttons
  const canCmd = wsOk && mega1online && !lock && !notausActive;

  return { mega1online, hasDiag, diag, wsOk, lock, notausActive, canCmd };
}

function renderMega1StationsLeft(msg) {
  const el = document.getElementById("ov-m1-stations");
  if (!el) return;

  const { mega1online, hasDiag, diag, canCmd, wsOk, lock, notausActive } = getMega1DiagContext(msg);

  if (!mega1online) {
    el.innerHTML = "<em>keine Daten</em>";
    return;
  }
  if (!hasDiag || !diag) {
    el.innerHTML = "<em>keine Daten</em>";
    return;
  }

  const powerMask = Number(diag.powerMask ?? 0);
  const mkPill = (text, cls) => `<span class="pill ${cls}">${text}</span>`;

  // Bahnhoefe 1..4 (powerMask bit0..3)
  const bhfBtns = [];
  for (let i = 0; i < 4; i++) {
    const on = ((powerMask >> i) & 1) === 1;
    const cls = "toggle-btn " + (on ? "is-on" : "is-off");
    const st = mkPill(on ? "AN" : "aus", on ? "pill-on" : "pill-off");
    const dis = canCmd ? "" : "disabled";
    bhfBtns.push(
      `<button class="${cls}" ${dis} onclick="sendM1BhfToggle(${i + 1})">
        <div class="toggle-title">BHF ${i + 1}</div>
        <div class="toggle-state">${st}</div>
      </button>`
    );
  }

  const lockHint = (!canCmd)
    ? `<div class="hint" style="margin-top:.5rem;">CMD gesperrt: ${!wsOk ? "WS down" : (lock ? "Safety-Lock" : (notausActive ? "HW-NOT-AUS" : ""))}</div>`
    : "";

  el.innerHTML = `
    <div class="m1-section">
      <div class="toggle-grid grid-4">
        ${bhfBtns.join("")}
      </div>
    </div>
    ${lockHint}
  `;
}

function renderMega1TurnoutsLeft(msg) {
  const el = document.getElementById("ov-m1-turnouts");
  if (!el) return;

  const { mega1online, hasDiag, diag, canCmd, wsOk, lock, notausActive } = getMega1DiagContext(msg);

  if (!mega1online) {
    el.innerHTML = "<em>keine Daten</em>";
    return;
  }
  if (!hasDiag || !diag) {
    el.innerHTML = "<em>keine Daten</em>";
    return;
  }

  const ist = Number(diag.weicheIstBits ?? 0);
  const soll = Number(diag.weicheSollBits ?? 0);
  const slow = Number(diag.weicheSlowBits ?? 0);

  const mkPill = (text, cls) => `<span class="pill ${cls}">${text}</span>`;

  const wBtns = [];
  for (let i = 0; i < 12; i++) {
    const curG = ((ist >> i) & 1) === 1;
    const sG   = ((soll >> i) & 1) === 1;
    const isSlow = ((slow >> i) & 1) === 1;

    const dis = canCmd ? "" : "disabled";

    // Trennung der Infos:
    // - Button-Farbe nach IST (G/A)
    // - Abweichung (IST!=SOLL) als separate Zeile
    // - Slow als separate Zeile
    const cls = ["toggle-btn", curG ? "is-on" : "is-off", isSlow ? "is-slow" : ""].join(" ").trim();

    const istSollLine = `<div class="toggle-sub">Ist: ${curG ? "G" : "A"}&nbsp;&nbsp;Soll: ${sG ? "G" : "A"}</div>`;
    const okLine = `<div class="toggle-sub">${mkPill((sG === curG) ? "OK" : "ABW.", (sG === curG) ? "pill-ok" : "pill-warn")}</div>`;
    const slowLine = isSlow ? `<div class="toggle-sub">${mkPill("Slow aktiv", "pill-info")}</div>` : "";

    wBtns.push(
      `<button class="${cls}" ${dis} onclick="sendM1WeicheToggle(${i})">
        <div class="toggle-title">W ${i}</div>
        ${istSollLine}
        ${okLine}
        ${slowLine}
      </button>`
    );
  }

  const lockHint = (!canCmd)
    ? `<div class="hint" style="margin-top:.5rem;">CMD gesperrt: ${!wsOk ? "WS down" : (lock ? "Safety-Lock" : (notausActive ? "HW-NOT-AUS" : ""))}</div>`
    : "";

  el.innerHTML = `
    <div class="m1-section">
      <div class="toggle-grid grid-6">
        ${wBtns.join("")}
      </div>
    </div>
    ${lockHint}
  `;
}


function fmtHex(v, width) {
  const n = Number(v) >>> 0;
  const s = n.toString(16).toUpperCase();
  return "0x" + s.padStart(width || 2, "0");
}

function renderStationsLeft(msg) {
  const el = document.getElementById("ov-stations");
  if (!el) return;

  const mega1online = !!(msg && msg.mega1 && msg.mega1.online);
  const hasDiag = !!(msg && msg.mega1 && msg.mega1.hasDiag);
  const wsOk = (wsConnected === true);
  const lock = !!(lastSafetyState && lastSafetyState.lock === true);
  const notausActive = !!(lastSafetyState && lastSafetyState.notausActive === true);

  if (!mega1online) {
    el.innerHTML = `<div class="hint">Mega1 offline</div>`;
    return;
  }
  if (!hasDiag || !msg.mega1.diag) {
    el.innerHTML = `<div class="hint">Mega1 online - diag noch nicht verfuegbar</div>`;
    return;
  }

  const diag = msg.mega1.diag;
  const mode = Number(diag.mode ?? 0);
  const powerMask = Number(diag.powerMask ?? 0);
  const ist = Number(diag.weicheIstBits ?? 0);
  const soll = Number(diag.weicheSollBits ?? 0);
  const slow = Number(diag.weicheSlowBits ?? 0);

  // Enable rules for CMD buttons
  const canCmd = wsOk && mega1online && !lock && !notausActive;

  const modeText = (mode === 1) ? "Auto" : "Manuell";
  const modeCls  = (mode === 1) ? "badge-ok" : "badge-info";

  const mkPill = (text, cls) => `<span class="pill ${cls}">${text}</span>`;

  // Bahnhoefe 1..4 (powerMask bit0..3)
  const bhfBtns = [];
  for (let i = 0; i < 4; i++) {
    const on = ((powerMask >> i) & 1) === 1;
    const cls = "toggle-btn " + (on ? "is-on" : "is-off");
    const st = mkPill(on ? "AN" : "aus", on ? "pill-on" : "pill-off");
    const dis = canCmd ? "" : "disabled";
    bhfBtns.push(
      `<button class="${cls}" ${dis} onclick="sendM1BhfToggle(${i+1})">
        <div class="toggle-title">BHF ${i+1}</div>
        <div class="toggle-state">${st}</div>
      </button>`
    );
  }

  // Weichen 0..11 (Ist gerade Bits)
  const wBtns = [];
  for (let i = 0; i < 12; i++) {
    const curG = ((ist >> i) & 1) === 1;
    const sG   = ((soll >> i) & 1) === 1;
    const isSlow = ((slow >> i) & 1) === 1;

    const cls = ["toggle-btn", curG ? "is-on" : "is-off", isSlow ? "is-slow" : ""].join(" ").trim();
    const dis = canCmd ? "" : "disabled";

    const st = mkPill(curG ? "Gerade" : "Abzweig", curG ? "pill-on" : "pill-off");
    const stSoll = mkPill("Soll: " + (sG ? "G" : "A"), (sG === curG ? "pill-ok" : "pill-warn"));
    const slowTag = isSlow ? mkPill("Slow", "pill-info") : "";

    wBtns.push(
      `<button class="${cls}" ${dis} onclick="sendM1WeicheToggle(${i})">
        <div class="toggle-title">W ${i}</div>
        <div class="toggle-state">${st}</div>
        <div class="toggle-sub">${stSoll}${slowTag}</div>
      </button>`
    );
  }

  const lockHint = (!canCmd)
    ? `<div class="hint" style="margin-top:.5rem;">CMD gesperrt: ${!wsOk ? "WS down" : (lock ? "Safety-Lock" : (notausActive ? "HW-NOT-AUS" : ""))}</div>`
    : "";

  el.innerHTML = `
    <div class="m1-summary">
      <div class="badge-row">
        <span class="badge ${modeCls}">Mode: ${modeText}</span>
        <span class="badge badge-warn">PowerMask: ${powerMask}</span>
        <span class="badge badge-warn">Ist: ${fmtHex(ist, 4)}</span>
      </div>
    </div>

    <div class="m1-section">
      <div class="m1-title">Bahnhoefe</div>
      <div class="toggle-grid grid-4">
        ${bhfBtns.join("")}
      </div>
    </div>

    <div class="m1-section">
      <div class="m1-title">Weichen</div>
      <div class="toggle-grid grid-6">
        ${wBtns.join("")}
      </div>
    </div>

    ${lockHint}
  `;
}

/* =========================================================
 *  Mega2: SBHF / Weichen / Bloecke (INFO only)
 *  (Fix: previous patch accidentally injected \1 + escaped quotes)
 * ========================================================= */

function renderSbhfLeft(msg) {
  const el = document.getElementById("ov-sbhf");
  if (!el) return;
  el.classList.add("mega2-info");

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
    <div class="info-row"><span>State:</span><strong>${state}</strong></div>
    <div class="info-row"><span>Ausfahr-Gleis:</span><strong>${g}</strong></div>
    <div class="info-row"><span>Belegt:</span><strong>${occList.length ? occList.join(", ") : "-"}</strong></div>
    <div class="info-row"><span>Erlaubt:</span><strong>${allowList.length ? allowList.join(", ") : "-"}</strong></div>
    <div class="info-row"><span>Restricted:</span><strong>${restricted ? "ja" : "nein"}</strong></div>
  `;
}

function renderTurnoutsLeft(msg) {
  const el = document.getElementById("ov-turnouts");
  if (!el) return;
  el.classList.add("mega2-info");

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
    html += `<span class="badge ${ok ? "badge-ok" : "badge-warn"}">${names[i]} Soll:${s} Ist:${r}</span>`;
  }
  html += `</div>`;
  el.innerHTML = html;
}

function renderBlocksLeft(msg) {
  const el = document.getElementById("ov-blocks");
  if (!el) return;
  el.classList.add("mega2-info");

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
    html += `<span class="badge ${occ ? "badge-err" : "badge-ok"}">B${i + 1} ${occ ? "belegt" : "frei"}</span>`;
  }
  html += `</div>`;

  // 2) FROM->TO Signale (fixe Liste nach Topologie)
  if (Array.isArray(entryPrev) && entryPrev.length >= 9 && Array.isArray(entryNow) && entryNow.length >= 9) {
    const pairs = [
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 1],
      [4, 5],
      [5, 7],
      [5, 8],
      [5, 9],
      [7, 6],
      [8, 6],
      [9, 6],
      [6, 4],
    ];

    html += `<div style="margin-top:0.8rem;"><b>Signale (FROM -> TO):</b></div>`;
    html += `<div class="badge-wrap">`;

    for (const [from, to] of pairs) {
      const maskPrev = entryPrev[from - 1] ?? 0;
      const maskNow  = entryNow[from - 1] ?? 0;

      const prevOk = (maskPrev & (1 << (to - 1))) !== 0;
      const nowOk  = (maskNow  & (1 << (to - 1))) !== 0;

      html += `<span class="badge ${prevOk ? "badge-ok" : "badge-err"}" style="line-height:1.15; padding-top:6px; padding-bottom:6px;">
        <div style="font-size:0.85em; opacity:0.85;">P: B${from}->B${to}</div>
        <div style="font-weight:700;">N: ${nowOk ? "OK" : "STOP"}</div>
      </span>`;
    }

    html += `</div>`;
  } else {
    html += `<div style="margin-top:0.8rem;"><em>Signale: keine Daten</em></div>`;
  }

  el.innerHTML = html;
}
