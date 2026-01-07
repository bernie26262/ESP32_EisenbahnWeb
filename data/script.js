/* =========================================================
 *  Eisenbahn WebUI – WS-only
 *  Version: 2026-01-07-p5
 * ========================================================= */

const UI_VERSION = "2026-01-07-p5";
const DEBUG_WS = false;

let ws = null;
let wsConnected = false;
window.lastStateMsg = null;

function $(id) { return document.getElementById(id); }

function logLine(s) {
  const w = $("log-window");
  if (!w) return;
  const line = document.createElement("div");
  line.textContent = s;
  w.prepend(line);
}

function bit(mask, i) {
  return (((mask ?? 0) >> i) & 1) === 1;
}

function wsSend(obj) {
  if (!wsConnected || !ws) return false;
  try { ws.send(JSON.stringify(obj)); return true; }
  catch (e) { return false; }
}

/* ===================== ACTIONS ===================== */

function sendPowerToggle() {
  // Backend: queued actions -> I2C
  const ok = wsSend({ action: "powerToggle" });
  if (ok) logLine("POWER Toggle gesendet");
}

function sendMega1ModeToggle() {
  const d = window.lastStateMsg?.mega1?.diag;
  if (!d) { logLine("Mega1 Mode: keine Daten"); return; }
  const mode = Number(d.mode ?? 0);     // 0=MANUELL, 1=AUTO
  const target = (mode === 1) ? 0 : 1;  // toggle
  const ok = wsSend({ action: "m1SetMode", mode: target });
  if (ok) logLine(`Mega1 Modus -> ${target === 1 ? "AUTO" : "MANUELL"} gesendet`);
}

function sendMega1WeicheToggle(idx) {
  const d = window.lastStateMsg?.mega1?.diag;
  if (!d) { logLine("Mega1 Weiche: keine Daten"); return; }

  const istBits = d.weicheIstBits ?? d.weicheIstGeradeBits ?? 0;
  const istGerade = bit(istBits, idx);
  const targetGerade = !istGerade;

  const ok = wsSend({ action: "m1TurnoutSet", idx, gerade: targetGerade });
  if (ok) logLine(`Mega1 Weiche W${idx} -> ${targetGerade ? "GERADE" : "ABB"} gesendet`);
}

function sendMega1BhfToggle(bhfIdx) {
  const d = window.lastStateMsg?.mega1?.diag;
  if (!d) { logLine("Mega1 Bahnhof: keine Daten"); return; }

  const pm = d.powerMask ?? 0;
  const on = bit(pm, bhfIdx);
  const targetOn = !on;

  const ok = wsSend({ action: "m1PowerSet", bhf: bhfIdx, on: targetOn });
  if (ok) logLine(`Mega1 Bahnhof B${bhfIdx + 1} -> ${targetOn ? "GRÜN" : "ROT"} gesendet`);
}

/* ===================== RENDER ===================== */

function renderBadges(msg) {
  const m2 = !!msg?.mega2?.online;
  const m1 = !!msg?.mega1?.online;
  const pwr = !!msg?.safety?.powerOn;

  const bWs = $("badge-ws");
  const bM2 = $("badge-m2");
  const bM1 = $("badge-m1");
  const bPw = $("badge-power");
  const bMode = $("badge-m1mode");

  if (bWs) {
    bWs.className = "badge " + (wsConnected ? "badge-ok" : "badge-err");
    bWs.textContent = "WS: " + (wsConnected ? "verbunden" : "getrennt");
  }
  if (bM2) {
    bM2.className = "badge " + (m2 ? "badge-ok" : "badge-err");
    bM2.textContent = "Mega2: " + (m2 ? "online" : "offline");
  }
  if (bM1) {
    bM1.className = "badge " + (m1 ? "badge-ok" : "badge-err");
    bM1.textContent = "Mega1: " + (m1 ? "online" : "offline");
  }
  if (bPw) {
    bPw.className = "badge " + (pwr ? "badge-ok" : "badge-warn");
    bPw.textContent = "Power: " + (pwr ? "AN" : "aus");
  }

  // Mode badge color: green=AUTO, blue=MANUELL
  if (bMode) {
    const d = msg?.mega1?.diag;
    if (!m1 || !d || typeof d.mode !== "number") {
      bMode.className = "badge badge-warn";
      bMode.textContent = "Mega1 Modus: ?";
    } else {
      const isAuto = (d.mode === 1);
      bMode.className = "badge " + (isAuto ? "badge-green" : "badge-blue");
      bMode.textContent = "Mega1 Modus: " + (isAuto ? "AUTO" : "MANUELL");
    }
  }

  // Top-right buttons
  const btnPower = $("btn-power");
  if (btnPower) {
    btnPower.classList.toggle("power-on", !!pwr);
    btnPower.classList.toggle("power-off", !pwr);
    btnPower.textContent = pwr ? "⏻ STOP / POWER OFF" : "⚡ POWER ON";
  }
}

function renderMega2Sbhf(msg) {
  const el = $("ov-sbhf");
  if (!el) return;
  const sb = msg?.mega2?.sbhf;
  if (!msg?.mega2?.online || !sb) { el.innerHTML = "<em>keine Daten</em>"; return; }

  const allowed = msg?.mega2?.allowedMask ?? sb.allowedMask;
  const restricted = !!(sb.restricted);

  // minimal – du kannst hier später mehr reinrendern
  el.innerHTML = `
    <div class="kv">State: <b>${sb.state ?? "?"}</b></div>
    <div class="kv">Ausfahr-Gleis: <b>${sb.currentTrack ?? sb.gleis ?? "?"}</b></div>
    <div class="kv">Belegt: <b>${sb.occupiedTrack ?? "—"}</b></div>
    <div class="kv">Erlaubt: <b>${sb.allowedText ?? "G1, G2, G3"}</b></div>
    <div class="kv">Restricted: <b>${restricted ? "ja" : "nein"}</b></div>
  `;
}

function renderMega2Turnouts(msg) {
  const el = $("ov-turnouts");
  if (!el) return;

  const t = msg?.mega2?.turnouts;
  if (!msg?.mega2?.online || !t) { el.innerHTML = "<em>keine Daten</em>"; return; }

  // erwartet: t.items oder feste W12..W15
  const items = t.items ?? t.list ?? [];
  if (items.length === 0 && typeof t === "object") {
    // Fallback: W12..W15
    const fallback = ["W12","W13","W14","W15"].map((name, i) => ({
      name,
      soll: t[`w${12+i}Soll`] ?? t[`W${12+i}Soll`] ?? "G",
      ist:  t[`w${12+i}Ist`]  ?? t[`W${12+i}Ist`]  ?? "G",
      ok:   true
    }));
    el.innerHTML = `<div class="pill-row">` + fallback.map(x =>
      `<span class="pill pill-ro ${x.ok ? "ok" : "bad"}">${x.name} Soll:${x.soll} Ist:${x.ist}</span>`
    ).join("") + `</div>`;
    return;
  }

  el.innerHTML =
    `<div class="pill-row">` +
    items.map(x => {
      const ok = (x.ok ?? (x.soll === x.ist));
      return `<span class="pill pill-ro ${ok ? "ok" : "bad"}">${x.name} Soll:${x.soll} Ist:${x.ist}</span>`;
    }).join("") +
    `</div>`;
}

function renderMega2Blocks(msg) {
  const el = $("ov-blocks");
  if (!el) return;

  const blocks = msg?.mega2?.blocks;
  if (!msg?.mega2?.online || !blocks) { el.innerHTML = "<em>keine Daten</em>"; return; }

  // Minimal: mask free/occupied (wenn vorhanden)
  const occMask = blocks.occupiedMask ?? msg?.mega2?.blockOccupiedMask ?? 0;

  let html = `<div class="ov-subtitle">Belegung:</div><div class="pill-row">`;
  for (let i=1;i<=9;i++){
    const occ = bit(occMask, i-1);
    html += `<span class="pill pill-ro ${occ ? "bad":"ok"}">B${i} ${occ?"belegt":"frei"}</span>`;
  }
  html += `</div>`;

  // optional: signals array
  if (blocks.signals && Array.isArray(blocks.signals)) {
    html += `<div class="ov-subtitle" style="margin-top:8px;">Signale (FROM → TO):</div><div class="pill-row">`;
    html += blocks.signals.map(s => {
      const ok = (s.n === "OK" || s.n === 0);
      const txt = `P: ${s.p}  N: ${s.nTxt ?? s.n ?? "?"}`;
      return `<span class="pill pill-ro ${ok ? "ok":"bad"}">${txt}</span>`;
    }).join("");
    html += `</div>`;
  }

  el.innerHTML = html;
}

function renderMega1Stations(msg) {
  const el = $("ov-stations");
  if (!el) return;

  const online = !!msg?.mega1?.online;
  const d = msg?.mega1?.diag;
  if (!online || !d) { el.innerHTML = "<em>keine Daten</em>"; return; }

  const pm = d.powerMask ?? 0;

  let html = `<div class="pill-row">`;
  for (let i=0;i<4;i++){
    const on = bit(pm, i);
    html += `
      <button type="button"
        class="pill pill-btn ${on ? "ok":"bad"}"
        onclick="sendMega1BhfToggle(${i})">
        B${i+1}: ${on ? "GRÜN" : "ROT"}
      </button>`;
  }
  html += `</div>`;
  el.innerHTML = html;
}

function renderMega1Weichen(msg) {
  const host = $("ov-m1weichen");
  if (!host) return;

  const online = !!msg?.mega1?.online;
  const d = msg?.mega1?.diag;
  if (!online || !d) { host.innerHTML = "<em>keine Daten</em>"; return; }

  const istBits  = d.weicheIstBits  ?? d.weicheIstGeradeBits  ?? 0;
  const sollBits = d.weicheSollBits ?? d.weicheSollGeradeBits ?? 0;
  const slowBits = d.weicheSlowBits ?? d.weicheSlowActiveBits ?? 0;

  let html = `<div class="pill-grid">`;

  for (let i=0;i<12;i++){
    const istG = bit(istBits, i);
    const solG = bit(sollBits, i);
    const slow = bit(slowBits, i);
    const ok = (istG === solG);

    // Debug: "R" + Rohbit
    const dbg = slow ? `<span class="dbg dbg-red" title="Reduktions-Relais aktiv">R</span><span class="dbg dbg-raw">r=1</span>`
                     : `<span class="dbg dbg-raw">r=0</span>`;

    html += `
      <button type="button"
        class="pill pill-btn pill-m1 ${ok ? "ok":"bad"} ${slow ? "slow":""}"
        onclick="sendMega1WeicheToggle(${i})">
        <span class="t">W${i}</span>
        <span class="s">Ist:${istG ? "G":"A"}</span>
        <span class="s">Soll:${solG ? "G":"A"}</span>
        ${slow ? `<span class="s">SLOW</span>` : ``}
        ${dbg}
      </button>`;
  }

  html += `</div>`;
  host.innerHTML = html;
}

function renderAll(msg) {
  renderBadges(msg);
  renderMega2Sbhf(msg);
  renderMega2Turnouts(msg);
  renderMega2Blocks(msg);
  renderMega1Stations(msg);
  renderMega1Weichen(msg);

  // Alerts minimal (du hast ggf. schon mehr serverseitig)
  const alerts = $("alerts");
  if (alerts) {
    const lines = [];
    if (msg?.mega2?.online && msg?.mega2?.allowedMask != null) {
      lines.push(`SBHF erlaubte Gleise: ${msg?.mega2?.allowedText ?? "G1, G2, G3"}`);
    }
    alerts.innerHTML = lines.length ? lines.map(s => `<div class="alert-line">🚦 ${s}</div>`).join("") : "<em>—</em>";
  }
}

/* ===================== WS ===================== */

function wsConnect() {
  const proto = (location.protocol === "https:") ? "wss" : "ws";
  const url = `${proto}://${location.host}/ws`;
  ws = new WebSocket(url);

  ws.onopen = () => {
    wsConnected = true;
    logLine("WS connected");
  };

  ws.onclose = () => {
    wsConnected = false;
    logLine("WS disconnected");
    setTimeout(wsConnect, 1500);
  };

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch(e) { return; }
    window.lastStateMsg = msg;

    if (DEBUG_WS) console.log("[WS MSG]", msg);

    if (msg.type === "state") {
      renderAll(msg);
    }
  };
}

/* ===================== INIT ===================== */

document.addEventListener("DOMContentLoaded", () => {
  $("ui-version").textContent = UI_VERSION;

  $("btn-power")?.addEventListener("click", sendPowerToggle);
  $("btn-m1-mode")?.addEventListener("click", sendMega1ModeToggle);

  wsConnect();
});
