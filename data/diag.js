let ws = null;
let token = null;
let hbTimer = null;

function qs(id){ return document.getElementById(id); }
function setStatus(t){ const el=qs("diag-status"); if(el) el.textContent=t; }

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
