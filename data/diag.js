let ws = null;
let token = null;
let hbTimer = null;

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
    const sid = (typeof s?.sid === "number") ? s.sid : null;
    const lvl = (typeof s?.level === "number") ? s.level : null;
    const rise = (typeof s?.rise === "number") ? s.rise : null;
    const fall = (typeof s?.fall === "number") ? s.fall : null;

    html += `<tr>
      <td>${sid === null ? "–" : ("S"+sid)}</td>
      <td>${lvl === null ? "–" : fmt01(lvl)}</td>
      <td class="mono">${rise === null ? "–" : rise}</td>
      <td class="mono">${fall === null ? "–" : fall}</td>
    </tr>`;
  }
  tb.innerHTML = html;
}

// ------------------------------------------------------------
// Render: Mega1 Sensors from diag (type:"diag")
// Expects: msg.mega1.sensors = [{sid,level,rise,fall}, ...]
// ------------------------------------------------------------
function renderM1Sensors(msg){
  const arr = msg?.mega1?.sensors;
  if (!Array.isArray(arr)) return;

  const tb = qs("diag-m1-sensors");
  if (!tb) return;

  // Sort by numeric S-id to keep the gaps intuitive.
  const sorted = [...arr].sort((a,b)=> (a?.sid??999)-(b?.sid??999));

  let html = "";
  for (const s of sorted){
    const sid = (typeof s?.sid === "number") ? s.sid : null;
    const lvl = (typeof s?.level === "number") ? s.level : null;
    const rise = (typeof s?.rise === "number") ? s.rise : null;
    const fall = (typeof s?.fall === "number") ? s.fall : null;

    html += `<tr>
      <td>${sid === null ? "–" : ("S"+sid)}</td>
      <td>${lvl === null ? "–" : fmt01(lvl)}</td>
      <td class="mono">${rise === null ? "–" : rise}</td>
      <td class="mono">${fall === null ? "–" : fall}</td>
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
function connect(){
  const proto = (location.protocol === "https:") ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
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
  };

  ws.onerror = (e) => {
    wsLog("error", e);
  };

  ws.onmessage = (ev) => {
    let msg = null;
    try { msg = JSON.parse(ev.data); } catch(e) { return; }

    wsLog(msg?.type || "msg", msg);

    // Dump last diag frame for quick debugging
    if (msg.type === "diag"){
      const pre = qs("diag-json");
      if (pre) pre.textContent = JSON.stringify(msg, null, 2);

      // Analog meta (Mega2)
      const an = msg?.mega2?.analog;
      if (an){
        setKpi(an.ageMs, an.hz, an.seq);

        // Fallback: if analog values are included inside type:"diag"
        const vA10 = qs("an-vA10");
        const vB10 = qs("an-vB10");
        const imA  = qs("an-imA");
        if (vA10 && typeof an.vA10 === "number") vA10.textContent = fmtV10(an.vA10);
        if (vB10 && typeof an.vB10 === "number") vB10.textContent = fmtV10(an.vB10);
        if (imA && Array.isArray(an.i_mA)) imA.textContent = an.i_mA.join(", ");
      }

      // Digital sensor tables
      renderM2Schalt(msg);
      renderM1Sensors(msg);
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
        // Values
        const vA10 = qs("an-vA10");
        const vB10 = qs("an-vB10");
        const imA  = qs("an-imA");
        if (vA10) vA10.textContent = fmtV10(an.vA10);
        if (vB10) vB10.textContent = fmtV10(an.vB10);
        if (imA && Array.isArray(an.i_mA)) imA.textContent = an.i_mA.join(", ");
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
  qs("diag-enter").addEventListener("click", () => {
    wsSend({ action:"diagEnter" });
  });

  qs("diag-exit").addEventListener("click", () => {
    if (token) wsSend({ action:"diagExit", token });
    window.location.href = "index.htm";
  });

  connect();
});