let ws;

// -------------------------------------------------
// API Polling (WLAN)
// -------------------------------------------------
function updateWifiStatus() {
    fetch("/api/status")
        .then(r => r.json())
        .then(data => {
            document.getElementById("wifiStatus").textContent =
                data.wifi ? "Verbunden" : "Getrennt";

            document.getElementById("wifiIp").textContent =
                data.ip || "–";
        });
}

// -------------------------------------------------
// API Polling (Mega-Status)
// -------------------------------------------------
function updateMegaStatus() {
    fetch("/api/mega/status")
        .then(r => r.json())
        .then(data => {

            document.getElementById("megaConn").textContent =
                data.connected ? "Verbunden" : "Getrennt";

            document.getElementById("megaUpdate").textContent =
                data.lastUpdate ? data.lastUpdate + " ms" : "–";

            // Rohdaten anzeigen
            document.getElementById("megaRaw").textContent =
                data.data && data.data.length > 0 ? data.data : "(leer)";
        });
}

// -------------------------------------------------
// WebSocket Live Updates
// -------------------------------------------------
function initWebSocket() {
    ws = new WebSocket(`ws://${location.host}/ws`);

    ws.onopen = () => console.log("WebSocket verbunden.");

    ws.onclose = () => {
        console.log("WebSocket getrennt, retry in 1s...");
        setTimeout(initWebSocket, 1000);
    };

    ws.onmessage = (event) => {
        let msg = JSON.parse(event.data);

        // WiFi-Update?
        if (msg.type === "status") {
            document.getElementById("wifiStatus").textContent =
                msg.wifi ? "Verbunden" : "Getrennt";

            document.getElementById("wifiIp").textContent =
                msg.ip || "–";
        }

        // Mega-Update?
        if (msg.type === "megaStatus") {
            document.getElementById("megaConn").textContent =
                msg.connected ? "Verbunden" : "Getrennt";

            document.getElementById("megaUpdate").textContent =
                msg.lastUpdate + " ms";

            document.getElementById("megaRaw").textContent =
                msg.raw && msg.raw.length > 0 ? msg.raw : "(leer)";
        }
    };
}

// -------------------------------------------------
// Startintervall
// -------------------------------------------------
setInterval(updateWifiStatus, 3000);
setInterval(updateMegaStatus, 3000);

updateWifiStatus();
updateMegaStatus();
initWebSocket();
