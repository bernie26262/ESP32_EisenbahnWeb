let ws = null;

// -----------------------------------------------------------------------------
// WebSocket initialisieren
// -----------------------------------------------------------------------------
function initWebSocket() {
    ws = new WebSocket(`ws://${location.host}/ws`);

    ws.onopen = () => {
        console.log("WebSocket verbunden");
    };

    ws.onmessage = (event) => {
        console.log("WS:", event.data);

        try {
            const msg = JSON.parse(event.data);

            if (msg.type === "status") {
                updateStatusUI(msg.wifi, msg.ip);
            }
        } catch (e) {
            console.warn("Ungültige WS-Nachricht:", event.data);
        }
    };

    ws.onclose = () => {
        console.log("WebSocket getrennt – neuer Versuch in 2s...");
        setTimeout(initWebSocket, 2000);
    };
}

// -----------------------------------------------------------------------------
// API-Fallback: Status regelmäßig abfragen
// -----------------------------------------------------------------------------
function updateStatusPoll() {
    fetch("/api/status")
        .then(r => r.json())
        .then(data => {
            updateStatusUI(data.wifi, data.ip);
        })
        .catch(() => {
            updateStatusUI(false, null);
        });
}

setInterval(updateStatusPoll, 3000);
updateStatusPoll();


// -----------------------------------------------------------------------------
// UI-Update
// -----------------------------------------------------------------------------
function updateStatusUI(isConnected, ip) {
    document.getElementById("wifiStatus").textContent =
        isConnected ? "Verbunden" : "Getrennt";

    document.getElementById("wifiStatus").style.color =
        isConnected ? "#0a0" : "#c00";

    document.getElementById("ipAddress").textContent =
        isConnected && ip ? ip : "–";
}


// Start
initWebSocket();
