#pragma once
#include <Arduino.h>

enum class NothaltReason : uint8_t {
    NONE = 0,
    SENSOR_FAULT,
    MEGA_TIMEOUT,
    OVERCURRENT,
    MANUAL,
    ETH_LOSS
};

namespace Safety {

    // Wichtig: exakt diese Signatur muss implementiert werden
    const char* reasonToString(NothaltReason reason);

    void setNothalt(NothaltReason reason, uint32_t info = 0);
    void clearNothalt();
    bool isActive();
    NothaltReason lastReason();
    uint32_t lastInfo();
}
