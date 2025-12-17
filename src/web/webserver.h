#pragma once
#include <Arduino.h>

class Web {
public:
    static void begin();
    static void loop();

    // 🔴 NEU: Event-basierter Push
    static void pushStateIfDirty();
};
