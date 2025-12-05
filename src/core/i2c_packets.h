#pragma once
#include <Arduino.h>

// ======================================================
//   Gemeinsame I2C-Pakete für Mega2560 → ESP32-S3
//   (Version C – Full & Delta + Grouping Light)
// ======================================================

// --- Kommandos vom ESP an Mega ------------------------
enum : uint8_t {
    I2C_CMD_GET_FULL    = 0x01,
    I2C_CMD_GET_DELTA   = 0x02,

    // NEUE KOMMANDOS: ESP → Mega
    I2C_CMD_SET_WEICHE  = 0x10,  // payload: id, value
    I2C_CMD_SET_BHF     = 0x11,  // payload: id, value
    I2C_CMD_SET_MODE    = 0x12   // payload: mode
};

// --- Antworten vom Mega an ESP ------------------------
enum : uint8_t {
    I2C_PKT_FULL  = 0x81,
    I2C_PKT_DELTA = 0x82
};

// ======================================================
// FULL-PAYLOAD – kompletter Status eines Slaves
// ======================================================
struct I2C_FullPayload {
    uint8_t  pktType;      // = I2C_PKT_FULL
    uint32_t timestamp;    // Mega-Time in ms
    uint16_t weichenBits;  // 12 Weichen → Bits 0..11
    uint8_t  bhfStromBits; // 4 Bahnhöfe → Bits 0..3
    uint8_t  mode;         // Betriebsmodus
} __attribute__((packed));

// ======================================================
// DELTA-PAYLOAD – grouping light
// ======================================================

// Einzelnes Delta-Event
struct I2C_DeltaEvent {
    uint8_t type;   // EVT_SENSOR, EVT_WEICHE, EVT_BHF, ...
    uint8_t id;     // index
    uint8_t value;  // neuer Zustand
} __attribute__((packed));

struct I2C_DeltaPayload {
    uint8_t        pktType;   // = I2C_PKT_DELTA
    uint8_t        count;     // Anzahl Events
    I2C_DeltaEvent ev[8];     // grouping light: max. 8
} __attribute__((packed));
