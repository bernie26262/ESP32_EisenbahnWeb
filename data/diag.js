let ws = null;
let token = null;
let hbTimer = null;
let lastDiag = null;
let lastAnalog = null;



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
  // avoid flooding: log every 10th message  always log errors/diagControl
  if (type === "error" || type === "diagControl" || (__wsLogCnt % 10) === 0) {
    console.log("[WS]", type, msg);
  }
}

function setKpi(ageMs, hz, seq){
  const el = qs("diag-analog-kpi");
  if (!el) return;
  const age = (typeof ageMs === "number") ? ageMs : null;
  const hzTxt  = (typeof hz === "number") ? hz.toFixed(2) : "?";
  const seqTxt = (typeof seq === "number") ? seq : "?";
  const ageTxt = (age === null) ? "?" : age;
  el.textContent = `Analog: ${hzTxt} Hz · age ${ageTxt} ms · seq ${seqTxt}`;
  el.classList.remove("kpi-ok","kpi-warn","kpi-err");
  if (age === null) el.classList.add("kpi-warn");
  else if (age <= 800) el.classList.add("kpi-ok");
  else if (age <= 2000) el.classList.add("kpi-warn");
  else el.classList.add("kpi-err");
}

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

function qs(id){ return document.getElementById(id); }
function setStatus(t){ const el=qs("diag-status"); if(el) el.textContent=t; }

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

function fmtV10(raw){
  if (typeof raw !== "number") return "–";
  if (raw >= 65000) return `— (${raw})`;
  return `${(raw/10).toFixed(1)} V (${raw})`;
}

function fmt01(v){
  return v ? "1" : "0";
}

function setKpi(ageMs, hz, seq){
  const el = qs("diag-analog-kpi");
  if (!el) return;

  // ageMs kann fehlen/undefiniert sein
  const age = (typeof ageMs === "number") ? ageMs : null;
  const hzTxt  = (typeof hz === "number") ? hz.toFixed(2) : "?";
  const seqTxt = (typeof seq === "number") ? seq : "?";
  const ageTxt = (age === null) ? "?" : age;

  el.textContent = `Analog: ${hzTxt} Hz · age ${ageTxt} ms · seq ${seqTxt}`;

  // Ampel: <800ms ok, <2000ms warn, sonst err
  el.classList.remove("kpi-ok","kpi-warn","kpi-err");
  if (age === null) {
    el.classList.add("kpi-warn");
  } else if (age <= 800) {
    el.classList.add("kpi-ok");
  } else if (age <= 2000) {
    el.classList.add("kpi-warn");
  } else {
    el.classList.add("kpi-err");
  }
}

function setAnalogTable(a){
  // a ist das "analog"-Objekt: {vA10,vB10,i_mA:[...]} oder ähnlich
  const vA10 = qs("an-vA10");
  const vB10 = qs("an-vB10");
  const imA  = qs("an-imA");
  if (vA10) vA10.textContent = (a && typeof a.vA10 === "number") ? fmtV10(a.vA10) : "–";
  if (vB10) vB10.textContent = (a && typeof a.vB10 === "number") ? fmtV10(a.vB10) : "–";

  // i_mA[] formatiert
  if (imA) {
    let arr = null;
    if (a && Array.isArray(a.i_mA)) arr = a.i_mA;
    if (arr) {
      const parts = arr.map((v, i) => `${i}:${v}`);
      imA.textContent = parts.join("  ");
    } else {
      imA.textContent = "–";
    }
  }
}

function wsSend(obj){
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify(obj));
}

function startHeartbeat(){
  stopHeartbeat();
  hbTimer = setInterval(() => {
    if (token) wsSend({ action:"diagHeartbeat", token });
  }, 2000);
}
function stopHeartbeat(){
  if (hbTimer) { clearInterval(hbTimer); hbTimer=null; }
}

function connect(){
  const proto = (location.protocol === "https:") ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    statusModel.wsUp = true;
    renderStatus();
    wsSend({ action:"subscribe", base:true, diag:true });
  };

  ws.onclose = () => {
    statusModel.wsUp = false;
    setDiagStatus("");
    setWarnStatus("");
    renderStatus();
    stopHeartbeat();
    token = null;
    qs("diag-exit").disabled = true;
    qs("diag-enter").disabled = false;
  };

  ws.onmessage = (ev) => {
    let msg = null;
    try { msg = JSON.parse(ev.data); } catch(e) { return; }
    wsLog(msg && msg.type ? msg.type : "?", msg);

    // Diag stream (separater Payload-Typ)
    if (msg.type === "diag") {
      lastDiag = msg;
      const pre = qs("diag-json");
      if (pre) pre.textContent = JSON.stringify(msg, null, 2);
      
      // KPI aus mega2.analog
      const a = msg?.mega2?.analog;
      if (a) setKpi(a.ageMs, a.hz, a.seq);
      return;
    }

    // Analog fast stream (base subscription): Spannungen/Ströme
    if (msg.type === "analog") {
      lastAnalog = msg;
      // shape: { type:"analog", analog:{...} }
      const a = msg.analog || msg?.mega2?.analog || null;
      if (a) setAnalogTable(a);

      // wenn diag schon da ist, KPI beibehalten; sonst evtl. nur seq zeigen
      if (!lastDiag && a) setKpi(null, null, a.seq);
      return;
    }

    if (msg.type === "state") {
      renderBlocksFromState(msg);

      // Lease verloren (Timeout / Disconnect)
      if (msg.diagCtrl && !msg.diagCtrl.active) {
        token = null;
        stopHeartbeat();
        qs("diag-exit").disabled = true;
        qs("diag-enter").disabled = false;
        setDiagStatus("Diagnose inaktiv");
      }
      return;
    }

    if (msg.type === "diagControl") {
      if (msg.isOwner && msg.token) {
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

    if (msg.type === "error" && msg.code === "DIAG_ACTIVE") {
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
    // kurz warten ist nicht nötig; du kannst sofort zurück
    window.location.href = "index.htm";
  });

  connect();
});
