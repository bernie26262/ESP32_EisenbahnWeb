#pragma once
#include <Arduino.h>

namespace HMI
{
    void begin();
    void loop();
    bool sendJson(const String& s);
}