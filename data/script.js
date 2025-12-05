let ws;

// Lokaler Cache aller Slavezustände
let slaves = {
    0: { weichenBits: 0, bhfBits: 0, mode: 0, timestamp: 0 },
    1: { weichenBits: 0, bhfBits: 0, mode: 0, timestamp: 0 },
    2: { weichenBits: 0, bhfBits: 0, mode: 0, timestamp: 0 },
    3: { weichenBits: 0, bhfBits: 0, mode: 0, timestamp: 0 }
};

// -------------------------------------------------
// Tabelle neu zeichnen
// -------------------------------------------------
function renderTable() {
    const tbody = document.getElementById("slaveTableBody");
    tbody.innerHTML = "";

    for (let sid = 0; sid < 4; sid++) {
        const st = slaves[sid];
        const row = document.createElement("tr");

        row.innerHTML = `
            <td>${sid}</td>
            <td>${st.weichenBits}</td>
            <td>${st.bhfBits}</td>
            <td>${st.mode}</td>
            <td>${st.timestamp}</td>
        `;

        tbody.appendChild(row);
    }
}

// -------------------------------------------------
// Live WebSocket Updates
// -------------------------------------------------
function initWebSocket() {
    ws = new WebSocket(`ws://${location.host}/ws`);

    ws.onopen = () => {
        console.log("WebSocket verbunden.");
        document.getElementById("ethStatus").textContent = "verbunden";
        document.getElementById("ethIp").textContent = location.host;
    };

    ws.onclose = () => {
        console.log("WebSocket getrennt → retry in 1s");
        document.getElementById("ethStatus").textContent = "getrennt";
        setTimeout(initWebSocket, 1000);
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        // Rohdaten-Liveausgabe
        document.getElementById("rawLog").textContent = JSON.stringify(msg, null, 2);

        // -------------- FULL-STATE ----------------
        if (msg.type === "state") {
            const sid = msg.slave;
            slaves[sid].weichenBits = msg.weichen.bits;
            slaves[sid].bhfBits = msg.bahnhoefe.bits;
            slaves[sid].mode = msg.mode;
            slaves[sid].timestamp = msg.timestamp;
            renderTable();
        }

        // -------------- UPDATE (DELTA) ------------
        if (msg.type === "update") {
            const sid = msg.slave;
            msg.events.forEach(ev => {
                if (ev.kind === "weiche")
                    slaves[sid].weichenBits = updateBit(slaves[sid].weichenBits, ev.id, ev.value);

                if (ev.kind === "bahnhof")
                    slaves[sid].bhfBits = updateBit(slaves[sid].bhfBits, ev.id, ev.value);

                if (ev.kind === "mode")
                    slaves[sid].mode = ev.value;

                // sensor-Events ignorieren wir im Dashboard vorerst
            });

            slaves[sid].timestamp = Date.now();
            renderTable();
        }
    };
}

// Hilfsfunktion: Bit setzen/löschen
function updateBit(bits, id, val) {
    if (val)
        return bits | (1 << id);
    else
        return bits & ~(1 << id);
}

// -------------------------------------------------
// Los geht’s
// -------------------------------------------------
renderTable();
initWebSocket();
