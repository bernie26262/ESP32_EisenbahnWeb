// safety_ui_texts.js
// Enthält ausschließlich UI-Texte & Darstellung
// KEINE Logik, KEINE imports

window.safetyUiMap = {
    "EMERG_ESTOP_CHAIN_OPEN": {
        level: "EMERGENCY",
        color: "red",
        icon: "stop",
        overlay: true,
        ackRequired: true,
        title: "NOT-AUS – Anlage gestoppt",
        text: [
            "Der Not-Halt wurde ausgelöst.",
            "",
            "Bitte Ursache prüfen, Not-Halt entriegeln",
            "und anschließend bestätigen (ACK)."
        ]
    },

    "EMERG_WEICHENFEHLER_SBHF": {
        level: "EMERGENCY",
        color: "red",
        icon: "stop",
        overlay: true,
        ackRequired: true,
        title: "NOT-AUS – Anlage gestoppt",
        text: [
            "Weichenfehler im Schattenbahnhof.",
            "",
            "Weiche {x} hat nicht korrekt geschaltet.",
            "Bitte Weiche und Fahrzeuge prüfen.",
            "Nach Bestätigung (ACK) wird ein erneuter Schaltversuch durchgeführt."
        ]
    },

    "EMERG_DOPPELTE_BLOCKBELEGUNG_BLOCK_x": {
        level: "EMERGENCY",
        color: "red",
        icon: "stop",
        overlay: true,
        ackRequired: true,
        title: "NOT-AUS – Anlage gestoppt",
        text: [
            "Mögliche Doppelbelegung in Block {x} erkannt.",
            "",
            "Ein Zug ist trotz gesperrter Zufahrt in den Block gefahren.",
            "Bitte Block prüfen und gegebenenfalls einen Zug entfernen.",
            "Bitte langsamer fahren.",
            "",
            "Danach bestätigen (ACK)."
        ]
    },

    "WARN_BAHNHOFSDURCHFAHRT": {
        level: "WARNING",
        color: "yellow",
        icon: "warning",
        overlay: false,
        ackRequired: false,
        title: "Warnung",
        text: [
            "Bahnhofsdurchfahrt erkannt.",
            "",
            "Ein Zug ist über ein abgeschaltetes Bahnhofsgleis hinweg gefahren.",
            "Bitte langsamer fahren."
        ]
    }
};
