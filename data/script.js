/* =========================================================
 *  Eisenbahn WebUI – Safety & Status (D3)
 * ========================================================= */

let socket = null;
let wsConnected = false;
let ackSnoozeUntil = 0;   // Zeitstempel (ms), bis wann Overlay unterdrückt wird

/* =========================================================
 *  INIT
 * ========================================================= */

window.addEventListener("load", () => {
    initWebSocket();
});

/* =========================================================
 *  WEBSOCKET
 * ========================================================= */

function initWebSocket() {
    const proto = location.protocol === "https:" ? "wss://" : "ws://";
    const url = proto + location.host + "/ws";

    log(`[WS] connect ${url}`);
    socket = new WebSocket(url);

    socket.onopen = () => {
        wsConnected = true;
        log("[WS] verbunden");
    };

    socket.onclose = () => {
        wsConnected = false;
        log("[WS] getrennt – Reconnect in 2s");
        setTimeout(initWebSocket, 2000);
    };

    socket.onerror = (e) => {
        console.warn("[WS] error", e);
    };

    socket.onmessage = (event) => {
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch {
            console.warn("[WS] invalid JSON", event.data);
            return;
        }
        handleWsMessage(msg);
    };
}

/* =========================================================
 *  WS DISPATCH
 * ========================================================= */

function handleWsMessage(msg) {
    if (!msg || msg.type !== "state") return;

    // 🔴 letzten Safety-Zustand merken
    window.lastSafetyState = msg.safety;

    updateSafetyUI(msg.safety, msg.mega2);
}


/* =========================================================
 *  SAFETY UI
 * ========================================================= */

function updateSafetyUI(safety, mega2) {
    const panel  = document.getElementById("safety-panel");
    const status = document.getElementById("safety-status");

    if (!panel || !status) return;

    if (window.lastSafetyState && window.lastSafetyState.lock === true) {
        showAckOverlay(
            window.lastSafetyState.text || "Sicherheitsfehler aktiv"
        );
    return;
}


    // Mega2 offline
    if (mega2 && mega2.online === false) {
        panel.className = "safety-panel warning";
        status.textContent = "⚠ Mega2 offline";
        hideAckOverlay();
        return;
    }

    // System OK
    if (!safety || safety.lock !== true) {
        panel.className = "safety-panel ok";
        status.textContent = "🟢 System OK";
        hideAckOverlay();
        return;
    }

    // 🔴 Safety Lock aktiv
    panel.className = "safety-panel error";

    const text = safety.text && safety.text.length > 0
        ? safety.text
        : "Safety aktiv";

    status.textContent = `🔴 ${text}`;

    // 🔴 NEU: ACK über Overlay erzwingen
    showAckOverlay(text);
}


/* =========================================================
 *  COMMANDS
 * ========================================================= */

function sendNothalt() {
    sendAction("nothalt", "NOTHALT gesendet");
}

function sendPowerOn() {
    // Safety aktiv?
    if (window.lastSafetyState && window.lastSafetyState.lock === true) {
        showAckOverlay(
            window.lastSafetyState.text ||
            "Power On nicht möglich – Safety aktiv"
        );
        return;
    }

    sendAction("powerOn", "POWER ON gesendet");
}

function ackSafety() {
    sendAction("safetyAck", "ACK gesendet");
}

function sendAction(action, logText) {
    if (!socket || !wsConnected) {
        log("⚠ WebSocket nicht verbunden");
        return;
    }

    socket.send(JSON.stringify({ action }));
    log(`➡ ${logText}`);
}

/* =========================================================
 *  LOG
 * ========================================================= */

function log(msg) {
    const win = document.getElementById("log-window");
    if (!win) return;

    const line = document.createElement("div");
    line.textContent = msg;
    win.appendChild(line);
    win.scrollTop = win.scrollHeight;
}

function showAckOverlay(text) {
    
    const checkbox = document.getElementById("ack-confirm-checkbox");
    const confirmText = document.getElementById("ack-confirm-text");
    if (checkbox) checkbox.checked = false;

    if (confirmText && window.lastSafetyState) {
        confirmText.textContent =
            buildAckConfirmText(window.lastSafetyState);
    }

    const ackBtn = document.getElementById("ack-confirm-btn");
    if (ackBtn) ackBtn.disabled = true;

    
    // Snooze aktiv?
    if (Date.now() < ackSnoozeUntil) {
        return;
    }

    const overlay = document.getElementById("ack-overlay");
    const txt = document.getElementById("ack-text");

    if (!overlay || !txt) return;

    txt.textContent = text || "Sicherheitsfehler aktiv";
    overlay.classList.remove("hidden");
}


function hideAckOverlay() {
    const overlay = document.getElementById("ack-overlay");
    if (!overlay) return;

    // 🔕 Snooze: 15 Sekunden
    ackSnoozeUntil = Date.now() + 15000;

    overlay.classList.add("hidden");
}


function confirmAck() {
    const checkbox = document.getElementById("ack-confirm-checkbox");

    if (!checkbox || checkbox.checked !== true) {
        alert("Bitte bestätigen Sie, dass der Fehler vor Ort behoben wurde.");
        return;
    }

    hideAckOverlay();
    ackSafety();
    log("[ACK] Bediener bestätigt: Fehler vor Ort behoben");
}

document.addEventListener("change", (e) => {
    if (e.target.id === "ack-confirm-checkbox") {
        const ackBtn = document.getElementById("ack-confirm-btn");
        if (ackBtn) {
            ackBtn.disabled = !e.target.checked;
        }
    }
});

function buildAckConfirmText(safety) {
    if (!safety) {
        return "Fehler vor Ort geprüft und behoben";
    }

    switch (safety.errorType) {
        case 1: // NOTHALT
            return "Nothalt vor Ort geprüft und Ursache beseitigt";

        case 2: // Kurzschluss Block
            return `Kurzschluss in Block ${safety.errorIndex} wurde beseitigt`;

        case 3: // SBhf Weiche
            return `Fehler an Weiche ${safety.errorIndex} im Schattenbahnhof behoben`;

        default:
            return "Fehler vor Ort geprüft und behoben";
    }
}

