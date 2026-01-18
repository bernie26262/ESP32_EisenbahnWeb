// safety_ui_texts.js
// Enthält ausschließlich UI-Texte & Darstellung
// KEINE Logik, KEINE imports
// (Achtung: Diese Datei wird via index.htm geladen; UploadFS + Hard Reload nötig)

window.safetyUiMap = {

    "GENERIC_SAFETY_ACTIVE": {
        level: "EMERGENCY",
        color: "red",
        icon: "alert",
        overlay: true,
        ackRequired: true,
        title: "Sicherheitsquittierung",
        text: [
            "Safety aktiv – Bedienung gesperrt."
        ]
    },

    // ------------------------------------------------------------
    // Startup-Checklist: Abschluss / ACK innerhalb der Checklist
    // ------------------------------------------------------------
    "STARTUP_READY_TO_ACK": {
        level: "WARNING",
        color: "yellow",
        icon: "info",
        overlay: true,
        ackRequired: false,
        title: "",
        text: [
            "System betriebsbereit? Bitte quittieren."
        ]
    },
    "STARTUP_ACK_BUTTON": {
        level: "WARNING",
        color: "yellow",
        icon: "info",
        overlay: true,
        ackRequired: false,
        title: "",
        text: [
            "Quittieren"
        ]
    },
    
    // ------------------------------------------------------------
    // Startup-Checklist: Labels / States (UI-only)
    // ------------------------------------------------------------
    "STARTUP_CHECKLIST_TITLE": {
        level: "INFO",
        color: "blue",
        icon: "info",
        overlay: true,
        ackRequired: false,
        title: "",
        text: ["Checkliste"]
    },
    "STARTUP_M2_TITLE": { level:"INFO", color:"blue", icon:"info", overlay:true, ackRequired:false, title:"", text:["SBHF-Weichen Selftest (Mega2)"] },
    "STARTUP_M2_BTN":   { level:"INFO", color:"blue", icon:"info", overlay:true, ackRequired:false, title:"", text:["SBHF Selftest starten"] },
    "STARTUP_M2_SKIP_BTN_ON": {
        level: "INFO",
        color: "blue",
        icon: "info",
        overlay: true,
        ackRequired: false,
        title: "",
        text: ["SBHF Selftest überspringen (SIM)"]
    },
    "STARTUP_M2_SKIP_BTN_OFF": {
        level: "INFO",
        color: "blue",
        icon: "info",
        overlay: true,
        ackRequired: false,
        title: "",
        text: ["SBHF Selftest-Step wieder aktivieren (SIM)"]
    },
    "STARTUP_SIM_HINT": {
        level: "INFO",
        color: "blue",
        icon: "info",
        overlay: true,
        ackRequired: false,
        title: "",
        text: ["SIM: Ohne Hardware kannst du den SBHF-Selftest-Step überspringen."]
    },
    "STARTUP_M1_TITLE": { level:"INFO", color:"blue", icon:"info", overlay:true, ackRequired:false, title:"", text:["Weichen Selftest (Mega1)"] },
    "STARTUP_M1_RETRY_BTN": {
        level: "INFO",
        color: "blue",
        icon: "info",
        overlay: true,
        ackRequired: false,
        title: "",
        text: ["Mega1 Selftest erneut"]
    },
    "STARTUP_M1_FAIL_LIST": {
        level: "WARNING",
        color: "yellow",
        icon: "warning",
        overlay: true,
        ackRequired: false,
        title: "",
        // {x} wird ersetzt durch z.B. "W1, W2, W5"
        text: ["Defekte Weichen: {x}"]
    },

    "STARTUP_STATE_OPEN":         { level:"INFO", color:"blue", icon:"info", overlay:true, ackRequired:false, title:"", text:["offen"] },
    "STARTUP_STATE_RUNNING":      { level:"INFO", color:"blue", icon:"info", overlay:true, ackRequired:false, title:"", text:["läuft…{x}"] },
    "STARTUP_STATE_DONE":         { level:"INFO", color:"blue", icon:"info", overlay:true, ackRequired:false, title:"", text:["erledigt"] },
    "STARTUP_STATE_NOT_REQUIRED": { level:"INFO", color:"blue", icon:"info", overlay:true, ackRequired:false, title:"", text:["nicht erforderlich"] },
    "STARTUP_STATE_FAILMASK":     { level:"INFO", color:"blue", icon:"info", overlay:true, ackRequired:false, title:"", text:["fehlgeschlagen (Maske {x})"] },

    "STARTUP_M1_BTN_AUTO":         { level:"INFO", color:"blue", icon:"info", overlay:true, ackRequired:false, title:"", text:["Mega1 Selftest läuft/auto"] },
    "STARTUP_M1_BTN_NOT_REQUIRED": { level:"INFO", color:"blue", icon:"info", overlay:true, ackRequired:false, title:"", text:["nicht erforderlich"] },
    "STARTUP_M1_BTN_DISABLED": {
        level: "INFO",
        color: "blue",
        icon: "info",
        overlay: true,
        ackRequired: false,
        title: "",
        text: ["Mega1 Selftest (kommt später)"]
    },
   


    "INFO_SBHF_SELFTEST_RUNNING": {
    level: "INFO",
    color: "blue",
    icon: "info",
    overlay: true,
    ackRequired: false,
    title: "SBHF Weichentest läuft",
    text: [
      "Bitte warten …",
      "Der Selbsttest läuft im Hintergrund",
      "und wird automatisch abgeschlossen."
    ]
  },

  "INFO_SELFTEST_POWER_STAYS_OFF": {
    level: "INFO",
    color: "blue",
    icon: "info",
    overlay: false,
    ackRequired: false,
    title: "SBHF",
    text: [
      "Selftest beendet – Power bleibt aus, bitte manuell einschalten."
    ]
  },

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
    
    "EMERG_BLOCK_SHORT": {
        level: "EMERGENCY",
        color: "red",
        icon: "alert",
        overlay: true,
        ackRequired: true,
        title: "Not-Aus – Kurzschluss / Überstrom",
        text: [
            "Kurzschluss oder Überstrom erkannt: {x}.",
            "",
            "Anlage wurde abgeschaltet.",
            "Ursache prüfen (Verdrahtung, Fahrzeug, Weiche, Block).",
            "Nach Beseitigung: ACK."
        ]
    },

    "EMERG_SSR_STUCK": {
        level: "EMERGENCY",
        color: "red",
        icon: "alert",
        overlay: true,
        ackRequired: true,
        title: "Not-Aus – SSR hängt",
        text: [
            "Ein SSR scheint eingeschaltet zu bleiben ({x}).",
            "",
            "Anlage wurde abgeschaltet.",
            "Hardware prüfen (Relais/SSR, Verdrahtung, Trafo).",
            "Nach Beseitigung: ACK."
        ]
    },

    "EMERG_DOUBLE_OCCUPANCY": {
        level: "EMERGENCY",
        color: "red",
        icon: "alert",
        overlay: true,
        ackRequired: true,
        title: "Doppelte Blockbelegung",
        text: [
            "Doppelte Belegung erkannt: {x}.",
            "",
            "Anlage wurde abgeschaltet.",
            "Ursache prüfen; Quittierung erst möglich, wenn die Ursache weg ist",
            "(z.B. Override aus / Strom ~0 mA).",
            "Nach Beseitigung: ACK."
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
    },

    // ------------------------------------------------------------
    // SBHF Warnings/Info (rechte Meldungsliste)
    // ------------------------------------------------------------
    "INFO_SBHF_ALLOWED_TRACKS": {
        level: "INFO",
        color: "blue",
        icon: "info",
        overlay: false,
        ackRequired: false,
        title: "SBHF",
        text: ["SBHF erlaubte Gleise: {x}"]
    },
    "WARN_SBHF_NO_SAFE_PATH": {
        level: "WARNING",
        color: "yellow",
        icon: "warning",
        overlay: false,
        ackRequired: false,
        title: "SBHF",
        text: ["SBHF gesperrt (kein sicherer Pfad)"]
    },
    "WARN_SBHF_RESTRICTED_MODE": {
        level: "WARNING",
        color: "yellow",
        icon: "warning",
        overlay: false,
        ackRequired: false,
        title: "SBHF",
        text: ["SBHF: Restricted Mode aktiv"]
    },
    "WARN_W12_DEFECT": { level:"WARNING", color:"yellow", icon:"warning", overlay:false, ackRequired:false, title:"SBHF", text:["W12 defekt"] },
    "WARN_W13_DEFECT": { level:"WARNING", color:"yellow", icon:"warning", overlay:false, ackRequired:false, title:"SBHF", text:["W13 defekt"] },
    "INFO_W14_ISSUE":  { level:"INFO",    color:"blue",   icon:"info",    overlay:false, ackRequired:false, title:"SBHF", text:["W14 Störung"] },
    "INFO_W15_ISSUE":  { level:"INFO",    color:"blue",   icon:"info",    overlay:false, ackRequired:false, title:"SBHF", text:["W15 Störung"] },
    "WARN_SBH_SERVICE_REQUIRED": { level:"WARNING", color:"yellow", icon:"warning", overlay:false, ackRequired:false, title:"SBHF", text:["Service erforderlich"] },

    // ------------------------------------------------------------
    // Mega1 Weichen-Selbsttest (rechte Meldungsliste)
    // ------------------------------------------------------------
    "WARN_M1_TURNOUTS_DEFECT_LIST": {
        level: "WARNING",
        color: "yellow",
        icon: "warning",
        overlay: false,
        ackRequired: false,
        title: "Mega1",
        text: ["Defekte Weichen: {x}"]
    }
};

// Alias: interne Map für fromCodes()
const SAFETY_TEXTS = window.safetyUiMap;



// ---------------------------------------------------------------------------
// Numeric errorType/errorIndex support (ESP sends codes to keep WS payload small)
// ---------------------------------------------------------------------------
// Mega2 safety_error.h (errType):
// 0=NONE, 1=NOTAUS, 2=BLOCK_SHORT, 3=SBH_WEICHE, 4=SSR_STUCK, 5=DOUBLE_OCC (patched)
// If your enums differ, adjust this mapping.
const SAFETY_ERRTYPE_TO_KEY = {
  0: null,
  1: "EMERG_ESTOP_CHAIN_OPEN",
  2: "EMERG_BLOCK_SHORT",
  3: "EMERG_WEICHENFEHLER_SBHF",
  4: "EMERG_SSR_STUCK",
  5: "EMERG_DOUBLE_OCCUPANCY",
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


// Direct lookup by key (INFO/WARN overlays etc.)
// Returns { title, lines[] } or null
window.SAFETY_UI_TEXTS.fromKey = function(key) {
  const def = window.safetyUiMap?.[key];
  if (!def) return null;
  return {
    title: def.title || "",
    lines: Array.isArray(def.text) ? def.text.slice() : []
  };
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

  // idx formatting: for block-related errors, show "Block B<idx>" (Mega2 prints B%d)
  let idxFmt = idx;
  if (key === "EMERG_BLOCK_SHORT" || key === "EMERG_DOUBLE_OCCUPANCY") {
    idxFmt = `Block B${idx}`;
  } else if (key === "EMERG_SSR_STUCK") {
    idxFmt = (idx === 0 ? "A" : "B");
  }

  return {
    title: def.title || "Safety aktiv",
    lines: _fmtLines(def.text || [], idxFmt),
  };
};



