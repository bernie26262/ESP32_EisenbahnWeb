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

function setAnalogTable(a){
  const vA10 = qs("an-vA10");
  const vB10 = qs("an-vB10");
  const imA  = qs("an-imA");
  if (vA10) vA10.textContent = (a && typeof a.vA10 === "number") ? String(a.vA10) : "–";
  if (vB10) vB10.textContent = (a && typeof a.vB10 === "number") ? String(a.vB10) : "–";
  if (imA) {
    let arr = null;
    if (a && Array.isArray(a.i_mA)) arr = a.i_mA;
    if (arr) imA.textContent = arr.map((v,i)=>`${i}:${v}`).join("  ");
    else imA.textContent = "–";
  }
}

function qs(id){ return document.getElementById(id); }
function setStatus(t){ const el=qs("diag-status"); if(el) el.textContent=t; }

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
  if (vA10) vA10.textContent = (a && typeof a.vA10 === "number") ? String(a.vA10) : "–";
  if (vB10) vB10.textContent = (a && typeof a.vB10 === "number") ? String(a.vB10) : "–";

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
    setStatus("WS connected");
    wsSend({ action:"subscribe", base:true, diag:true });
  };

  ws.onclose = () => {
    setStatus("WS disconnected");
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
    
    // Analog stream (base subscription): Spannungen/Ströme
    if (msg.type === "analog") {
      const a = msg.analog || msg?.mega2?.analog || null;
      if (a) setAnalogTable(a);
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


    if (msg.type === "diagControl") {
      if (msg.isOwner && msg.token) {
        token = msg.token;
        qs("diag-enter").disabled = true;
        qs("diag-exit").disabled = false;
        setStatus(`Diagnose aktiv (Owner ${msg.ownerId}, Token gesetzt)`);
        startHeartbeat();
      } else {
        setStatus(`Diagnose belegt (Owner ${msg.ownerId})`);
      }
      return;
    }

    if (msg.type === "error" && msg.code === "DIAG_ACTIVE") {
      setStatus("DIAG_ACTIVE: Schreibzugriff gesperrt (du bist nicht Owner)");
      return;
    }

    if (msg.type === "state" && msg.diagCtrl) {
      // optional: Statusanzeige aktualisieren
      if (!msg.diagCtrl.active) {
        // Lease weg (timeout/disconnect) -> UI zurücksetzen
        token = null;
        stopHeartbeat();
        qs("diag-exit").disabled = true;
        qs("diag-enter").disabled = false;
        setStatus("Diagnose inaktiv");
      }
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
