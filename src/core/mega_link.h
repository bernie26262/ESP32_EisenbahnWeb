#pragma once
#include <Arduino.h>
#include <Wire.h>
#include "config/pins.h"
#include "i2c_packets.h"

// Anzahl der möglichen Slaves (Mega2560-Module)
constexpr uint8_t NUM_SLAVES = 4;

// Aggregierter Zustand eines Slaves auf ESP-Seite
struct SlaveState {
    bool     valid      = false;  // true, sobald wir einmal einen FULL oder DELTA bekommen haben
    uint32_t timestamp  = 0;      // Mega-Zeit in ms (kommt nur im FULL)
    uint16_t weichenBits = 0;     // 12 Weichen → Bits 0..11
    uint8_t  bhfStromBits = 0;    // 4 Bahnhöfe → Bits 0..3
    uint8_t  mode       = 0;      // Betriebsmodus (MOD_AUTOMATIK / MOD_MANUELL)
};

// Initialisierung (I2C + DataReady-Interrupts + FULL-Initialsync)
void mega_init();

// Hintergrund-Update, im loop() regelmäßig aufrufen
// Holt für alle Slaves, deren DataReady-Flag gesetzt ist, ein DELTA
void mega_update();

// Read-only Zugriff auf aktuellen Zustand eines Slaves
const SlaveState& mega_getState(uint8_t sid);
