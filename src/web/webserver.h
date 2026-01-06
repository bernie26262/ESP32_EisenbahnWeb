#pragma once
#include <Arduino.h>

namespace Web
{
    void begin();
    void loop();

    // Push per WS, wenn sich State geändert hat
    void pushStateIfDirty();
}

// IMPORTANT: Dieses Symbol wird (derzeit) auch aus anderen Modulen referenziert.
extern volatile bool g_stateDirty;
