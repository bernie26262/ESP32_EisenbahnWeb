#pragma once

#include <stdint.h>

namespace Mega2Link
{
    void begin();

    // Zyklisch in loop() aufrufen
    void update();

    // Online-Flag aus Sicht des ESP32-Link-Layers.
    // Poll-Fehler sind Kommunikationsprobleme und sollen *nicht* als Safety-Fehler
    // (ERR/NOTAUS/ACK-Pflicht) interpretiert werden.
    bool mega2Online();

    // Zeitpunkt (millis) des letzten erfolgreichen Status-Polls.
    // 0, falls noch nie OK.
    uint32_t lastOkMs();

    // Sofortigen Status-Poll anstoßen (z.B. nach Fix von Warnings)
    void requestPollNow();

    // Aktionen (von WebUI/Serial)
    bool safetyAck();
    bool sbhfSelftestRetry();
    bool nothalt();     // setzt NOTAUS (true)
    bool powerOn();
    bool powerOff();    // UI-STOP / SSR_MAIN_ENABLE aus

    // optional: falls du später “lösen” willst
    bool releaseNotaus();
}
