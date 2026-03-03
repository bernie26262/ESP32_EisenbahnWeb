const DIAG_BUILD = "2026-02-17 17:54";

// ------------------------------------------------------------
// Debug toggles (runtime):
//  - localStorage EE_DIAG_DEBUG = "0"/"1"
//  - localStorage EE_DIAG_TIMING = "0"/"1"
//  - URL: ?diagdebug=1 / ?diagtiming=1
// ------------------------------------------------------------
function _diagBoolSetting(lsKey, urlKey, defVal=false){
  try{
    const qs = new URLSearchParams(location.search);
    if (qs.has(urlKey)){
      const v = qs.get(urlKey);
      return !(v === "0" || v === "false" || v === "off");
    }
    const s = localStorage.getItem(lsKey);
    if (s !== null) return (s === "1" || s === "true" || s === "on");
  }catch(e){}
  return defVal;
}

const DIAG_DEBUG = _diagBoolSetting("EE_DIAG_DEBUG", "diagdebug", false);
const DIAG_TIMING = _diagBoolSetting("EE_DIAG_TIMING", "diagtiming", false);
// Only show verbose console output when BOTH toggles are enabled
const DIAG_VERBOSE = (DIAG_DEBUG && DIAG_TIMING);

if (DIAG_VERBOSE) {
  console.log("[DIAGJS] build", DIAG_BUILD);
}


// ------------------------------------------------------------
// Render throttling (avoid re-rendering tables if nothing changed)
// ------------------------------------------------------------
let _lastM2DiagSensorsSeq = -1;
let _lastM2RelaysSeq = -1;
let _lastM1RelaysSeq = -1;
let _lastM1SensorsKey = "";
let _lastM2TurnoutsIstMask = null; // number | null

// Convenience for browser console:
//   diagDebug(1) / diagTiming(1) then reload happens automatically
window.diagDebug = function(on){
  try{ localStorage.setItem("EE_DIAG_DEBUG", on ? "1":"0"); }catch(e){}
  location.reload();
};
window.diagTiming = function(on){
  try{ localStorage.setItem("EE_DIAG_TIMING", on ? "1":"0"); }catch(e){}
  location.reload();
};

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
// Cache: Turnouts istMask kann ggf. in state frames kommen, gerendert wird aber nur im DIAG-throttle.
let _m2CachedIstMask = null;   // number | null
let _m2CachedIstMaskTs = 0;    // ms timestamp (Date.now)
 
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
  // Mega2: Kontakte + Schaltgleise + Weichenrückmelder in einem konsistenten Durchlauf
  try { renderM2Kontakte(msg); } catch(e){ console.error("[diag] renderM2Kontakte failed", e); }
  try { renderM2Schalt(msg); } catch(e){ console.error("[diag] renderM2Schalt failed", e); }
  try { renderM2Turnouts(msg); } catch(e){ console.error("[diag] renderM2Turnouts failed", e); }
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
  // ---------------- M2 sensors (kontakte + schalt) only if seq changed ----------------
  const m2DiagSeq = (typeof m?.mega2?.diagSensors?.seq === "number") ? m.mega2.diagSensors.seq : -1;
  if (m2DiagSeq !== _lastM2DiagSensorsSeq) {
    _lastM2DiagSensorsSeq = m2DiagSeq;
    try { renderM2Kontakte(m); } catch(e){ console.error("[diag] renderM2Kontakte failed", e); }
    try { renderM2Schalt(m); } catch(e){ console.error("[diag] renderM2Schalt failed", e); }
  }

  // ---------------- M2 turnouts only if effective istMask changed ----------------
  const directIst = m?.mega2?.turnouts?.istMask;
  const effIst = (typeof directIst === "number") ? directIst : (typeof _m2CachedIstMask === "number" ? _m2CachedIstMask : null);
  if (effIst !== _lastM2TurnoutsIstMask) {
    _lastM2TurnoutsIstMask = effIst;
    try { renderM2Turnouts(m); } catch(e){ console.error("[diag] renderM2Turnouts failed", e); }
  }

  // ---------------- M2 relays only if seq changed ----------------
  const m2RelSeq = (typeof m?.mega2?.relays?.seq === "number") ? m.mega2.relays.seq : -1;
  if (m2RelSeq !== _lastM2RelaysSeq) {
    _lastM2RelaysSeq = m2RelSeq;
    if (DIAG_VERBOSE) {
      console.log("[diag] renderM2Relays seq=", m2RelSeq, "online=", m?.mega2?.online);
    }
    try { renderM2Relays(m); } catch(e){ console.error("[diag] renderM2Relays failed", e); }
  }
  const t2 = performance.now();

  // ---------------- M1 sensors only if masks changed ----------------
  const m1 = m?.mega1;
  const m1Key = `${m1?.sensorActiveMask ?? ""}|${m1?.sensorRiseMask ?? ""}|${m1?.sensorFallMask ?? ""}`;
  if (m1Key !== _lastM1SensorsKey) {
    _lastM1SensorsKey = m1Key;
    try { renderM1Sensors(m); } catch(e){ console.error("[diag] renderM1Sensors failed", e); }
  }

  // ---------------- M1 relays only if seq changed ----------------
  const m1RelSeq = (typeof m?.mega1?.relays?.seq === "number") ? m.mega1.relays.seq : -1;
  if (m1RelSeq !== _lastM1RelaysSeq) {
    _lastM1RelaysSeq = m1RelSeq;
    try { renderM1Relays(m); } catch(e){ console.error("[diag] renderM1Relays failed", e); }
  }
  const t3 = performance.now();

  if (DIAG_VERBOSE) {
    console.log("[DIAG-RENDER]",
                "total", (t3 - t0).toFixed(1)+"ms",
                "init",  (t1 - t0).toFixed(1)+"ms",
                "m2",    (t2 - t1).toFixed(1)+"ms",
                "m1",    (t3 - t2).toFixed(1)+"ms");
  }
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
// Mega2 Weichenrückmelder (abgeleitet)
// Mega2 liefert turnouts.istMask (W12..W15). Die HW-RM-Pins sind "RM_ABBIEG".
// Wir zeigen pro Weiche: Stellung (Gerade/Abbiegen) + LED (LOW=aktiv) als Diagnosehilfe.
// ------------------------------------------------------------
const M2_TURNOUT_RM_PINS = [
  { wid:12, rmPin:37 },
  { wid:13, rmPin:38 },
  { wid:14, rmPin:39 },
  { wid:15, rmPin:40 },
];

function renderM2Turnouts(msg){
  // Heavy tables ONLY from DIAG frames, never from state/diagControl
  if (!msg || msg.type !== "diag") return;

  const body = qs("diag-m2-turnouts-body");
  if (!body) return;

  const m2 = msg.mega2;
  const online = !!m2?.online;

  // istMask: Bit0=W12, Bit1=W13, Bit2=W14, Bit3=W15 (Gerade=1 => HIGH)
  // Kann in state frames kommen → Cache nutzen, aber hier (DIAG) rendern.
  const directIst = m2?.turnouts?.istMask;
  const istMask = (typeof directIst === "number")
    ? directIst
    : (typeof _m2CachedIstMask === "number" ? _m2CachedIstMask : null);

  if (DIAG_VERBOSE && (!renderM2Turnouts._t || Date.now() - renderM2Turnouts._t > 1000)){
    renderM2Turnouts._t = Date.now();
    console.log("[TURNOUTS] render", msg.type, "istMask", istMask);
  }

  body.innerHTML = "";

  if (!online){
    body.innerHTML = `<tr><td colspan="6" class="mono">Mega2 offline</td></tr>`;
    return;
  }

  // Level-Rendering wie bei Mega2 Sensor-Tabellen:
  // 1 => LOW/aktiv (grün), 0 => HIGH/inaktiv (grau)
  function levelHtml(lvl1MeansLow){
    const on = !!lvl1MeansLow;
    return `<span class="led ${on ? "led-on" : "led-off"}" title="${on ? "LOW (aktiv)" : "HIGH (inaktiv)"}"></span>` +
           (on ? "LOW" : "HIGH");
  }

  // Stabil: immer 4 Zeilen rendern (auch wenn istMask fehlt)
  for (let i = 0; i < M2_TURNOUT_RM_PINS.length; i++){
    const w = M2_TURNOUT_RM_PINS[i];   // erwartet: { wid:12..15, rmPin:37..40 }
    const bit = i;                    // W12->0, W13->1, W14->2, W15->3

    // Wenn istMask fehlt: Level als "–" ohne LED anzeigen (wie andere Platzhalter)
    let levelCell = "–";
    if (istMask !== null){
      const bitIs1 = ((istMask >> bit) & 1) === 1;

      // INVERT: bit=1 => LOW (aktiv), bit=0 => HIGH (inaktiv)
      const lvl1MeansLow = bitIs1 ? 1 : 0;

      levelCell = levelHtml(lvl1MeansLow);
    }

    body.insertAdjacentHTML("beforeend", `<tr>
      <td class="mono">W${w.wid}</td>
      <td>Rückmelder</td>
      <td class="mono">${w.rmPin}</td>
      <td>${levelCell}</td>
      <td class="mono">–</td>
      <td class="mono">–</td>
    </tr>`);
  }
}
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
  powerNames: ["Bhf0", "Bhf1", "Bhf2", "Bhf3"],
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
  // Render ONLY from diag frames (state frames would overwrite and cause flicker)
  if (!msg || msg.type !== "diag") return;
  if (!msg.mega2) return;

  const el = qs("m2-mode");
  if (!el) return;

  const m2 = msg.mega2;
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

function bitTest(mask, bit){
  return ((mask >>> bit) & 1) !== 0;
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

// ------------------------------------------------------------
// Mega2 Relays UI (stable DOM; no innerHTML rebuild in the tick)
// ------------------------------------------------------------
const M2_RELAYS_UI = {
  inited: false,
  table: null,
  tbody: null,
  sub: null,
  rows: [], // [{ name, pin, bit, tr, tdLevel, tdAction, btnPulse, btnOn, btnOff }]
};

let _m2RelaysLastSeq = null;

function _seqNewer8(newSeq, oldSeq){
  const d = ((newSeq - oldSeq) & 0xFF);
  return d > 0 && d < 128;
}

function m2RelaysBuildMeta(){
  const rows = [];
  let bit = 0;

  // Weichenrelais W12..W15 (2 Spulen pro Weiche) => bits 0..7 => pulse-only
  const TURNOUT_PINS = [
    { wid:12, gerade:2,  abbiegen:3  },
    { wid:13, gerade:4,  abbiegen:5  },
    { wid:14, gerade:6,  abbiegen:7  },
    { wid:15, gerade:8,  abbiegen:9  },
  ];
  for (const p of TURNOUT_PINS){
    rows.push({ name:`W${p.wid} Gerade`,    pin:p.gerade,   bit: bit++, pulseOnly: true });
    rows.push({ name:`W${p.wid} Abbiegen`,  pin:p.abbiegen, bit: bit++, pulseOnly: true });
  }

  // Stromgleise / Powerpfade (nur Pin-Pegel; Bedeutung hängt von NO/NC ab)
  // Reihenfolge bleibt wie bisher (Map insertion order).
  const EDGE_PINS = new Map([
    ["Block 1 → 2 (Powerpfad)",         43],
    ["Block 2 → 3 (Powerpfad)",         44],
    ["Block 3 → 4 (Powerpfad)",         45],
    ["Block 4 → 1 (Powerpfad)",         46],
    ["Block 4 → 5 (Powerpfad)",         47],
    ["Block 5 → SBHF (Powerpfad)",      48],
    ["SBHF Gl1 → Block 6 (Powerpfad)",  49],
    ["SBHF Gl2 → Block 6 (Powerpfad)",  50],
    ["SBHF Gl3 → Block 6 (Powerpfad)",  51],
    ["Block 6 → Block 4 (Powerpfad)",   53],
    ["Nothalt SBHF (Relais)",           52],
    ["Trafo oben (Relais)",             41],
    ["Trafo unten (Relais)",            42],
  ]);
  for (const [name, pin] of EDGE_PINS.entries()){
    rows.push({ name, pin, bit: bit++, pulseOnly: false });
  }
  return rows;
}

function m2RelaysLevelCell(levelMask, bit){
  // Telemetrie: bit=1 => LOW/aktiv
  if (levelMask === null || typeof bit !== "number"){
    return { html: `<span class="mono">—</span>`, isLowActive: null };
  }
  const isLowActive = (((levelMask >>> bit) & 1) === 1);
  const led = `<span class="led ${isLowActive ? "led-on" : "led-off"}"></span>`;
  const txt = `<span class="mono">${isLowActive ? "LOW" : "HIGH"}</span>`;
  return { html: `${led}${txt}`, isLowActive };
}

function m2RelaysInitOnce(){
  if (M2_RELAYS_UI.inited) return;

  const tbody = qs("diag-m2-relays-body");
  const sub   = qs("diag-m2-relays-sub");
  const table = qs("diag-m2-relays-table");
  if (!tbody || !table) return;

  M2_RELAYS_UI.inited = true;
  M2_RELAYS_UI.table = table;
  M2_RELAYS_UI.tbody = tbody;
  M2_RELAYS_UI.sub = sub || null;

  // Build stable rows ONCE
  const meta = m2RelaysBuildMeta();
  M2_RELAYS_UI.rows = [];

  // Clear once (safe), afterwards: no innerHTML rebuilds.
  tbody.innerHTML = "";

  for (const r of meta){
    const tr = document.createElement("tr");

    const tdName = document.createElement("td");
    tdName.textContent = r.name;

    const tdPin = document.createElement("td");
    tdPin.className = "mono";
    tdPin.textContent = (r.pin ?? "—");

    const tdLevel = document.createElement("td");
    tdLevel.innerHTML = `<span class="mono">—</span>`;

    const tdAction = document.createElement("td");
    tdAction.className = "diag-relay-actions";
    // Buttons are created once; enabled/disabled in updateOnly.
    let btnPulse = null, btnOn = null, btnOff = null;

    if (r.pulseOnly){
      btnPulse = document.createElement("button");
      btnPulse.type = "button";
      btnPulse.className = "btn btn-sm btn-mini";
      btnPulse.textContent = "Puls (0,5s)";
      btnPulse.dataset.m2relayBit = String(r.bit);
      btnPulse.dataset.m2relayAction = "pulse";
      tdAction.appendChild(btnPulse);
    } else {
      btnOn = document.createElement("button");
      btnOn.type = "button";
      btnOn.className = "btn btn-sm btn-mini";
      btnOn.textContent = "AN";
      btnOn.dataset.m2relayBit = String(r.bit);
      btnOn.dataset.m2relayAction = "on";

      btnOff = document.createElement("button");
      btnOff.type = "button";
      btnOff.className = "btn btn-sm btn-mini";
      btnOff.textContent = "AUS";
      btnOff.dataset.m2relayBit = String(r.bit);
      btnOff.dataset.m2relayAction = "off";

      tdAction.appendChild(btnOn);
      tdAction.appendChild(document.createTextNode(" "));
      tdAction.appendChild(btnOff);
    }

    tr.appendChild(tdName);
    tr.appendChild(tdPin);
    tr.appendChild(tdLevel);
    tr.appendChild(tdAction);
    tbody.appendChild(tr);

    M2_RELAYS_UI.rows.push({
      name: r.name,
      pin: r.pin,
      bit: r.bit,
      pulseOnly: !!r.pulseOnly,
      tr, tdLevel, tdAction,
      btnPulse, btnOn, btnOff
    });
  }

  // Event delegation: ONE handler for all relay buttons.
  // Use pointerup to be robust against "down/up while UI updates".
  table.addEventListener("pointerup", (ev) => {
    const btn = ev.target && ev.target.closest ? ev.target.closest("button[data-m2relay-bit]") : null;
    if (!btn) return;
    if (btn.disabled) return;

    const bit = parseInt(btn.dataset.m2relayBit || "NaN", 10);
    const act = btn.dataset.m2relayAction || "";
    if (!Number.isFinite(bit) || !act) return;

    // Ensure nothing else eats the gesture
    ev.preventDefault();
    ev.stopPropagation();

    if (act === "pulse"){
      // Mega1-Style: pulse helper manages busy + button UI if passed the element
      m2PulseClick(ev, bit, 500, btn);
      return;
    }
    if (act === "on"){
      m2RelaySetClick(ev, bit, true, btn);
      return;
    }
    if (act === "off"){
      m2RelaySetClick(ev, bit, false, btn);
      return;
    }
  }, { passive: false });
}

function m2RelaysUpdateOnly(msg){
  // Only from diag frames
  if (!msg || msg.type !== "diag") return;
  if (!msg.mega2) return;

  const m2 = msg.mega2;
  const seq = m2?.relays?.seq;

  if (typeof seq === "number"){
    if (_m2RelaysLastSeq !== null &&
        !_seqNewer8(seq & 0xFF, _m2RelaysLastSeq)){
      return; // stale frame -> ignore
    }
    _m2RelaysLastSeq = seq & 0xFF;
  }
  const online = !!m2.online;

  // Telemetrie (pin-level, active-low semantics): bit=1 => LOW/aktiv
  let levelMask = null;
  const lm = m2?.relays?.levelMask;
  if (typeof lm === "number") levelMask = lm >>> 0;
  else if (typeof lm === "string" && lm.trim() !== "" && !isNaN(Number(lm))) levelMask = (Number(lm) >>> 0);
  const ageMs = (typeof m2?.relays?.ageMs === "number") ? m2.relays.ageMs : null;

  // Sub line
  if (M2_RELAYS_UI.sub){
    if (!online) M2_RELAYS_UI.sub.textContent = "telemetry: offline";
    else if (levelMask === null) M2_RELAYS_UI.sub.textContent = "telemetry: – (no relay levels)";
    else M2_RELAYS_UI.sub.textContent = (ageMs !== null) ? `telemetry: ok (age ${ageMs} ms)` : "telemetry: ok";
  }

  // Owner gate (same logic as before)
  const canWrite = online && diagIsOwner && diagToken;

  for (const r of M2_RELAYS_UI.rows){
    // Level cell
    const lc = m2RelaysLevelCell(levelMask, r.bit);
    r.tdLevel.innerHTML = lc.html;

    // Action enable/disable (stable buttons)
    if (r.pulseOnly && r.btnPulse){
      r.btnPulse.disabled = !canWrite;
      r.btnPulse.setAttribute("aria-disabled", (!canWrite).toString());
    } else {
      if (r.btnOn){
        r.btnOn.disabled = !canWrite;
        r.btnOn.setAttribute("aria-disabled", (!canWrite).toString());
      }
      if (r.btnOff){
        r.btnOff.disabled = !canWrite;
        r.btnOff.setAttribute("aria-disabled", (!canWrite).toString());
      }
    }
  }
}


function renderM2Relays(msg){
  if (!msg || msg.type !== "diag") return;
  if (!msg.mega2) return;

  // Ensure stable DOM exists
  m2RelaysInitOnce();
  if (!M2_RELAYS_UI.inited) return;

  // Update only (no rebuild)
  m2RelaysUpdateOnly(msg);
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
  // TTL is no longer shown in the status line -> no need for 1 Hz refresh.
  // Keep this as a no-op to avoid UI flicker due to length changes.
}

function buildDiagLeaseText(){
  if (!leaseModel.active) return "Diagnose inaktiv";
  const ownerPart = (leaseModel.ownerId && leaseModel.ownerId !== 0) ? `Owner ${leaseModel.ownerId}` : "";
  // Keep status short & stable (no TTL countdown in header)
  return ownerPart ? `Diagnose aktiv (${ownerPart})` : "Diagnose aktiv";
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
    const raw = !!(an && (an.flags & 0x10));
    const suffixI = raw ? " cnt" : " mA";
    const val = (typeof i[k] === "number") ? `${i[k]}${suffixI}` : "–";
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
    if (DIAG_VERBOSE) {
      console.warn("[DIAGJS] m1DiagRelaySet blocked (not owner or missing token)", { diagIsOwner, diagToken });
    }
    return;
  }
  if (DIAG_DEBUG && DIAG_TIMING) {
   console.log("[DIAGJS] m1DiagRelaySet send", { relay, idx, val, token: diagToken });
  }
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

// Mega2 DIAG relay commands
const _m2PulseTimers = new Map(); // bit -> timeoutId

// Helper: user feedback when pulse is busy (Mega1-style UX, but with message)
function m2PulseBusyFeedback(bit, uiBtn){
  try { setDiagStatus(`Busy: Mega2 Puls läuft (Bit ${bit})`); } catch(_) {}
  if (!uiBtn) return;
  // Mega1-style: rely on [disabled] CSS; just give a short text hint.
  try {
    const old = uiBtn.textContent;
    uiBtn.textContent = "Busy…";
    setTimeout(() => {
      // If our pulse timer still owns the button, keep "Puls…" text.
      if (uiBtn.dataset && uiBtn.dataset.busy === "1"){
        uiBtn.textContent = "Puls…";
      } else {
        uiBtn.textContent = old;
      }
    }, 250);
  } catch(_) {}
}

function m2SendRelaySet(bit, on){
  if (!diagIsOwner || !diagToken) {
    console.warn("[DIAGJS] m2DiagRelaySet blocked (not owner or missing token)", { diagIsOwner, diagToken });
    return;
  }
  wsSend({ action:"m2DiagRelaySet", token: diagToken, bit, on: !!on });
}

function m2SendRelayPulse(bit, ms){
  if (!diagIsOwner || !diagToken) {
    console.warn("[DIAGJS] m2DiagRelayPulse blocked (not owner or missing token)", { diagIsOwner, diagToken });
    return;
  }
  wsSend({ action:"m2DiagRelayPulse", token: diagToken, bit, ms });
}

function m2RelaySetClick(ev, bit, on, uiBtn){
  // Ensure table/row handlers or overlays don't swallow the click.
  if (ev){
    ev.preventDefault();
    ev.stopPropagation();
  }

  // Optional tiny UI feedback
  if (uiBtn){
    uiBtn.blur();
  }

  m2SendRelaySet(bit, on);
}

function m2PulseClick(ev, bit, ms, uiBtn){
  if (ev){
    ev.preventDefault();
    ev.stopPropagation();
  }
  if (uiBtn){
    uiBtn.blur();
  }
  m2Pulse(bit, ms, uiBtn);
}

function m2PulseBusyFeedback(bit, uiBtn){
  if (!uiBtn) return;
  const old = uiBtn.textContent;
  uiBtn.dataset.busy = "1";
  uiBtn.textContent = "Busy…";
  setTimeout(() => {
    uiBtn.textContent = old;
    uiBtn.dataset.busy = "";
  }, 300);
}

function m2Pulse(bit, ms, uiBtn){
  const key = String(bit);
  if (_m2PulseTimers.has(key)){
    // Busy: ignore overlapping pulses (same behavior as Mega1), but give feedback.
    m2PulseBusyFeedback(bit, uiBtn);
    return;
  }

  if (uiBtn){
    uiBtn.disabled = true;
    uiBtn.dataset.busy = "1";
    uiBtn.textContent = "Puls…";
  }

  m2SendRelayPulse(bit, ms);

  const tid = setTimeout(() => {
    _m2PulseTimers.delete(key);
    if (uiBtn){
      uiBtn.disabled = false;
      uiBtn.dataset.busy = "";
      uiBtn.textContent = "Puls (0,5s)";
    }
  }, ms + 50);

  _m2PulseTimers.set(key, tid);
}

// ------------------------------------------------------------
// Mega1 Relais / Outputs (aus msg.mega1.relays)
// ------------------------------------------------------------
function renderM1Relays(msg){
  const r = msg?.mega1?.relays;
  if (!r) return;

  const tbody = qs("diag-m1-relays-body");
  const table = qs("diag-m1-relays-table");
  if (!tbody || !table) return;

  const sub = qs("diag-m1-relays-sub");
  if (sub){
    const seqTxt = (typeof r.seq === "number") ? r.seq : "–";
    const ageTxt = (typeof r.ageMs === "number") ? (r.ageMs + " ms") : "–";
    sub.textContent = `seq: ${seqTxt} · age: ${ageTxt}`;
  }

  function bit(mask, i){ return ((mask >>> i) & 1) ? 1 : 0; }

  const gMask   = (typeof r.weicheGMask === "number")    ? r.weicheGMask    : 0;
  const aMask   = (typeof r.weicheAMask === "number")    ? r.weicheAMask    : 0;
  const redMask = (typeof r.weicheRedMask === "number")  ? r.weicheRedMask  : 0;
  const bhfMask = (typeof r.bhfPowerMask === "number")   ? r.bhfPowerMask   : 0;

  // Level display like sensor tables: 1 => LOW/aktiv (green)
  function setLevel(td, lvl1MeansLow){
    const on = !!lvl1MeansLow;
    const html =
      `<span class="led ${on ? "led-on" : "led-off"}" title="${on ? "LOW (aktiv)" : "HIGH (inaktiv)"}"></span>` +
      (on ? "LOW" : "HIGH");
    if (td.__lvlHtml !== html){
      td.innerHTML = html;
      td.__lvlHtml = html;
    }
  }

  // Build stable DOM once (no tbody.innerHTML churn => no lost clicks)
  if (!renderM1Relays._ui){
    renderM1Relays._ui = { rows: [] };

    const rows = [];

    // 1) Bhf2a..Bhf4b (mask bits 0..3)
    for (let i=0;i<4;i++){
      rows.push({
        kind: "power",
        name: M1_RELAY_META.powerNames[i],
        pin: M1_RELAY_META.pinTxt(M1_RELAY_META.powerPins[i]),
        idx: i,
      });
    }

    // separator
    rows.push({ kind: "sep", label: "— Weichen (Taster: Puls 0,5s) —" });

    // 2) Weichen: W0..W11 gerade/abbiegen (pulse + stop)
    for (let i=0;i<12;i++){
      rows.push({
        kind: "weiche",
        relay: "weicheG",
        idx: i,
        name: `W${i} gerade`,
        pin: M1_RELAY_META.pinTxt(M1_RELAY_META.pinsG[i]),
      });
      rows.push({
        kind: "weiche",
        relay: "weicheA",
        idx: i,
        name: `W${i} abbiegen`,
        pin: M1_RELAY_META.pinTxt(M1_RELAY_META.pinsA[i]),
      });
    }

    // separator
    rows.push({
      kind: "sep",
      label: "— Reduktion (nur W6–W11) — <span class=\"muted\">Read-Only: Reduktion wird automatisch abhängig der Weichenstellung geschaltet!</span>"
    });

    // 3) Reduktion: W6..W11 read-only
    for (let i=6;i<=11;i++){
      rows.push({
        kind: "red",
        idx: i,
        name: `W${i} Reduktion`,
        pin: M1_RELAY_META.pinTxt(M1_RELAY_META.pinsRed[i]),
      });
    }

    // Create DOM rows once
    for (const it of rows){
      if (it.kind === "sep"){
        const tr = document.createElement("tr");
        tr.className = "diag-sep-row";
        const td = document.createElement("td");
        td.colSpan = 4;
        td.innerHTML = it.label;
        tr.appendChild(td);
        tbody.appendChild(tr);
        renderM1Relays._ui.rows.push({ kind:"sep", tr });
        continue;
      }

      const tr = document.createElement("tr");

      const tdName = document.createElement("td");
      tdName.textContent = it.name;

      const tdPin = document.createElement("td");
      tdPin.className = "mono";
      tdPin.textContent = it.pin;

      const tdLevel = document.createElement("td");
      tdLevel.innerHTML = `<span class="mono">—</span>`;

      const tdAction = document.createElement("td");
      tdAction.className = "diag-relay-actions";

      let btnPulse=null, btnStop=null, btnOn=null, btnOff=null;

      if (it.kind === "power"){
        btnOn = document.createElement("button");
        btnOn.type = "button";
        btnOn.className = "btn btn-mini";
        btnOn.textContent = "AN";
        btnOn.dataset.m1rel = "power";
        btnOn.dataset.idx = String(it.idx);
        btnOn.dataset.val = "0"; // AN = active-low => drive pin LOW

        btnOff = document.createElement("button");
        btnOff.type = "button";
        btnOff.className = "btn btn-mini";
        btnOff.textContent = "AUS";
        btnOff.dataset.m1rel = "power";
        btnOff.dataset.idx = String(it.idx);
        btnOff.dataset.val = "1"; // AUS = inactive => drive pin HIGH

        tdAction.appendChild(btnOn);
        tdAction.appendChild(document.createTextNode(" "));
        tdAction.appendChild(btnOff);
      } else if (it.kind === "weiche"){
        btnPulse = document.createElement("button");
        btnPulse.type = "button";
        btnPulse.className = "btn btn-mini";
        btnPulse.textContent = "Puls (0,5s)";
        btnPulse.dataset.m1rel = it.relay;
        btnPulse.dataset.idx = String(it.idx);
        btnPulse.dataset.pulse = "1";

        btnStop = document.createElement("button");
        btnStop.type = "button";
        btnStop.className = "btn btn-mini";
        btnStop.textContent = "STOP/AUS";
        btnStop.dataset.m1rel = it.relay;
        btnStop.dataset.idx = String(it.idx);
        btnStop.dataset.val = "0";

        tdAction.appendChild(btnPulse);
        tdAction.appendChild(document.createTextNode(" "));
        tdAction.appendChild(btnStop);
      } else if (it.kind === "red"){
        tdAction.innerHTML = `<span class="muted">automatisch (abhängig von Weichenstellung)</span>`;
      }

      tr.appendChild(tdName);
      tr.appendChild(tdPin);
      tr.appendChild(tdLevel);
      tr.appendChild(tdAction);
      tbody.appendChild(tr);

      renderM1Relays._ui.rows.push({
        kind: it.kind,
        relay: it.relay,
        idx: it.idx,
        tr, tdLevel,
        btnPulse, btnStop, btnOn, btnOff
      });
    }

    // Event delegation: ONE handler for all relay buttons.
    // Use pointerup to be robust against "down/up while UI updates".
    table.addEventListener("pointerup", (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest("button[data-m1rel]") : null;
      if (!btn) return;
      if (btn.disabled) return;

      // Ensure nothing else eats the gesture
      ev.preventDefault();
      ev.stopPropagation();

      if (!diagIsOwner || !diagToken) return;

      const relay = btn.dataset.m1rel || "";
      const idx = parseInt(btn.dataset.idx || "NaN", 10);
      if (!relay || !Number.isFinite(idx)) return;

      const isPulse = (btn.dataset.pulse === "1");
      if (isPulse){
        m1Pulse(relay, idx, 500, btn);
        return;
      }
      const val = parseInt(btn.dataset.val || "0", 10);
      m1SendRelayCmd(relay, idx, val);
    }, { passive: false });
  }

  // Update only (levels + enabled/disabled)
  const canCmd = !!(diagIsOwner && diagToken);

  for (const row of renderM1Relays._ui.rows){
    if (!row || row.kind === "sep") continue;

    if (row.kind === "power"){
      // IMPORTANT (Mega1 Bhf2a..Bhf4b):
      // bhfPowerMask bit==1 corresponds to PIN=HIGH on the Mega1 output.
      // Our LED convention expects "1 => LOW/aktiv (green)" (same as sensor tables).
      // Therefore invert ONLY for these 4 power relays:
      const pinHigh = bit(bhfMask, row.idx) === 1;
      const lvl1MeansLow = pinHigh ? 0 : 1;
      setLevel(row.tdLevel, lvl1MeansLow);

      if (row.btnOn)  row.btnOn.disabled  = !canCmd;
      if (row.btnOff) row.btnOff.disabled = !canCmd;
    }
    else if (row.kind === "weiche"){
      const isG = (row.relay === "weicheG");
      const lvl1MeansLow = isG ? (bit(gMask, row.idx) === 0) : (bit(aMask, row.idx) === 0);
      setLevel(row.tdLevel, lvl1MeansLow);

      if (row.btnPulse) row.btnPulse.disabled = !canCmd;
      if (row.btnStop)  row.btnStop.disabled  = !canCmd;
    }
    else if (row.kind === "red"){
      const lvl1MeansLow = (bit(redMask, row.idx) === 0);
      setLevel(row.tdLevel, lvl1MeansLow);
      // no buttons
    }
  }
}

// ------------------------------------------------------------
// WS send + diag lease heartbeat
// ------------------------------------------------------------
function wsSend(obj){
  if (DIAG_DEBUG && DIAG_TIMING && obj &&
      (obj.action === "diagEnter" || obj.action === "diagHeartbeat" || obj.action === "diagExit")){
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
      if (DIAG_VERBOSE) {
        try { console.log("[DIAGJS] HB send token=", diagToken, "len=", (diagToken||"").length); } catch(_){ }
      }
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
    const t0 = performance.now();

    let msg = null;
    try { msg = JSON.parse(ev.data); } catch(_) { return; }
    const tParse = performance.now();

    wsLog(msg?.type || "msg", msg);

    // ------------------------------------------------------------
    // 1) diagControl: IMMER zuerst behandeln + return
    // ------------------------------------------------------------
    if (msg.type === "diagControl"){
      if (DIAG_DEBUG && DIAG_TIMING) {
        try { console.log("[DIAGJS] diagControl rx", msg); } catch(_){}
      }

      if (msg.isOwner && msg.token){
        diagIsOwner = true;
        diagToken = msg.token;
        storeDiagToken(diagToken);

        const bEnter = qs("diag-enter");
        const bExit  = qs("diag-exit");
        if (bEnter) bEnter.disabled = true;
        if (bExit)  bExit.disabled  = false;

        setWarnStatus("⚠️ Diagnose aktiv: Aktoren können direkt geschaltet werden (potenziell gefährlich). Not-Aus bleibt wirksam.");
        setDiagStatus(`Diagnose aktiv (Owner ${msg.ownerId})`);
        startHeartbeat();
      } else {
        diagIsOwner = false;
        // Token nur löschen, wenn Lease inaktiv ist (sonst "busy" behalten)
        if (!msg.active) {
          diagToken = null;
          storeDiagToken(null);
        }
        stopHeartbeat();

        const bEnter = qs("diag-enter");
        const bExit  = qs("diag-exit");
        if (bExit)  bExit.disabled  = true;
        if (bEnter) bEnter.disabled = false;

        setDiagStatus(msg.active ? `Diagnose belegt (Owner ${msg.ownerId})` : "Diagnose inaktiv");
      } 

      const tEnd = performance.now();
      if (DIAG_DEBUG && DIAG_TIMING) {
        console.log("[WSRX-T]", "type", msg.type, "len", ev.data.length,
                    "parse", (tParse - t0).toFixed(2) + "ms",
                    "total", (tEnd - t0).toFixed(2) + "ms");
      }
      return;
    }

    // ------------------------------------------------------------
    // Cache Mega2 Turnouts istMask (kann in state oder diag kommen)
    // Rendering bleibt trotzdem im DIAG-throttle.
    // ------------------------------------------------------------
    const maybeIst = msg?.mega2?.turnouts?.istMask;
    if (typeof maybeIst === "number") {
      _m2CachedIstMask = maybeIst;
      _m2CachedIstMaskTs = Date.now();
    }


    // ------------------------------------------------------------
    // 2) diagCtrl snapshot (kann in state/diag/analog kommen)
    // ------------------------------------------------------------
    if (msg.diagCtrl){
      if (msg.diagCtrl.active){
        leaseModel.active = true;
        leaseModel.ownerId = msg.diagCtrl.ownerId || 0;

        if (typeof msg.diagCtrl.expiresAtMs === "number") {
          leaseModel.expiresAtMs = msg.diagCtrl.expiresAtMs;
        } else if (typeof msg.diagCtrl.leaseUntilMs === "number") {
          leaseModel.expiresAtMs = msg.diagCtrl.leaseUntilMs;
        } else if (typeof msg.diagCtrl.ttlMs === "number") {
          leaseModel.expiresAtMs = Date.now() + msg.diagCtrl.ttlMs;
        } else if (typeof msg.diagCtrl.expiresInMs === "number") {
          leaseModel.expiresAtMs = Date.now() + msg.diagCtrl.expiresInMs;
        } else {
          leaseModel.expiresAtMs = 0;
        } 

        setDiagStatus(buildDiagLeaseText());
        if (leaseModel.expiresAtMs > 0) startLeaseCountdown();
        else stopLeaseCountdown();
      } else {
        leaseModel.active = false;
        leaseModel.ownerId = 0;
        leaseModel.expiresAtMs = 0;
        stopLeaseCountdown();
        setDiagStatus("Diagnose inaktiv");
      }
    }

    // ------------------------------------------------------------
    // 3) state: nur leichte Dinge (Blocks) + return
    // ------------------------------------------------------------
    if (msg.type === "state"){
      renderBlocksFromState(msg);

      const tEnd = performance.now();
      if (DIAG_VERBOSE) {
        console.log("[WSRX-T]", "type", msg.type, "len", ev.data.length,
                    "parse", (tParse - t0).toFixed(2) + "ms",
                    "total", (tEnd - t0).toFixed(2) + "ms");
      }
      return;
    }

    // ------------------------------------------------------------
    // 4) diag: hier passieren heavy tables (throttled)
    // ------------------------------------------------------------
    if (msg.type === "diag"){
      // Drop out-of-order/duplicate diag frames by ts
      if (typeof msg.ts === "number"){
        if (msg.ts <= _lastDiagTs) return;
        _lastDiagTs = msg.ts;
      }

      lastDiagMsg = msg;

      // Mega2 mode badge nur aus DIAG (kein Flackern)
      renderMega2Mode(msg);

      // Pretty JSON dump throttle
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
                sensors: d1.sensors,
                relays: msg?.mega1?.relays,
              } : undefined,
              mega2: {
                analog: msg?.mega2?.analog,
                turnouts: msg?.mega2?.turnouts,
                diagSensors: msg?.mega2?.diagSensors,
                relays: msg?.mega2?.relays
              }
            }, null, 2);
          }
        }
      }



      // Heavy DOM nur throttled
      _latestDiagMsg = msg;
      scheduleDiagRender();

      const tEnd = performance.now();
      if (DIAG_VERBOSE) {
        console.log("[WSRX-T]", "type", msg.type, "len", ev.data.length,
                    "parse", (tParse - t0).toFixed(2) + "ms",
                    "total", (tEnd - t0).toFixed(2) + "ms");
      }
      return;
    }

    // ------------------------------------------------------------
    // 5) analog: nur Analog-Tabelle (klein) + return
    // ------------------------------------------------------------
    if (msg.type === "analog"){
      const an = msg?.analog ?? msg?.mega2?.analog;
      if (an){
        renderAnalogRows(an);
        setKpi(an.ageMs, an.hz, an.seq);
      }
      const tEnd = performance.now();
      if (DIAG_VERBOSE) {
        console.log("[WSRX-T]", "type", msg.type, "len", ev.data.length,
                    "parse", (tParse - t0).toFixed(2) + "ms",
                    "total", (tEnd - t0).toFixed(2) + "ms");
      }
      return;
    }

    // ------------------------------------------------------------
    // 6) errors
    // ------------------------------------------------------------
    if (msg.type === "error" && msg.code === "DIAG_ACTIVE"){
      setWarnStatus("DIAG_ACTIVE: Schreibzugriff gesperrt (du bist nicht Owner)");
      return;
    }

    if (msg.type === "error" && msg.code === "DIAG_HB_REJECT"){
      setWarnStatus("DIAG_HB_REJECT: Heartbeat abgelehnt – Diagnose-Lease verloren.");
      diagIsOwner = false;
      diagToken = null;
      storeDiagToken(null);
      stopHeartbeat();

      const exitBtn  = qs("diag-exit");
      const enterBtn = qs("diag-enter");
      if (exitBtn)  exitBtn.disabled = true;
      if (enterBtn) enterBtn.disabled = false;

      setDiagStatus("Diagnose inaktiv");
      return;
    } 

    // default timing log
    const tEnd = performance.now();
    if (DIAG_VERBOSE) {
      console.log("[WSRX-T]", "type", msg.type, "len", ev.data.length,
                  "parse", (tParse - t0).toFixed(2) + "ms",
                  "total", (tEnd - t0).toFixed(2) + "ms");
    }
  };
}

window.addEventListener("load", () => {
  const elBuild = qs("diag-build");
  if (elBuild) elBuild.textContent = "build: " + (typeof DIAG_BUILD === "string" ? DIAG_BUILD : "unknown");
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