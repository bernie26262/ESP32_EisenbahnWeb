#pragma once

#include <stdint.h>


namespace Mega1Link
{
    void begin();
    void update();

    // Sofortigen Status-Poll anstoßen (z.B. UI ↻ Prüfen)
    void requestPollNow();

// ------------------------------------------------------------
// UI/Automatik Commands (werden in update() seriell über I2C ausgeführt)
// Rückgabe: false => Queue voll / Parameter ungültig
// ------------------------------------------------------------
bool queueSetMode(uint8_t mode);                  // 0=MANUELL, 1=AUTO
bool queueTurnoutSet(uint8_t idx, bool gerade);   // 0..11
bool queueBhfPowerSet(uint8_t bhf, bool on);      // 0..3
bool queueStartSelftest();                        // Mega1 Weichen-Selftest (explicit)

}