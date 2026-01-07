#pragma once

#include <stdint.h>

#include "../bus/i2c_bus.h"
#include "system/system_status_payload.h"

namespace Mega2Client
{
    void begin();

    I2CBus::Result pollStatus();

    bool pollSafetyStatus();

    bool pollEntryMatrix();
    bool pollEntryPreviewMatrix();

    bool safetyAck();
    bool setNotaus(bool on);
    bool powerOn();

    bool powerOff();
    bool setSsr(uint8_t idx, bool on);
}
