const UI_VERSION = "2026-04-10-p01";
const SYS_WARNING_PRESENT = 0x10;

let socket = null;
let wsConnected = false;
let lastSafetyState = null;
let lastMega2Online = false;
let lastStateMsg = null;
let ackPending = false;
let g_startupSessionActive = false;
let uiTransientInfoText = null;
let uiTransientInfoUntil = 0;

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function logLine(txt) {
  const win = document.getElementById("log-window");
  if (!win) return;
  const p = document.createElement("div");
  p.textContent = txt;
  win.appendChild(p);
  win.scrollTop = win.scrollHeight;
}

function normalizeWsState(msg) {
  if (!msg || !msg.mega2) return msg;
  const m2 = msg.mega2;
  if (!m2.sbhf) {
    const allowedMask = (typeof m2.allowedMask === "number") ? (m2.allowedMask & 0xff) : 0;
    const warningMask = (typeof m2.warningMask === "number") ? (m2.warningMask & 0xff) : 0;
    const occupiedMask = (typeof m2.sbhfOccupiedMask === "number") ? m2.sbhfOccupiedMask : 0;
    m2.sbhf = {
      state: (typeof m2.sbhfState === "number") ? m2.sbhfState : 0,
      currentGleis: (typeof m2.sbhfCurrentGleis === "number") ? m2.sbhfCurrentGleis : 0,
      occupiedMask,
      allowedMask,
      warningMask,
      restricted: (allowedMask !== 0x07 && allowedMask !== 0x00),
      selftestRunning: (occupiedMask & 0x80) !== 0
    };
  }
  if (!m2.turnouts) {
    const soll = (typeof m2.turnoutSollMask === "number") ? m2.turnoutSollMask : undefined;
    const ist = (typeof m2.turnoutIstMask === "number") ? m2.turnoutIstMask : undefined;
    if (soll !== undefined || ist !== undefined) {
      m2.turnouts = { sollMask: soll ?? 0, istMask: ist ?? 0 };
    }
  }
  return msg;
}

function ensureUiCssOnce(id, cssText) {
  if (document.getElementById(id)) return;
  const st = document.createElement("style");
  st.id = id;
  st.textContent = String(cssText || "");
  document.head.appendChild(st);
}

function wsSend(obj) {
  if (!socket || wsConnected !== true || socket.readyState !== 1) {
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

function wsSendAction(action, okMsg) {
  const ok = wsSend({ action });
  if (ok && okMsg) logLine(okMsg);
}

function sendPowerOn() {
  if (!wsConnected || !socket || socket.readyState !== 1) {
    logLine("WS nicht verbunden - Aktion nicht gesendet");
    return;
  }
  if (!lastMega2Online) {
    logLine("Mega2 offline - Aktion nicht gesendet");
    return;
  }
  const powerOn = !!(lastSafetyState?.powerOn === true);
  if (powerOn) {
    logLine("Power ist bereits AN");
    return;
  }
  const notausActive = !!(lastSafetyState?.notausActive === true);
  const safetyLock = !!(lastSafetyState?.lock === true);
  if (safetyLock || notausActive) {
    logLine("Power On nicht moeglich - Safety aktiv oder HW-NOT-AUS");
    return;
  }
  wsSendAction("powerOn", "POWER ON gesendet");
}

function sendPowerOff() {
  if (!wsConnected || !socket || socket.readyState !== 1) {
    logLine("WS nicht verbunden - Aktion nicht gesendet");
    return;
  }
  if (!lastMega2Online) {
    logLine("Mega2 offline - Aktion nicht gesendet");
    return;
  }
  const powerOn = !!(lastSafetyState?.powerOn === true);
  if (!powerOn) {
    logLine("Power ist bereits AUS");
    return;
  }
  wsSendAction("powerOff", "STOP / POWER OFF gesendet");
}

function sendModeToggle() {
  const mega1online = !!(lastStateMsg?.mega1?.online);
  if (!wsConnected || !socket || socket.readyState !== 1) {
    logLine("WS nicht verbunden - Aktion nicht gesendet");
    return;
  }
  if (!mega1online) {
    logLine("Mega1 offline - Aktion nicht gesendet");
    return;
  }
  const notausActive = !!(lastSafetyState?.notausActive === true);
  const safetyLock = !!(lastSafetyState?.lock === true);
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
  const newMode = (mode === 1) ? 0 : 1;
  const ok = wsSend({ action: (newMode === 1 ? "setAuto" : "setManual") });
  if (ok) logLine("Mode gesetzt: " + (newMode === 1 ? "Auto" : "Manuell"));
}

function sendM1BhfToggle(bhf1) {
  const mega1online = !!(lastStateMsg?.mega1?.online);
  if (!wsConnected || !socket || socket.readyState !== 1) {
    logLine("WS nicht verbunden - Aktion nicht gesendet");
    return;
  }
  if (!mega1online) {
    logLine("Mega1 offline - Aktion nicht gesendet");
    return;
  }
  const notausActive = !!(lastSafetyState?.notausActive === true);
  const safetyLock = !!(lastSafetyState?.lock === true);
  if (safetyLock || notausActive) {
    logLine("Bahnhof-Toggle gesperrt (Safety/HW-NOT-AUS)");
    return;
  }
  const diag = lastStateMsg?.mega1?.diag;
  const powerMask = Number(diag?.powerMask ?? 0);
  const n = Number(bhf1);
  const idx0 = (n >= 1 && n <= 4) ? (n - 1) : (n >= 0 && n <= 3) ? n : -1;
  if (idx0 < 0 || idx0 >= 4) return;
  const curOn = (((powerMask >> idx0) & 1) === 1);
  const newOn = !curOn;
  const ok = wsSend({ action: "m1PowerSet", bhf: idx0, on: newOn });
  if (ok) logLine(`Bhf${idx0} -> ${newOn ? "AN" : "aus"}`);
}

function sendM1WeicheToggle(idxW) {
  const mega1online = !!(lastStateMsg?.mega1?.online);
  if (!wsConnected || !socket || socket.readyState !== 1) {
    logLine("WS nicht verbunden - Aktion nicht gesendet");
    return;
  }
  if (!mega1online) {
    logLine("Mega1 offline - Aktion nicht gesendet");
    return;
  }
  const notausActive = !!(lastSafetyState?.notausActive === true);
  const safetyLock = !!(lastSafetyState?.lock === true);
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

function sendSbhfSelftestRetry() {
  logLine("SBHF Selftest start/retry (WS action) ...");
  const st = window.lastStateMsg || {};
  const lock = (st?.safety?.lock === true);
  if (lock) {
    const okA = wsSend({ action: "safetyAck" });
    if (okA) logLine("Safety ACK (vor SBHF Selftest)");
  }
  const okP = wsSend({ action: "powerOff" });
  if (okP) logLine("Power OFF (vor SBHF Selftest)");
  setTimeout(() => {
    const ok = wsSend({ action: "sbhfSelftestRetry" });
    if (ok) logLine("SBHF Selftest-Retry gesendet");
  }, lock ? 250 : 0);
}

function sendSbhfSelftestStartup() {
  logLine("SBHF Selftest STARTUP (WS action) ...");
  const okP = wsSend({ action: "powerOff" });
  if (okP) logLine("Power OFF (vor SBHF Selftest)");
  const ok = wsSend({ action: "sbhfSelftestStartup" });
  if (ok) logLine("SBHF Selftest-STARTUP gesendet");
}

function sendM1SelftestRetry() {
  logLine("Mega1 Selftest start/retry (WS action) ...");
  const st = window.lastStateMsg || {};
  const lock = (st?.safety?.lock === true);
  if (lock) {
    const okA = wsSend({ action: "safetyAck" });
    if (okA) logLine("Safety ACK (vor Mega1 Selftest)");
  }
  const okP = wsSend({ action: "powerOff" });
  if (okP) logLine("Power OFF (vor Mega1 Selftest)");
  setTimeout(() => {
    const ok = wsSend({ action: "m1SelftestStart" });
    if (ok) logLine("Mega1 Selftest-Retry gesendet");
  }, lock ? 250 : 0);
}

function getSafetyOverlayTexts(safety) {
  try {
    if (window.SAFETY_UI_TEXTS && typeof window.SAFETY_UI_TEXTS.fromCodes === "function") {
      const et = (safety?.errType ?? safety?.errorType ?? safety?.errorCause);
      const ei = (safety?.errIndex ?? safety?.errorIndex);
      const ed = (safety?.errorDetailCode ?? 0);
      const t = window.SAFETY_UI_TEXTS.fromCodes(et, ei, ed);
      if (t && (t.title || (t.lines && t.lines.length))) {
        return { title: t.title || "Sicherheitsquittierung", lines: t.lines || [] };
      }
    }
  } catch (_) {}
  const br = Number(safety?.blockReason ?? safety?.block_reason);
  if (br === 2) {
    const t2 = window.SAFETY_UI_TEXTS?.fromKey?.("EMERG_ESTOP_CHAIN_OPEN");
    if (t2) return { title: t2.title || "NOT-AUS – Anlage gestoppt", lines: t2.lines || [] };
    return { title: "NOT-AUS – Anlage gestoppt", lines: ["Der Not-Aus wurde ausgelöst.", "Bitte Ursache prüfen und anschließend ACK."] };
  }
  const fb = window.SAFETY_UI_TEXTS?.fromKey?.("GENERIC_SAFETY_ACTIVE");
  if (fb) return { title: fb.title || "Sicherheitsquittierung", lines: fb.lines || [] };
  return { title: "Sicherheitsquittierung", lines: [] };
}

function showOverlay(title, lines, requireChecked, options = {}) {
  const overlay = document.getElementById("ack-overlay");
  const titleEl = document.getElementById("ack-title");
  const textEl = document.getElementById("ack-text");
  const checkboxWrap = overlay?.querySelector(".ack-checkbox");
  const checkbox = overlay?.querySelector("input[type=checkbox]");
  const ackBtn = overlay?.querySelector(".btn-ack");
  const cancelBtn = overlay?.querySelector(".btn-cancel") || overlay?.querySelector(".btn");
  if (!overlay || !titleEl || !textEl) return;

  const wasHidden = overlay.classList.contains("hidden");
  overlay.classList.remove("hidden");

  const mode = options.mode || (requireChecked === false ? "info" : "ack");
  if (mode !== "startup") {
    const stWrap = document.getElementById("startup-checklist-wrap");
    if (stWrap) {
      stWrap.remove();
      overlay.__startupUiBuilt = false;
    }
  }

  titleEl.textContent = title || "⚠ Sicherheitsquittierung";
  const safeLines = (Array.isArray(lines) ? lines : [lines]).filter(Boolean).map((l) => escapeHtml(String(l)));
  textEl.innerHTML = safeLines.join("<br>");

  try {
    const st = options?.state;
    const lock = !!st?.safety?.lock;
    const sbhfPresent = !!st?.mega2?.sbhf;
    const selftestRunning = !!st?.mega2?.sbhf?.selftestRunning;
    const fullText = (String(title || "") + " " + safeLines.join(" ")).toLowerCase();
    const looksLikeSbhfWeicheError = fullText.includes("weichenfehler") && (fullText.includes("schattenbahnhof") || fullText.includes("sbhf"));
    if (lock && sbhfPresent && !selftestRunning && looksLikeSbhfWeicheError) {
      textEl.innerHTML += `
        <div style="margin-top:12px; padding-top:10px; border-top:1px solid rgba(0,0,0,0.08);">
          <div style="opacity:.9; margin-bottom:8px;">Für diesen Fehler ist ein <b>SBHF Selftest</b> erforderlich. Bitte starten und abwarten.</div>
          <button class="btn-mini" type="button" onclick="sendSbhfSelftestRetry()">SBHF Selftest starten</button>
        </div>`;
    }
  } catch (_) {}

  if (mode === "startup") {
    overlay.classList.remove("is-info-wait");
    if (ackBtn) ackBtn.style.display = "none";
    if (checkboxWrap) checkboxWrap.style.display = "none";
    if (cancelBtn) cancelBtn.style.display = "";

    const uiText0 = (key, fallback) => {
      const t = window.SAFETY_UI_TEXTS?.fromKey?.(key);
      const s = (t && Array.isArray(t.lines) && String(t.lines[0] || "").trim()) || "";
      return s || fallback || "";
    };

    if (!overlay.__startupUiBuilt) {
      overlay.__startupUiBuilt = true;
      const wrap = document.createElement("div");
      wrap.id = "startup-checklist-wrap";
      wrap.style.marginTop = "14px";
      wrap.innerHTML = `
        <div style="font-weight:700; margin: 10px 0 6px;">${escapeHtml(uiText0("STARTUP_CHECKLIST_TITLE", "Checkliste"))}</div>
        <div class="startup-item" style="padding:10px 0; border-top: 1px solid rgba(0,0,0,0.08);">
          <div style="display:flex; gap:10px; align-items:flex-start;">
            <span id="st-m2-box" aria-hidden="true">⬜</span>
            <div style="flex:1;">
              <div style="font-weight:700;">${escapeHtml(uiText0("STARTUP_M2_TITLE", "SBHF-Weichen Selftest (Mega2)"))}</div>
              <div id="st-m2-state" style="opacity:.85; margin-top:2px;">${escapeHtml(uiText0("STARTUP_STATE_OPEN", "offen"))}</div>
              <div style="margin-top:8px;"><button id="st-m2-btn" class="btn-mini" type="button">${escapeHtml(uiText0("STARTUP_M2_BTN", "SBHF Selftest starten"))}</button></div>
            </div>
          </div>
        </div>
        <div class="startup-item" style="padding:10px 0; border-top: 1px solid rgba(0,0,0,0.08);">
          <div style="display:flex; gap:10px; align-items:flex-start;">
            <span id="st-m1-box" aria-hidden="true">⬜</span>
            <div style="flex:1;">
              <div style="font-weight:700;">${escapeHtml(uiText0("STARTUP_M1_TITLE", "Weichen Selftest (Mega1)"))}</div>
              <div id="st-m1-state" style="opacity:.85; margin-top:2px;">${escapeHtml(uiText0("STARTUP_STATE_NOT_REQUIRED", "nicht erforderlich"))}</div>
              <div style="margin-top:8px;"><button id="st-m1-btn" class="btn-mini" type="button">${escapeHtml(uiText0("STARTUP_M1_SELFTEST_LABEL", "Mega1 Selftest starten"))}</button></div>
            </div>
          </div>
        </div>`;
      textEl.parentNode.insertBefore(wrap, textEl.nextSibling);
      document.getElementById("st-m2-btn")?.addEventListener("click", sendSbhfSelftestStartup);
      document.getElementById("st-m1-btn")?.addEventListener("click", sendM1SelftestRetry);
    }

    const stp = options?.state?.startup || {};
    const m1diag = options?.state?.mega1?.diag;
    const m2sbhf = options?.state?.mega2?.sbhf;
    const m1Done = !!stp.m1SelftestDone || !!m1diag?.selftestDone || ((Number(m1diag?.selftestFlags ?? 0) & 0x02) !== 0);
    const m2Done = !!stp.m2SelftestDone || !!m2sbhf?.selftestDone || ((Number(options?.state?.mega2?.shadow?.selftestFlags ?? 0) & 0x02) !== 0);
    const m1Running = !!m1diag?.selftestRunning;
    const m2Running = !!m2sbhf?.selftestRunning;

    const stM1Box = document.getElementById("st-m1-box");
    const stM2Box = document.getElementById("st-m2-box");
    const stM1State = document.getElementById("st-m1-state");
    const stM2State = document.getElementById("st-m2-state");
    const stM1Btn = document.getElementById("st-m1-btn");
    const stM2Btn = document.getElementById("st-m2-btn");

    if (stM1Box) stM1Box.textContent = m1Done ? "✅" : (m1Running ? "⏳" : (stp.m1Needs ? "⬜" : "–"));
    if (stM2Box) stM2Box.textContent = m2Done ? "✅" : (m2Running ? "⏳" : (stp.m2Needs ? "⬜" : "–"));
    if (stM1State) stM1State.textContent = m1Done ? "erledigt" : (m1Running ? "läuft …" : (stp.m1Needs ? "offen" : "nicht erforderlich"));
    if (stM2State) stM2State.textContent = m2Done ? "erledigt" : (m2Running ? "läuft …" : (stp.m2Needs ? "offen" : "nicht erforderlich"));
    if (stM1Btn) stM1Btn.disabled = !wsConnected || m1Running || m1Done;
    if (stM2Btn) stM2Btn.disabled = !wsConnected || m2Running || m2Done;

    const allDone = m1Done && m2Done;

    if (checkboxWrap) {
      checkboxWrap.style.display = allDone ? "" : "none";
    }

    if (checkbox && ackBtn) {
      if (!allDone) {
        checkbox.checked = false;
        checkbox.style.display = "none";
        ackBtn.style.display = "none";
        ackBtn.disabled = true;
      } else {
        checkbox.style.display = "";
        ackBtn.style.display = "";

        const labelEl = checkbox.closest("label")?.querySelector("span") || checkbox.closest("label");
        if (labelEl) {
          const t = window.SAFETY_UI_TEXTS?.fromKey?.("STARTUP_READY_TO_ACK");
          const msg =
            (t && Array.isArray(t.lines) && String(t.lines[0] || "").trim()) ||
            "System betriebsbereit? Bitte quittieren.";
          labelEl.textContent = msg;
        }

        const tBtn = window.SAFETY_UI_TEXTS?.fromKey?.("STARTUP_ACK_BUTTON");
        ackBtn.textContent =
          (tBtn && Array.isArray(tBtn.lines) && String(tBtn.lines[0] || "").trim()) ||
          "Quittieren";

        const syncAckEnabled = () => {
          const enabled = (wsConnected === true) && allDone && (checkbox.checked === true);
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

  if (mode === "info") {
    overlay.classList.add("is-info-wait");
    if (ackBtn) ackBtn.style.display = "none";
    if (cancelBtn) cancelBtn.style.display = "none";
    if (checkboxWrap) checkboxWrap.style.display = "none";
    return;
  }

  overlay.classList.remove("is-info-wait");
  if (ackBtn) ackBtn.style.display = "";
  if (cancelBtn) cancelBtn.style.display = "";
  if (checkboxWrap) checkboxWrap.style.display = "";

  const canAckSend = (window.lastStateMsg?.actions?.canAck === true);
  if (checkbox) {
    if (wasHidden) checkbox.checked = false;
    checkbox.disabled = false;
  }
  if (ackBtn) {
    const enabled = canAckSend && (checkbox?.checked === true);
    ackBtn.disabled = !enabled;
    ackBtn.textContent = "ACK";
  }
  if (checkbox && ackBtn && !checkbox.__ackListenerInstalled) {
    checkbox.__ackListenerInstalled = true;
    checkbox.addEventListener("change", () => {
      ackBtn.disabled = !((window.lastStateMsg?.actions?.canAck === true) && checkbox.checked === true);
    });
  }
}

function hideOverlay() {
  document.getElementById("ack-overlay")?.classList.add("hidden");
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
  const st = window.lastStateMsg || {};
  const inStartupChecklist = (g_startupSessionActive === true);
  if (inStartupChecklist) {
    if (st?.mega1?.online === true) wsSend({ action: "setAuto" });
    const stp = st.startup || {};
    const m1diag = st.mega1?.diag;
    const m1Flags = Number(m1diag?.selftestFlags ?? 0);
    const m1SelftestDone = !!m1diag?.selftestDone || ((m1Flags & 0x02) !== 0);
    const m1Ok = (!stp.m1Needs) || !!stp.m1SelftestDone || m1SelftestDone;
    const m2Sbhf = st.mega2?.sbhf;
    const m2ShadowFlags = Number(st.mega2?.shadow?.selftestFlags ?? 0);
    const m2SelftestDone = !!m2Sbhf?.selftestDone || ((m2ShadowFlags & 0x02) !== 0);
    const m2Ok = (!stp.m2Needs) || !!stp.m2SelftestDone || m2SelftestDone;
    if (!m1Ok || !m2Ok) {
      logLine("Startup-Checkliste noch nicht abgeschlossen (Selftest fehlt).");
      return;
    }
    let okAll = true;
    okAll = wsSend({ action: "markMega1ChecklistDone" }) && okAll;
    okAll = wsSend({ action: "markMega2ChecklistDone" }) && okAll;
    if (st?.safety?.lock === true) {
      okAll = wsSend({ action: "safetyAck" }) && okAll;
      if (okAll) logLine("ACK gesendet.");
    } else {
      if (okAll) logLine("Startup-Checkliste quittiert.");
    }
    if (okAll) {
      g_startupSessionActive = false;
      closeOverlay();
    }
    return;
  }
  if (st?.safety?.lock === true) {
    const ok = wsSend({ action: "safetyAck" });
    if (ok) logLine("ACK gesendet.");
  }
}

function getUiStateFromWs(msg, safety, mega2online) {
  let level = "OK";
  let text = ["🟢 System OK"];
  let title = "";
  let overlay = false;
  let ackRequired = false;
  let hasWarn = false;
  let overlayMode = undefined;

  const stp = msg?.startup || {};
  const startupNeeds = !!stp.m1Needs || !!stp.m2Needs;
  if (!g_startupSessionActive && startupNeeds) g_startupSessionActive = true;
  if (g_startupSessionActive && stp && stp.ready === true && stp.m1Needs === false && stp.m2Needs === false) {
    g_startupSessionActive = false;
  }
  const inStartup = (g_startupSessionActive === true);

  if (!mega2online) {
    level = "WARN";
    text = ["🟡 Mega2 offline"];
    return { level, text, title, overlay, ackRequired, overlayMode, hasWarn };
  }

  const m1SelftestRunning = !!(msg?.mega1?.diag?.selftestRunning);
  if (m1SelftestRunning && !inStartup) {
    const t = window.SAFETY_UI_TEXTS?.fromKey?.("INFO_M1_SELFTEST_RUNNING");
    return { level: "WARN", text: t?.lines || ["Bitte warten …"], title: t?.title || "Mega1 Weichentest läuft", overlay: true, ackRequired: false, overlayMode: "info", hasWarn };
  }

  const selftestRunning = !!(msg?.mega2?.sbhf?.selftestRunning);
  if (selftestRunning && !inStartup) {
    const t = window.SAFETY_UI_TEXTS?.fromKey?.("INFO_SBHF_SELFTEST_RUNNING");
    return { level: "WARN", text: t?.lines || ["Bitte warten …"], title: t?.title || "SBHF Weichentest läuft", overlay: true, ackRequired: false, overlayMode: "info", hasWarn };
  }

  if (inStartup) {
    const t = window.SAFETY_UI_TEXTS?.fromKey?.("INFO_STARTUP_CHECKLIST");
    return { level: "WARN", text: t?.lines || ["Bitte die folgenden Punkte abarbeiten, bevor Power eingeschaltet werden kann."], title: t?.title || "Systemstart – Checkliste", overlay: true, ackRequired: false, overlayMode: "startup", hasWarn };
  }

  if (safety && safety.lock === true) {
    const t = getSafetyOverlayTexts(safety);
    return { level: "ERR", text: t.lines?.length ? t.lines : [], title: t.title || "⚠ Sicherheitsquittierung", overlay: true, ackRequired: true, overlayMode: "ack", hasWarn };
  }

  const sb = msg?.mega2?.sbhf;
  if (sb) {
    const allowed = (sb.allowedMask ?? 0) & 0xff;
    const warn = (sb.warningMask ?? 0) & 0xff;
    const restricted = (allowed !== 0x07 && allowed !== 0x00);
    hasWarn = (warn !== 0) || restricted;
    if (hasWarn) {
      level = "WARN";
      text = ["🟡 Warning aktiv"];
    }
  }

  const m1online = !!(msg?.mega1?.online);
  const m1StatusFlags = Number(msg?.mega1?.status?.flags ?? 0) & 0xff;
  if (m1online && ((m1StatusFlags & SYS_WARNING_PRESENT) !== 0)) {
    hasWarn = true;
    level = "WARN";
    text = ["🟡 Warning aktiv"];
  }

  return { level, text, title, overlay, ackRequired, overlayMode, hasWarn };
}

function setStatusValue(el, level, text) {
  if (!el) return;
  el.className = "status-value status-" + level;
  el.textContent = text;
}

function renderControlStatus(msg) {
  const el = document.getElementById("control-status");
  if (!el) return;
  const safetyLock = !!(msg?.safety?.lock);
  const diagActive = !!(msg?.diagCtrl?.active);

  let bedienung = "🟢 frei";
  if (safetyLock || diagActive) {
    bedienung = "🔒 gesperrt";
  }

  el.innerHTML = `<div><strong>Bedienung:</strong> ${bedienung}</div>`;
}

function renderDefectsRight(msg) {
  const elM1 = document.getElementById("defects-mega1");
  const elM2 = document.getElementById("defects-mega2");
  if (!elM1 || !elM2) return;
  const canMega2 = wsConnected && !!(msg?.mega2?.online);
  const selftestRunning = !!(msg?.mega2?.sbhf?.selftestRunning);
  const lock = !!(msg?.safety?.lock);
  const canMega1 = wsConnected && !!(msg?.mega1?.online);
  const m1SelftestRunning = !!(msg?.mega1?.diag?.selftestRunning);

  const fm = Number(msg?.mega1?.diag?.selftestFailMask || 0) & 0x0fff;
  const m1Names = [];
  for (let i = 0; i < 12; i++) if (fm & (1 << i)) m1Names.push(`W${i}`);
  const retryBtnM1 = m1Names.length ? `<div class="msg-actions"><button class="btn-mini" ${(canMega1 && !m1SelftestRunning && !lock) ? "" : "disabled"} onclick="sendM1SelftestRetry()">Mega1 Selbsttest erneut</button></div>` : "";
  elM1.innerHTML = m1Names.length ? `<div><strong>Mega1 Defekte:</strong> ${escapeHtml(m1Names.join(", "))}</div>${retryBtnM1}` : `<div><strong>Mega1 Defekte:</strong> keine</div>`;

  const warn = Number(msg?.mega2?.sbhf?.warningMask || 0) & 0xff;
  const m2Names = [];
  if (warn & 0x02) m2Names.push("W12 defekt");
  if (warn & 0x04) m2Names.push("W13 defekt");
  if (warn & 0x08) m2Names.push("W14 Störung");
  if (warn & 0x10) m2Names.push("W15 Störung");
  if (warn & 0x20) m2Names.push("Service erforderlich");
  const retryBtnM2 = m2Names.length ? `<div class="msg-actions"><button class="btn-mini" ${(canMega2 && !selftestRunning) ? "" : "disabled"} onclick="sendSbhfSelftestRetry()">SBHF Selbsttest erneut</button></div>` : "";
  elM2.innerHTML = m2Names.length ? `<div><strong>SBHF / Mega2 Defekte:</strong> ${escapeHtml(m2Names.join(", "))}</div>${retryBtnM2}` : `<div><strong>SBHF / Mega2 Defekte:</strong> keine</div>`;
}

function renderTrafoRight(msg) {
  const aEl = document.getElementById("trafo-a");
  const bEl = document.getElementById("trafo-b");
  if (!aEl && !bEl) return;
  const an = msg?.mega2?.analog;
  const flags = Number(an?.flags ?? 0) >>> 0;
  const fmtV = (v10) => {
    const n = Number(v10);
    if (!Number.isFinite(n) || n === 0xFFFF || n < 0 || n > 300) return "– V";
    return (n / 10).toFixed(1) + " V";
  };
  const voltagesInvalid = (flags & 0x02) !== 0;
  const aTxt = "Trafo A: " + (!an || voltagesInvalid ? "– V" : (an.vA10 !== undefined ? fmtV(an.vA10) : "– V"));
  const bTxt = "Trafo B: " + (!an || voltagesInvalid ? "– V" : (an.vB10 !== undefined ? fmtV(an.vB10) : "– V"));
  if (aEl) aEl.textContent = aTxt;
  if (bEl) bEl.textContent = bTxt;
}

function renderPowerWarningsEmergencies(msg) {
  const el = document.getElementById("safety-messages-list");
  if (!el) return;
  const items = [];
  if (uiTransientInfoText && Date.now() < uiTransientInfoUntil) {
    items.push(`i ${escapeHtml(String(uiTransientInfoText))}`);
  } else if (uiTransientInfoText && Date.now() >= uiTransientInfoUntil) {
    uiTransientInfoText = null;
  }
  const pushUiText = (key, x, prefix) => {
    const t = window.SAFETY_UI_TEXTS?.fromKey?.(key);
    if (!t || !Array.isArray(t.lines) || t.lines.length === 0) return;
    let line = String(t.lines[0] || "").trim();
    if (!line) return;
    if (typeof x !== "undefined") line = line.replaceAll("{x}", String(x));
    items.push(`${prefix || "i"} ${escapeHtml(line)}`);
  };

  // --- WS / Diagnose Status (nach oben verschoben aus Schreibrechte) ---
  const dc = msg?.diagCtrl;
  const wc = msg?.wsClients;
  const diagCount = (wc && typeof wc.diag === "number") ? wc.diag : 0;
  const wsBase = (wc && typeof wc.base === "number") ? wc.base : 0;
  const diagActive = !!(dc?.active);

  if (!wsConnected) {
    items.push("! WS getrennt");
  }

  if (diagActive) {
    const owner = (dc?.ownerId != null) ? dc.ownerId : "?";
    const sec = (dc?.expiresInMs != null)
      ? Math.round((dc.expiresInMs || 0) / 1000)
      : "?";
    items.push(`! Diagnose aktiv (Owner ${owner}, Timeout ~${sec}s, Base: ${wsBase}, Diag: ${diagCount})`);
  }

  const safety = msg?.safety;
  if (safety && (safety.lock === true || safety.ackRequired === true || (safety.errorCause ?? safety.errorType ?? safety.errType) > 0)) {
    const t = getSafetyOverlayTexts(safety);
    const title = (t?.title || "").trim();
    const first = (Array.isArray(t?.lines) && t.lines.length) ? String(t.lines[0]).trim() : "";
    let line = "";
    if (title && first) line = `${title}: ${first}`;
    else if (title) line = title;
    else if (first) line = first;
    if (line) items.push(`! ${escapeHtml(line)}`);
  }

  const m2 = msg?.mega2;
  const sb = m2?.sbhf;
  if (m2?.online && sb) {
    const allowed = (sb.allowedMask ?? 0) & 0xff;
    const warn = (sb.warningMask ?? 0) & 0xff;
    const tracks = [];
    if (allowed & 0x01) tracks.push("G1");
    if (allowed & 0x02) tracks.push("G2");
    if (allowed & 0x04) tracks.push("G3");
    if (allowed === 0x00) pushUiText("WARN_SBHF_NO_SAFE_PATH", undefined, "!");
    else pushUiText("INFO_SBHF_ALLOWED_TRACKS", (tracks.length ? tracks.join(", ") : "-"), "i");
    const restricted = ((warn & 0x01) !== 0) || (allowed !== 0x07 && allowed !== 0x00);
    if (restricted) pushUiText("WARN_SBHF_RESTRICTED_MODE", undefined, "!");
  }

  const m1 = msg?.mega1;
  if (m1?.online && m1.diag) {
    const m1WarnMask = Number(m1.warningMask ?? 0) & 0xff;
    if (m1WarnMask & 0x01) pushUiText("WARN_WEICHEN_NO_SWITCH", undefined, "!");
  }

  ensureUiCssOnce("ui-messages-icons-css", `
    .msg-line{ display:flex; gap:.55rem; align-items:flex-start; }
    .msg-ico{ width:1.25rem; flex:0 0 1.25rem; text-align:center; line-height:1.2; }
    .msg-txt{ flex:1 1 auto; }
  `);
  const renderMsg = (t) => {
    const s = String(t || "");
    const pre = s.length ? s[0] : "";
    const txt = (s.length >= 2 && s[1] === " ") ? s.slice(2) : s;
    const ico = (pre === "!") ? "⚠️" : (pre === "i") ? "ℹ️" : "•";
    return `<div class="msg-line"><span class="msg-ico">${ico}</span><span class="msg-txt">${txt}</span></div>`;
  };
  const html = (items.length ? items.map(renderMsg).join("") : "<em>Keine Meldungen</em>");
  if (el.__ptrDown === true) {
    el.__pendingHtml = html;
    return;
  }
  if (el.__lastHtml === html) return;
  el.innerHTML = html;
  el.__lastHtml = html;
}

function applyUiState(ui, msg) {
  const panel = document.getElementById("safety-panel");
  const status = document.getElementById("safety-status");
  if (!panel || !status) return;
  panel.className = "panel panel-right safety-panel " + ui.level.toLowerCase();
  status.textContent = ui.text[0] || "";
  if (ui.overlay) showOverlay(ui.title, ui.text, ui.ackRequired, { mode: ui.overlayMode, state: msg });
  else hideOverlay();

  const mega2online = !!(msg?.mega2?.online);
  const mega1online = !!(msg?.mega1?.online);
  const wsOk = (wsConnected === true);
  const lock = !!(lastSafetyState?.lock === true);
  const notausActive = !!(lastSafetyState?.notausActive === true);
  const powerOn = !!(lastSafetyState?.powerOn === true);
  const startup = msg?.startup;

  const ethOnline = !!(msg?.eth?.ip && msg.eth.ip !== "0.0.0.0");
+  setStatusValue(document.getElementById("status-eth"), ethOnline ? "ok" : "err", ethOnline ? "online" : "offline");
  setStatusValue(document.getElementById("badge-ws"), wsOk ? "ok" : "err", wsOk ? "verbunden" : "getrennt");

  const m2WarnMask = Number(msg?.mega2?.warningMask ?? 0) & 0xff;
  const m2Restricted = !!(msg?.mega2?.sbhf?.restricted);
  const m2WarnPresent = mega2online && ((m2WarnMask !== 0) || m2Restricted);
  setStatusValue(document.getElementById("badge-mega2"), !mega2online ? "err" : (m2WarnPresent ? "warn" : "ok"), mega2online ? (m2WarnPresent ? "online, warn" : "online") : "offline");

  const m1WarnMask = Number(msg?.mega1?.warningMask ?? 0) & 0xff;
  const m1Flags = Number(msg?.mega1?.status?.flags ?? 0) & 0xffff;
  const m1WarnPresent = mega1online && ((m1WarnMask !== 0) || ((m1Flags & SYS_WARNING_PRESENT) !== 0));
  setStatusValue(document.getElementById("badge-mega1"), !mega1online ? "err" : (m1WarnPresent ? "warn" : "ok"), mega1online ? (m1WarnPresent ? "online, warn" : "online") : "offline");

  const modeRaw = msg?.mega1?.diag?.mode;
  const mode = (modeRaw === undefined || modeRaw === null) ? -1 : Number(modeRaw);
  const isAuto = (mode === 1);
  setStatusValue(document.getElementById("badge-mode"), (mode < 0 || Number.isNaN(mode)) ? "warn" : (isAuto ? "ok" : "info"), (mode < 0 || Number.isNaN(mode)) ? "?" : (isAuto ? "Auto" : "Manuell"));
  setStatusValue(document.getElementById("badge-power"), powerOn ? "ok" : "warn", powerOn ? "AN" : "aus");

  const btnPowerOn = document.getElementById("btn-power-on");
  const btnPowerOff = document.getElementById("btn-power-off");
  const btnMode = document.getElementById("btn-mode");
  if (btnPowerOn) btnPowerOn.disabled = (!wsOk || !mega2online) ? true : (powerOn || notausActive || lock || (startup && startup.ready === false));
  if (btnPowerOff) btnPowerOff.disabled = (!wsOk || !mega2online) ? true : (!powerOn || lock);
  if (btnMode) btnMode.disabled = (!wsOk || !mega1online) ? true : (lock || !!(startup && startup.ready === false));

  const ledPower = document.getElementById("led-power");
  const ledStop = document.getElementById("led-stop");
  const ledMode = document.getElementById("led-mode");
  if (ledPower) ledPower.className = "status-led " + (powerOn ? "led-on" : "led-off");
  if (ledStop) ledStop.className = "status-led " + ((!powerOn || lock || notausActive) ? "led-stop" : "led-off");
  if (ledMode) ledMode.className = "status-led " + ((mode === 1) ? "led-on" : "led-off");

  renderControlStatus(msg);
  renderDefectsRight(msg);
  renderPowerWarningsEmergencies(msg);
  renderTrafoRight(msg);
  updateTrackDiagramFromState(msg);
}

function tdHasDiagram() { return !!document.querySelector(".track-diagram-stage"); }

function tdIsPanelActive(el) {
  const panel = el?.closest?.(".tab-panel[data-tab-panel]");
  return !!panel && panel.classList.contains("active");
}

function tdEnsureImageLoaded(el) {
  if (!el) return;
  if (el.dataset?.loaded === "1") return;
  const deferredSrc = el.dataset?.src;
  if (!deferredSrc) return;
  el.src = deferredSrc;
  el.dataset.loaded = "1";
}

function tdLoadVisibleAssetsInPanel(panel) {
  if (!panel) return;
  panel.querySelectorAll("img[data-src]").forEach((el) => {
    if (el.classList.contains("track-base") || el.style.display !== "none") tdEnsureImageLoaded(el);
  });
}

let tdWarmPrefetchScheduled = false;
function tdScheduleWarmPrefetch() {
  if (tdWarmPrefetchScheduled) return;
  tdWarmPrefetchScheduled = true;
  window.setTimeout(() => {
    document.querySelectorAll('.tab-panel img[data-src]').forEach((el) => tdEnsureImageLoaded(el));
  }, 1500);
}
function tdSetVisible(id, visible) { const el = document.getElementById(id); if (!el) return; el.style.display = visible ? "block" : "none"; if (visible && tdIsPanelActive(el)) tdEnsureImageLoaded(el); }
function tdSetTriState(prefix, state, values) { values.forEach((v) => tdSetVisible(`${prefix}-${v}`, v === state)); }
function tdSetWeiche(key, state) { tdSetTriState(key, state, ["g", "g-diff", "a", "a-diff", "undef"]); }
function tdSetSignal(prefix, state) { tdSetTriState(prefix, state, ["green", "red", "undef"]); }
function tdSetBlock(key, state) { tdSetVisible(`block-${key}-occ`, state === "occ"); tdSetVisible(`block-${key}-undef`, state === "undef"); }
function tdSetWarn(key, visible) { tdSetVisible(`${key}-warn`, visible === true); }
function tdSetButtonEnabled(id, enabled) { const el = document.getElementById(id); if (el) el.disabled = !enabled; }
function tdBit(mask, i) { return (((Number(mask) >>> 0) >> i) & 1) !== 0; }
function tdHasToken(list, token) {
  if (!token) return false;

  let raw = "";
  if (Array.isArray(list)) {
    raw = list.join(" ");
  } else if (typeof list === "string") {
    raw = list;
  } else if (list !== null && list !== undefined) {
    raw = String(list);
  }

  if (!raw.trim()) return false;

  const norm = raw
    .toUpperCase()
    .replace(/[\[\]\(\)\{\},;:|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const wanted = String(token).toUpperCase();
  const num = wanted.replace(/^W/, "");
  const parts = norm.split(" ");

  return parts.includes(wanted) || (num && parts.includes(num));
}
function tdSetText(id, txt) {
  const el = document.getElementById(id);
  if (el && el.textContent !== txt) el.textContent = txt;
}
function tdRenderSbhfStatus(msg) {
  const sb = msg?.mega2?.sbhf;
  const online = !!msg?.mega2?.online;
  if (!online || !sb) {
    tdSetText("m2-sbhf-state", "—");
    tdSetText("m2-sbhf-gleis", "—");
    tdSetText("m2-sbhf-occ", "—");
    tdSetText("m2-sbhf-allow", "—");
    tdSetText("m2-sbhf-restr", "—");
    tdSetText("m2-sbhf-start", "—");
    return;
  }

  const state = Number(sb.state ?? 0);
  const g = Number(sb.currentGleis ?? 0);
  const occ = Number(sb.occupiedMask ?? 0) & 0xff;
  const allowed = Number(sb.allowedMask ?? 0) & 0xff;
  const restricted = !!sb.restricted;
  const startPending = !!sb.startPending;

  const occList = [];
  if (occ & 0x01) occList.push("G1");
  if (occ & 0x02) occList.push("G2");
  if (occ & 0x04) occList.push("G3");

  const allowList = [];
  if (allowed & 0x01) allowList.push("G1");
  if (allowed & 0x02) allowList.push("G2");
  if (allowed & 0x04) allowList.push("G3");

  const stateText =
    (window.SAFETY_UI_TEXTS && typeof window.SAFETY_UI_TEXTS.sbhfStateName === "function")
      ? window.SAFETY_UI_TEXTS.sbhfStateName(state, g)
      : String(state);

  tdSetText("m2-sbhf-state", stateText);
  tdSetText("m2-sbhf-gleis", (g >= 1 && g <= 3) ? `G${g}` : "-");
  tdSetText("m2-sbhf-occ", occList.length ? occList.join(", ") : "-");
  tdSetText("m2-sbhf-allow", allowList.length ? allowList.join(", ") : "-");
  tdSetText("m2-sbhf-restr", restricted ? "ja" : "nein");
  tdSetText("m2-sbhf-start", startPending ? "SBHF-Start vorgemerkt" : "-");
}

function tdUpdateCommandButtons(msg) {
  if (!tdHasDiagram()) return;
  const canCmd = (wsConnected === true) && !!(msg?.mega1?.online) && !(msg?.safety?.lock === true) && !(msg?.safety?.notausActive === true);
  tdSetButtonEnabled("td-btn-w0", canCmd);
  tdSetButtonEnabled("td-btn-w1", canCmd);
  tdSetButtonEnabled("td-btn-w2", canCmd);
  tdSetButtonEnabled("td-btn-w3", canCmd);
  tdSetButtonEnabled("td-btn-w4", canCmd);
  tdSetButtonEnabled("td-btn-w5", canCmd);
  tdSetButtonEnabled("td-btn-w6", canCmd);
  tdSetButtonEnabled("td-btn-w7", canCmd);
  tdSetButtonEnabled("td-btn-w8", canCmd);
  tdSetButtonEnabled("td-btn-w9", canCmd);
  tdSetButtonEnabled("td-btn-w10", canCmd);
  tdSetButtonEnabled("td-btn-w11", canCmd);
  tdSetButtonEnabled("td-btn-bhf0", canCmd);
  tdSetButtonEnabled("td-btn-bhf1", canCmd);
  tdSetButtonEnabled("td-btn-bhf2", canCmd);
  tdSetButtonEnabled("td-btn-bhf3", canCmd);
}

function initTrackDiagramUi() {
  if (!tdHasDiagram()) return;

  document.querySelectorAll(".track-layer.track-overlay").forEach((el) => {
    el.style.display = "none";
  });

  tdSetButtonEnabled("td-btn-w0", false);
  tdSetButtonEnabled("td-btn-w1", false);
  tdSetButtonEnabled("td-btn-w2", false);
  tdSetButtonEnabled("td-btn-w3", false);
  tdSetButtonEnabled("td-btn-w4", false);
  tdSetButtonEnabled("td-btn-w5", false);
  tdSetButtonEnabled("td-btn-w6", false);
  tdSetButtonEnabled("td-btn-w7", false);
  tdSetButtonEnabled("td-btn-w8", false);
  tdSetButtonEnabled("td-btn-w9", false);
  tdSetButtonEnabled("td-btn-w10", false);
  tdSetButtonEnabled("td-btn-w11", false);
  tdSetButtonEnabled("td-btn-bhf0", false);
  tdSetButtonEnabled("td-btn-bhf1", false);
  tdSetButtonEnabled("td-btn-bhf2", false);
  tdSetButtonEnabled("td-btn-bhf3", false);

  tdSetWarn("w0", false);
  tdSetWarn("w1", false);
  tdSetWarn("w2", false);
  tdSetWarn("w3", false);
  tdSetWarn("w4", false);
  tdSetWarn("w5", false);
  tdSetWarn("w6", false);
  tdSetWarn("w7", false);
  tdSetWarn("w8", false);
  tdSetWarn("w9", false);
  tdSetWarn("w10", false);
  tdSetWarn("w11", false);
  tdSetWarn("w12", false);
  tdSetWarn("w13", false);
  tdSetWarn("w14", false);
  tdSetWarn("w15", false);

  tdSetVisible("target-sbhf1", false);
  tdSetVisible("target-sbhf2", false);
  tdSetVisible("target-sbhf3", false);

  tdLoadVisibleAssetsInPanel(document.querySelector('.tab-panel.active[data-tab-panel]'));
}

function updateTrackDiagramFromState(msg) {
  if (!tdHasDiagram()) return;
  const m1online = !!(msg?.mega1?.online);
  const m1diag = msg?.mega1?.diag;
  if (m1online && m1diag) {
    const istBits = Number(m1diag.weicheIstBits ?? 0);
    const sollBits = Number(m1diag.weicheSollBits ?? 0);
    const tdWeicheStateFromIstSoll = (idx) => {
      const istG = tdBit(istBits, idx);
      const sollG = tdBit(sollBits, idx);
      if (istG && sollG) return "g";
      if (!istG && !sollG) return "a";
      if (istG && !sollG) return "g-diff";
      return "a-diff";
    };

    /* Ebene 0: W0..W8 */
    tdSetWeiche("w0", tdWeicheStateFromIstSoll(0));
    tdSetWeiche("w1", tdWeicheStateFromIstSoll(1));
    tdSetWeiche("w2", tdWeicheStateFromIstSoll(2));
    tdSetWeiche("w3", tdWeicheStateFromIstSoll(3));
    tdSetWeiche("w4", tdWeicheStateFromIstSoll(4));
    tdSetWeiche("w5", tdWeicheStateFromIstSoll(5));
    tdSetWeiche("w6", tdWeicheStateFromIstSoll(6));
    tdSetWeiche("w7", tdWeicheStateFromIstSoll(7));
    tdSetWeiche("w8", tdWeicheStateFromIstSoll(8));

    /* Ebene 1: W9..W11 */
    tdSetWeiche("w9", tdWeicheStateFromIstSoll(9));
    tdSetWeiche("w10", tdWeicheStateFromIstSoll(10));
    tdSetWeiche("w11", tdWeicheStateFromIstSoll(11));

    const powerMask = Number(m1diag.powerMask ?? 0);
    tdSetSignal("bhf0", tdBit(powerMask, 0) ? "green" : "red");
    tdSetSignal("bhf1", tdBit(powerMask, 1) ? "green" : "red");
    tdSetSignal("bhf2", tdBit(powerMask, 2) ? "green" : "red");
    tdSetSignal("bhf3", tdBit(powerMask, 3) ? "green" : "red");

    const m1FailMask = Number(msg?.mega1?.diag?.selftestFailMask ?? 0) & 0x0fff;
    tdSetWarn("w0", tdBit(m1FailMask, 0));
    tdSetWarn("w1", tdBit(m1FailMask, 1));
    tdSetWarn("w2", tdBit(m1FailMask, 2));
    tdSetWarn("w3", tdBit(m1FailMask, 3));
    tdSetWarn("w4", tdBit(m1FailMask, 4));
    tdSetWarn("w5", tdBit(m1FailMask, 5));
    tdSetWarn("w6", tdBit(m1FailMask, 6));
    tdSetWarn("w7", tdBit(m1FailMask, 7));
    tdSetWarn("w8", tdBit(m1FailMask, 8));
    tdSetWarn("w9", tdBit(m1FailMask, 9));
    tdSetWarn("w10", tdBit(m1FailMask, 10));
    tdSetWarn("w11", tdBit(m1FailMask, 11));
  } else {
    tdSetWeiche("w0", "undef");
    tdSetWeiche("w1", "undef");
    tdSetWeiche("w2", "undef");
    tdSetWeiche("w3", "undef");
    tdSetWeiche("w4", "undef");
    tdSetWeiche("w5", "undef");
    tdSetWeiche("w6", "undef");
    tdSetWeiche("w7", "undef");
    tdSetWeiche("w8", "undef");
    tdSetWeiche("w9", "undef");
    tdSetWeiche("w10", "undef");
    tdSetWeiche("w11", "undef");
    tdSetSignal("bhf0", "undef");
    tdSetSignal("bhf1", "undef");
    tdSetSignal("bhf2", "undef");
    tdSetSignal("bhf3", "undef");

    tdSetWarn("w0", false);
    tdSetWarn("w1", false);
    tdSetWarn("w2", false);
    tdSetWarn("w3", false);
    tdSetWarn("w4", false);
    tdSetWarn("w5", false);
    tdSetWarn("w6", false);
    tdSetWarn("w7", false);
    tdSetWarn("w8", false);
    tdSetWarn("w9", false);
    tdSetWarn("w10", false);
    tdSetWarn("w11", false);
  }

  const m2online = !!(msg?.mega2?.online);
  const bs = msg?.mega2?.blocks?.status;
  if (m2online && Array.isArray(bs) && bs.length >= 6) {
    /* Ebene 0 */
    tdSetBlock("e0-b1", bs[0]?.besetzt ? "occ" : "free");
    tdSetBlock("e0-b3", bs[2]?.besetzt ? "occ" : "free");
    tdSetBlock("e0-b4", bs[3]?.besetzt ? "occ" : "free");
    tdSetBlock("e0-b5", bs[4]?.besetzt ? "occ" : "free");
    tdSetBlock("e0-b6", bs[5]?.besetzt ? "occ" : "free");

    /* Ebene 1 */
    tdSetBlock("e1-b1", bs[0]?.besetzt ? "occ" : "free");
    tdSetBlock("e1-b2", bs[1]?.besetzt ? "occ" : "free");
    tdSetBlock("e1-b3", bs[2]?.besetzt ? "occ" : "free");

    /* Ebene -1 */
    tdSetBlock("e-1-b4", bs[3]?.besetzt ? "occ" : "free");
    tdSetBlock("e-1-b5", bs[4]?.besetzt ? "occ" : "free");
    tdSetBlock("e-1-b6", bs[5]?.besetzt ? "occ" : "free");
    tdSetBlock("e-1-sbhf1", tdBit(msg?.mega2?.sbhf?.occupiedMask ?? 0, 0) ? "occ" : "free");
    tdSetBlock("e-1-sbhf2", tdBit(msg?.mega2?.sbhf?.occupiedMask ?? 0, 1) ? "occ" : "free");
    tdSetBlock("e-1-sbhf3", tdBit(msg?.mega2?.sbhf?.occupiedMask ?? 0, 2) ? "occ" : "free");
  } else if (m2online && (msg?.mega2?.blocks?.occupiedMask !== undefined || msg?.mega2?.blockOccupiedMask !== undefined)) {
    const occMask = Number(msg?.mega2?.blocks?.occupiedMask ?? msg?.mega2?.blockOccupiedMask ?? 0);

    /* Ebene 0 */
    tdSetBlock("e0-b1", tdBit(occMask, 0) ? "occ" : "free");
    tdSetBlock("e0-b3", tdBit(occMask, 2) ? "occ" : "free");
    tdSetBlock("e0-b4", tdBit(occMask, 3) ? "occ" : "free");
    tdSetBlock("e0-b5", tdBit(occMask, 4) ? "occ" : "free");
    tdSetBlock("e0-b6", tdBit(occMask, 5) ? "occ" : "free");

    /* Ebene 1 */
    tdSetBlock("e1-b1", tdBit(occMask, 0) ? "occ" : "free");
    tdSetBlock("e1-b2", tdBit(occMask, 1) ? "occ" : "free");
    tdSetBlock("e1-b3", tdBit(occMask, 2) ? "occ" : "free");

    /* Ebene -1 */
    tdSetBlock("e-1-b4", tdBit(occMask, 3) ? "occ" : "free");
    tdSetBlock("e-1-b5", tdBit(occMask, 4) ? "occ" : "free");
    tdSetBlock("e-1-b6", tdBit(occMask, 5) ? "occ" : "free");
    tdSetBlock("e-1-sbhf1", tdBit(msg?.mega2?.sbhf?.occupiedMask ?? 0, 0) ? "occ" : "free");
    tdSetBlock("e-1-sbhf2", tdBit(msg?.mega2?.sbhf?.occupiedMask ?? 0, 1) ? "occ" : "free");
    tdSetBlock("e-1-sbhf3", tdBit(msg?.mega2?.sbhf?.occupiedMask ?? 0, 2) ? "occ" : "free");
  } else {
    tdSetBlock("e0-b1", "undef");
    tdSetBlock("e0-b3", "undef");
    tdSetBlock("e0-b4", "undef");
    tdSetBlock("e0-b5", "undef");
    tdSetBlock("e0-b6", "undef");
    tdSetBlock("e1-b1", "undef");
    tdSetBlock("e1-b2", "undef");
    tdSetBlock("e1-b3", "undef");
    tdSetBlock("e-1-b4", "undef");
    tdSetBlock("e-1-b5", "undef");
    tdSetBlock("e-1-b6", "undef");
    tdSetBlock("e-1-sbhf1", "undef");
    tdSetBlock("e-1-sbhf2", "undef");
    tdSetBlock("e-1-sbhf3", "undef");
  }

  const entryNow = msg?.mega2?.entryAllowed;
  if (m2online && Array.isArray(entryNow) && entryNow.length >= 6) {
    const sbhfState = Number(msg?.mega2?.sbhf?.state ?? 0);
    const currentGleis = Number(msg?.mega2?.sbhf?.currentGleis ?? 0);
    const block5ToSbhfActive = !!msg?.mega2?.sbhf?.block5ToSbhfActive;
    const exitRunning = (sbhfState === 4);

    const grant34 = ((Number(entryNow[2] ?? 0) & (1 << 3)) !== 0); /* 3 -> 4 */
    const grant64 = ((Number(entryNow[5] ?? 0) & (1 << 3)) !== 0); /* 6 -> 4 */
    const grant45 = ((Number(entryNow[3] ?? 0) & (1 << 4)) !== 0); /* 4 -> 5 */
    const grant41 = ((Number(entryNow[3] ?? 0) & (1 << 0)) !== 0); /* 4 -> 1 */

    const grant12 = ((Number(entryNow[0] ?? 0) & (1 << 1)) !== 0);
    const grant23 = ((Number(entryNow[1] ?? 0) & (1 << 2)) !== 0);

    tdSetSignal("grant-3-4", grant34 ? "green" : "red");
    tdSetSignal("grant-6-4", grant64 ? "green" : "red");
    tdSetSignal("grant-4-5", grant45 ? "green" : "red");
    tdSetSignal("grant-4-1", grant41 ? "green" : "red");
    tdSetSignal("grant-1-2", grant12 ? "green" : "red");
    tdSetSignal("grant-2-3", grant23 ? "green" : "red");

    tdSetSignal("grant-sbhf-4-5", grant45 ? "green" : "red");
    tdSetSignal("grant-sbhf-5-sbhf", block5ToSbhfActive ? "green" : "red");
    tdSetSignal("grant-sbhf-sbhf1-6", (exitRunning && currentGleis === 1) ? "green" : "red");
    tdSetSignal("grant-sbhf-sbhf2-6", (exitRunning && currentGleis === 2) ? "green" : "red");
    tdSetSignal("grant-sbhf-sbhf3-6", (exitRunning && currentGleis === 3) ? "green" : "red");
    tdSetSignal("grant-sbhf-6-4", grant64 ? "green" : "red");
  } else {
    tdSetSignal("grant-3-4", "undef");
    tdSetSignal("grant-6-4", "undef");
    tdSetSignal("grant-4-5", "undef");
    tdSetSignal("grant-4-1", "undef");
    tdSetSignal("grant-1-2", "undef");
    tdSetSignal("grant-2-3", "undef");
    
    tdSetSignal("grant-sbhf-4-5", "undef");
    tdSetSignal("grant-sbhf-5-sbhf", "undef");
    tdSetSignal("grant-sbhf-sbhf1-6", "undef");
    tdSetSignal("grant-sbhf-sbhf2-6", "undef");
    tdSetSignal("grant-sbhf-sbhf3-6", "undef");
    tdSetSignal("grant-sbhf-6-4", "undef");
  }

  const m2turnouts = msg?.mega2?.turnouts;
  if (m2online && m2turnouts) {
    const istMask = Number(m2turnouts.istMask ?? 0);
    const sollMask = Number(m2turnouts.sollMask ?? 0);
    const tdM2WeicheState = (bit) => {
      const istA = tdBit(istMask, bit);
      const sollA = tdBit(sollMask, bit);
      if (!istA && !sollA) return "g";
      if (istA && sollA) return "a";
      if (!istA && sollA) return "g-diff";
      return "a-diff";
    };
    tdSetWeiche("w12", tdM2WeicheState(0));
    tdSetWeiche("w13", tdM2WeicheState(1));
    tdSetWeiche("w14", tdM2WeicheState(2));
    tdSetWeiche("w15", tdM2WeicheState(3));

    const m2WarnMask = Number(msg?.mega2?.sbhf?.warningMask ?? 0) & 0xff;
    tdSetWarn("w12", (m2WarnMask & 0x02) !== 0);
    tdSetWarn("w13", (m2WarnMask & 0x04) !== 0);
    tdSetWarn("w14", (m2WarnMask & 0x08) !== 0);
    tdSetWarn("w15", (m2WarnMask & 0x10) !== 0);
  } else {
    tdSetWeiche("w12", "undef");
    tdSetWeiche("w13", "undef");
    tdSetWeiche("w14", "undef");
    tdSetWeiche("w15", "undef");
    tdSetWarn("w12", false);
    tdSetWarn("w13", false);
    tdSetWarn("w14", false);
    tdSetWarn("w15", false);
  }

  const currentGleis = Number(msg?.mega2?.sbhf?.currentGleis ?? 0);
  tdSetVisible("target-sbhf1", currentGleis === 1);
  tdSetVisible("target-sbhf2", currentGleis === 2);
  tdSetVisible("target-sbhf3", currentGleis === 3);
  tdRenderSbhfStatus(msg);

  tdUpdateCommandButtons(msg);
}

function handleWsMessage(msg) {
  if (!msg) return;
  if (msg.type === "error") {
    const code = msg.code || "ERROR";
    const ownerId = (msg.ownerId != null) ? msg.ownerId : "";
    logLine(`⚠ ${code}${ownerId !== "" ? ` (owner ${ownerId})` : ""}: ${msg.msg || ""}`);
    return;
  }
  if (msg.type === "analog") {
    window.lastStateMsg = window.lastStateMsg || {};
    window.lastStateMsg.mega2 = window.lastStateMsg.mega2 || {};
    window.lastStateMsg.mega2.analog = msg.analog || {};
    renderTrafoRight(window.lastStateMsg);
    return;
  }
  if (msg.type !== "state") return;

  msg = normalizeWsState(msg);
  const prevAnalog = window.lastStateMsg?.mega2?.analog;
  if (prevAnalog) {
    msg.mega2 = msg.mega2 || {};
    if (msg.mega2.analog === undefined) msg.mega2.analog = prevAnalog;
  }

  window.lastState = msg;
  window.lastStateMsg = msg;
  lastSafetyState = msg.safety || null;
  if (lastSafetyState && lastSafetyState.lock === false) ackPending = false;
  lastMega2Online = !!(msg?.mega2?.online);
  lastStateMsg = msg;

  const uiState = getUiStateFromWs(msg, lastSafetyState, lastMega2Online);
  applyUiState(uiState, msg);
  tdScheduleWarmPrefetch();
}

function connectWebSocket() {
  socket = new WebSocket(`ws://${location.host}/ws`);
  socket.onopen = () => {
    wsConnected = true;
    logLine("WS connected");
    try { wsSend({ action: "subscribe", base: true, diag: false }); } catch (_) {}
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
    wsConnected = false;
    logLine("WS error");
  };
  socket.onmessage = (ev) => {
    try {
      handleWsMessage(JSON.parse(ev.data));
    } catch (e) {
      console.warn("WS parse error", e);
    }
  };
}

function installPointerGuard() {
  const el = document.getElementById("safety-messages-list");
  if (!el || el.__ptrGuardInstalled) return;
  el.__ptrGuardInstalled = true;
  el.__ptrDown = false;
  el.__pendingHtml = null;
  el.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".msg-actions, .btn-mini")) el.__ptrDown = true;
  }, true);
  el.addEventListener("pointercancel", () => { el.__ptrDown = false; }, true);
  window.addEventListener("blur", () => { el.__ptrDown = false; }, true);
  el.addEventListener("pointerup", () => {
    if (!el.__ptrDown) return;
    el.__ptrDown = false;
    if (typeof el.__pendingHtml === "string") {
      const html = el.__pendingHtml;
      el.__pendingHtml = null;
      setTimeout(() => {
        if (el.__lastHtml !== html) {
          el.innerHTML = html;
          el.__lastHtml = html;
        }
      }, 0);
    }
  }, true);
}

function initTrackTabs() {
  const tabButtons = Array.from(document.querySelectorAll(".tabs-nav .tab-btn[data-tab]"));
  const tabPanels = Array.from(document.querySelectorAll(".tab-panels .tab-panel[data-tab-panel]"));
  const activateTab = (tabName) => {
    let activePanel = null;
    tabButtons.forEach((btn) => {
      const active = (btn.dataset.tab === tabName);
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    tabPanels.forEach((panel) => {
      const active = (panel.dataset.tabPanel === tabName);
      panel.classList.toggle("active", active);
      panel.setAttribute("aria-hidden", active ? "false" : "true");
      panel.style.display = active ? "" : "none";
      if (active) activePanel = panel;
    });
    tdLoadVisibleAssetsInPanel(activePanel);
  };
  tabButtons.forEach((btn) => btn.addEventListener("click", () => activateTab(btn.dataset.tab)));
  const initiallyActive = tabButtons.find((b) => b.classList.contains("active"))?.dataset.tab || tabButtons[0]?.dataset.tab;
  if (initiallyActive) activateTab(initiallyActive);
}

function initOnce() {
  const g = (window.__EE_TRACKDIAGRAM_INIT__ ||= { inited: false });
  if (g.inited) return;
  g.inited = true;
  const v = document.getElementById("ui-version");
  if (v) v.textContent = UI_VERSION;
  initTrackTabs();
  initTrackDiagramUi();
  installPointerGuard();
  connectWebSocket();
}

window.addEventListener("load", initOnce, { once: true });
window.sendPowerOn = sendPowerOn;
window.sendPowerOff = sendPowerOff;
window.sendModeToggle = sendModeToggle;
window.sendM1BhfToggle = sendM1BhfToggle;
window.sendM1WeicheToggle = sendM1WeicheToggle;
window.closeOverlay = closeOverlay;
window.confirmAck = confirmAck;
window.sendSbhfSelftestRetry = sendSbhfSelftestRetry;
window.sendM1SelftestRetry = sendM1SelftestRetry;