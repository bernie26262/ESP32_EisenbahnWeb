console.log("[DIAGJS] build 2026-02-15 14:59");
const DIAG_DEBUG = true;
let ws = null;
// Diagnose-Owner Token (nur aus type:"diagControl")
let diagToken = null;
let diagIsOwner = false;

// Persist last known diag token so we can "resume" after reconnect/reload.
const DIAG_TOKEN_KEY = "ee_diag_token";

function loadDiagToken(){
  try { return localStorage.getItem(DIAG_TOKEN_KEY); } catch(_) { return null; }
}
function storeDiagToken(t){
  try {
    if (t) localStorage.setItem(DIAG_TOKEN_KEY, t);
    else localStorage.removeItem(DIAG_TOKEN_KEY);
  } catch(_) {}
}

// Try to enter diagnose mode, optionally resuming by previously stored token.
function diagEnterWithBestToken(){
  const t = diagToken || loadDiagToken() || null;
  wsSend({ action:"diagEnter", token: t || undefined });
}

// Best-effort release of lease even if WS is already closing.
// Uses HTTP keepalive fallback because beforeunload/pagehide is unreliable for WS frames.
function diagExitBestEffort(){
  const t = diagToken || loadDiagToken() || null;
  if (!t) return;

  // 1) try WS if still open
  try {
    if (ws && ws.readyState === WebSocket.OPEN){
      wsSend({ action:"diagExit", token: t });
    }
  } catch(_) {}

  // 2) HTTP fallback (works during pagehide)
  try {
    fetch(`/diag-exit?token=${encodeURIComponent(t)}`, {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "text/plain" },
      body: "1"
    }).catch(()=>{});
  } catch(_) {}
}

// (removed duplicate token storage + duplicate diagEnterWithBestToken)


let hbTimer = null;
let leaseCountdownTimer = null;
// NOTE: token is only valid while we are DIAG owner (server lease)

// Optional lease countdown (server may or may not provide TTL fields)
const leaseModel = {
  active: false,
  ownerId: 0,
  expiresAtMs: 0, // epoch ms
};
let lastDiagMsg = null;
 
 // ------------------------------------------------------------
 // Performance guards for diag.htm:
 // - pretty JSON dump is expensive -> throttle + optionally trim
 // - render tables at most DIAG_RENDER_INTERVAL_MS
 // - drop out-of-order/duplicate diag frames by msg.ts
 // ------------------------------------------------------------
 const DIAG_RENDER_INTERVAL_MS = 250;   // 4 Hz; adjust later if needed
 const DIAG_JSON_DUMP_MS       = 1000;  // pretty-print at most 1 Hz
 const DIAG_JSON_FULL          = (localStorage.getItem("diagJsonFull") === "1");
 
 let _lastDiagTs = 0;
 let _diagRenderPending = false;
 let _latestDiagMsg = null;
 let _lastPreDumpMs = 0;
 let _lastAnalogAgeMs = null;

 function renderM2Sensors(msg){
  // Mega2: Kontakte + Schaltgleise in einem konsistenten Durchlauf
  try { renderM2Kontakte(msg); } catch(e){ console.error("[diag] renderM2Kontakte failed", e); }
  try { renderM2Schalt(msg); } catch(e){ console.error("[diag] renderM2Schalt failed", e); }
 }

function initM2PrevFromFirstPacket(msg){
  const d = msg?.mega2?.diagSensors;
  if (!d) return;

  // Kontakte: packed 4-bit counters
  if (!_m2InitKontaktPrevDone && Array.isArray(d.kontaktRise4) && Array.isArray(d.kontaktFall4)){
    for (let i=0; i<14; i++){
      const r = getNibble4(d.kontaktRise4, i);
      const f = getNibble4(d.kontaktFall4, i);

      // Prev für Pfeile
      m2Ui.kontakt.prevRise[i] = r;
      m2Ui.kontakt.prevFall[i] = f;

      // Offset initialisieren -> Anzeige startet bei 0 nach Page-Load
      m2Ui.kontakt.offRise[i] = r;
      m2Ui.kontakt.offFall[i] = f;
    }
    _m2InitKontaktPrevDone = true;
  }

  // Schaltgleise: arrays of counters
  if (!_m2InitSchaltPrevDone && Array.isArray(d.schaltRise) && Array.isArray(d.schaltFall)){
    for (let i=0; i<6; i++){
      const r = (typeof d.schaltRise[i] === "number") ? d.schaltRise[i] : 0;
      const f = (typeof d.schaltFall[i] === "number") ? d.schaltFall[i] : 0;

      // Prev für Pfeile
      m2Ui.schalt.prevRise[i] = r;
      m2Ui.schalt.prevFall[i] = f;

      // Offset initialisieren -> Anzeige startet bei 0 nach Page-Load
      m2Ui.schalt.offRise[i] = r;
      m2Ui.schalt.offFall[i] = f;
    }
    _m2InitSchaltPrevDone = true;
  }
}
 
function scheduleDiagRender(){
  if (_diagRenderPending) return;
  _diagRenderPending = true;
  setTimeout(() => {
  _diagRenderPending = false;
  const m = _latestDiagMsg;
  _latestDiagMsg = null;
  if (!m) return;

  const t0 = performance.now();

  try { initM2PrevFromFirstPacket(m); } catch(e){ console.error("[diag] initM2PrevFromFirstPacket failed", e); }
  const t1 = performance.now();

  try { renderM2Sensors(m); } catch(e){ console.error("[diag] renderM2Sensors failed", e); }
  const t2 = performance.now();

  try { renderM1Sensors(m); } catch(e){ console.error("[diag] renderM1Sensors failed", e); }
  try { renderM1Relays(m); } catch(e){ console.error("[diag] renderM1Relays failed", e); }
  const t3 = performance.now();

  console.log("[DIAG-RENDER]",
              "total", (t3 - t0).toFixed(1)+"ms",
              "init",  (t1 - t0).toFixed(1)+"ms",
              "m2",    (t2 - t1).toFixed(1)+"ms",
              "m1",    (t3 - t2).toFixed(1)+"ms");
}, DIAG_RENDER_INTERVAL_MS);
}


// ------------------------------------------------------------
// Mega2 sensor meta
// (Pins aus deinem Chattext / proto_common.h: 14 Kontakte + S11..S16)
// Reihenfolge der 14 Kontakt-Bits muss zur Mega2 FW passen.
// ------------------------------------------------------------
const M2_KONTAKT_INFO = [
  { key:"B1",        name:"Blockkontakt 1",           pin:22 },
  { key:"B2",        name:"Blockkontakt 2",           pin:23 },
  { key:"B3",        name:"Blockkontakt 3",           pin:24 },
  { key:"B4",        name:"Blockkontakt 4",           pin:25 },
  { key:"B5",        name:"Blockkontakt 5",           pin:26 },
  { key:"B6",        name:"Blockkontakt 6",           pin:30 },
  { key:"SBHF1",     name:"SBHF Kontakt GF1",         pin:27 },
  { key:"SBHF2",     name:"SBHF Kontakt GF2",         pin:28 },
  { key:"SBHF3",     name:"SBHF Kontakt GF3",         pin:29 },
  { key:"NOTHALT",   name:"Nothalt-Kontakt",          pin:19 },
  { key:"BHF2_A",    name:"Bahnhof Block2 A",         pin:14 },
  { key:"BHF2_B",    name:"Bahnhof Block2 B",         pin:15 },
  { key:"BHF4_A",    name:"Bahnhof Block4 A",         pin:16 },
  { key:"BHF4_B",    name:"Bahnhof Block4 B",         pin:11 },
];

// Mega2 Schaltgleise S11..S16: Map nach sid (11..16)
const M2_SCHALT_INFO = new Map([
  [11, { key:"S11", name:"Schaltgleis S11", pin:31, idx:0 }],
  [12, { key:"S12", name:"Schaltgleis S12", pin:32, idx:1 }],
  [13, { key:"S13", name:"Schaltgleis S13", pin:33, idx:2 }],
  [14, { key:"S14", name:"Schaltgleis S14", pin:34, idx:3 }],
  [15, { key:"S15", name:"Schaltgleis S15", pin:35, idx:4 }],
  [16, { key:"S16", name:"Schaltgleis S16", pin:36, idx:5 }],
]);
// ------------------------------------------------------------
// Mega1 sensor meta (from pins_mega1.h / pins_mega1.cpp)
// sid -> { name, pin }
// Note: In dieser Diagnose gilt: level==1 bedeutet "LOW/aktiv" (grüne LED).
// ------------------------------------------------------------
const M1_SENSOR_INFO = new Map([
  [0,  { name:"S0 Fahrstraße",                   pin:22 }],
  [1,  { name:"S1 Fahrstraße",                   pin:28 }],
  [2,  { name:"S2 Bhf0/1 Einfahrt",              pin:23 }],
  [3,  { name:"S3 Fahrstraße",                   pin:33 }],
  [4,  { name:"S4 Fahrstraße",                   pin:24 }],
  [5,  { name:"S5 Fahrstraße",                   pin:32 }],
  [6,  { name:"S6 Fahrstraße",                   pin:25 }],
  [7,  { name:"S7 Fahrstraße",                   pin:31 }],
  [8,  { name:"S8 Bhf2/3 Einfahrt",              pin:27 }],
  [9,  { name:"S9 Fahrstraße",                   pin:35 }],
  [10, { name:"S10 Fahrstraße",                  pin:34 }],
  [18, { name:"S18 Bhf1 Timerstart",             pin:29 }],
  [19, { name:"S19 Bhf0 Timerstart",             pin:26 }],
  [22, { name:"S22 Bhf2 Timerstart",             pin:30 }],
  [23, { name:"S23 Bhf3 Timerstart",             pin:36 }],
]);

// ------------------------------------------------------------
// Mega1 Relay + Rückmelder Pins (aus pinout_mega1.md)
// Konvention: Weichen-Ausgänge idle HIGH / Puls LOW
// Rückmelder: INPUT_PULLUP => LOW aktiv; Bedeutung: LOW=Abbiegen, HIGH=Gerade
// ------------------------------------------------------------
const M1_RELAY_META = {
  // Benutzer-gewünschte Sortierung/Benennung:
  // Annahme: Bhf2a..Bhf4b entsprechen den 4 TrackPower-Relais auf A8..A11.
  powerNames: ["Bhf2a", "Bhf2b", "Bhf4a", "Bhf4b"],
  powerPins:  ["A8", "A9", "A10", "A11"], // TrackPower Relais Bhf0..Bhf3

  // Weichen W0..W11 (Gerade/Abbiegen)
  pinsG: [
    "D5",  "D8",  "D10", "D12", "D14", "D16", "D18", "D2",  "A0", "A2", "A4", "A6"
  ],
  pinsA: [
    "D6",  "D9",  "D11", "D7",  "D15", "D17", "D19", "D3",  "A1", "A3", "A5", "A7"
  ],

  // Reduktion nur W6..W11
  // W10/W11 teilen sich D50
  pinsRed: [
    null, null, null, null, null, null,
    "A12", "A13", "A14", "A15", "D50", "D50"
  ],

  // Weichenrückmelder W0..W11 auf D38..D49
  pinsFb: ["D38","D39","D40","D41","D42","D43","D44","D45","D46","D47","D48","D49"],

  pinTxt(pin){
    return (typeof pin === "string" && pin.length) ? pin : "–";
  }
};

// ------------------------------------------------------------
// Browser-side counters for Mega1 sensor events (rise/fall).
// This makes testing easier: you don't have to "catch" the one WS frame
// where rise/fall flags are visible. Counters reset via UI button.
// ------------------------------------------------------------
const m1EventCounters = {
  // sid -> { rise:number, fall:number, lastLevel:0|1|null, lastTs:number, lastRiseFlag:number, lastFallFlag:number }
  map: new Map(),
  get(sid){
    let e = this.map.get(sid);
    if (!e){
      e = { rise: 0, fall: 0, lastLevel: null, lastTs: 0, lastRiseFlag: 0, lastFallFlag: 0 };
      this.map.set(sid, e);
    }
    return e;
  },
  reset(){
    this.map.clear();
  }
};


// For Mega2 Schaltgleise: counters come from FW, but we can show "just changed" arrows
// ------------------------------------------------------------
// Mega2 UI State (kanonisch): lokale Offsets + Prev für Pfeile
// ------------------------------------------------------------
const m2Ui = {
  kontakt: {
    prevRise: Array(14).fill(0), // raw FW counter nibble (0..15) zum Pfeilvergleich
    prevFall: Array(14).fill(0),
    offRise:  Array(14).fill(0), // raw FW counter nibble zum lokalen Reset (Offset)
    offFall:  Array(14).fill(0),
  },
  schalt: {
    prevRise: Array(6).fill(0),
    prevFall: Array(6).fill(0),
    offRise:  Array(6).fill(0), // lokaler Reset-Offset
    offFall:  Array(6).fill(0),
  }
};

let _m2InitKontaktPrevDone = false;
let _m2InitSchaltPrevDone  = false;
// ------------------------------------------------------------
// Browser-side counters for Mega2 *Kontakt*-events (rise/fall).
// Unterstützt zwei Formate:
//  - alt: kontaktRiseMask/kontaktFallMask ("seen" Flags)
//  - neu: kontaktRise4/kontaktFall4 (4-bit cumulative counters, wrap 0..15)
// ------------------------------------------------------------
const m2KontaktCounters = {
  // idx -> { rise:number, fall:number, lastRiseFlag:0|1, lastFallFlag:0|1 }
  map: new Map(),
  get(idx){
    let e = this.map.get(idx);
    if (!e){
      e = { rise: 0, fall: 0, lastRiseFlag: 0, lastFallFlag: 0, lastRise4: -1, lastFall4: -1 };
      this.map.set(idx, e);
    }
    return e;
  },
  reset(){
    this.map.clear();
  }
};


// ------------------------------------------------------------
// Optional WS debug logging:
// Enable via DevTools console:
//   localStorage.setItem("diagWsLog","1"); location.reload();
// Disable:
//   localStorage.removeItem("diagWsLog"); location.reload();
// ------------------------------------------------------------
const WS_LOG = (localStorage.getItem("diagWsLog") === "1");
let __wsLogCnt = 0;
function wsLog(type, msg){
  if (!WS_LOG) return;
  __wsLogCnt++;
  // avoid flooding: log every 10th message; always log errors/diagControl
  if (type === "error" || type === "diagControl" || (__wsLogCnt % 10) === 0) {
    console.log("[WS]", type, msg);
  }
}

function qs(id){ return document.getElementById(id); }

function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}

// Helpers for packed 4-bit counters (Mega2 kontaktRise4/kontaktFall4)
function getNibble4(arr, idx){
  if (!Array.isArray(arr)) return 0;
  const b = (typeof arr[idx >> 1] === "number") ? arr[idx >> 1] : 0;
  return (idx & 1) ? ((b >> 4) & 0x0F) : (b & 0x0F);
}

// compat alias (render helpers use esc())
function esc(s){ return escapeHtml(s); }

 // ------------------------------------------------------------
 // Render: Mega2 Kontakte + Schaltgleise from diag (type:"diag")
 // Expects: msg.mega2.diagSensors = { kontakt*Mask, schalt* }
 // ------------------------------------------------------------

// ------------------------------------------------------------
// Render: Mega2 Kontakte + Schaltgleise from diag (type:"diag")
// Expects: msg.mega2.diagSensors = { kontakt*Mask, schalt* }
// ------------------------------------------------------------
function renderM2Kontakte(msg){
  const tb = qs("diag-m2-kontakte");
  if (!tb) return;

  const d = msg?.mega2?.diagSensors;

  // Immer 14 Zeilen rendern (auch ohne Daten)
  if (!d){
    let html = "";
    for (let i=0; i<M2_KONTAKT_INFO.length; i++){
      const info = M2_KONTAKT_INFO[i];
      html += `<tr>
        <td class="mono">${esc(info.key)}</td>
        <td>${esc(info.name)}</td>
        <td class="mono">${info.pin}</td>
        <td>–</td>
        <td class="mono">–</td>
        <td class="mono">–</td>
      </tr>`;
    }
    tb.innerHTML = html;
    return;
  }

  const lvlMask = (typeof d.kontaktLevelMask === "number") ? d.kontaktLevelMask : 0;

  // Preferred: packed 4-bit counters (wrap 0..15)
  const rise4 = Array.isArray(d.kontaktRise4) ? d.kontaktRise4 : null;
  const fall4 = Array.isArray(d.kontaktFall4) ? d.kontaktFall4 : null;

  // Legacy: sticky masks (fallback)
  const riseMaskLegacy = (typeof d.kontaktRiseMask === "number") ? d.kontaktRiseMask : 0;
  const fallMaskLegacy = (typeof d.kontaktFallMask === "number") ? d.kontaktFallMask : 0;

  let html = "";

  for (let i=0; i<M2_KONTAKT_INFO.length; i++){
    const info = M2_KONTAKT_INFO[i];
    const bit  = (1 << i);

    // 1 = LOW/aktiv (wie bisher)
    const lvl = (lvlMask & bit) ? 1 : 0;

    let rise = 0, fall = 0, riseDelta = false, fallDelta = false;

    if (rise4 && fall4){
      // Raw counters from FW (0..15)
      const curRise = getNibble4(rise4, i);
      const curFall = getNibble4(fall4, i);

      // Anzeige seit lokalem Reset (mod16)
      rise = (curRise - (m2Ui.kontakt.offRise[i] ?? 0) + 16) & 0x0F;
      fall = (curFall - (m2Ui.kontakt.offFall[i] ?? 0) + 16) & 0x0F;

      // Pfeile bei echter Counter-Änderung
      riseDelta = (curRise !== (m2Ui.kontakt.prevRise[i] ?? curRise));
      fallDelta = (curFall !== (m2Ui.kontakt.prevFall[i] ?? curFall));
      m2Ui.kontakt.prevRise[i] = curRise;
      m2Ui.kontakt.prevFall[i] = curFall;
    } else {
      // Legacy fallback: sticky 1-shot flags -> browser counters
      const r = (riseMaskLegacy & bit) ? 1 : 0;
      const f = (fallMaskLegacy & bit) ? 1 : 0;

      const c = m2KontaktCounters.get(i);
      if (r && !c.lastRiseFlag) c.rise++;
      if (f && !c.lastFallFlag) c.fall++;
      c.lastRiseFlag = r ? 1 : 0;
      c.lastFallFlag = f ? 1 : 0;

      rise = c.rise;
      fall = c.fall;
      riseDelta = !!r;
      fallDelta = !!f;
    }

    const levelHtml =
      `<span class="led ${lvl ? "led-on" : "led-off"}" title="${lvl ? "LOW (aktiv)" : "HIGH (inaktiv)"}"></span>` +
      (lvl ? "LOW" : "HIGH");

    const riseTxt = `${rise}${riseDelta ? " ⬆" : ""}`;
    const fallTxt = `${fall}${fallDelta ? " ⬇" : ""}`;

    html += `<tr>
      <td class="mono">${esc(info.key)}</td>
      <td>${esc(info.name)}</td>
      <td class="mono">${info.pin}</td>
      <td>${levelHtml}</td>
      <td class="mono">${riseTxt}</td>
      <td class="mono">${fallTxt}</td>
    </tr>`;
  }

  tb.innerHTML = html;
}


// ------------------------------------------------------------
// Combined status model (WS + diag lease + warning)
// ------------------------------------------------------------
const statusModel = {
  wsUp: false,
  diagText: "",
  warnText: ""
};
// Mega2: flags bit for DIAG_TEST/Testmode (SYS_MODE_DIAG = 1<<5)
const SYS_MODE_DIAG = 0x20;

function renderMega2Mode(msg){
  const el = qs("m2-mode");
  if (!el) return;

  const m2 = msg?.mega2;
  if (!m2 || !m2.online){
    el.textContent = "Mega2: offline";
    return;
  }

  const flags = (typeof m2.flags === "number") ? m2.flags : 0;
  const isDiagTest = ((flags & SYS_MODE_DIAG) !== 0);

  if (isDiagTest){
    el.textContent = "Mega2: Testmode AKTIV (DIAG_TEST – Automatik pausiert)";
  } else {
    el.textContent = "Mega2: Automatik";
  }
}

function renderStatus(){
  const el = qs("diag-status");
  if (!el) return;
  const parts = [];
  parts.push(statusModel.wsUp ? "WS connected" : "WS disconnected");
  if (statusModel.diagText) parts.push(statusModel.diagText);
  if (statusModel.warnText) parts.push("⚠ " + statusModel.warnText);
  el.textContent = parts.join(" · ");
}

function setDiagStatus(t){
  statusModel.diagText = t || "";
  renderStatus();
}

function setWarnStatus(t){
  statusModel.warnText = t || "";
  renderStatus();
}

function stopLeaseCountdown(){
  if (leaseCountdownTimer){
    clearInterval(leaseCountdownTimer);
    leaseCountdownTimer = null;
  }
}

function startLeaseCountdown(){
  stopLeaseCountdown();
  leaseCountdownTimer = setInterval(() => {
    // force periodic refresh of diag text that includes remaining time
    if (!leaseModel.active) return;
    setDiagStatus(buildDiagLeaseText());
  }, 1000);
}

function buildDiagLeaseText(){
  if (!leaseModel.active) return "Diagnose inaktiv";
  const ownerPart = (leaseModel.ownerId && leaseModel.ownerId !== 0) ? `Owner ${leaseModel.ownerId}` : "";
  let ttlPart = "";
  if (leaseModel.expiresAtMs && leaseModel.expiresAtMs > 0){
    const now = Date.now();
    const remMs = Math.max(0, leaseModel.expiresAtMs - now);
    const remS  = Math.ceil(remMs / 1000);
    ttlPart = `TTL ${remS}s`;
  }
  const extras = [ownerPart, ttlPart].filter(Boolean).join(", ");
  return extras ? `Diagnose aktiv (${extras})` : "Diagnose aktiv";
}

// ------------------------------------------------------------
// Formatting helpers
// ------------------------------------------------------------
function fmt01(v){ return v ? "1" : "0"; }

function fmtV10(raw){
  if (typeof raw !== "number") return "–";
  if (raw >= 65000) return `— (${raw})`;
  return `${(raw/10).toFixed(1)} V (${raw})`;
}


function renderAnalogRows(an){
  const body = qs("diag-analog-body");
  if (!body) return false;

  const vA10 = fmtV10(an?.vA10);
  const vB10 = fmtV10(an?.vB10);
  const i = Array.isArray(an?.i_mA) ? an.i_mA : [];

  const labels = ["B1","B2","B3","B4","B5","B6","SBHF1","SBHF2","SBHF3"];

  let html = "";
  html += `<tr><td>vA10</td><td class="mono">${vA10}</td></tr>`;
  html += `<tr><td>vB10</td><td class="mono">${vB10}</td></tr>`;
  for (let k=0;k<labels.length;k++){
    const val = (typeof i[k] === "number") ? `${i[k]} mA` : "–";
    html += `<tr><td>i_mA ${labels[k]}</td><td class="mono">${val}</td></tr>`;
  }
  body.innerHTML = html;
  return true;
}

// ------------------------------------------------------------
// KPI (Analog update quality)
// ------------------------------------------------------------
function setKpi(ageMs, hz, seq){
  const el = qs("diag-analog-kpi");
  if (!el) return;

  if (typeof ageMs === "number") _lastAnalogAgeMs = ageMs;
  const age = _lastAnalogAgeMs;

  const hzTxt  = (typeof hz === "number") ? hz.toFixed(2) : "?";
  const seqTxt = (typeof seq === "number") ? seq : "?";
  const ageTxt = (typeof age === "number") ? age : "?";

  el.textContent = `Analog: ${hzTxt} Hz · age ${ageTxt} ms · seq ${seqTxt}`;

  el.classList.remove("kpi-ok","kpi-warn","kpi-err");
  if (typeof age !== "number") el.classList.add("kpi-warn");
  else if (age <= 800) el.classList.add("kpi-ok");
  else if (age <= 2000) el.classList.add("kpi-warn");
  else el.classList.add("kpi-err");
}

// ------------------------------------------------------------
// Render: Blocks from state (type:"state")
// ------------------------------------------------------------
function renderBlocksFromState(msg){
  const st = msg?.mega2?.blocks?.status;
  if (!Array.isArray(st) || st.length < 9) return;

  const main = qs("diag-blocks-main");
  const sbhf = qs("diag-blocks-sbhf");

  function row(label, o){
    return `<tr>
      <td>${label}</td>
      <td>${fmt01(o?.kontakt)}</td>
      <td>${fmt01(o?.stromEin)}</td>
      <td>${fmt01(o?.besetzt)}</td>
      <td>${fmt01(o?.kurzschluss)}</td>
      <td>${fmt01(o?.nothalt)}</td>
      <td class="mono">${typeof o?.stromRaw === "number" ? o.stromRaw : "–"}</td>
    </tr>`;
  }

  if (main){
    let html = "";
    for (let i=0;i<6;i++) html += row(`B${i+1}`, st[i]);
    main.innerHTML = html;
  }

  if (sbhf){
    let html = "";
    for (let i=6;i<9;i++) html += row(`SBHF${i-5}`, st[i]);
    sbhf.innerHTML = html;
  }
}

// ------------------------------------------------------------
// Render: Mega2 Schaltgleise from diag (type:"diag")
// Expects: msg.mega2.schaltgleise = [{sid,level,rise,fall}, ...]
// ------------------------------------------------------------
function renderM2Schalt(msg){
  const tb = qs("diag-m2-schalt");
  if (!tb) return;

  const d = msg?.mega2?.diagSensors;
  if (!d){
    // Immer sichtbar: 6 leere Zeilen statt "verschwindet"
    let html = "";
    for (let i=0; i<6; i++){
      const sid = 11 + i;
      const meta = M2_SCHALT_INFO.get(sid);
      html += `<tr>
        <td class="mono">${esc(meta?.key ?? ("S"+sid))}</td>
        <td>${esc(meta?.name ?? ("Schaltgleis S"+sid))}</td>
        <td class="mono">${(typeof meta?.pin === "number") ? meta.pin : "–"}</td>
        <td>–</td>
        <td class="mono">–</td>
        <td class="mono">–</td>
      </tr>`;
    }
    tb.innerHTML = html;
    return;
  }

  const lvlMask = (typeof d.schaltLevelMask === "number") ? d.schaltLevelMask : 0;
  const riseArr = Array.isArray(d.schaltRise) ? d.schaltRise : [0,0,0,0,0,0];
  const fallArr = Array.isArray(d.schaltFall) ? d.schaltFall : [0,0,0,0,0,0];

  let html = "";
  for (let i=0; i<6; i++){
    const sid  = 11 + i;
    const meta = M2_SCHALT_INFO.get(sid);

    const bit = (1 << i);
    const lvl = (lvlMask & bit) ? 1 : 0; // 1 = LOW/aktiv

    let rise = (typeof riseArr[i] === "number") ? riseArr[i] : null;
    let fall = (typeof fallArr[i] === "number") ? fallArr[i] : null;

    // 255 (und generell >=250) als "uninitialisiert/invalid" behandeln
    if (typeof rise === "number" && rise >= 250) rise = null;
    if (typeof fall === "number" && fall >= 250) fall = null;

    // lokale Reset-Offets: Anzeige ab 0 nach Reset
    let riseDispVal = null;
    let fallDispVal = null;
    if (rise !== null) riseDispVal = rise - (m2Ui.schalt.offRise[i] ?? 0);
    if (fall !== null) fallDispVal = fall - (m2Ui.schalt.offFall[i] ?? 0);

    // Pfeile nur, wenn Werte gültig sind
    const prevR = m2Ui.schalt.prevRise[i];
    const prevF = m2Ui.schalt.prevFall[i];

    const riseDelta = (rise !== null) && (prevR !== undefined) && (rise !== prevR);
    const fallDelta = (fall !== null) && (prevF !== undefined) && (fall !== prevF);

    // Prev nur aktualisieren, wenn gültig (sonst würde "null" prev kaputt machen)
    if (rise !== null) m2Ui.schalt.prevRise[i] = rise;
    if (fall !== null) m2Ui.schalt.prevFall[i] = fall;

    const levelHtml =
      `<span class="led ${lvl ? "led-on" : "led-off"}" title="${lvl ? "LOW (aktiv)" : "HIGH (inaktiv)"}"></span>` +
      (lvl ? "LOW" : "HIGH");

    const riseTxt = `${(riseDispVal === null) ? "–" : riseDispVal}${riseDelta ? " ⬆" : ""}`;
    const fallTxt = `${(fallDispVal === null) ? "–" : fallDispVal}${fallDelta ? " ⬇" : ""}`;

    html += `<tr>
      <td class="mono">${esc(meta?.key ?? ("S"+sid))}</td>
      <td>${esc(meta?.name ?? ("Schaltgleis S"+sid))}</td>
      <td class="mono">${(typeof meta?.pin === "number") ? meta.pin : "–"}</td>
      <td>${levelHtml}</td>
      <td class="mono">${riseTxt}</td>
      <td class="mono">${fallTxt}</td>
    </tr>`;
  }

  tb.innerHTML = html;
}


// ------------------------------------------------------------
// Render: Mega1 Sensors from diag (type:"diag")
// Expects: msg.mega1.sensors = [{sid,level,rise,fall}, ...]
// ------------------------------------------------------------
function renderM1Sensors(msg){
  // Robust: some frames provide sensors under mega1.diag.sensors
  const arr = msg?.mega1?.sensors
           ?? msg?.mega1?.diag?.sensors;
  if (!Array.isArray(arr)) return;

  const tb = qs("diag-m1-sensors");
  if (!tb) return;

  // Sort by numeric S-id to keep gaps intuitive
  const sorted = [...arr].sort((a,b)=> (a?.sid ?? 999) - (b?.sid ?? 999));

  let html = "";
  for (const s of sorted){
    const sid  = (typeof s?.sid === "number") ? s.sid : null;
    const lvl  = (typeof s?.level === "number") ? s.level : null; // 1 = LOW/aktiv (grün)
    const rise = (typeof s?.rise === "number") ? s.rise : 0;
    const fall = (typeof s?.fall === "number") ? s.fall : 0;

    // Browser-side counters
    let cnt = null;
    if (sid !== null){
      cnt = m1EventCounters.get(sid);
      // Count only once per edge-flag assertion (0->1), not for every frame that carries "1".
      // This prevents runaway counts if rise/fall stays 1 for multiple WS frames.
      const riseFlag = (rise === 1) ? 1 : 0;
      const fallFlag = (fall === 1) ? 1 : 0;
      if (riseFlag === 1 && cnt.lastRiseFlag === 0) cnt.rise += 1;
      if (fallFlag === 1 && cnt.lastFallFlag === 0) cnt.fall += 1;
      cnt.lastRiseFlag = riseFlag;
      cnt.lastFallFlag = fallFlag;
      if (lvl === 0 || lvl === 1) cnt.lastLevel = lvl;
      cnt.lastTs = (typeof msg?.ts === "number") ? msg.ts : Date.now();
    }

    // Meta: name + pin
    const meta = (sid !== null) ? M1_SENSOR_INFO.get(sid) : null;
    const nameTxt = meta?.name ?? "–";
    const pinTxt  = (typeof meta?.pin === "number") ? ("D" + meta.pin) : "–";

    // LED + text: level==1 => LOW/aktiv => green
    let levelHtml = "–";
    if (lvl === 0 || lvl === 1){
      const on = (lvl === 1);
      levelHtml =
        `<span class="led ${on ? "led-on" : "led-off"}" title="${on ? "LOW (aktiv)" : "HIGH (inaktiv)"}"></span>` +
        (on ? "LOW" : "HIGH");
    }

    const riseTxt = (sid === null || !cnt) ? "–" : (cnt.rise + (rise === 1 ? " ⬆" : ""));
    const fallTxt = (sid === null || !cnt) ? "–" : (cnt.fall + (fall === 1 ? " ⬇" : ""));

    

    html += `<tr>
      <td>${sid === null ? "–" : ("S"+sid)}</td>
      <td>${escapeHtml(nameTxt)}</td>
      <td class="mono">${pinTxt}</td>
      <td>${levelHtml}</td>
      <td class="mono">${riseTxt}</td>
      <td class="mono">${fallTxt}</td>
    </tr>`;
  }
  // ---- Append Weichenrückmelder as digital sensors (LOW=Abbiegen, HIGH=Gerade) ----
  const d = msg?.mega1?.diag;
  if (d && typeof d.weicheIstBits === "number"){
    const bits = d.weicheIstBits >>> 0;
    html += `<tr class="diag-sep-row"><td colspan="6">— Weichenrückmelder (LOW=Abbiegen, HIGH=Gerade) —</td></tr>`;

    for (let i=0;i<12;i++){
      // Assumption: bit==1 => LOW/aktiv (Abbiegen). If inverted in FW: flip with (const lvl = b ? 0 : 1).
      const b = ((bits >>> i) & 1) ? 1 : 0;
      const lvl = b ? 0 : 1; // invert: 1 => HIGH, 0 => LOW (INPUT_PULLUP)
      const on = (lvl === 1);
      const fbLevelHtml =
        `<span class="led ${on ? "led-on" : "led-off"}" title="${on ? "LOW (Abbiegen)" : "HIGH (Gerade)"}"></span>` +
        (on ? "LOW" : "HIGH");

      html += `<tr>
        <td>W${i}</td>
        <td>${escapeHtml("Rückmelder")}</td>
        <td class="mono">${M1_RELAY_META.pinTxt(M1_RELAY_META.pinsFb[i])}</td>
        <td>${fbLevelHtml}</td>
        <td class="mono">–</td>
        <td class="mono">–</td>
      </tr>`;
    }
  }

  tb.innerHTML = html;
}
// ------------------------------------------------------------
// Momentary pulse helper for Weichen (coil safety)
// Sends ON, then auto OFF after 500ms. Blocks overlapping pulses per key.
// ------------------------------------------------------------
const _m1PulseTimers = new Map(); // key -> timeoutId

function m1SendRelayCmd(relay, idx, val){
  // Hard UI gate: send only if we are owner AND have the diag token.
  if (!diagIsOwner || !diagToken) {
    console.warn("[DIAGJS] m1DiagRelaySet blocked (not owner or missing token)", { diagIsOwner, diagToken });
    return;
  }
  console.log("[DIAGJS] m1DiagRelaySet send", { relay, idx, val, token: diagToken });
  wsSend({ action:"m1DiagRelaySet", token: diagToken, relay, idx, val });
}

function m1Pulse(relay, idx, ms, uiBtn){
  const key = `${relay}:${idx}`;
  if (_m1PulseTimers.has(key)) return; // ignore overlapping pulses

  if (uiBtn){
    uiBtn.disabled = true;
    uiBtn.dataset.busy = "1";
    uiBtn.textContent = `Puls…`;
  }

  m1SendRelayCmd(relay, idx, 1);

  const tid = setTimeout(() => {
    m1SendRelayCmd(relay, idx, 0);
    _m1PulseTimers.delete(key);
    if (uiBtn){
      uiBtn.disabled = false;
      uiBtn.dataset.busy = "";
      uiBtn.textContent = `Puls (0,5s)`;
    }
  }, ms);

  _m1PulseTimers.set(key, tid);
}

// ------------------------------------------------------------
// Mega1 Relais / Outputs (aus msg.mega1.relays)
// ------------------------------------------------------------
function renderM1Relays(msg){
  const r = msg?.mega1?.relays;
  if (!r) return;

  const tbody = qs("diag-m1-relays-body");
  if (!tbody) return;

  const sub = qs("diag-m1-relays-sub");
  if (sub){
    const seqTxt = (typeof r.seq === "number") ? r.seq : "–";
    const ageTxt = (typeof r.ageMs === "number") ? (r.ageMs + " ms") : "–";
    sub.textContent = `seq: ${seqTxt} · age: ${ageTxt}`;
  }

  // Nur Owner darf klicken
  const dis = (!diagIsOwner || !diagToken) ? "disabled" : "";

  function bit(mask, i){ return ((mask >>> i) & 1) ? 1 : 0; }

  const gMask   = (typeof r.weicheGMask === "number")    ? r.weicheGMask    : 0;
  const aMask   = (typeof r.weicheAMask === "number")    ? r.weicheAMask    : 0;
  const redMask = (typeof r.weicheRedMask === "number")  ? r.weicheRedMask  : 0;
  const bhfMask = (typeof r.bhfPowerMask === "number")   ? r.bhfPowerMask   : 0;

// Level display like sensor tables: 1 => LOW/aktiv (green)
  function levelHtml(lvl1MeansLow){
    const on = !!lvl1MeansLow;
    return `<span class="led ${on ? "led-on" : "led-off"}" title="${on ? "LOW (aktiv)" : "HIGH (inaktiv)"}"></span>` +
           (on ? "LOW" : "HIGH");
  }

  let html = "";

  // ----------------------------------------------------------
  // Sortierung wie gewünscht:
  // Bhf2a, Bhf2b, Bhf4a, Bhf4b
  // (Trenner)
  // W0 G, W0 A, W1 G, W1 A, ... W11
  // (Trenner)
  // W6..W11 Reduktion
  // ----------------------------------------------------------

  // Power rows (mask bits 0..3)
  for (let i=0;i<4;i++){
    const on = bit(bhfMask, i) === 1;
    html += `<tr>
      <td>${escapeHtml(M1_RELAY_META.powerNames[i])}</td>
      <td class="mono">${M1_RELAY_META.pinTxt(M1_RELAY_META.powerPins[i])}</td>
      <td>${levelHtml(on)}</td>
      <td>
        <div class="diag-relay-actions">
          <button class="btn btn-mini" data-rel="power" data-idx="${i}" data-val="1" ${dis}>AN</button>
          <button class="btn btn-mini" data-rel="power" data-idx="${i}" data-val="0" ${dis}>AUS</button>
        </div>
      </td>
    </tr>`;
  }

  html += `<tr class="diag-sep-row"><td colspan="4">— Weichen (Taster: Puls 0,5s) —</td></tr>`;

  // Weichen: G/A as momentary pulse (coil safety)
  for (let i=0;i<12;i++){
    const gOn = bit(gMask, i) === 0;
    const aOn = bit(aMask, i) === 0;

    html += `<tr>
      <td>W${i} gerade</td>
      <td class="mono">${M1_RELAY_META.pinTxt(M1_RELAY_META.pinsG[i])}</td>
      <td>${levelHtml(gOn)}</td>
      <td>
        <div class="diag-relay-actions">
          <button class="btn btn-mini" data-rel="weicheG" data-idx="${i}" data-pulse="1" ${dis}>Puls (0,5s)</button>
          <button class="btn btn-mini" data-rel="weicheG" data-idx="${i}" data-val="0" ${dis}>STOP/AUS</button>
        </div>
      </td>
    </tr>`;
    html += `<tr>
      <td>W${i} abbiegen</td>
      <td class="mono">${M1_RELAY_META.pinTxt(M1_RELAY_META.pinsA[i])}</td>
      <td>${levelHtml(aOn)}</td>
      <td>
        <div class="diag-relay-actions">
          <button class="btn btn-mini" data-rel="weicheA" data-idx="${i}" data-pulse="1" ${dis}>Puls (0,5s)</button>
          <button class="btn btn-mini" data-rel="weicheA" data-idx="${i}" data-val="0" ${dis}>STOP/AUS</button>
        </div>
      </td>
    </tr>`;
  }

  html += `<tr class="diag-sep-row"><td colspan="4">— Reduktion (nur W6–W11) — <span class="muted">Read-Only: Reduktion wird automatisch abhängig der Weichenstellung geschaltet!</span></td></tr>`;

  for (let i=6;i<=11;i++){
    const redOn = bit(redMask, i) === 0;
    html += `<tr>
      <td>W${i} Reduktion</td>
      <td class="mono">${M1_RELAY_META.pinTxt(M1_RELAY_META.pinsRed[i])}</td>
      <td>${levelHtml(redOn)}</td>
      <td><span class="muted">automatisch (abhängig von Weichenstellung)</span></td>
    </tr>`;
  }

  tbody.innerHTML = html;

  // One-time event delegation for buttons
  if (!renderM1Relays._handlerInstalled){
    const table = qs("diag-m1-relays-table");
    if (table){
      table.addEventListener("click", (ev) => {
        const btn = ev.target && ev.target.closest ? ev.target.closest("button[data-rel]") : null;
        if (!btn) return;
        if (!diagIsOwner || !diagToken) return;

        const relay = btn.getAttribute("data-rel");
        const idx   = parseInt(btn.getAttribute("data-idx") || "0", 10);
        const isPulse = btn.getAttribute("data-pulse") === "1";

        if (isPulse){
          m1Pulse(relay, idx, 500, btn);
          return;
        }
        const val = parseInt(btn.getAttribute("data-val") || "0", 10);
        m1SendRelayCmd(relay, idx, val);
      });
      renderM1Relays._handlerInstalled = true;
    }
  }
}

// ------------------------------------------------------------
// WS send + diag lease heartbeat
// ------------------------------------------------------------
function wsSend(obj){
  if (DIAG_DEBUG && obj && (obj.action === "diagEnter" || obj.action === "diagHeartbeat" || obj.action === "diagExit")){
    console.log(`[DIAGJS] tx ${obj.action} token=${obj.token ?? "<none>"} diagToken=${diagToken ?? "<null>"} isOwner=${diagIsOwner}`);
  }
  const json = JSON.stringify(obj);
  ws.send(json);
}

function startHeartbeat(){
  stopHeartbeat();
  hbTimer = setInterval(() => {
    if (diagIsOwner && diagToken) {
      // Instrumentation: verify the token we think we send.
      try { console.log("[DIAGJS] HB send token=", diagToken, "len=", (diagToken||"").length); } catch(_){ }
      wsSend({ action:"diagHeartbeat", token: diagToken });
    }
  }, 1000);
}

function stopHeartbeat(){
  if (hbTimer){
    clearInterval(hbTimer);
    hbTimer = null;
  }
}

// ------------------------------------------------------------
// WS connect
// ------------------------------------------------------------
let _wsReconnectT = null;
let _wsReconnectDelayMs = 500;         // start small
const _WS_RECONNECT_MAX_MS = 8000;     // cap

function scheduleReconnect(){
  if (_wsReconnectT) return;
  const d = _wsReconnectDelayMs;
  _wsReconnectDelayMs = Math.min(_WS_RECONNECT_MAX_MS, Math.floor(_wsReconnectDelayMs * 1.6));
  _wsReconnectT = setTimeout(() => {
    _wsReconnectT = null;
    try { connect(); } catch(e) { /* ignore */ }
  }, d);
}

function connect(){
  const proto = (location.protocol === "https:") ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    // reset reconnect backoff
    if (_wsReconnectT){ clearTimeout(_wsReconnectT); _wsReconnectT = null; }
    _wsReconnectDelayMs = 500;

    statusModel.wsUp = true;
    renderStatus();
    setDiagStatus("Diagnose inaktiv");

    // Subscribe to both:
    // - base (state) for blocks table
    // - diag for diagnostics stream
    wsSend({ action:"subscribe", base:true, diag:true });

    // Auto-enter diagnose mode on diag.htm (safe: server will reply isOwner=false if occupied)
    // This prevents "forgetting to press Diagnose starten" and keeps the UX consistent.
    // If we have a stored token from a previous owner session, try to resume by token.
    diagEnterWithBestToken();

    wsLog("open", {});
  };

  ws.onclose = () => {
    statusModel.wsUp = false;
    renderStatus();
    setWarnStatus("");
    stopHeartbeat();
    wsLog("close", {});

    // auto-reconnect (important: diag stream uses subscriptions per WS client-id)
    scheduleReconnect();
  };

  ws.onerror = (e) => {
    wsLog("error", e);
    // Force a close to trigger reconnect logic
    try { if (ws && ws.readyState === WebSocket.OPEN) ws.close(); } catch(_) {}
  };

  ws.onmessage = (ev) => {
  console.log("[WSRX]", Date.now(), ev.data.length);
  const t0 = performance.now();

  let msg = null;
  try { msg = JSON.parse(ev.data); } catch(e) { return; }
  const tParse = performance.now();

  wsLog(msg?.type || "msg", msg);
  
  // Update Mega2 mode badge on every frame (diag/state/analog)
  renderMega2Mode(msg);

  // ------------------------------------------------------------
  // IMPORTANT: Handle diagControl + diagCtrl BEFORE returning from
  //            "diag/state/analog" branches below.
  // Reason: msg.diagCtrl is embedded in type:"diag" and type:"state".
  // ------------------------------------------------------------

  // 1) Explicit diagControl response (after diagEnter)
  if (msg.type === "diagControl"){
    try { console.log("[DIAGJS] diagControl rx", msg); } catch(_){ }
    if (msg.isOwner && msg.token){
      diagIsOwner = true;
      diagToken = msg.token;
      if (DIAG_DEBUG) console.log(`[DIAGJS] set diagToken=${diagToken} (store) startHeartbeat`);
      storeDiagToken(diagToken);
      qs("diag-enter").disabled = true;
      qs("diag-exit").disabled = false;
      setWarnStatus("");
      setDiagStatus(`Diagnose aktiv (Owner ${msg.ownerId})`);
      startHeartbeat();
    } else {
      // Diagnose belegt / kein Owner -> hard read-only
      diagIsOwner = false;
      // IMPORTANT: don't clear stored token on "busy". We might want to resume later.
      // Only clear if server says lease is inactive.
      if (!msg.active) {
        diagToken = null;
        storeDiagToken(null);
      }
      stopHeartbeat();
      qs("diag-exit").disabled = true;
      qs("diag-enter").disabled = false;
      setDiagStatus(`Diagnose belegt (Owner ${msg.ownerId})`);
    }
    const tEnd = performance.now();
    console.log("[WSRX-T]", "len", ev.data.length,
                "parse", (tParse - t0).toFixed(2) + "ms",
                "total", (tEnd - t0).toFixed(2) + "ms");
    return;
  }

  // 2) Lease snapshot mirrored into diag + state frames
  if (msg.diagCtrl){
    if (msg.diagCtrl.active){
      leaseModel.active = true;
      leaseModel.ownerId = msg.diagCtrl.ownerId || 0;
      // Support multiple possible field names (optional)
      if (typeof msg.diagCtrl.expiresAtMs === "number") {
        leaseModel.expiresAtMs = msg.diagCtrl.expiresAtMs;
      } else if (typeof msg.diagCtrl.leaseUntilMs === "number") {
        leaseModel.expiresAtMs = msg.diagCtrl.leaseUntilMs;
      } else if (typeof msg.diagCtrl.ttlMs === "number") {
        leaseModel.expiresAtMs = Date.now() + msg.diagCtrl.ttlMs;
      } else if (typeof msg.diagCtrl.expiresInMs === "number") {
        // Your server currently sends expiresInMs (remaining), not an absolute timestamp
        leaseModel.expiresAtMs = Date.now() + msg.diagCtrl.expiresInMs;
      } else {
        leaseModel.expiresAtMs = 0;
      }
      setDiagStatus(buildDiagLeaseText());
      if (leaseModel.expiresAtMs > 0) startLeaseCountdown();
      else stopLeaseCountdown();
    } else {
      // Lease snapshot says inactive (display only). Token/owner is controlled by diagControl.
      // If we are owner, heartbeat will refresh it; if not, diagControl will tell us.
      leaseModel.active = false;
      leaseModel.ownerId = 0;
      leaseModel.expiresAtMs = 0;
      stopLeaseCountdown();
      // Anzeige-only: Owner/Token wird ausschließlich durch type:"diagControl" geführt.
      setDiagStatus("Diagnose inaktiv");
    }
    // IMPORTANT: do NOT return here; diag/state payloads still need rendering below.
  }

  // Dump last diag frame for quick debugging
  if (msg.type === "diag"){
    // Drop out-of-order/duplicate diag frames by ts (monotonic on ESP)
    if (typeof msg.ts === "number"){
      if (msg.ts <= _lastDiagTs) return;
      _lastDiagTs = msg.ts;
    }

    lastDiagMsg = msg;

    // Pretty JSON dump is expensive -> throttle + (default) trim payload
    const now = Date.now();
    if (now - _lastPreDumpMs > DIAG_JSON_DUMP_MS){
      _lastPreDumpMs = now;
      const pre = qs("diag-json");
      if (pre){
        if (DIAG_JSON_FULL){
          pre.textContent = JSON.stringify(msg, null, 2);
        } else {
          const d1 = msg?.mega1?.diag;
          pre.textContent = JSON.stringify({
            type: msg.type,
            ts: msg.ts,
            wsClients: msg.wsClients,
            diagCtrl: msg.diagCtrl,
            mega1: d1 ? {
              sensorActiveMask: d1.sensorActiveMask,
              sensorRiseMask: d1.sensorRiseMask,
              sensorFallMask: d1.sensorFallMask,
              sensors: d1.sensors,
              relays: msg?.mega1?.relays,
            } : undefined,
            mega2: {
              analog: msg?.mega2?.analog,
              diagSensors: msg?.mega2?.diagSensors
            }
          }, null, 2);
        }
      }
    }

    // Analog meta (Mega2)
    const an = msg?.mega2?.analog;
    if (an){
      setKpi(an.ageMs, an.hz, an.seq);

      // Preferred: table rows
      if (!renderAnalogRows(an)){
        // Fallback to old ids (if someone has an older diag.htm)
        const vA10 = qs("an-vA10");
        const vB10 = qs("an-vB10");
        const imA  = qs("an-imA");
        if (vA10 && typeof an.vA10 === "number") vA10.textContent = fmtV10(an.vA10);
        if (vB10 && typeof an.vB10 === "number") vB10.textContent = fmtV10(an.vB10);
        if (imA && Array.isArray(an.i_mA)) imA.textContent = an.i_mA.join(", ");
      }
    }

    // Digital sensor tables (heavy DOM) -> throttle and render only latest
    _latestDiagMsg = msg;
    scheduleDiagRender();

    const tEnd = performance.now();
    console.log("[WSRX-T]", "len", ev.data.length,
                "parse", (tParse - t0).toFixed(2) + "ms",
                "total", (tEnd - t0).toFixed(2) + "ms");
    return;
  }

  if (msg.type === "state"){
    renderBlocksFromState(msg);
    const tEnd = performance.now();
    console.log("[WSRX-T]", "len", ev.data.length,
                "parse", (tParse - t0).toFixed(2) + "ms",
                "total", (tEnd - t0).toFixed(2) + "ms");
    return;
  }

  if (msg.type === "analog"){
    // Small periodic analog payload (base stream)
    const an = msg?.mega2?.analog;
    if (an){
      if (!renderAnalogRows(an)){
        const vA10 = qs("an-vA10");
        const vB10 = qs("an-vB10");
        const imA  = qs("an-imA");
        if (vA10) vA10.textContent = fmtV10(an.vA10);
        if (vB10) vB10.textContent = fmtV10(an.vB10);
        if (imA && Array.isArray(an.i_mA)) imA.textContent = an.i_mA.join(", ");
      }
    }
    const tEnd = performance.now();
    console.log("[WSRX-T]", "len", ev.data.length,
                "parse", (tParse - t0).toFixed(2) + "ms",
                "total", (tEnd - t0).toFixed(2) + "ms");
    return;
  }

  if (msg.type === "error" && msg.code === "DIAG_ACTIVE"){
    setWarnStatus("DIAG_ACTIVE: Schreibzugriff gesperrt (du bist nicht Owner)");
    const tEnd = performance.now();
    console.log("[WSRX-T]", "len", ev.data.length,
                "parse", (tParse - t0).toFixed(2) + "ms",
                "total", (tEnd - t0).toFixed(2) + "ms");
    return;
  }
  
  if (msg.type === "error" && msg.code === "DIAG_HB_REJECT"){
    // Server rejected heartbeat => we are NOT owner anymore (token mismatch / inactive lease).
    setWarnStatus("DIAG_HB_REJECT: Heartbeat abgelehnt – Diagnose-Lease verloren (Token mismatch / inaktiv).");
    diagIsOwner = false;
    diagToken = null;
    storeDiagTokenStored(null);
    stopHeartbeat();

    const exitBtn  = qs("diag-exit");
    const enterBtn = qs("diag-enter");
    if (exitBtn)  exitBtn.disabled = true;
    if (enterBtn) enterBtn.disabled = false;

    setDiagStatus("Diagnose inaktiv");

    const tEnd = performance.now();
    console.log("[WSRX-T]", "len", ev.data.length,
                "parse", (tParse - t0).toFixed(2) + "ms",
                "total", (tEnd - t0).toFixed(2) + "ms");
    return;
  }

  const tEnd = performance.now();
  console.log("[WSRX-T]", "len", ev.data.length,
              "parse", (tParse - t0).toFixed(2) + "ms",
              "total", (tEnd - t0).toFixed(2) + "ms");
};
}

window.addEventListener("load", () => {
  // Reset Mega1 browser-side counters
  const resetBtn = qs("m1-reset");
  if (resetBtn){
    resetBtn.addEventListener("click", () => {
      m1EventCounters.reset();
      if (lastDiagMsg) renderM1Sensors(lastDiagMsg);
    });
  }

  // Reset Mega2 Kontakte + Schaltgleise (nur lokal, read-only)
  const resetBtnM2 = qs("m2-reset");
  if (resetBtnM2){
    resetBtnM2.addEventListener("click", () => {
      try {
        const d = lastDiagMsg?.mega2?.diagSensors;

        // Kontakte: packed 4-bit counters -> Offsets + Prev auf aktuellen FW-Stand setzen
        if (d && Array.isArray(d.kontaktRise4) && Array.isArray(d.kontaktFall4)){
          for (let i=0;i<14;i++){
            const r = getNibble4(d.kontaktRise4, i);
            const f = getNibble4(d.kontaktFall4, i);
            m2Ui.kontakt.offRise[i]  = r;
            m2Ui.kontakt.offFall[i]  = f;
            m2Ui.kontakt.prevRise[i] = r;
            m2Ui.kontakt.prevFall[i] = f;
          }
        } else {
          // Legacy masks (fallback)
          m2KontaktCounters.reset();
        }

        // Schaltgleise: Offsets + Prev auf aktuellen FW-Stand setzen (Anzeige startet ab 0)
        const sr = Array.isArray(d?.schaltRise) ? d.schaltRise : null;
        const sf = Array.isArray(d?.schaltFall) ? d.schaltFall : null;

        for (let i=0;i<6;i++){
          const r = (sr && typeof sr[i] === "number") ? sr[i] : 0;
          const f = (sf && typeof sf[i] === "number") ? sf[i] : 0;
          m2Ui.schalt.offRise[i]  = r;
          m2Ui.schalt.offFall[i]  = f;
          m2Ui.schalt.prevRise[i] = r;
          m2Ui.schalt.prevFall[i] = f;
        }

        // Re-render (latest)
        if (lastDiagMsg){
          renderM2Sensors(lastDiagMsg);
        }
      } catch(_) {
        m2KontaktCounters.reset();
      }
    });
  }

  qs("diag-enter").addEventListener("click", () => {
    // Try resume by stored token if available; otherwise normal enter.
    diagEnterWithBestToken();
  });

  qs("diag-exit").addEventListener("click", () => {
    // Release lease only; stay on diag.htm
    diagExitBestEffort();
    // Optimistic UI update (server will also broadcast diagCtrl inactive)
    diagToken = null;
    diagIsOwner = false
    storeDiagToken(null); // oder: clearStoredDiagToken()
    stopHeartbeat();
    const exitBtn  = qs("diag-exit");
    const enterBtn = qs("diag-enter");
    if (exitBtn)  exitBtn.disabled = true;
    if (enterBtn) enterBtn.disabled = false;
    setWarnStatus("");
    setDiagStatus("Diagnose inaktiv");
  });

  connect();

  window.addEventListener("beforeunload", () => {
    try { diagExitBestEffort(); } catch(_) {}
  });

    // pagehide is the reliable one for bfcache/mobile
  window.addEventListener("pagehide", () => {
    try { diagExitBestEffort(); } catch(_) {}
  });

  // Optional: do NOT exit on hidden; at most stop heartbeat if you want
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      // optional: stopHeartbeat();  // but don't release lease
    }
  });
});