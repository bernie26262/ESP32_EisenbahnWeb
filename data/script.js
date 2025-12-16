let socket;

let SIMULATION = localStorage.getItem("SIMULATION") === "true";

const IMG_PATH = "img/";

const weichenTypen = [
    "Linksweiche","Rechtsweiche","Kreuzweiche","Kreuzweiche",
    "Kreuzweiche","Rechtsweiche","Linksweiche","Rechtsweiche",
    "Linksweiche","Rechtsweiche","Rechtsweiche","Rechtsweiche"
];

let simState = {
    weichen: Array(12).fill(0),
    strom: Array(4).fill(2)
};

window.addEventListener("load", () => {
    if (!SIMULATION) initWebSocket();
    else {
        showWarning("Simulation aktiv – Mega1 wird ignoriert.");
        updateUI(simState);
    }
    initSimUI();
});

/* ========================== SIMULATION SWITCH ========================== */

function initSimUI() {
    const toggle = document.getElementById("sim-toggle");
    toggle.checked = SIMULATION;
    updateSimLabel();
    applySimVisuals();

    toggle.addEventListener("change", () => {
        SIMULATION = toggle.checked;
        localStorage.setItem("SIMULATION", SIMULATION);

        if (SIMULATION) {
            if (socket) socket.close();
            showWarning("Simulation aktiv – Mega1 wird ignoriert.");
            updateUI(simState);
            log("[SIM] aktiviert");
        } else {
            hideWarning();
            initWebSocket();
            log("[SIM] deaktiviert – Realbetrieb");
        }

        updateSimLabel();
        applySimVisuals();
    });
}

function updateSimLabel() {
    document.getElementById("sim-label").textContent =
        SIMULATION ? "Simulation" : "Realbetrieb";

    document.getElementById("title").textContent =
        SIMULATION ? "Eisenbahn Steuerung (SIMULATION)" : "Eisenbahn Steuerung";
}

/* Farbmodus an/aus */
function applySimVisuals() {
    if (SIMULATION)
        document.body.classList.add("sim-mode");
    else
        document.body.classList.remove("sim-mode");
}

/* ========================== WEBSOCKET ========================== */

function initWebSocket() {
    socket = new WebSocket(`ws://${location.hostname}/ws`);

    socket.onopen = () => {
        log("WebSocket verbunden");
    };

    socket.onclose = () => {
        log("WebSocket getrennt");
        setTimeout(initWebSocket, 1500);
    };

    socket.onmessage = (event) => {
        if (SIMULATION) return;
        updateUI(JSON.parse(event.data));
    };
}

/* ========================== WEICHEN ========================== */

function toggleWeiche(i) {
    if (SIMULATION) {
        simState.weichen[i] ^= 1;
        updateUI(simState);
        log(`[SIM] W${i} → ${simState.weichen[i] ? "Abzweig" : "Gerade"}`);
        return;
    }

    socket.send(JSON.stringify({ cmd: "weiche", index: i }));
}

function toggleBahnhof(i) {
    if (SIMULATION) {
        simState.strom[i] = simState.strom[i] ? 0 : 1;
        updateUI(simState);
        log(`[SIM] B${i} strom=${simState.strom[i]}`);
        return;
    }

    socket.send(JSON.stringify({ cmd: "bahnhof", index: i }));
}

/* ========================== UI UPDATE ========================== */

function updateUI(d) {
    if (d.weichen) {
        for (let i = 0; i < d.weichen.length; i++) {
            const img = document.getElementById("weiche-img-" + i);
            const txt = document.getElementById("weiche-txt-" + i);
            img.src = `${IMG_PATH}${weichenTypen[i]}_${d.weichen[i] ? "Abzweig" : "gerade"}.png`;
            txt.textContent = d.weichen[i] ? "Abzweig" : "Gerade";
        }
    }

    const signalImages = {
        1: IMG_PATH + "Signal_gruen.png",
        0: IMG_PATH + "Signal_rot.png",
        2: IMG_PATH + "Signal_aus.png"
    };

    if (d.strom) {
        for (let i = 0; i < d.strom.length; i++) {
            document.getElementById("signal-img-" + i).src = signalImages[d.strom[i]];
        }
    }
}

/* ========================== WARNING ========================== */

function showWarning(msg) {
    const w = document.getElementById("mega-warning");
    w.textContent = "⚠ " + msg;
    w.classList.remove("hidden");
}

function hideWarning() {
    document.getElementById("mega-warning").classList.add("hidden");
}

/* ========================== LOG ========================== */

function log(msg) {
    const win = document.getElementById("log-window");
    const t = document.createElement("div");
    t.textContent = msg;
    win.appendChild(t);
    win.scrollTop = win.scrollHeight;
}
