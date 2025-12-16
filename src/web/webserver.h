#pragma once

#include <Arduino.h>

class Web {
public:
    static void begin();
    static void loop();

    // Text über WebSocket an alle Clients
    static void broadcastText(const String &msg);

    // Status-JSON an alle Clients senden
    static void broadcastStatus();
};
