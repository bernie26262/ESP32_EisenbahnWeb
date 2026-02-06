let ws = null;
let token = null;
let hbTimer = null;
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
 
 function scheduleDiagRender(){
   if (_diagRenderPending) return;
   _diagRenderPending = true;
   setTimeout(() => {
     _diagRenderPending = false;
     const m = _latestDiagMsg;
     _latestDiagMsg = null;
     if (!m) return;
 
     // Digital sensor tables (heavy DOM)
     try { renderM2Kontakte(m); } catch(e){ console.error("[diag] renderM2Kontakte failed", e); }
     try { renderM2Schalt(m); } catch(e){ console.error("[diag] renderM2Schalt failed", e); }
     try { renderM1Sensors(m); } catch(e){ console.error("[diag] renderM1Sensors failed", e); }

     // Quick visibility in console (helps catch path/ID issues)
     try {
       const a1 = m?.mega1?.sensors ?? m?.mega1?.diag?.sensors;
       if (Array.isArray(a1)) console.log("[diag] m1 sensors:", a1.length);
       const tb1 = qs("diag-m1-sensors");
       if (!tb1) console.warn("[diag] missing tbody #diag-m1-sensors");
     } catch(_) {}
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

const M2_SCHALT_INFO = [
  { key:"S11", name:"Schaltgleis S11", pin:31, idx:0 },
  { key:"S12", name:"Schaltgleis S12", pin:32, idx:1 },
  { key:"S13", name:"Schaltgleis S13", pin:33, idx:2 },
  { key:"S14", name:"Schaltgleis S14", pin:34, idx:3 },
  { key:"S15", name:"Schaltgleis S15", pin:35, idx:4 },
  { key:"S16", name:"Schaltgleis S16", pin:36, idx:5 },
];
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

// ------------------------------------------------------------
// Browser-side counters for Mega2 *Kontakt*-events (rise/fall).
// Mega2 liefert kontaktRiseMask/kontaktFallMask nur als "seen" Flags (kurz).
// Wir zählen deshalb im Browser hoch (wie bei Mega1).
// ------------------------------------------------------------
const m2KontaktCounters = {
  // idx -> { rise:number, fall:number, lastRiseFlag:0|1, lastFallFlag:0|1 }
  map: new Map(),
  get(idx){
    let e = this.map.get(idx);
    if (!e){
      e = { rise: 0, fall: 0, lastRiseFlag: 0, lastFallFlag: 0 };
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

// compat alias (render helpers use esc())
function esc(s){ return escapeHtml(s); }

// ------------------------------------------------------------
// Render: Mega2 Kontakte + Schaltgleise from diag (type:"diag")
// Expects: msg.mega2.diagSensors = { kontakt*Mask, schalt* }
// ------------------------------------------------------------
function renderM2Kontakte(msg){
  const d = msg?.mega2?.diagSensors;
  if (!d) return;

  const tb = qs("diag-m2-kontakte");
  if (!tb) return;

  const lvlMask  = (typeof d.kontaktLevelMask === "number") ? d.kontaktLevelMask : 0;
  const riseMask = (typeof d.kontaktRiseMask  === "number") ? d.kontaktRiseMask  : 0;
  const fallMask = (typeof d.kontaktFallMask  === "number") ? d.kontaktFallMask  : 0;

  const sLvlMask = (typeof d.schaltLevelMask === "number") ? d.schaltLevelMask : 0;
  const sRise = Array.isArray(d.schaltRise) ? d.schaltRise : [];
  const sFall = Array.isArray(d.schaltFall) ? d.schaltFall : [];

  let html = "";

  // Kontakte (Level + Browser-Counter + Pfeil wenn Event im aktuellen Frame sichtbar)
  for (let i=0; i<M2_KONTAKT_INFO.length; i++){
    const info = M2_KONTAKT_INFO[i];
    const bit = (1 << i);
    const lvl  = (lvlMask  & bit) ? 1 : 0;
    const rise = (riseMask & bit) ? 1 : 0;
    const fall = (fallMask & bit) ? 1 : 0;

    const c = m2KontaktCounters.get(i);
    if (rise && !c.lastRiseFlag) c.rise++;
    if (fall && !c.lastFallFlag) c.fall++;
    c.lastRiseFlag = rise ? 1 : 0;
    c.lastFallFlag = fall ? 1 : 0;

    const riseTxt = `${rise ? "↑ " : ""}${c.rise}`;
    const fallTxt = `${fall ? "↓ " : ""}${c.fall}`;

    html += `<tr>
      <td class="mono">${esc(info.key)}</td>
      <td>${esc(info.name)}</td>
      <td class="mono">${info.pin}</td>
      <td>${lvl ? `<span class="led led-on"></span>LOW` : `<span class="led led-off"></span>HIGH`}</td>
      <td class="mono">${riseTxt}</td>
      <td class="mono">${fallTxt}</td>
    </tr>`;
  }

  // Schaltgleise (Level + Counter)
  for (const s of M2_SCHALT_INFO){
    const bit = (1 << s.idx);
    const lvl  = (sLvlMask & bit) ? 1 : 0;
    const rise = (typeof sRise[s.idx] === "number") ? sRise[s.idx] : 0;
    const fall = (typeof sFall[s.idx] === "number") ? sFall[s.idx] : 0;

    html += `<tr>
      <td class="mono">${esc(s.key)}</td>
      <td>${esc(s.name)}</td>
      <td class="mono">${s.pin}</td>
      <td>${lvl ? `<span class="led led-on"></span>LOW` : `<span class="led led-off"></span>HIGH`}</td>
      <td class="mono">${rise}</td>
      <td class="mono">${fall}</td>
    </tr>`;
  }

  tb.innerHTML = html;
}

// Hook: optional Mega2 counter reset button (if present in diag.htm)
try {
  const b = qs("m2-reset");
  if (b) b.addEventListener("click", () => m2KontaktCounters.reset());
} catch(_) {}

// ------------------------------------------------------------
// Combined status model (WS + diag lease + warning)
// ------------------------------------------------------------
const statusModel = {
  wsUp: false,
  diagText: "",
  warnText: ""
};

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

  const age = (typeof ageMs === "number") ? ageMs : null;
  const hzTxt  = (typeof hz === "number") ? hz.toFixed(2) : "?";
  const seqTxt = (typeof seq === "number") ? seq : "?";
  const ageTxt = (age === null) ? "?" : age;

  el.textContent = `Analog: ${hzTxt} Hz · age ${ageTxt} ms · seq ${seqTxt}`;

  // Ampel: <800ms ok, <2000ms warn, sonst err
  el.classList.remove("kpi-ok","kpi-warn","kpi-err");
  if (age === null) el.classList.add("kpi-warn");
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
  const arr = msg?.mega2?.schaltgleise;
  if (!Array.isArray(arr)) return;

  const tb = qs("diag-m2-schalt");
  if (!tb) return;

  let html = "";
  for (const s of arr){
    const sid  = (typeof s?.sid === "number")   ? s.sid   : null;
    const lvl  = (typeof s?.level === "number") ? s.level : null;
    const rise = (typeof s?.rise === "number")  ? s.rise  : null;
    const fall = (typeof s?.fall === "number")  ? s.fall  : null;

    // Optional meta (Name/Pin) – currently unknown for Mega2, keep placeholders.
    const nameTxt = "–";
    const pinTxt  = "–";

    const lvlKnown = (lvl === 0 || lvl === 1);
    const levelHtml = lvlKnown
      ? (`<span class="led ${(lvl === 1) ? "led-on" : "led-off"}" title="${(lvl === 1) ? "LOW (aktiv)" : "HIGH (inaktiv)"}"></span>` + ((lvl === 1) ? "LOW" : "HIGH"))
      : "–";

    html += `<tr>
      <td>${sid === null ? "–" : ("S"+sid)}</td>
      <td>${(lvl === 0 || lvl === 1)
         ? (`<span class="led ${(lvl === 1) ? "led-on" : "led-off"}" title="${(lvl === 1) ? "LOW (aktiv)" : "HIGH (inaktiv)"}"></span>` + ((lvl === 1) ? "LOW" : "HIGH"))
         : "–"
       }</td>
       <td class="mono">${(typeof rise === "number") ? rise : "–"}</td>
       <td class="mono">${(typeof fall === "number") ? fall : "–"}</td>
    </tr>`;
  }
  tb.innerHTML = html;
}

function renderM2Kontakte(msg){
  const d = msg?.mega2?.diagSensors;
  if (!d) return;

  const tb = qs("diag-m2-kontakte");
  if (!tb) return;

  const lvlMask  = (typeof d.kontaktLevelMask === "number") ? d.kontaktLevelMask : 0;
  const riseMask = (typeof d.kontaktRiseMask  === "number") ? d.kontaktRiseMask  : 0;
  const fallMask = (typeof d.kontaktFallMask  === "number") ? d.kontaktFallMask  : 0;

  let html = "";
  for (let i=0; i<M2_KONTAKT_INFO.length; i++){
    const info = M2_KONTAKT_INFO[i];
    const bit = (1 << i);
    const lvl  = (lvlMask  & bit) ? 1 : 0;
    const rise = (riseMask & bit) ? 1 : 0;
    const fall = (fallMask & bit) ? 1 : 0;

    html += `<tr>
      <td class="mono">${esc(info.key)}</td>
      <td>${esc(info.name)}</td>
      <td class="mono">${info.pin}</td>
      <td>${lvl ? `<span class="led led-on"></span>LOW` : `<span class="led led-off"></span>HIGH`}</td>
      <td class="mono">${rise}</td>
      <td class="mono">${fall}</td>
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

  tb.innerHTML = html;
}

// ------------------------------------------------------------
// WS send + diag lease heartbeat
// ------------------------------------------------------------
function wsSend(obj){
  if (!ws || ws.readyState !== 1) return;
  const json = JSON.stringify(obj);
  ws.send(json);
}

function startHeartbeat(){
  stopHeartbeat();
  hbTimer = setInterval(() => {
    if (token) wsSend({ action:"diagHeartbeat", token });
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
    let msg = null;
    try { msg = JSON.parse(ev.data); } catch(e) { return; }

    wsLog(msg?.type || "msg", msg);

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
                 sensors: d1.sensors
               } : undefined,
               mega2: msg?.mega2?.analog ? { analog: msg.mega2.analog } : undefined
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
      return;
    }

    if (msg.type === "state"){
      renderBlocksFromState(msg);
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
      return;
    }

    // Lease state snapshot that the server mirrors into both state and diag
    if (msg.diagCtrl){
      if (msg.diagCtrl.active){
        if (msg.diagCtrl.ownerId && msg.diagCtrl.ownerId !== 0){
          setDiagStatus(`Diagnose aktiv (Owner ${msg.diagCtrl.ownerId})`);
        } else {
          setDiagStatus("Diagnose aktiv");
        }
      } else {
        token = null;
        stopHeartbeat();
        qs("diag-exit").disabled = true;
        qs("diag-enter").disabled = false;
        setDiagStatus("Diagnose inaktiv");
      }
      return;
    }

    if (msg.type === "diagControl"){
      if (msg.isOwner && msg.token){
        token = msg.token;
        qs("diag-enter").disabled = true;
        qs("diag-exit").disabled = false;
        setWarnStatus("");
        setDiagStatus(`Diagnose aktiv (Owner ${msg.ownerId})`);
        startHeartbeat();
      } else {
        setDiagStatus(`Diagnose belegt (Owner ${msg.ownerId})`);
      }
      return;
    }

    if (msg.type === "error" && msg.code === "DIAG_ACTIVE"){
      setWarnStatus("DIAG_ACTIVE: Schreibzugriff gesperrt (du bist nicht Owner)");
      return;
    }
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

  qs("diag-enter").addEventListener("click", () => {
    wsSend({ action:"diagEnter" });
  });

  qs("diag-exit").addEventListener("click", () => {
    if (token) wsSend({ action:"diagExit", token });
    window.location.href = "index.htm";
  });


  connect();
});