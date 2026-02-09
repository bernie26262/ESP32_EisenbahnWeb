/* =========================================================
 *  Eisenbahn WebUI - Safety & Status (WebSocket-only)
 * ========================================================= */

const DEBUG_WS = true;
const DEBUG_UI = false;


// SystemStatus.flags bits (include/system/system_status_payload.h)
// Keep in sync with firmware. Used ONLY for UI level/badges.
const SYS_WARNING_PRESENT = 0x10;

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
// ------------------------------------------------------------
// Startup session tracking (avoid "startup checklist" overlay on selftest retry)
// ------------------------------------------------------------
let g_startupSessionActive = false;
// ------------------------------------------------------------
// UI one-shot hint: SBHF selftest finished, power remains OFF
// (shown in right message list for a short time)
// ------------------------------------------------------------
let uiPrevSbhfSelftestRunning = null;
let uiSbhfSelftestPowerHintShown = false;
let uiPrevM1SelftestRunning = null;
let uiM1SelftestPowerHintShown = false;
let uiTransientInfoText = null;
let uiTransientInfoUntil = 0;

 
 // Overlay spinner helper (do not recreate DOM on every WS tick)
 function ensureOverlaySpinner(textEl) {
   if (!textEl) return;
   if (textEl.__spinnerInstalled) return;
   textEl.__spinnerInstalled = true;
 
   const wrap = document.createElement("div");
   wrap.className = "ui-info-wait-wrap";
 
   const sp = document.createElement("span");
   sp.className = "ui-spinner";
   sp.setAttribute("aria-hidden", "true");
   // Inject spinner CSS once (so we don't show the hourglass fallback)
   if (!document.getElementById("ui-spinner-css")) {
     const st = document.createElement("style");
     st.id = "ui-spinner-css";
     st.textContent = `
       .ui-spinner{
         display:inline-block;
         width:1.05em;height:1.05em;
         border:0.18em solid rgba(0,0,0,.25);
         border-top-color: rgba(0,0,0,.65);
         border-radius:999px;
         animation: uiSpin .8s linear infinite;
         vertical-align:-0.15em;
         margin-right:0.45em;
       }
       @keyframes uiSpin { to { transform: rotate(360deg); } }
     `;
     document.head.appendChild(st);
   }
   sp.textContent = "";
 
   const cont = document.createElement("div");
   cont.className = "ui-info-lines";
 
   // Move current content into cont
   cont.innerHTML = textEl.innerHTML;
   textEl.innerHTML = "";
 
   wrap.appendChild(sp);
   wrap.appendChild(cont);
   textEl.appendChild(wrap);
 }


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
  bindMega1DelegatedClicks();
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
    // Subscription: base UI wants normal state/analog; diag UI will override to diag:true
    try { wsSend({ action: "subscribe", base: true, diag: false }); } catch (e) {}
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
  // Always log locally so we can see whether the click happened at all.
  logLine("SBHF Selftest start/retry (WS action) ...");

  const st = window.lastStateMsg || {};
  const lock = (st?.safety?.lock === true);

  // If we're locked, try to ACK/unlock first.
  // Note: ackRequired might be false due to UI/state quirks; we still send safetyAck if lock==true.
  if (lock) {
    const okA = wsSend({ action: "safetyAck" });
    if (okA) logLine("Safety ACK (vor SBHF Selftest)");
    else     logLine("Safety ACK NICHT gesendet (WS down?)");
  }

  // Komfort/UX wie bei Mega1: vor dem Selftest Power ausschalten.
  // (Viele SBHF-Selftests setzen voraus, dass Leistung aus ist.)
  const okP = wsSend({ action: "powerOff" });
  if (okP) logLine("Power OFF (vor SBHF Selftest)");

  // Give ACK/PowerOff a moment to propagate before sending the retry command.
  // This avoids "retry rejected: lock=1" right after the click.
  setTimeout(() => {
    const ok = wsSend({ action: "sbhfSelftestRetry" });
    if (ok) logLine("SBHF Selftest-Retry gesendet");
    else    logLine("SBHF Selftest-Retry NICHT gesendet (WS down?)");
  }, lock ? 250 : 0);
}


function sendSbhfSelftestStartup() {
  // Only used by the Startup-Checklist button.
  // This must NOT be used in diag/systemstatus, otherwise we'd re-trigger startup logic.
  logLine(" SBHF Selftest STARTUP (WS action) ...");

  // Komfort/UX: vor dem Selftest Power ausschalten.
  const okP = wsSend({ action: "powerOff" });
  if (okP) logLine(" Power OFF (vor SBHF Selftest)");

  const ok = wsSend({ action: "sbhfSelftestStartup" });
  if (ok) logLine(" SBHF Selftest-STARTUP gesendet");
  else    logLine(" SBHF Selftest-STARTUP NICHT gesendet (WS down?)");
}

function sendM1SelftestRetry() {
  // Always log locally so we can see whether the click happened at all.
  logLine("Mega1 Selftest start/retry (WS action) ...");

  const st = window.lastStateMsg || {};
  const lock = (st?.safety?.lock === true);

  // If we're locked, try to ACK/unlock first.
  if (lock) {
    const okA = wsSend({ action: "safetyAck" });
    if (okA) logLine("Safety ACK (vor Mega1 Selftest)");
    else     logLine("Safety ACK NICHT gesendet (WS down?)");
  }

  // Komfort/UX: wie bei Mega2 -> vor Selftest Power ausschalten.
  // (Power muss nach dem Test manuell wieder eingeschaltet werden.)
  const okP = wsSend({ action: "powerOff" });
  if (okP) logLine("Power OFF (vor Mega1 Selftest)");

  // Give ACK a moment to propagate before sending the start command.
  setTimeout(() => {
    const ok = wsSend({ action: "m1SelftestStart" });
    if (ok) logLine("Mega1 Selftest-Retry gesendet");
    else    logLine("Mega1 Selftest-Retry NICHT gesendet (WS down?)");
  }, lock ? 250 : 0);

  // Hinweis: "Power bleibt aus" wird nach Testende (falling edge) transient angezeigt.
}


function wsSendAction(action, okMsg) {
  const ok = wsSend({ action: action });
  if (ok && okMsg) logLine(okMsg);
}

/* =========================================================
 *  WS MESSAGE HANDLER
 * ========================================================= */

function handleWsMessage(msg) {
  // NOTE: We throttle analog logs further down (every 10th frame),
  // so keep the generic DEBUG_WS log disabled for analog to avoid console spam.
  // (State logs remain as before.)
  // if (DEBUG_WS) console.log("[WS MSG json]", JSON.stringify(msg));
  if (!msg) return;

  // Error frames (e.g. DIAG_ACTIVE gating)
  if (msg.type === "error") {
    const code = msg.code || "ERROR";
    const ownerId = (msg.ownerId != null) ? msg.ownerId : "";
    logLine(`⚠ ${code}${ownerId !== "" ? ` (owner ${ownerId})` : ""}: ${msg.msg || ""}`);
    return;
  }

  // Fast-path: analog stream (periodic, small)
  if (msg.type === "analog") {
    // Log only every 10th analog frame to keep console readable
    if (DEBUG_WS) {
      window.__wsAnalogLogN = (window.__wsAnalogLogN || 0) + 1;
      if ((window.__wsAnalogLogN % 10) === 0) {
        console.log("[WS MSG json][analog x10]", JSON.stringify(msg));
      }
    }

    window.lastStateMsg = window.lastStateMsg || {};
    window.lastStateMsg.mega2 = window.lastStateMsg.mega2 || {};
    window.lastStateMsg.mega2.analog = msg.analog || {};

    // Update only analog-related UI parts (cheap, avoids full re-render)
    try { renderTrafoRight(window.lastStateMsg); } catch (e) { console.warn("[UI] renderTrafoRight(analog) failed:", e); }
    try { renderBlocksLeft(window.lastStateMsg); } catch (e) { console.warn("[UI] renderBlocksLeft(analog) failed:", e); }
    return;
  }

  if (msg.type !== "state") return;
  
  // Keep state logging as-is (full state frames are infrequent now)
  if (DEBUG_WS) console.log("[WS MSG json][state]", JSON.stringify(msg));

  // Backwards compatible shape for renderers (flat vs nested)
  msg = normalizeWsState(msg);

  // Debug/Inspection helper (Browser-Konsole)
  window.lastState = msg;
  window.lastStateMsg = msg;

  // ------------------------------------------------------------
// One-shot UI hint after SBHF selftest finished
// ------------------------------------------------------------
try {
  const sbhf = msg?.mega2?.sbhf;
  const safety = msg?.safety;

  if (sbhf && typeof sbhf.selftestRunning === "boolean") {
    // re-arm for next run
    if (uiPrevSbhfSelftestRunning === false && sbhf.selftestRunning === true) {
      uiSbhfSelftestPowerHintShown = false;
    }

    // detect falling edge: true -> false
    if (
      uiPrevSbhfSelftestRunning === true &&
      sbhf.selftestRunning === false &&
      safety?.powerOn === false &&
      uiSbhfSelftestPowerHintShown === false
    ) {

       // Transient UI message (right-hand message list), text from safety_ui_texts.js
      const t = window.SAFETY_UI_TEXTS?.fromKey?.("INFO_SELFTEST_POWER_STAYS_OFF");
      const line = (t?.lines && t.lines.length) ? String(t.lines[0]) : null;
      if (line) {
        uiTransientInfoText = line;
        uiTransientInfoUntil = Date.now() + 12000; // 12s
      } else {
        console.info("[UI] INFO_SELFTEST_POWER_STAYS_OFF missing in safety_ui_texts.js");
      }

      uiSbhfSelftestPowerHintShown = true;
    }

    uiPrevSbhfSelftestRunning = sbhf.selftestRunning;
  }
} catch (e) {
  console.warn("[UI] Selftest power-off hint failed:", e);
}

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
  
  // ------------------------------------------------------------
  // One-shot UI hint after SBHF selftest finished
  // Trigger: selftestRunning true -> false AND power remains OFF
  // ------------------------------------------------------------
  try {
    const sbhf = msg?.mega2?.sbhf;
    const safety = msg?.safety;
    if (sbhf && typeof sbhf.selftestRunning === "boolean") {
      // re-arm for next selftest run
      if (uiPrevSbhfSelftestRunning === false && sbhf.selftestRunning === true) {
        uiSbhfSelftestPowerHintShown = false;
      }

      // falling edge -> show hint once
      if (
        uiPrevSbhfSelftestRunning === true &&
        sbhf.selftestRunning === false &&
        safety?.powerOn === false &&
        uiSbhfSelftestPowerHintShown === false
      ) {
        uiTransientInfoText = "Selftest beendet – Power bleibt aus, bitte manuell einschalten.";
        uiTransientInfoUntil = Date.now() + 12000; // 12s
        uiSbhfSelftestPowerHintShown = true;
      }

      uiPrevSbhfSelftestRunning = sbhf.selftestRunning;
    }
  } catch (e) {
    console.warn("[UI] selftest power-off hint failed:", e);
  }

// ------------------------------------------------------------
// One-shot UI hint after Mega1 selftest finished (power remains OFF)
// ------------------------------------------------------------
try {
  const m1run = !!msg?.mega1?.diag?.selftestRunning;
  const safety = msg?.safety;

  // re-arm for next run
  if (uiPrevM1SelftestRunning === false && m1run === true) {
    uiM1SelftestPowerHintShown = false;
  }

  // detect falling edge: true -> false
  if (
    uiPrevM1SelftestRunning === true &&
    m1run === false &&
    safety?.powerOn === false &&
    uiM1SelftestPowerHintShown === false
  ) {
    const t = window.SAFETY_UI_TEXTS?.fromKey?.("INFO_M1_SELFTEST_POWER_STAYS_OFF");
    const line = (t?.lines && t.lines.length) ? String(t.lines[0]) : null;
    if (line) {
      uiTransientInfoText = line;
      uiTransientInfoUntil = Date.now() + 12000;
    }
    uiM1SelftestPowerHintShown = true;
  }

  uiPrevM1SelftestRunning = m1run;
} catch (e) {
  console.warn("[UI] M1 selftest power-off hint failed:", e);
}


   // Schritt 2: rechts "Meldungen" befuellen (Safety + SBHF Masken)
   renderPowerWarningsEmergencies(msg);
 
   // Right-side Trafo section
   try { renderTrafoRight(msg); } catch (e) { console.warn('[UI] renderTrafoRight failed:', e); }

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
      const et = (safety?.errType  ?? safety?.errorType);
      const ei = (safety?.errIndex ?? safety?.errorIndex);
      const t = window.SAFETY_UI_TEXTS.fromCodes(et, ei);
      if (t && (t.title || (t.lines && t.lines.length))) {
        return { title: t.title || 'Sicherheitsquittierung', lines: t.lines || [] };
      }
    }
  } catch (e) {
    console.warn('SAFETY_UI_TEXTS error', e);
  }
  
  // If Mega2 reports blockReason==2 (NOTAUS), always present it as "Not-Aus"
  // even if no numeric errType was provided (keeps UI unambiguous).
  const br = Number(safety?.blockReason ?? safety?.block_reason);
  if (br === 2) {
    const t2 = window.SAFETY_UI_TEXTS?.fromKey?.("EMERG_ESTOP_CHAIN_OPEN");
    if (t2) return { title: t2.title || "NOT-AUS – Anlage gestoppt", lines: t2.lines || [] };
    return { title: "NOT-AUS – Anlage gestoppt", lines: ["Der Not-Aus wurde ausgelöst.", "Bitte Ursache prüfen und anschließend ACK."] };
  }

  
  // Fallback ONLY via safety_ui_texts.js (no hardcoded strings here)
  const fb = window.SAFETY_UI_TEXTS?.fromKey?.("GENERIC_SAFETY_ACTIVE");
  if (fb) return { title: fb.title || "Sicherheitsquittierung", lines: fb.lines || [] };

  // Last resort: keep UI functional even if text map missing
  // (Should not happen in normal operation; contract banner will warn anyway.)
  return { title: "Sicherheitsquittierung", lines: [] };
}

function getUiStateFromWs(msg, safety, mega2online) {
  // Default OK
  let level = "OK";
  let text = [" System OK"];
  let title = "";
  let overlay = false;
  let ackRequired = false;
  let hasWarn = false;
  let overlayMode = undefined; // "ack" | "info" | "startup" | undefined

  // Flags-first Startup gate (sticky UI session):
  // IMPORTANT (2026-02): The startup checklist is driven by WS msg.startup.{m1Needs,m2Needs}.
  // It MUST NOT be derived from "!selftestDone", because "Selftest retry" temporarily changes done-flags.
  // Sticky-session UX requirement: once active, remain in the checklist until user ACKs it (no ugly jump).
  const stp = msg?.startup || {};
  const m1NeedsNow = !!stp.m1Needs;
  const m2NeedsNow = !!stp.m2Needs;
  const startupNeeds = (m1NeedsNow || m2NeedsNow);

  // Start sticky startup session only if the system explicitly reports that startup checklist is needed.
  if (!g_startupSessionActive && startupNeeds) {
    g_startupSessionActive = true;
  }

  // Auto-leave startup session once backend says nothing is needed anymore.
  // Otherwise the overlay will keep coming back even though startup is complete.
  try {
    const stp = msg?.startup;
    if (g_startupSessionActive &&
        stp &&
        stp.ready === true &&
        stp.m1Needs === false &&
        stp.m2Needs === false) {
      g_startupSessionActive = false;
    }
  } catch (e) {
    // ignore
  }


  // DO NOT auto-drop the sticky session on "done" (prevents the ugly jump to standard overlay).
  // The session is ended only by a successful ACK inside the startup overlay (markMega*ChecklistDone).
  const inStartup = (g_startupSessionActive === true);

  if (!mega2online) {
    level = "WARN";
    text = [" Mega2 offline"];
    return { level, text, title, overlay, ackRequired, overlayMode, hasWarn };
  }

  // --- Mega1 Selftest Overlay (WS-driven, analog zu SBHF) ---
  const m1SelftestRunning = !!(msg?.mega1?.diag?.selftestRunning);
  if (m1SelftestRunning && !inStartup) {
    level = "WARN";
    overlay = true;
    ackRequired = false;
    const t = window.SAFETY_UI_TEXTS?.fromKey?.("INFO_M1_SELFTEST_RUNNING");
    title = t?.title || "Mega1 Weichentest läuft";
    text  = t?.lines || ["Bitte warten …"];
    overlayMode = "info";
    return { level, text, title, overlay, ackRequired, overlayMode, hasWarn };
  }

  // --- SBHF Selftest Overlay (WS-driven, independent of safety.lock) ---
  const selftestRunning = !!(msg?.mega2?.sbhf?.selftestRunning);
  // IMPORTANT: while startup checklist is active, do NOT switch away to a separate overlay.
  // The "läuft..." state is rendered inside the startup checklist.
  if (selftestRunning && !inStartup) {
    level = "WARN";
    overlay = true;
    ackRequired = false;
    const t = window.SAFETY_UI_TEXTS?.fromKey?.("INFO_SBHF_SELFTEST_RUNNING");
    title = t?.title || "SBHF Weichentest läuft";
    text  = t?.lines || ["Bitte warten …"];

    overlayMode = "info"; // Info-only -> keine Buttons/Checkbox
    return { level, text, title, overlay, ackRequired, overlayMode, hasWarn };
  }

  // --- STARTUP CHECKLIST Overlay (WS-driven) ---
  if (inStartup) {
    level = "WARN";
    overlay = true;
    ackRequired = false;
    overlayMode = "startup";
    const t = window.SAFETY_UI_TEXTS?.fromKey?.("INFO_STARTUP_CHECKLIST");
    title = t?.title || "Systemstart – Checkliste";
    text  = t?.lines || ["Bitte die folgenden Punkte abarbeiten, bevor Power eingeschaltet werden kann."];
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
    if (t.lines && t.lines.length) {
      text = t.lines;
    } else {
      const fb = window.SAFETY_UI_TEXTS?.fromKey?.("GENERIC_SAFETY_ACTIVE");
      text = (fb?.lines && fb.lines.length) ? fb.lines : [];
    }

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

  
  // Mega1 warnings: "wie Mega2" -> Mega1 entscheidet selbst und setzt SYS_WARNING_PRESENT.
  // ESP/WebUI zeigt nur an (keine Interpretation aus selftestFailMask als Level-Quelle).
  const m1online = !!(msg?.mega1?.online);
  const m1StatusFlags  = Number(msg?.mega1?.status?.flags ?? 0) & 0xff;
  if (m1online && ((m1StatusFlags & SYS_WARNING_PRESENT) !== 0)) {
    hasWarn = true;
    level = "WARN";
    text = [" Warning aktiv"];
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
    // pass msg so overlay can render checklist state
    showOverlay(ui.title, ui.text, ui.ackRequired, { mode: ui.overlayMode, state: msg });
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
  const startup = msg?.startup;

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
  const m2WarnMask = Number(msg?.mega2?.warningMask ?? 0) & 0xff;
  const m2Restricted = !!(msg?.mega2?.sbhf?.restricted);
  const m2WarnPresent = mega2online && ((m2WarnMask !== 0) || m2Restricted);

  bM2.className = "badge " + (!mega2online ? "badge-err" : (m2WarnPresent ? "badge-warn" : "badge-ok"));
  bM2.textContent = "Mega2: " + (mega2online ? (m2WarnPresent ? "online, warn" : "online") : "offline");
}
if (bM1) {
  const m1WarnMask = Number(msg?.mega1?.warningMask ?? 0) & 0xff;
  const m1Flags = Number(msg?.mega1?.status?.flags ?? 0) & 0xffff;
  const m1WarnPresent = mega1online && ((m1WarnMask !== 0) || ((m1Flags & SYS_WARNING_PRESENT) !== 0));

  bM1.className = "badge " + (!mega1online ? "badge-err" : (m1WarnPresent ? "badge-warn" : "badge-ok"));
  bM1.textContent = "Mega1: " + (mega1online ? (m1WarnPresent ? "online, warn" : "online") : "offline");
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
  // Diag-Control banner: warn if someone holds exclusive diagnose control
  // --------------------------------------------------
  try {
    const el = document.getElementById("diag-banner");
    const dc = msg && msg.diagCtrl;
    const wc = msg && msg.wsClients;
    const diagCount = (wc && typeof wc.diag === "number") ? wc.diag : 0;
    if (el) {
      if (dc && dc.active) {
        const owner = (dc.ownerId != null) ? dc.ownerId : "?";
        const sec = (dc.expiresInMs != null) ? Math.round((dc.expiresInMs || 0) / 1000) : "?";
        el.textContent = `⚠ Diagnose aktiv (${diagCount} Client${diagCount === 1 ? "" : "s"}) – Schreibzugriffe gesperrt (Owner ${owner}, Timeout ~${sec}s)`;
        el.classList.remove("hidden");
      } else {
        el.classList.add("hidden");
      }
    }
  } catch (e) {}



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
    // PLUS: im Startup-Checklist-Modus NIE PowerOn erlauben (bis ready==true)
    const startupNotReady = (startup && startup.ready === false);
    btnPowerOn.disabled = (!wsOk || !mega2online) ? true
                        : (powerOn || notausActive || lock || startupNotReady);
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
  // - "startup": Startup-Checklist (eigene Buttons)
  const mode = options.mode || (requireChecked === false ? "info" : "ack");
  
  // If we switch away from the startup checklist overlay, remove its DOM once.
  // Otherwise the checklist would "stick" and appear in other overlay modes (e.g. retry/info).
  if (mode !== "startup") {
    const stWrap = document.getElementById("startup-checklist-wrap");
    if (stWrap) {
      stWrap.remove();
      overlay.__startupUiBuilt = false;
    }
  }

  titleEl.textContent = title || "! Sicherheitsquittierung";

  const safeLines = (Array.isArray(lines) ? lines : [lines])
    .filter(Boolean)
    .map((l) => escapeHtml(String(l)));

  // Default: ohne Spinner
  textEl.innerHTML = safeLines.join("<br>");

  // --- Special case: SBHF Weichenfehler -> Selftest erforderlich ---
  // Wenn Mega2 den ACK blockt, weil ein Selftest nötig ist, muss die UI den Selftest anbieten,
  // sonst entsteht eine nicht lösbare Situation.
  try {
    const st = options?.state;
    const lock = !!st?.safety?.lock;
    const sbhfPresent = !!st?.mega2?.sbhf;
    const selftestRunning = !!st?.mega2?.sbhf?.selftestRunning;

    const fullText = (String(title || "") + " " + safeLines.join(" ")).toLowerCase();
    const looksLikeSbhfWeicheError =
      fullText.includes("weichenfehler") &&
      (fullText.includes("schattenbahnhof") || fullText.includes("sbhf"));

    if (lock && sbhfPresent && !selftestRunning && looksLikeSbhfWeicheError) {
      const hint = `
        <div style="margin-top:12px; padding-top:10px; border-top:1px solid rgba(0,0,0,0.08);">
          <div style="opacity:.9; margin-bottom:8px;">
            Für diesen Fehler ist ein <b>SBHF Selftest</b> erforderlich. Bitte starten und abwarten.
          </div>
          <button class="btn-mini" type="button" onclick="sendSbhfSelftestRetry()">
            SBHF Selftest starten
          </button>
        </div>`;
      textEl.innerHTML += hint;
    }
  } catch (e) {
    console.warn("[UI] SBHF selftest action insert failed:", e);
  }

    // ---------- STARTUP CHECKLIST ----------
  if (mode === "startup") {
    overlay.classList.remove("is-info-wait");

    // Ensure CSS spinner exists (otherwise fallback text would show)
    const ensureSpinnerCss = () => {
      if (document.getElementById("ui-spinner-css")) return;
      const st = document.createElement("style");
      st.id = "ui-spinner-css";
      st.textContent = `
        .ui-spinner{
          display:inline-block;
          width:1.05em;height:1.05em;
          border:0.18em solid rgba(0,0,0,.25);
          border-top-color: rgba(0,0,0,.65);
          border-radius:999px;
          animation: uiSpin .8s linear infinite;
          vertical-align:-0.15em;
          margin-right:0.45em;
        }
        @keyframes uiSpin { to { transform: rotate(360deg); } }
      `;
      document.head.appendChild(st);
    };

    ensureSpinnerCss();

    // Helper: fetch UI text from safety_ui_texts.js (fallbacks keep UI usable)
    const _uiText0 = (key, fallback) => {
      const t = window.SAFETY_UI_TEXTS?.fromKey?.(key);
      const s = (t && Array.isArray(t.lines) && String(t.lines[0] || "").trim()) || "";
      return s ? s : (fallback || "");
    };
    const _uiFmt0 = (key, x, fallback) => {
      return _uiText0(key, fallback).replaceAll("{x}", String(x ?? ""));
    };


    // Default: ACK UI ausblenden. Sobald alle Checklist-Tests erledigt sind,
    // wird der ACK-Button *innerhalb* dieses Startup-Overlays eingeblendet.
    if (ackBtn) ackBtn.style.display = "none";
    if (checkbox) checkbox.style.display = "none";
    if (cancelBtn) cancelBtn.style.display = ""; // Abbrechen bleibt ok



    // Build/Update startup checklist DOM (stable IDs, no rebind each tick)
    if (!overlay.__startupUiBuilt) {
      overlay.__startupUiBuilt = true;

      // Append checklist below the existing text area
      const wrap = document.createElement("div");
      wrap.id = "startup-checklist-wrap";
      wrap.style.marginTop = "14px";

      wrap.innerHTML = `
        <div style="font-weight:700; margin: 10px 0 6px;">${escapeHtml(_uiText0("STARTUP_CHECKLIST_TITLE", "Checkliste"))}</div>

        <div class="startup-item" style="padding:10px 0; border-top: 1px solid rgba(0,0,0,0.08);">
          <div style="display:flex; gap:10px; align-items:flex-start;">
            <span id="st-m2-box" aria-hidden="true">⬜</span>
            <div style="flex:1;">
              <div style="font-weight:700;">${escapeHtml(_uiText0("STARTUP_M2_TITLE", "SBHF-Weichen Selftest (Mega2)"))}</div>
              <div id="st-m2-state" style="opacity:.85; margin-top:2px;">${escapeHtml(_uiText0("STARTUP_STATE_OPEN", "offen"))}</div>
              <div id="st-sim-hint" style="opacity:.75; margin-top:6px; display:none;"></div>
              <div style="margin-top:8px;">
                <button id="st-m2-btn" class="btn-mini" type="button">${escapeHtml(_uiText0("STARTUP_M2_BTN", "SBHF Selftest starten"))}</button>
                <button id="st-m2-skip-btn" class="btn-mini" type="button" style="margin-left:8px; display:none;"></button>
              </div>
            </div>
          </div>
        </div>

        <div class="startup-item" style="padding:10px 0; border-top: 1px solid rgba(0,0,0,0.08);">
          <div style="display:flex; gap:10px; align-items:flex-start;">
            <span id="st-m1-box" aria-hidden="true">⬜</span>
            <div style="flex:1;">
              <div style="font-weight:700;">${escapeHtml(_uiText0("STARTUP_M1_TITLE", "Weichen Selftest (Mega1)"))}</div>
              <div id="st-m1-state" style="opacity:.85; margin-top:2px;">${escapeHtml(_uiText0("STARTUP_STATE_NOT_REQUIRED", "nicht erforderlich"))}</div>
              <div style="margin-top:8px;">
                <button id="st-m1-btn" class="btn-mini" type="button">${escapeHtml(_uiText0("STARTUP_M1_SELFTEST_LABEL", "Mega1 Selftest starten"))}</button>
              </div>
            </div>
          </div>
        </div>
      `;

      // Put it after textEl (ack-text)
      textEl.parentNode.insertBefore(wrap, textEl.nextSibling);

      // One-time click handler
      const m2btn = document.getElementById("st-m2-btn");
      if (m2btn) {
        m2btn.addEventListener("click", () => {
          // IMPORTANT: Startup flow must work even while safety.lock==true.
          sendSbhfSelftestStartup();
        });
      }

      const m2skip = document.getElementById("st-m2-skip-btn");
      if (m2skip) {
        // Bind only once (overlay may re-render / reconnect)
        if (!m2skip.__bound) {
          m2skip.__bound = true;
          m2skip.addEventListener("click", () => {
            // Robust toggle:
            // - derive from WS state (not from button text / transient labels)
            // - do not allow while the real selftest is running
            // - only in SIM (noHwBuild)
            const st = window.lastStateMsg || {};
            const sim = st.sim || {};
            const selftestRunning = !!st.mega2?.sbhf?.selftestRunning;

            if (!(wsConnected === true)) {
              logLine(" SIM: cannot toggle bypass (WS down)");
              return;
            }
            if (!sim.noHwBuild) {
              logLine(" SIM: bypass toggle ignored (not a SIM noHw build)");
              return;
            }
            if (selftestRunning) {
              logLine(" SIM: bypass toggle blocked (selftest is running)");
              return;
            }

            const cur = !!sim.bypassSbhfSelftest;
            const en  = !cur;
            logLine(` SIM: bypass SBHF selftest step -> ${en ? "ON" : "OFF"} ...`);
            wsSend({ action: "setBypassSbhfSelftest", enable: en });
          });
        }
      }
              
      const m1btn = document.getElementById("st-m1-btn");
      if (m1btn) {
        m1btn.addEventListener("click", () => {
          // Mega1 Selftest explizit starten
          logLine(" Mega1 Selftest start (WS action) ...");
          const ok = wsSend({ action: "m1SelftestStart" });
          if (ok) logLine(" Mega1 Selftest-Start gesendet");
          else    logLine(" Mega1 Selftest-Start NICHT gesendet (WS down?)");
        });
      }
    }

   // Update state (from latest WS message) - FLAGS FIRST
    const st = window.lastStateMsg || {};
    const simNoHw = !!st.sim?.noHwBuild;
    const simBypass = !!st.sim?.bypassSbhfSelftest;
    const stp = st.startup || {};

    const m1diag = st.mega1?.diag;
    const m1Flags = Number(m1diag?.selftestFlags ?? 0);
    const m1SelftestRunning = !!m1diag?.selftestRunning || ((m1Flags & 0x01) !== 0);
    const m1SelftestDone    = !!m1diag?.selftestDone    || ((m1Flags & 0x02) !== 0);
    // Startup checklist "needs" is a latch (stp.m1Needs), but the step can still be completed.
    // Step completed if: not needed OR startup says done OR HW says done.
    const m1Needs = (st.mega1?.online === true) &&
      (typeof stp.m1Needs === "boolean" ? stp.m1Needs : !m1SelftestDone);
    const m1Ok =
      (!m1Needs) ||
      (typeof stp.m1SelftestDone === "boolean" ? stp.m1SelftestDone : false) ||
      (m1SelftestDone === true);

    const m2Sbhf = st.mega2?.sbhf;
    const m2ShadowFlags = Number(st.mega2?.shadow?.selftestFlags ?? 0);
    const selftestRunning = !!m2Sbhf?.selftestRunning || ((m2ShadowFlags & 0x01) !== 0);
    const m2SelftestDone  = !!m2Sbhf?.selftestDone    || ((m2ShadowFlags & 0x02) !== 0);
    // For SBHF: "needs" must follow startup.m2Needs, because SIM-bypass only affects startup layer.
    const m2Needs = (st.mega2?.online === true) &&
      (typeof stp.m2Needs === "boolean" ? stp.m2Needs : !m2SelftestDone);
    const m2Ok =
      (!m2Needs) ||
      (typeof stp.m2SelftestDone === "boolean" ? stp.m2SelftestDone : false) ||
      (m2SelftestDone === true);

    // Keep old variable names used below in the render code:
    const m1Done = m1Ok;
    const m2Done = m2Ok;
    const allDone = (m1Done && m2Done);


    const m2box = document.getElementById("st-m2-box");
    const m2state = document.getElementById("st-m2-state");
    const m2btn = document.getElementById("st-m2-btn");
    const m2skip = document.getElementById("st-m2-skip-btn");
    const simHint = document.getElementById("st-sim-hint");

    if (m2box)   m2box.textContent = (m2Done ? "✅" : "⬜");
    if (m2state) {
      if (m2Done) {
          m2state.textContent = _uiText0("STARTUP_STATE_DONE", "erledigt");
          delete m2state.dataset.spinner;
      }
      else if (selftestRunning) {

        // Spinner nur EINMAL erzeugen → Animation bleibt stabil
        if (!m2state.dataset.spinner) {
            m2state.textContent = "";

            const spinner = document.createElement("span");
            spinner.className = "ui-spinner";
            spinner.setAttribute("aria-hidden", "true");
            ensureSpinnerCss();
            spinner.textContent = "";

            const text = document.createElement("span");
            text.id = "st-m2-text";

            m2state.appendChild(spinner);
            m2state.appendChild(text);
            m2state.dataset.spinner = "1";
            }

        const txt = _uiFmt0("STARTUP_STATE_RUNNING", "", "läuft…{x}").trim();
        const textNode = m2state.querySelector("#st-m2-text");
        if (textNode) textNode.textContent = txt;
      }
      else {
        m2state.textContent = _uiText0("STARTUP_STATE_OPEN", "offen");
        delete m2state.dataset.spinner;
      }
    }

    // Enable rule for the STARTUP button:
    // - WS ok + Mega2 online
    // - NOT dependent on safety.lock (boot lock is expected!)
    // - only if checklist says it's needed
    const canStartM2 =
      (wsConnected === true) &&
      (lastMega2Online === true) &&
      (m2Needs === true) &&
      (m2Done === false) &&
      (selftestRunning === false);
    if (m2btn) m2btn.disabled = !canStartM2;

    // SIM-only: allow bypassing SBHF selftest step (toggle)
    if (simHint) {
      if (simNoHw) {
        simHint.style.display = "";
        simHint.textContent = _uiText0("STARTUP_SIM_HINT", "SIM: SBHF-Selftest-Step kann übersprungen werden.");
      } else {
        simHint.style.display = "none";
      }
    }

    if (m2skip) {
      if (simNoHw) {
        m2skip.style.display = "";

        // Truth source for button labeling: WS state.
        const bypass = !!window.lastStateMsg?.sim?.bypassSbhfSelftest;

        // While the real selftest is running, do not allow toggling (keeps UI consistent)
        m2skip.disabled = !(wsConnected === true) || selftestRunning;
        const key = bypass ? "STARTUP_M2_SKIP_BTN_OFF" : "STARTUP_M2_SKIP_BTN_ON";
        const fallback = bypass ? "SBHF Selftest-Step wieder aktivieren (SIM)" : "SBHF Selftest überspringen (SIM)";
        m2skip.textContent = _uiText0(key, fallback);
      } else {
        m2skip.style.display = "none";
      }
    }

    const m1box = document.getElementById("st-m1-box");
    const m1state = document.getElementById("st-m1-state");
    if (m1box)   m1box.textContent = (m1Done ? "✅" : "⬜");
    if (m1state) {
      if (!m1Needs) {
        m1state.textContent = _uiText0("STARTUP_STATE_NOT_REQUIRED", "nicht erforderlich");
        delete m1state.dataset.spinner;
      }
      else if (m1Done) {
        m1state.textContent = _uiText0("STARTUP_STATE_DONE", "erledigt");
        delete m1state.dataset.spinner;
      }
      else if (m1SelftestRunning) {
        // Spinner nur EINMAL erzeugen → Animation bleibt stabil
        if (!m1state.dataset.spinner) {
          m1state.textContent = "";
          const spinner = document.createElement("span");
          spinner.className = "ui-spinner";
          spinner.setAttribute("aria-hidden", "true");
            ensureSpinnerCss();
            spinner.textContent = "";
          const textEl = document.createElement("span");
          textEl.id = "st-m1-text";
          m1state.appendChild(spinner);
          m1state.appendChild(textEl);
          m1state.dataset.spinner = "1";
        }
        const txt = _uiFmt0("STARTUP_STATE_RUNNING", "", "läuft…{x}").trim();
        const textNode = m1state.querySelector("#st-m1-text");
        if (textNode) textNode.textContent = txt;
      }
      else {
        m1state.textContent = _uiText0("STARTUP_STATE_OPEN", "offen");
        delete m1state.dataset.spinner;
      }
    }

    // Enable rule for Mega1 Selftest button:
    // - WS ok
    // - Mega1 online
    // - checklist says it's needed
    // - not already done
    // - not currently running
    const m1btn = document.getElementById("st-m1-btn");
    const canStartM1 =
      (wsConnected === true) &&
      (window.lastStateMsg?.mega1?.online === true) &&
      (m1Needs === true) &&
      (m1Done === false) &&
      (m1SelftestRunning === false);
    if (m1btn) m1btn.disabled = !canStartM1;

    // Once both checklist steps are done, show ACK UI within this startup overlay.
    // The checklist itself remains visible until the user explicitly ACKs.
    if (checkbox && ackBtn) {
      if (!allDone) {
        checkbox.checked = false;
        checkbox.style.display = "none";
        ackBtn.style.display = "none";
      } else {
        checkbox.style.display = "";
        ackBtn.style.display = "";

        // Text: move to safety_ui_texts.js later; keep a sensible default here.
        const labelEl = checkbox.closest("label")?.querySelector("span") || checkbox.closest("label");
        if (labelEl) {
          const t = window.SAFETY_UI_TEXTS?.fromKey?.("STARTUP_READY_TO_ACK");
          const msg =
            (t && Array.isArray(t.lines) && String(t.lines[0] || "").trim())
            || "System betriebsbereit? Bitte quittieren.";
          labelEl.textContent = msg;
        }

        // ACK button text
        const tBtn = window.SAFETY_UI_TEXTS?.fromKey?.("STARTUP_ACK_BUTTON");
        ackBtn.textContent =
          (tBtn && Array.isArray(tBtn.lines) && String(tBtn.lines[0] || "").trim())
          || "Quittieren";
        // Enable rule: WS ok + Mega2 online + checkbox checked
        const syncAckEnabled = () => {
          const enabled = (wsConnected === true) && (lastMega2Online === true) && (checkbox.checked === true);
          ackBtn.disabled = !enabled;
        };

        if (!checkbox.__startupAckListenerInstalled) {
          checkbox.__startupAckListenerInstalled = true;
          checkbox.addEventListener("change", syncAckEnabled);
        }
        syncAckEnabled();
      }
    }

    return;
  }



  // ---------- INFO ONLY ----------
  if (mode === "info") {
    // Spinner: nur per CSS-Klasse, damit die Animation nicht bei jedem Render neu startet
    overlay.classList.add("is-info-wait");
 
     // Ensure a visible spinner inside the overlay text area (stable, no churn)
     // We only wrap once; subsequent renders update only the innerHTML of the lines container.
     try {
       // If already wrapped, update inner lines container only
       const linesCont = textEl?.querySelector?.(".ui-info-lines");
       if (linesCont) {
         linesCont.innerHTML = safeLines.join("<br>");
       } else {
         // first time in info mode -> wrap with spinner
         textEl.innerHTML = safeLines.join("<br>");
         ensureOverlaySpinner(textEl);
       }
     } catch (_) {
       // fallback
       textEl.innerHTML = safeLines.join("<br>");
     }

    // Alles an Interaktion ausblenden
    if (ackBtn) ackBtn.style.display = "none";
    if (cancelBtn) cancelBtn.style.display = "none";
    if (checkbox) checkbox.style.display = "none";
    return;
  }

  // Non-info overlay: ensure wait class is removed
  overlay.classList.remove("is-info-wait");


  // If we leave startup mode, remove checklist DOM once (optional cleanup)
  // Keeps overlay from growing if modes change often.
  const stWrap = document.getElementById("startup-checklist-wrap");
  if (stWrap) {
    stWrap.remove();
    overlay.__startupUiBuilt = false;
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

  // If the startup checklist overlay is active, keep UX inside the checklist:
  // User expects to see results and ACK there (no overlay switch surprise).
  const st = window.lastStateMsg || {};
  const stp = st.startup || {};
  const startupNeeds = !!stp.m1Needs || !!stp.m2Needs;
  const inStartupChecklist = (g_startupSessionActive === true) && startupNeeds;

  if (inStartupChecklist) {
    // Optional Komfort: nach Startup-Checkliste automatisch auf Automatik schalten
    if (st?.mega1?.online === true) {
      wsSend({ action: "m1SetMode", mode: 1 });
    }
  
    // The startup checklist is cleared on ESP ONLY through markMega*ChecklistDone.
    // safetyAck does NOT clear startupNeeds.
    const m1Ok = (!stp.m1Needs) || !!stp.m1SelftestDone;
    const m2Ok = (!stp.m2Needs) || !!stp.m2SelftestDone;

    if (!m1Ok || !m2Ok) {
      logLine("Startup-Checkliste noch nicht abgeschlossen (Selftest fehlt).");
      return;
    }

    let okAll = true;
    if (stp.m1Needs) okAll = wsSend({ action: "markMega1ChecklistDone" }) && okAll;
    if (stp.m2Needs) okAll = wsSend({ action: "markMega2ChecklistDone" }) && okAll;

    // Only send safetyAck if a safety lock is actually active.
    if (st?.safety?.lock === true) {
      okAll = wsSend({ action: "safetyAck" }) && okAll;
      if (okAll) logLine("ACK gesendet.");
    } else {
      if (okAll) logLine("Startup-Checkliste quittiert.");
    }

    if (okAll) {
      g_startupSessionActive = false;
      closeOverlay();
    } else {
      logLine("ACK/Quittierung fehlgeschlagen (WS down?).");
    }
    return;
  }
  
  // Normal case: Safety ACK (only relevant when lock is active; otherwise harmless but noisy)
  if (st?.safety?.lock === true) {
    const ok = wsSend({ action: "safetyAck" });
    if (ok) logLine("ACK gesendet.");
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

// ------------------------------------------------------------
// Fix: "SBHF Selftest erneut" (btn-mini) schwer klickbar
// Ursache: Meldungsbereich wird bei jedem WS-State via innerHTML ersetzt
// -> während pointerdown/pointerup kann DOM ersetzt werden, click geht verloren
// Lösung: Während Pointer im Meldungsbereich gedrückt ist, UI-Update puffern
// ------------------------------------------------------------
(function installSafetyMessagesPointerGuard() {
  function ensureGuardInstalled(el) {
    if (!el || el.__ptrGuardInstalled) return;
    el.__ptrGuardInstalled = true;
    el.__ptrDown = false;
    el.__pendingHtml = null;

    el.addEventListener("pointerdown", (e) => {
      // Nur wenn im Actions-Bereich oder Button geklickt wird
      if (e.target.closest(".msg-actions, .btn-mini")) {
        el.__ptrDown = true;
      }
    }, true);

    
    // Robustness: if pointer gets cancelled (touch, focus loss), don't get stuck
    el.addEventListener("pointercancel", () => {
      el.__ptrDown = false;
      // keep pendingHtml; it will apply on next normal render
    }, true);
    window.addEventListener("blur", () => {
      el.__ptrDown = false;
    }, true);

    el.addEventListener("pointerup", () => {
      if (!el.__ptrDown) return;
      el.__ptrDown = false;
      if (typeof el.__pendingHtml === "string") {
        const html = el.__pendingHtml;
        el.__pendingHtml = null;
        // nächster Tick, damit click erst “fertig” ist
        setTimeout(() => {
          if (el.__lastHtml !== html) {
            el.innerHTML = html;
            el.__lastHtml = html;
          }
        }, 0);
      }
    }, true);
  }

  // Install lazily once DOM is there
  window.addEventListener("load", () => {
    ensureGuardInstalled(document.getElementById("safety-messages-list"));
  });
})();

function renderPowerWarningsEmergencies(msg) {
  const el = document.getElementById("safety-messages-list");
  if (!el) return;

  const items = [];

    // transient one-shot info (e.g. selftest finished, power remains OFF)
  if (uiTransientInfoText && Date.now() < uiTransientInfoUntil) {
    items.push(`i ${escapeHtml(String(uiTransientInfoText))}`);
  } else if (uiTransientInfoText && Date.now() >= uiTransientInfoUntil) {
    uiTransientInfoText = null;
  }


  const pushUiText = (key, x, prefix) => {
    const t = window.SAFETY_UI_TEXTS?.fromKey?.(key);
    if (!t || !Array.isArray(t.lines) || t.lines.length === 0) {
      // Quality Gate: missing texts should be visible immediately
      if (typeof contractFail === "function") {
        contractFail(`Missing UI text key in safety_ui_texts.js: ${key}`);
      } else if (typeof uiContractBannerShow === "function") {
        uiContractBannerShow(`UI TEXT MISSING:\n${key}\n=> safety_ui_texts.js ist unvollständig oder nicht geladen (UploadFS/Cache).`);
      }
      return;
    }
    let line = String(t.lines[0] || "").trim();
    if (!line) return;
    const needsX = line.includes("{x}");
    if (needsX && typeof x === "undefined") {
      if (typeof contractFail === "function") {
        contractFail(`UI text key ${key} requires {x} but no value provided`);
      }
    }
    if (typeof x !== "undefined") line = line.replaceAll("{x}", String(x));
    const pre = (prefix !== undefined) ? prefix : "i";
    items.push(`${pre} ${escapeHtml(line)}`);
  };

  // 1) Emergencies / Safety-Text
  const safety = msg && msg.safety;
  if (safety && (safety.lock === true || safety.ackRequired === true || (safety.errorType ?? safety.errType) > 0)) {
    const t = getSafetyOverlayTexts(safety);

    // Build a concise single-line message for the right panel
    const title = (t?.title || "").trim();
    const first = (Array.isArray(t?.lines) && t.lines.length) ? String(t.lines[0]).trim() : "";

    // Prefer "Title: first line", fallback to title only
    let line = "";
    if (title && first) line = `${title}: ${first}`;
    else if (title)   line = title;
    else if (first)   line = first;

    if (line) {
      // Use a consistent prefix icon on the right panel
      items.push(`! ${escapeHtml(line)}`);
    }
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
      pushUiText("WARN_SBHF_NO_SAFE_PATH", undefined, "!");
    } else {
      pushUiText("INFO_SBHF_ALLOWED_TRACKS", (tracks.length ? tracks.join(", ") : "-"), "i");
    }

    const restricted =
      ((warn & WARN_RESTRICTED_MODE) !== 0) ||
      (allowed !== 0x07 && allowed !== 0x00);

    if (restricted) pushUiText("WARN_SBHF_RESTRICTED_MODE", undefined, "!");
    if (warn & WARN_W12_DEFECT) pushUiText("WARN_W12_DEFECT", undefined, "!");
    if (warn & WARN_W13_DEFECT) pushUiText("WARN_W13_DEFECT", undefined, "!");
    if (warn & WARN_W14_DEFECT) pushUiText("INFO_W14_ISSUE", undefined, "i");
    if (warn & WARN_W15_DEFECT) pushUiText("INFO_W15_ISSUE", undefined, "i");
    if (warn & WARN_SBH_SERVICE_REQUIRED) pushUiText("WARN_SBH_SERVICE_REQUIRED", undefined, "!");
  }

    // 2b) Mega1 Warnings / Weichen-Selbsttest (Diagnoseliste)
  const m1 = msg && msg.mega1;
  if (m1 && m1.online && m1.diag) {
    
    const m1WarnMask = Number(m1.warningMask ?? 0) & 0xff;

    // Bit 0: WARN_WEICHEN_NO_SWITCH (canonical)
    if (m1WarnMask & 0x01) {
      pushUiText("WARN_WEICHEN_NO_SWITCH", undefined, "!");

      // Details: defekte Weichen aus selftestFailMask (nur Anzeige, keine Entscheidung)
      const fm = Number(m1.diag.selftestFailMask || 0) & 0x0fff;
      if (fm !== 0) {
        const names = [];
        for (let i = 0; i < 12; i++) {
          if (fm & (1 << i)) names.push(`W${i+1}`);
        }
        const listTxt = names.length ? names.join(", ") : "-";
        pushUiText("WARN_M1_TURNOUTS_DEFECT_LIST", listTxt, "!");
      }
      
    }
    
    // Bit 1: WARN_BAHNHOF_DURCHFAHRT (reserved / TODO)
    // if (m1WarnMask & 0x02) pushUiText("WARN_BAHNHOF_DURCHFAHRT", undefined, "!");
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

const canMega1 = wsConnected && !!(msg && msg.mega1 && msg.mega1.online);
const m1SelftestRunning = !!(msg?.mega1?.diag?.selftestRunning);

let weicheWarnActive = false;
if (m2 && m2.sbhf) {
  const warn = Number(m2.sbhf.warningMask || 0) & 0xff;
  // W12..W15 + Service erforderlich (UI-contract bits)
  const WEICHE_WARN_MASK = 0x02 | 0x04 | 0x08 | 0x10 | 0x20;
  weicheWarnActive = (warn & WEICHE_WARN_MASK) !== 0;
}

let m1WeicheWarnActive = false;
if (msg?.mega1?.online && msg?.mega1?.diag) {
  const fm = Number(msg.mega1.diag.selftestFailMask || 0) & 0x0fff;
  m1WeicheWarnActive = (fm !== 0);
}


const retryBtn = weicheWarnActive
  ? `<button class="btn-mini" ${(canMega2 && !selftestRunning) ? "" : "disabled"} onclick="sendSbhfSelftestRetry()"> SBHF Selftest erneut</button>`
  : "";

const retryBtnM1 = m1WeicheWarnActive
  ? `<button class="btn-mini" ${(canMega1 && !m1SelftestRunning && !lock) ? "" : "disabled"} onclick="sendM1SelftestRetry()"> Mega1 Selftest erneut</button>`
  : "";

const actionsHtml = (retryBtn || retryBtnM1)
  ? `<div class="msg-actions">${retryBtn}${retryBtn ? " " : ""}${retryBtnM1}</div>`
  : "";

  const html = (items.length ? items.map(t => `<div>${t}</div>`).join("") : "<em>Keine Meldungen</em>") + actionsHtml;

  // If user is currently clicking in this area, defer DOM replacement
  if (el.__ptrDown === true) {
    el.__pendingHtml = html;
    return;
  }

  // Avoid DOM churn if nothing changed (prevents flicker + click races)
  if (el.__lastHtml === html) return;
  el.innerHTML = html;
  el.__lastHtml = html;

}

/* =========================================================
 *  Schritt 3.5: Links - Betriebsuebersicht + Block-Signale
 * ========================================================= */


// ------------------------------------------------------------
// UI Assets: Weichen & Signale (PNG only, no logic)
// ------------------------------------------------------------
const TURNOUT_UI = {
  0:{type:"L",rot:180}, 1:{type:"R",rot:180}, 2:{type:"X",rot:0},
  3:{type:"X",rot:0},   4:{type:"X",rot:0},   5:{type:"R",rot:0},
  6:{type:"L",rot:90},  7:{type:"R",rot:0},   8:{type:"L",rot:0},
  9:{type:"R",rot:0},  10:{type:"R",rot:180},11:{type:"R",rot:180},
  // Mega2 SBHF (W12..W15) – Mapping aus README_ASSETS.md
  12:{type:"L",rot:0},
  13:{type:"L",rot:0},
  14:{type:"L",rot:180},
  15:{type:"L",rot:180},
};

function resolveTurnoutImg(idx, state) {
  const cfg = TURNOUT_UI[idx];
  const s = (state === "G" || state === "A") ? state : "U";
  if (!cfg) return { src:`img/turnout_L_U.png`, rot:0 };
  return {
    src: `img/turnout_${cfg.type}_${s}.png`,
    rot: cfg.rot || 0
  };
}

function resolveSignalImg(state) {
  const s = (state === true || state === "G") ? "G"
          : (state === false || state === "R") ? "R" : "U";
  return `img/sig_${s}.png`;
}


function bit(mask, i) {
  return ((mask >>> i) & 1) !== 0;
}

function renderTrafoRight(msg) {
   const aEl = document.getElementById("trafo-a");
   const bEl = document.getElementById("trafo-b");
   if (!aEl && !bEl) return;
 
   const an = msg?.mega2?.analog;
   const flags = Number(an?.flags ?? 0) >>> 0;
 
   const fmtV = (v10) => {
     const n = Number(v10);
     if (!Number.isFinite(n)) return "– V";
     if (n === 0xFFFF) return "– V";
     // Plausibilität: Trafo-Spannungen sind im Modellbahn-Kontext typischerweise klein.
     // Alles > 30.0V behandeln wir als ungültig (UI darf hier defensiv sein).
     if (n < 0 || n > 300) return "– V";
     return (n / 10).toFixed(1) + " V";
   };
 
   // flags bit1: voltages invalid -> beide Spannungen unterdrücken
   const voltagesInvalid = (flags & 0x02) !== 0;
   
   const aTxt = "Trafo A: " + (!an || voltagesInvalid ? "– V" : (an.vA10 !== undefined ? fmtV(an.vA10) : "– V"));
   const bTxt = "Trafo B: " + (!an || voltagesInvalid ? "– V" : (an.vB10 !== undefined ? fmtV(an.vB10) : "– V"));

   if (aEl) {
     aEl.textContent = aTxt;
     aEl.title = an
       ? `m2.analog: seq=${an.seq ?? "?"} flags=0x${flags.toString(16)} raw=${an.vA10}`
       : "m2.analog: (none)";
   }
   if (bEl) {
     bEl.textContent = bTxt;
     bEl.title = an
       ? `m2.analog: seq=${an.seq ?? "?"} flags=0x${flags.toString(16)} raw=${an.vB10}`
       : "m2.analog: (none)";
   }
}

// ---------------------------------------------------------
// Analog "Hold last good" (gegen Glitches / steigende Rohwerte)
// ---------------------------------------------------------
const m2AnalogHold = {
  i_mA: Array(9).fill(null),
};

 
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

 // Build stable DOM once -> no flicker on each WS state
  if (!el.__built) {
    el.__built = true;
    el.innerHTML = `
      <div class="m1-section">
        <div class="toggle-grid grid-4" id="m1-bhf-grid"></div>
        <div class="hint" id="m1-bhf-hint" style="margin-top:.5rem; display:none;"></div>
      </div>`;
    const grid = el.querySelector("#m1-bhf-grid");
    if (!grid) return;
    for (let i = 0; i < 4; i++) {
      const b = document.createElement("button");
      b.id = `m1-bhf-${i}`;
      b.className = "m1-sig-btn";
      b.setAttribute("data-m1cmd", "bhfToggle");
      b.setAttribute("data-bhf", String(i));
      b.innerHTML = `
        <div class="m1-sig-title">BHF ${i + 1}</div>
        <div class="m1-sig-row">
          <img class="signal-img" alt="">
          <span class="m1-sig-text"></span>
        </div>`;
      grid.appendChild(b);
    }
  }

  const grid = el.querySelector("#m1-bhf-grid");
  const hint = el.querySelector("#m1-bhf-hint");
  if (!grid || !hint) return;

  const showHint = (!canCmd);
  if (showHint) {
    hint.style.display = "";
    hint.textContent = `CMD gesperrt: ${!wsOk ? "WS down" : (lock ? "Safety-Lock" : (notausActive ? "HW-NOT-AUS" : ""))}`;
  } else {
    hint.style.display = "none";
    hint.textContent = "";
  }

  // Offline/NoData: U anzeigen, Buttons disabled (aber gleiche DOM)
  const haveData = (mega1online && hasDiag && !!diag);
  const powerMask = haveData ? Number(diag.powerMask ?? 0) : 0;

  for (let i = 0; i < 4; i++) {
    const btn = grid.querySelector(`#m1-bhf-${i}`);
    if (!btn) continue;

    const on = haveData ? (((powerMask >> i) & 1) === 1) : null; // null => U
    const sig = (on === true) ? resolveSignalImg("G") : (on === false) ? resolveSignalImg("R") : resolveSignalImg("U");

    // "wie FROM->TO": kein farbiger Hintergrund, nur dezenter Rand + Hover
    btn.classList.toggle("state-g", on === true);
    btn.classList.toggle("state-r", on === false);
    btn.classList.toggle("state-u", on === null);

    // Buttons bleiben erkennbar: Hover/Focus kommt aus CSS
    btn.disabled = !(canCmd && haveData);

    const img = btn.querySelector("img");
    if (img && img.getAttribute("src") !== sig) img.setAttribute("src", sig);
    if (img) img.setAttribute("alt", `BHF ${i + 1} ${(on === true) ? "G" : (on === false) ? "R" : "U"}`);

    const t = btn.querySelector(".m1-sig-text");
    const label = (on === true) ? "AN" : (on === false) ? "aus" : "—";
    if (t && t.textContent !== label) t.textContent = label;
  }
}

function renderMega1TurnoutsLeft(msg) {
  const el = document.getElementById("ov-m1-turnouts");
  if (!el) return;

  const { mega1online, hasDiag, diag, canCmd, wsOk, lock, notausActive } = getMega1DiagContext(msg);

  // Build stable DOM once -> no flicker on each WS state
  if (!el.__built) {
    el.__built = true;
    el.innerHTML = `
      <div class="m1-section">
        <div class="toggle-grid grid-6" id="m1-w-grid"></div>
        <div class="hint" id="m1-w-hint" style="margin-top:.5rem; display:none;"></div>
      </div>`;
    const grid = el.querySelector("#m1-w-grid");
    if (!grid) return;
    for (let i = 0; i < 12; i++) {
      const b = document.createElement("button");
      b.id = `m1-w-${i}`;
      b.className = "toggle-btn";
      b.setAttribute("data-m1cmd", "weicheToggle");
      b.setAttribute("data-idx", String(i));
      b.innerHTML = `
        <div class="toggle-title">W ${i}</div>
        <div class="toggle-sub turnout-col">
          <img class="turnout-img" alt="">
          <span class="m1-w-soll"></span>
        </div>
        <div class="toggle-sub">
          <span class="pill pill-info m1-w-red" style="display:none;">Redukt.</span>
        </div>`;
      grid.appendChild(b);
    }
  }

  const grid = el.querySelector("#m1-w-grid");
  const hint = el.querySelector("#m1-w-hint");
  if (!grid || !hint) return;

  const showHint = (!canCmd);
  if (showHint) {
    hint.style.display = "";
    hint.textContent = `CMD gesperrt: ${!wsOk ? "WS down" : (lock ? "Safety-Lock" : (notausActive ? "HW-NOT-AUS" : ""))}`;
  } else {
    hint.style.display = "none";
    hint.textContent = "";
  }

  const haveData = (mega1online && hasDiag && !!diag);
  const ist  = haveData ? Number(diag.weicheIstBits ?? 0) : 0;
  const soll = haveData ? Number(diag.weicheSollBits ?? 0) : 0;
  const slow = haveData ? Number(diag.weicheSlowSelectedBits ?? 0) : 0;

  for (let i = 0; i < 12; i++) {
    const btn = grid.querySelector(`#m1-w-${i}`);
    if (!btn) continue;

    if (!haveData) {
      btn.disabled = true;
      btn.classList.remove("is-ok", "is-bad", "is-slow");
      const img = resolveTurnoutImg(i, "U");
      const imgEl = btn.querySelector("img");
      if (imgEl && imgEl.getAttribute("src") !== img.src) imgEl.setAttribute("src", img.src);
      if (imgEl) imgEl.style.transform = `rotate(${img.rot}deg)`;
      const sollEl = btn.querySelector(".m1-w-soll");
      if (sollEl) sollEl.textContent = "Soll: —";
      const red = btn.querySelector(".m1-w-red");
      if (red) red.style.display = "none";
      continue;
    }

    const curG = ((ist >> i) & 1) === 1;
    const sG   = ((soll >> i) & 1) === 1;
    const isSlow = ((slow >> i) & 1) === 1;
    const isMatch = (sG === curG);

    // Button-Farbe nur nach Abweichung (IST!=SOLL), NICHT nach Richtung (G/A)
    btn.classList.toggle("is-ok", isMatch);
    btn.classList.toggle("is-bad", !isMatch);
    btn.classList.toggle("is-slow", isSlow);

    btn.disabled = !canCmd;

    const istState = curG ? "G" : "A";
    const img = resolveTurnoutImg(i, istState);
    const imgEl = btn.querySelector("img");
    if (imgEl && imgEl.getAttribute("src") !== img.src) imgEl.setAttribute("src", img.src);
    if (imgEl) imgEl.style.transform = `rotate(${img.rot}deg)`;
    if (imgEl) imgEl.setAttribute("alt", `W${i} ${istState}`);

    const sollEl = btn.querySelector(".m1-w-soll");
    const wantSoll = `Soll: ${sG ? "G" : "A"}`;
    if (sollEl && sollEl.textContent !== wantSoll) sollEl.textContent = wantSoll;

    const red = btn.querySelector(".m1-w-red");
    if (red) red.style.display = isSlow ? "" : "none";
  }
}

// ------------------------------------------------------------
// Mega1 UI: delegated click binding (works with innerHTML rerenders)
// ------------------------------------------------------------
function bindMega1DelegatedClicks() {
  const stations = document.getElementById("ov-m1-stations");
  if (stations && !stations.__m1Bound) {
    stations.__m1Bound = true;
    stations.addEventListener("click", (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest("button[data-m1cmd]") : null;
      if (!btn) return;
      if (btn.disabled) return;

      const cmd = btn.getAttribute("data-m1cmd");
      if (cmd === "bhfToggle") {
        const bhf = Number(btn.getAttribute("data-bhf"));
        if (!Number.isFinite(bhf)) return;
        // sendM1BhfToggle expects 1..4
        sendM1BhfToggle(bhf + 1);
      }
    });
  }

  const turnouts = document.getElementById("ov-m1-turnouts");
  if (turnouts && !turnouts.__m1Bound) {
    turnouts.__m1Bound = true;
    turnouts.addEventListener("click", (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest("button[data-m1cmd]") : null;
      if (!btn) return;
      if (btn.disabled) return;

      const cmd = btn.getAttribute("data-m1cmd");
      if (cmd === "weicheToggle") {
        const idx = Number(btn.getAttribute("data-idx"));
        if (!Number.isFinite(idx)) return;
        sendM1WeicheToggle(idx);
      }
    });
  }
}


function fmtHex(v, width) {
  const n = Number(v) >>> 0;
  const s = n.toString(16).toUpperCase();
  return "0x" + s.padStart(width || 2, "0");
}

// NOTE: Legacy renderStationsLeft() (old ov-stations panel) removed.
// Current Mega1 UI is rendered via renderMega1StationsLeft/renderMega1TurnoutsLeft.

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
  // Build stable DOM once (avoid “disappearing” UI)
   if (!el.__built) {
     el.__built = true;
     el.innerHTML = `
       <div class="info-row"><span>State:</span><strong id="m2-sbhf-state">—</strong></div>
       <div class="info-row"><span>Ausfahr-Gleis:</span><strong id="m2-sbhf-gleis">—</strong></div>
       <div class="info-row"><span>Belegt:</span><strong id="m2-sbhf-occ">—</strong></div>
       <div class="info-row"><span>Erlaubt:</span><strong id="m2-sbhf-allow">—</strong></div>
       <div class="info-row"><span>Restricted:</span><strong id="m2-sbhf-restr">—</strong></div>
     `;
   }
 
   // Offline/NoData -> keep symbols, grey out
   const have = (online && !!sb);
   el.classList.toggle("no-data", !have);
   if (!have) {
     const set = (id, txt) => { const n = document.getElementById(id); if (n && n.textContent !== txt) n.textContent = txt; };
     set("m2-sbhf-state", "—");
     set("m2-sbhf-gleis", "—");
     set("m2-sbhf-occ", "—");
     set("m2-sbhf-allow", "—");
     set("m2-sbhf-restr", "—");
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

  const set = (id, txt) => { const n = document.getElementById(id); if (n && n.textContent !== txt) n.textContent = txt; };
   set("m2-sbhf-state", String(state));
   set("m2-sbhf-gleis", String(g));
   set("m2-sbhf-occ", (occList.length ? occList.join(", ") : "-"));
   set("m2-sbhf-allow", (allowList.length ? allowList.join(", ") : "-"));
   set("m2-sbhf-restr", (restricted ? "ja" : "nein"));
}

function renderTurnoutsLeft(msg) {
  const el = document.getElementById("ov-turnouts");
  if (!el) return;
  el.classList.add("mega2-info");

  const online = !!msg?.mega2?.online;
  const t = msg?.mega2?.turnouts;

  // Build stable grid once (avoid periodic "wobble" due to innerHTML rebuild)
  if (!el.__gridBuilt) {
    el.__gridBuilt = true;
    el.innerHTML = `<div class="m2-turnout-grid" id="m2-turnout-grid"></div>`;
    const grid = el.querySelector("#m2-turnout-grid");
    if (!grid) return;
    for (let wi = 12; wi <= 15; wi++) {
      const node = document.createElement("div");
      node.id = `m2-w-${wi}`;
      node.className = "m2-turnout-tile";
      node.innerHTML = `
        <div class="m2-turnout-title">W${wi}</div>
        <div class="m2-turnout-row">
          <img class="turnout-img" alt="">
          <div class="m2-turnout-meta"></div>
        </div>`;
      grid.appendChild(node);
    }
  }
  const grid = el.querySelector("#m2-turnout-grid");
  if (!grid) return;

  // NoData/Offline -> show U and "—" but keep same DOM
  if (!online || !t) {
    for (let wi = 12; wi <= 15; wi++) {
      const node = grid.querySelector(`#m2-w-${wi}`);
      if (!node) continue;
      node.classList.remove("is-ok", "is-bad");
      const img = resolveTurnoutImg(wi, "U");
      const imgEl = node.querySelector("img");
      if (imgEl && imgEl.getAttribute("src") !== img.src) imgEl.setAttribute("src", img.src);
      if (imgEl) imgEl.style.transform = `rotate(${img.rot}deg)`;
      if (imgEl) imgEl.setAttribute("alt", `W${wi} U`);
      const meta = node.querySelector(".m2-turnout-meta");
      if (meta) meta.textContent = "Soll: —";
    }
    return;
  }

  const soll = t.sollMask ?? 0;
  const ist  = t.istMask ?? 0;

  for (let i = 0; i < 4; i++) {
    const wi = 12 + i;
    const s = bit(soll, i) ? "A" : "G";
    const r = bit(ist, i)  ? "A" : "G";
    const ok = (s === r);
    const img = resolveTurnoutImg(wi, r);

    const node = grid.querySelector(`#m2-w-${wi}`);
    if (!node) continue;
    node.classList.toggle("is-ok", ok);
    node.classList.toggle("is-bad", !ok);
    const imgEl = node.querySelector("img");
    if (imgEl && imgEl.getAttribute("src") !== img.src) imgEl.setAttribute("src", img.src);
    if (imgEl) imgEl.style.transform = `rotate(${img.rot}deg)`;
    if (imgEl) imgEl.setAttribute("alt", `W${wi} ${r}`);
    const meta = node.querySelector(".m2-turnout-meta");
    const want = `Soll: ${s}`;
    if (meta && meta.textContent !== want) meta.textContent = want;
  }

}

function renderBlocksLeft(msg) {
  const el = document.getElementById("ov-blocks");
  if (!el) return;
  el.classList.add("mega2-info");

  const online = !!msg?.mega2?.online;
 
   // Build stable sub-layout once (avoid flicker / disappearing UI)
   if (!el.__stableBuilt) {
     el.__stableBuilt = true;
     el.innerHTML = `<div id="m2-occ-wrap"></div><div id="m2-sig-wrap" style="margin-top:0.8rem;"></div>`;
   }
   const occWrap = el.querySelector("#m2-occ-wrap");
   const sigWrap = el.querySelector("#m2-sig-wrap");
   if (!occWrap || !sigWrap) return;
 
   // Offline/NoData -> show placeholders but keep layout + grey out
   el.classList.toggle("no-data", !online);
   if (!online) {
     // Occupancy placeholders B1..B9
     let html = `<div><b>Belegung:</b></div><div class="badge-wrap">`;
     for (let i = 0; i < 9; i++) {
       html += `<span class="badge badge-info">` +
               `<span class="label">B${i+1} —</span>` +
               `<span class="num">I=— mA</span>` +
               `</span>`;
     }
     html += `</div>`;
     occWrap.innerHTML = html;
 
     // Signals placeholders (keep heading visible)
     if (!sigWrap.__gridBuilt) {
       sigWrap.__gridBuilt = true;
       sigWrap.innerHTML = `<div><b>Signale (FROM -&gt; TO):</b></div><div class="badge-wrap" id="m2-sig-grid"></div>`;
     }
     const grid = sigWrap.querySelector("#m2-sig-grid");
     if (grid && !grid.__placeholderBuilt) {
       grid.__placeholderBuilt = true;
       // show the standard pairs as grey placeholders
       const pairs = [
         [1,2],[2,3],[3,4],[4,1],[4,5],[5,7],[5,8],[5,9],[7,6],[8,6],[9,6],[6,4],
       ];
       grid.innerHTML = pairs.map(([f,t]) =>
         `<span class="badge badge-info"><span class="label">B${f}→B${t}</span><span class="num">—</span></span>`
       ).join("");
     }
     return;
   }

  // online -> clear grey look + allow real rendering
  el.classList.remove("no-data");

  const occMask = msg?.mega2?.blocks?.occupiedMask ?? msg?.mega2?.blockOccupiedMask ?? 0;
  const entryNow = msg?.mega2?.entryAllowed;
  const entryPrev = msg?.mega2?.entryPreview;

  // 1) Occupancy (darf weiterhin per innerHTML neu gerendert werden)
  let html = `<div><b>Belegung:</b></div><div class="badge-wrap">`;

  const an = msg?.mega2?.analog;
  const flags = Number(an?.flags ?? 0) >>> 0; // aktuell nicht für currents genutzt
  const iArr = an?.i_mA;

  const bs = msg?.mega2?.blocks?.status;
  
  for (let i = 0; i < 9; i++) {
    const occ = (Array.isArray(bs) && bs.length >= 9)
      ? !!(bs[i] && bs[i].besetzt)
      : bit(occMask, i);
    const labelText = `B${i + 1} ${occ ? "belegt" : "frei"}`;

    // Strom immer anzeigen (ruhig/stabil); bei unbekannt: "—"
    let iText = "I=— mA";

    // Ströme: defensiv + plausibel
    // - 0xFFFF gilt als invalid
    // - Werte > 5000mA sind im Normalbetrieb sehr wahrscheinlich invalid/glitch
    // - hold last good bei Glitches / Zwischenwerten (UNABHÄNGIG von seq)
    if (Array.isArray(iArr) && iArr.length >= 9) {
      const raw = Number(iArr[i]);
      const finite = Number.isFinite(raw);
      const invalid = (!finite || raw === 0xFFFF || raw < 0 || raw > 5000);

      if (!invalid) m2AnalogHold.i_mA[i] = raw;
      const shown = invalid ? m2AnalogHold.i_mA[i] : raw;
      if (Number.isFinite(shown)) {
        iText = `I=${Math.round(shown)} mA`;
      }
    }

    html += `<span class="badge ${occ ? "badge-err" : "badge-ok"}">` +
            `<span class="label">${labelText}</span>` +
            `<span class="num">${iText}</span>` +
            `</span>`;
  }
  html += `</div>`;
  occWrap.innerHTML = html;

  // 2) FROM->TO Signale (stabile DOM-Nodes, kein innerHTML-Churn -> kein Wackeln)
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

    if (!sigWrap.__gridBuilt) {
      sigWrap.__gridBuilt = true;
      sigWrap.innerHTML = `<div><b>Signale (FROM -&gt; TO):</b></div><div class="badge-wrap" id="m2-sig-grid"></div>`;
    }
    const grid = sigWrap.querySelector("#m2-sig-grid");
    if (!grid) return;

    for (const [from, to] of pairs) {
      const maskPrev = entryPrev[from - 1] ?? 0;
      const maskNow  = entryNow[from - 1] ?? 0;

      const prevOk = (maskPrev & (1 << (to - 1))) !== 0;
      const nowOk  = (maskNow  & (1 << (to - 1))) !== 0;

      const id = `sig-${from}-${to}`;
      let node = grid.querySelector(`#${id}`);
      const sigImg = resolveSignalImg(nowOk ? "G" : "R");
      const cls = `badge ${prevOk ? "badge-ok" : "badge-err"}`;
      const label = `B${from}→B${to}`;

      if (!node) {
        node = document.createElement("span");
        node.id = id;
        node.className = cls;
        node.innerHTML = `<img class="signal-img" alt=""><span></span>`;
        grid.appendChild(node);
      }
      if (node.className !== cls) node.className = cls;
      const imgEl = node.querySelector("img");
      if (imgEl && imgEl.getAttribute("src") !== sigImg) imgEl.setAttribute("src", sigImg);
      if (imgEl && imgEl.getAttribute("alt") !== `Signal ${label}`) imgEl.setAttribute("alt", `Signal ${label}`);
      const tEl = node.querySelector("span");
      if (tEl && tEl.textContent !== label) tEl.textContent = label;
    }

  } else {
    // keep stable container; show a simple placeholder
    sigWrap.__gridBuilt = false;
    sigWrap.innerHTML = `<div style="margin-top:0.8rem;"><em>Signale: keine Daten</em></div>`;
  }

}
