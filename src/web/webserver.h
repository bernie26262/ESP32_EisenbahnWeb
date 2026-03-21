#pragma once
#include <Arduino.h>

// --------------------------------------------------------
// HMI Support (UART)
// --------------------------------------------------------
String buildWsStateJsonForHmi();

namespace Web
{
    void begin();
    void loop();

    // Push per WS, wenn sich State geändert hat (digital)
    void pushStateIfDirty();

    // Periodic analog stream (every ~500ms)
    void pushAnalogTick();
    
    // Periodic/on-change diag stream (only if diag clients subscribed)
    void pushDiagIfNeeded();
}

// IMPORTANT: Dieses Symbol wird (derzeit) auch aus anderen Modulen referenziert.
extern volatile bool g_stateDirty;

// IMPORTANT: Diag-Dirty Flag (für diag.htm / diag.js Instant-Updates).
// Wird von Core-Modulen gesetzt, wenn neue Diag-Sensor-Daten verfügbar sind.
extern volatile bool g_diagDirty;