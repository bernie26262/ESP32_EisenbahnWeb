#pragma once

#include <Arduino.h>
#include <Wire.h>

#include "config/pins.h"
#include "i2c_packets.h"
#include "proto_common.h"   // SafetySSR + Mega2 Command-IDs
#include "system/status_system.h"

// ---------------------------------------------------------------------
// Anzahl der möglichen Slaves (Mega2560-Module)
// ---------------------------------------------------------------------

constexpr uint8_t NUM_SLAVES = 4;

// Indizes der Slaves (so wie in I2C_ADDR)
constexpr uint8_t MEGA1_SID = 0;
constexpr uint8_t MEGA2_SID = 1;
constexpr uint8_t MEGA3_SID = 2;
constexpr uint8_t MEGA4_SID = 3;

// ---------------------------------------------------------------------
// Aggregierter Zustand eines Slaves auf ESP-Seite
// ---------------------------------------------------------------------

struct SlaveState {
    bool     valid       = false;  // true, sobald wir einmal Daten hatten
    uint32_t timestamp   = 0;      // Zeitstempel des letzten Updates

    uint16_t weichenBits  = 0;     // 16 Bits für Weichen (kompakt)
    uint8_t  bhfStromBits = 0;     // 4 Bits für Bahnhof-Strom
    uint8_t  mode         = 0;     // Betriebsmodus

    // --------- Mega2-Erweiterung: Analog- / Blockstatus ---------

    bool     analogValid   = false;

    uint16_t trafoOben     = 0;    // ZMPT101B oben
    uint16_t trafoUnten    = 0;    // ZMPT101B unten

    // 0..5: Blöcke 1–6
    // 6..8: SBhf-Gleis 1–3
    uint16_t stromAnalog[I2C_NUM_ANALOG_BLOCKS]   = {0};
    uint8_t  blockBesetzt[I2C_NUM_ANALOG_BLOCKS]  = {0};
    uint8_t  kontakt[I2C_NUM_ANALOG_BLOCKS]       = {0};

    // Schattenbahnhof-Zustand (logischer Controller)
    uint8_t sbhfBlock[3] = {0};   // Belegung der 3 SBhf-Gleise
    uint8_t sbhfState    = 0;     // interner State
    uint8_t sbhfMode     = 0;     // seriell / random
    uint8_t sbhfTarget   = 0;     // Ziel-Gleis
    uint8_t sbhfExit     = 0;     // Ausfahrtsziel

    uint8_t nothalt      = 0;     // von Mega gemeldeter Not-Aus

    // --------- Safety / Weichenprüfung ---------

    uint8_t  weichenCount = 0;

    uint8_t  weichenSoll[16] = {0};
    uint8_t  weichenIst[16]  = {0};

    uint32_t weichenTimestamp[16] = {0};

    bool     sbhfFault      = false;
    bool     nothaltBesetzt = false;
    bool     block6Powered  = false;
};

// ---------------------------------------------------------------------
// Initialisierung / Update
// ---------------------------------------------------------------------

// I2C + DataReady-Interrupts initialisieren
void mega_link_begin();

// Zyklisch im loop() aufrufen – holt DELTAs und Mega2-Status
void mega_update();

// aktuellen Zustand eines Slaves holen
const SlaveState &mega_getState(uint8_t sid);

// ---------------------------------------------------------------------
// Kommandos ESP → Mega (bestehend)
// ---------------------------------------------------------------------

// Weiche stellen (id = Weichenindex, value = 0/1)
bool mega_cmd_setWeiche(uint8_t slave, uint8_t id, uint8_t value);

// Bahnhof-Strom schalten (id = Bahnhofindex, value = 0/1)
bool mega_cmd_setBahnhof(uint8_t slave, uint8_t id, uint8_t value);

// Betriebsmodus setzen (z.B. MOD_AUTOMATIK / MOD_MANUELL)
bool mega_cmd_setMode(uint8_t slave, uint8_t mode);

// FULL-Sync für einen Slave explizit anfordern
bool mega_cmd_requestFull(uint8_t slave);

// Schattenbahnhof: Parameter setzen (Mega2)
bool mega_cmd_sendSBhfParam(uint8_t slave, uint8_t paramId, uint16_t value);

// Schattenbahnhof: Aktionen auslösen (Mega2)
bool mega_cmd_sendSBhfAction(uint8_t slave, uint8_t action);

// ---------------------------------------------------------------------
// NEU – Phase 1: Mega2 Safety / Recovery Commands
// ---------------------------------------------------------------------

// Not-Aus setzen / freigeben (nur Mega2)
bool mega2_cmd_setNotaus(bool enable);

// Safety-SSR schalten (NUR sicherheitsrelevant!)
bool mega2_cmd_setSafetySSR(SafetySSR ssr, bool enable);

// Fehler quittieren (Mega2)
bool mega2_cmd_ackError(uint8_t mask);

// ---------------------------------------------------------------------
// Mega2 SystemStatus (read-only, polling)
// ---------------------------------------------------------------------

bool mega2SystemOnline();
const SystemStatus& mega2SystemStatus();
