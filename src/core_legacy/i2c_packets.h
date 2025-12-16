#pragma once
#include <Arduino.h>

// ======================================================
//   Gemeinsame I2C-Pakete für Mega2560 → ESP32-S3
//   Version: erweitert für Mega2 + Schattenbahnhof
// ======================================================

// ------------------------------------------------------
// Kommandos ESP → Mega
// ------------------------------------------------------
enum I2C_Command : uint8_t {
    I2C_CMD_NOP            = 0x00,
    I2C_CMD_GET_FULL       = 0x01,
    I2C_CMD_GET_DELTA      = 0x02,
    I2C_CMD_GET_META       = 0x03,   // optional

    // Bestehende Set-Kommandos
    I2C_CMD_SET_WEICHE     = 0x10,   // payload: id, value
    I2C_CMD_SET_BHF        = 0x11,   // payload: id, value
    I2C_CMD_SET_MODE       = 0x12,   // payload: mode

    // Mega2: erweitertes Statuspaket (Analog + SBhf + Blöcke)
    I2C_CMD_GET_MEGA2_STATUS = 0x21,

    // Schattenbahnhof: generische Parameter
    I2C_CMD_SBFH_SET_PARAM   = 0x30, // payload: paramId, uint16_t value
    // Schattenbahnhof: Aktionen (Start Fill / Empty / Stop / ...)
    I2C_CMD_SBFH_ACTION      = 0x31  // payload: actionId
};

// ------------------------------------------------------
// Paket-Typen Mega → ESP
// ------------------------------------------------------
enum I2C_PacketType : uint8_t {
    I2C_PKT_NONE          = 0x00,
    I2C_PKT_FULL          = 0x10,
    I2C_PKT_DELTA         = 0x11,
    I2C_PKT_META          = 0x12,
    I2C_PKT_ERROR         = 0x1F,

    // Mega2: eigener Status
    I2C_PKT_MEGA2_STATUS  = 0x20
};

// ------------------------------------------------------
// Header (optional, bei MEGA2-Status genutzt)
// ------------------------------------------------------
struct __attribute__((packed)) I2C_Header {
    uint8_t packetType;   // I2C_PacketType
    uint8_t payloadLen;   // Größe des folgenden Payloads in Bytes
};

// ------------------------------------------------------
// FULL-Payload – komprimierter Zustand eines Mega
// (Version C: 16 Weichenbits + 4 Bahnhof-Strombits + Modus)
// ------------------------------------------------------
struct __attribute__((packed)) I2C_FullPayload {
    uint8_t  pktType;      // = I2C_PKT_FULL
    uint32_t timestamp;    // Mega-intern (ms)
    uint16_t weichenBits;  // bis zu 16 Weichen, Bits 0..15
    uint8_t  bhfStromBits; // bis zu 8 Bahnhöfe, Bits 0..7
    uint8_t  mode;         // Betriebsmodus
};

// ------------------------------------------------------
// DELTA-Payload – „grouping light“ Events
// ------------------------------------------------------
struct __attribute__((packed)) I2C_DeltaItem {
    uint8_t type;   // z.B. EVT_SENSOR, EVT_WEICHE, EVT_BHF, ...
    uint8_t id;     // Index
    uint8_t value;  // neuer Zustand
};

constexpr uint8_t I2C_MAX_DELTA_EVENTS = 8;

struct __attribute__((packed)) I2C_DeltaPayload {
    uint8_t        pktType;              // = I2C_PKT_DELTA
    uint8_t        count;                // Anzahl Events
    I2C_DeltaItem  events[I2C_MAX_DELTA_EVENTS];
};

// ältere Namen kompatibel halten
using I2C_DeltaEvent = I2C_DeltaItem;

// ======================================================
//   Mega2: erweitertes Statuspaket
// ======================================================

constexpr uint8_t I2C_NUM_ANALOG_BLOCKS = 9;   // Blöcke 1–6 + SBhf1–3

// SBhf-Parameter-IDs (WebUI → ESP32 → Mega2)
enum SBhfParamID : uint8_t {
    SBHF_PARAM_MODE        = 1,  // SBhfMode (Off/AutoNormal/AutoFill/AutoEmpty)
    SBHF_PARAM_FILL_STRAT  = 2,  // Füllstrategie
    SBHF_PARAM_EMPTY_STRAT = 3,  // Leerstrategie
    SBHF_PARAM_MAX_ZUEGE   = 4,  // max Züge im SBhf
    SBHF_PARAM_MIN_ABSTAND = 5,  // Mindestabstand zw. Fahrten
    SBHF_PARAM_MIN_AUFENTH = 6   // Mindestaufenthalt je Gleis
};

// Mega2-Status: wird auf GET_MEGA2_STATUS geliefert
struct __attribute__((packed)) I2C_Mega2Status {
    // Trafo-Spannungen (gefilterte ADC-Werte, 0–1023)
    uint16_t trafoOben;
    uint16_t trafoUnten;

    // Blockzustände: 1–6 + SBhf1–3
    uint8_t  blockBesetzt[I2C_NUM_ANALOG_BLOCKS]; // 0/1
    uint8_t  kontakt[I2C_NUM_ANALOG_BLOCKS];      // 0/1 (Kontaktgleise)
    uint16_t strom[I2C_NUM_ANALOG_BLOCKS];        // Stromsensor-Level

    // Schattenbahnhof
    uint8_t sbhfBlock[3];     // Gleis 1..3 besetzt/frei (0/1)
    uint8_t sbhfState;        // aktueller Automat-State
    uint8_t sbhfMode;         // aktueller Modus
    uint8_t sbhfTarget;       // Zielgleis Einfahrt (1–3, 0 = keiner)
    uint8_t sbhfExit;         // Ausfahrgleis (1–3, 0 = keiner)

    // Sonstiges
    uint8_t nothalt;          // 0/1
};
