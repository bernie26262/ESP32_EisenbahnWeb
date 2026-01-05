#pragma once
#include <Arduino.h>

// Globales Dirty-Flag (wird von SystemRuntimeState gesetzt)
extern bool g_stateDirty;

class Web {
public:
    static void begin();
    static void loop();

    // 🔴 NEU: Event-basierter Push
    static void pushStateIfDirty();
};
