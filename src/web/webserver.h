#pragma once
#include <Arduino.h>

namespace Web
{
    void begin();
    void loop();

    // Push per WS, wenn sich State geändert hat (digital)
    void pushStateIfDirty();

    // Periodic analog stream (every ~500ms)
    void pushAnalogTick();
}

// IMPORTANT: Dieses Symbol wird (derzeit) auch aus anderen Modulen referenziert.
extern volatile bool g_stateDirty;
