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

// Alias: interne Map für fromCodes()
const SAFETY_TEXTS = window.safetyUiMap;



// ---------------------------------------------------------------------------
// Numeric errorType/errorIndex support (ESP sends codes to keep WS payload small)
// ---------------------------------------------------------------------------
// Mega2 safety_error.h (errType):
// 0=NONE, 1=NOTAUS, 2=BLOCK_SHORT, 3=SBH_WEICHE, 4=SSR_STUCK (patched)
// If your enums differ, adjust this mapping.
const SAFETY_ERRTYPE_TO_KEY = {
  0: null,
  1: "EMERG_ESTOP_CHAIN_OPEN",
  2: "EMERG_BLOCK_SHORT",
  3: "EMERG_WEICHENFEHLER_SBHF",
  4: "EMERG_SSR_STUCK",
};

// Optional: block display names (used for SBhf blocks in UI)
const BLOCK_NAME = {
  7: "Block SBhf 1",
  8: "Block SBhf 2",
  9: "Block SBhf 3",
};

function _fmtLines(lines, idx) {
  if (!lines) return [];
  return lines.map(s => String(s).replaceAll("{x}", String(idx)));
}

window.SAFETY_UI_TEXTS = window.SAFETY_UI_TEXTS || {};
window.SAFETY_UI_TEXTS.blockName = function(id, fallbackPrefix="Block ") {
  const n = Number(id);
  if (BLOCK_NAME[n]) return BLOCK_NAME[n];
  return fallbackPrefix + n;
};

/**
 * Build { title, lines[] } from numeric errType/errIndex.
 * Returns null if errType is unknown.
 */
window.SAFETY_UI_TEXTS.fromCodes = function(errType, errIndex) {
  const t = Number(errType);
  const idx = Number(errIndex);

  const key = SAFETY_ERRTYPE_TO_KEY[t];
  if (!key) return null;

  // If the key isn't present in SAFETY_TEXTS yet, define a safe fallback.
  const def = (typeof SAFETY_TEXTS !== "undefined") ? SAFETY_TEXTS[key] : null;

  if (!def) {
    if (key === "EMERG_SSR_STUCK") {
      return {
        title: "Not-Aus (SSR hängt)",
        lines: _fmtLines([
          "SSR {x} ist AUS kommandiert, aber Trafo-Spannung bleibt anliegen.",
          "Hardware prüfen (Relais/SSR, Verdrahtung, Trafo).",
          "Nach Beseitigung: ACK."
        ], idx === 0 ? "A" : "B"),
      };
    }
    return { title: "Safety aktiv", lines: [] };
  }

  return {
    title: def.title || "Safety aktiv",
    lines: _fmtLines(def.text || [], idx),
  };
};

