#pragma once

namespace Mega2Link
{
    // Initialisierung (aus setup())
    void begin();

    // Zyklisches Update (aus loop())
    void update();

    // Status
    bool isOnline();

    // Commands
    bool safetyAck();
}
