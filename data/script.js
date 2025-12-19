/* =========================================================
 *  Eisenbahn WebUI – Safety & Status
 * ========================================================= */

let socket = null;
let wsConnected = false;

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

    socket.onmessage = (event) => {
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch {
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

    window.lastSafetyState = msg.safety || null;

    const uiState = getUiStateFromSafetyState(window.lastSafetyState);
    applyUiState(uiState);
}

/* =========================================================
 *  UI-STATE → UI
 * ========================================================= */

function applyUiState(ui) {
    const panel  = document.getElementById("safety-panel");
    const status = document.getElementById("safety-status");

    if (!panel || !status) return;

    panel.className = "safety-panel " + ui.level.toLowerCase();
    status.textContent = ui.text[0] || "";

    if (ui.overlay) {
        showOverlay(ui.title, ui.text, ui.ackRequired);
    } else {
        hideOverlay();
    }

    updatePowerButton(ui.level === "EMERGENCY");
}

/* =========================================================
 *  COMMANDS
 * ========================================================= */

function sendNothalt() {
    sendAction("nothalt");
}

function sendPowerOn() {
    sendAction("powerOn");
}

function confirmAck() {
    sendAction("safetyAck");
}

function sendAction(action) {
    if (!socket || !wsConnected) return;
    socket.send(JSON.stringify({ action }));
}

/* =========================================================
 *  OVERLAY
 * ========================================================= */

function showOverlay(title, lines, ackRequired) {
    document.getElementById("ack-title").textContent = title;
    document.getElementById("ack-text").innerHTML =
        lines.map(l => `<div>${l}</div>`).join("");

    document.getElementById("ack-confirm-btn").disabled = !ackRequired;
    document.getElementById("ack-overlay").classList.remove("hidden");
}

function hideOverlay() {
    document.getElementById("ack-overlay").classList.add("hidden");
}

/* =========================================================
 *  POWER
 * ========================================================= */

function updatePowerButton(disabled) {
    const btn = document.getElementById("btn-power");
    btn.disabled = disabled;
    btn.classList.toggle("disabled", disabled);
}

/* =========================================================
 *  SAFETY → UI STATE
 * ========================================================= */

function getUiStateFromSafetyState(safetyState) {
    if (!safetyState || !safetyState.reason) {
        return {
            level: "OK",
            overlay: false,
            ackRequired: false,
            title: "",
            text: []
        };
    }

    const mapping = window.safetyUiMap[safetyState.reason];

    if (!mapping) {
        return {
            level: "EMERGENCY",
            overlay: true,
            ackRequired: true,
            title: "NOT-AUS – Anlage gestoppt",
            text: ["Unbekannter Sicherheitszustand."]
        };
    }

    return {
        level: mapping.level,
        overlay: mapping.overlay && safetyState.lock === true,
        ackRequired: mapping.ackRequired && safetyState.lock === true,
        title: mapping.title,
        text: applyTextArgs(mapping.text, safetyState.textArgs)
    };
}

function applyTextArgs(lines, args = {}) {
    return lines.map(l => {
        let out = l;
        for (const k in args) {
            out = out.replaceAll(`{${k}}`, args[k]);
        }
        return out;
    });
}

/* =========================================================
 *  LOG
 * ========================================================= */

function log(msg) {
    const win = document.getElementById("log-window");
    if (!win) return;
    const d = document.createElement("div");
    d.textContent = msg;
    win.appendChild(d);
}
