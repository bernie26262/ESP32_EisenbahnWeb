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
     // Startup-Checklist: Haupt-Overlay Text
     // ------------------------------------------------------------
     "INFO_STARTUP_CHECKLIST": {
         level: "INFO",
         color: "blue",
         icon: "info",
         overlay: true,
         ackRequired: false,
         title: "Systemstart – Checkliste",
         text: [
             "Bitte die folgenden Punkte abarbeiten, bevor Power eingeschaltet werden kann."
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
        text: ["Mega1 Selftest nicht verfügbar"]
    },

    "STARTUP_M1_SELFTEST_LABEL": {
        level: "INFO",
        color: "blue",
        icon: "info",
        overlay: true,
        ackRequired: false,
        title: "",
        text: ["Mega1 Selftest starten"]
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
  
  "INFO_M1_SELFTEST_RUNNING": {
    level: "INFO",
    color: "blue",
    icon: "info",
    overlay: true,
    ackRequired: false,
    title: "Mega1 Weichentest läuft",
    text: [
      "Bitte warten …",
      "Der Selbsttest läuft im Hintergrund",
      "und wird automatisch abgeschlossen."
    ]
  },

  "INFO_M1_SELFTEST_POWER_STAYS_OFF": {
    level: "INFO",
    color: "blue",
    icon: "info",
    overlay: false,
    ackRequired: false,
    title: "Mega1",
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
        title: "Not-Aus",
        text: [
            "Notaus aktiv. Fahrspannung abgeschaltet.",
            "",
            "Bitte Ursache prüfen, Not-Halt entriegeln",
            "und anschließend bestätigen (ACK)."
        ]
    },

    
    "EMERG_SBH_FALSE_ENTRY": {
        level: "EMERGENCY",
        color: "red",
        icon: "stop",
        overlay: true,
        ackRequired: true,
        title: "Falschfahrt SBHF",
        text: [
            "Notaus aktiv. Fahrspannung abgeschaltet.",
            "",
            "Trafos auf 0 drehen, Zug aus dem Nothaltbereich entfernen,",
            "bestätigen und Trafos erst danach wieder einschalten."
        ]
    },

    "EMERG_SBH_ENTRY_TIMEOUT": {
        level: "EMERGENCY",
        color: "red",
        icon: "stop",
        overlay: true,
        ackRequired: true,
        title: "Timeout Einfahrt SBHF",
        text: [
            "Notaus aktiv. Fahrspannung abgeschaltet.",
            "",
            "Einfahrt in den Schattenbahnhof hat das Sollziel nicht rechtzeitig erreicht.",
            "Zuglage prüfen, Ursache beseitigen, dann bestätigen (ACK)."
        ]
    },

    "EMERG_SBH_ENTRY_WRONG_TRACK": {
        level: "EMERGENCY",
        color: "red",
        icon: "stop",
        overlay: true,
        ackRequired: true,
        title: "Einfahrt SBHF in falsches Gleis",
        text: [
            "Notaus aktiv. Fahrspannung abgeschaltet.",
            "",
            "Der Zug ist nicht in das vorgesehene SBHF-Gleis eingefahren.",
            "Weichenlage und Zugposition prüfen, dann bestätigen (ACK)."
        ]
    },

    "EMERG_SBH_EXIT_TIMEOUT": {
        level: "EMERGENCY",
        color: "red",
        icon: "stop",
        overlay: true,
        ackRequired: true,
        title: "SBHF Exit Timeout",
        text: [
            "Notaus aktiv. Fahrspannung abgeschaltet.",
            "",
            "Das aktive SBHF-Gleis {x} blieb nach der Ausfahrt zu lange belegt.",
            "Zuglage prüfen, Ursache beseitigen, dann bestätigen (ACK)."
        ]
    },

    "EMERG_CONTROLLER_FAULT": {
        level: "EMERGENCY",
        color: "red",
        icon: "alert",
        overlay: true,
        ackRequired: true,
        title: "Controller-Fehler",
        text: [
            "Notaus aktiv. Fahrspannung abgeschaltet.",
            "",
            "Interner Safety-/Controller-Fehler erkannt.",
            "Bitte bestätigen und Systemzustand prüfen."
        ]
    },

    "EMERG_SBH_CONTROLLER_FAULT": {
        level: "EMERGENCY",
        color: "red",
        icon: "alert",
        overlay: true,
        ackRequired: true,
        title: "Controller-Fehler SBHF",
        text: [
            "Notaus aktiv. Fahrspannung abgeschaltet.",
            "",
            "Interner SBHF-Ablauf-/Zustandsfehler erkannt.",
            "Bitte bestätigen und SBHF-Zustand prüfen."
        ]
    },
    "EMERG_WEICHENFEHLER_SBHF": {
        level: "EMERGENCY",
        color: "red",
        icon: "stop",
        overlay: true,
        ackRequired: true,
        title: "Weichenfehler SBHF",
        text: [
            "Notaus aktiv. Fahrspannung abgeschaltet.",
            "",
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
        title: "Kurzschluss / Überstrom",
        text: [
            "Kurzschluss oder Überstrom erkannt: {x}.",
            "",
            "Notaus aktiv. Fahrspannung abgeschaltet.",
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
        title: "Doppelbelegung",
        text: [
            "Doppelte Belegung erkannt: {x}.",
            "",
            "Notaus aktiv. Fahrspannung abgeschaltet.",
            "Ursache prüfen; Quittierung erst möglich, wenn die Ursache weg ist",
            "(z.B. Override aus / Strom ~0 mA).",
            "Nach Beseitigung: ACK."
        ]
    },


    // ------------------------------------------------------------
    // Mega1 Warning: Bahnhofsdurchfahrt trotz abgeschaltetem Stromgleis
    // Canonical key (new):
    // ------------------------------------------------------------

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


    "WARN_BAHNHOF_DURCHFAHRT": {
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
            "Bitte Ursache prüfen (Fremdeinspeisung/Verdrahtung)."
        ]
    },

    // Deprecated (kept for backward compatibility; use WARN_BAHNHOF_DURCHFAHRT)
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
            "Bitte Ursache prüfen (Fremdeinspeisung/Verdrahtung)."
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
    // Canonical Mega1 warning: Weichen schalten nicht (Soll != Ist nach Timeout)
    // Use this key in documentation / future UI messages.
    "WARN_WEICHEN_NO_SWITCH": {
        level: "WARNING",
        color: "yellow",
        icon: "warning",
        overlay: false,
        ackRequired: false,
        title: "Mega1",
        text: [
            "Mega1: Eine oder mehrere Weichen schalten nicht in die Sollstellung.",
            "Details: Defekte Weichen siehe Liste."
        ]
    },

    // Deprecated (kept for backward compatibility; use WARN_WEICHEN_NO_SWITCH)
    "WARN_WEICHEN_SLOW": {
        level: "WARNING",
        color: "yellow",
        icon: "warning",
        overlay: false,
        ackRequired: false,
        title: "Mega1",
        text: [
            "Eine oder mehrere Weichen schalten nicht in die Sollstellung.",
            "Details: Defekte Weichen siehe Liste."
        ]
    },

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
// Numeric errorCause/errorIndex support (ESP sends codes to keep WS payload small)
// Mega2 ErrorCause enum (v4):
// 0=NONE, 1=SBH_FALSE_ENTRY, 2=SBH_ENTRY_TIMEOUT, 3=SBH_ENTRY_WRONG_TRACK,
// 4=SBH_EXIT_TIMEOUT, 5=SBH_WEICHE, 6=DOUBLE_OCCUPANCY, 7=BLOCK_SHORT,
// 8=CONTROLLER_FAULT, 9=EXTERNAL_ESTOP, 10=SBH_CONTROLLER_FAULT
const SAFETY_ERRTYPE_TO_KEY = {
  0: null,
  1: "EMERG_SBH_FALSE_ENTRY",
  2: "EMERG_SBH_ENTRY_TIMEOUT",
  3: "EMERG_SBH_ENTRY_WRONG_TRACK",
  4: "EMERG_SBH_EXIT_TIMEOUT",
  5: "EMERG_WEICHENFEHLER_SBHF",
  6: "EMERG_DOUBLE_OCCUPANCY",
  7: "EMERG_BLOCK_SHORT",
  8: "EMERG_CONTROLLER_FAULT",
  9: "EMERG_ESTOP_CHAIN_OPEN",
  10: "EMERG_SBH_CONTROLLER_FAULT",
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

// Klartext für ShadowYardController / SBHF-State
window.SAFETY_UI_TEXTS.sbhfStateName = function(state, currentGleis) {
  const s = Number(state);
  const g = Number(currentGleis);
  const gleisTxt = (g >= 1 && g <= 3) ? `SBHF-Gleis ${g}` : "SBHF-Gleis";

  switch (s) {
    case 0: return "Leerlauf";
    case 1: return "Vorbereitung SBHF";
    case 2: return "Stellen der Weichen";
    case 3: return "Warten auf Ausfahrt Block 6";
    case 4: return `Ausfahrt aus ${gleisTxt}`;
    case 5: return "Warten auf Einfahrt";
    case 6: return `Einfahrt in ${gleisTxt}`;
    case 7: return "Fehler";
    default: return `State ${String(state)}`;
  }
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
window.SAFETY_UI_TEXTS.fromCodes = function(errType, errIndex, detailCode) {
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
    idxFmt = `Block ${idx}`;
  } else if (key === "EMERG_SBH_EXIT_TIMEOUT") {
    idxFmt = `${idx}`;
  } else if (key === "EMERG_WEICHENFEHLER_SBHF") {
    idxFmt = `${idx}`;
  } else if (key === "EMERG_SSR_STUCK") {
    idxFmt = (idx === 0 ? "A" : "B");
  }

  return {
    title: def.title || "Safety aktiv",
    lines: _fmtLines(def.text || [], idxFmt),
  };
};



