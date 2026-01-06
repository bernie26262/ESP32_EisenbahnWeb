#pragma once

#include <stdint.h>

namespace Mega2Link
{
    void begin();

    // Zyklisch in loop() aufrufen
    void update();

    // Aktionen (von WebUI/Serial)
    bool safetyAck();
    bool nothalt();     // setzt NOTAUS (true)
    bool powerOn();
    bool powerOff();    // UI-STOP / SSR_MAIN_ENABLE aus

    // optional: falls du später “lösen” willst
    bool releaseNotaus();
}
