/* =========================================================
 *  Eisenbahn WebUI – Safety & Status
 * ========================================================= */

const DEBUG_WS = false;
const DEBUG_UI = false;

if (DEBUG_UI) console.log("script.js loaded");

let socket = null;
let wsConnected = false;
let lastSafetyState = null;

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
        if (DEBUG_WS) console.log("[WS RAW]", event.data);

        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch (e) {
            console.error("JSON parse error", e);
            return;
        }

        handleWsMessage(msg);
    };
}

/* =========================================================
 *  WS DISPATCH
 * ========================================================= */

function handleWsMessage(msg) {
    if (DEBUG_WS) console.log("[WS MSG]", msg);
    if (!msg || msg.type !== "state") return;

    lastSafetyState = msg.safety || null;

    const uiState = getUiStateFromSafety(lastSafetyState);
    applyUiState(uiState);
}

/* =========================================================
 *  UI APPLY
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

    // Power nur erlauben, wenn Safety NICHT locked
    updatePowerButton(ui.locked === true);
}

/* =========================================================
 *  COMMANDS
 * ========================================================= */

function sendNothalt() {
    sendAction("nothalt");
}

function sendPowerOn() {
    if (lastSafetyState && lastSafetyState.lock === true) {
        showOverlay(
            "Power On nicht möglich",
            ["Safety-Lock aktiv"],
            false
        );
        return;
    }
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
    if (!btn) return;
    btn.disabled = disabled;
    btn.classList.toggle("disabled", disabled);
}

/* =========================================================
 *  SAFETY → UI STATE
 * ========================================================= */

function getUiStateFromSafety(safety) {
    if (!safety) {
        return {
            level: "OK",
            overlay: false,
            ackRequired: false,
            locked: false,
            title: "",
            text: []
        };
    }

    if (safety.lock === true) {
        return {
            level: "EMERGENCY",
            overlay: true,
            ackRequired: true,
            locked: true,
            title: "NOT-AUS – Anlage gestoppt",
            text: safety.text
                ? [safety.text]
                : ["Sicherheitsabschaltung aktiv"]
        };
    }

    return {
        level: "OK",
        overlay: false,
        ackRequired: false,
        locked: false,
        title: "",
        text: []
    };
}

/* =========================================================
 *  LOG WINDOW
 * ========================================================= */

function log(msg) {
    const win = document.getElementById("log-window");
    if (!win) return;
    const d = document.createElement("div");
    d.textContent = msg;
    win.appendChild(d);
}
