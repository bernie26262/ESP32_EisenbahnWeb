#pragma once

#include "core2/bus/i2c_bus.h"
#include "system/system_status_payload.h"

namespace Mega1Client
{
    void begin();
    I2CBus::Result pollStatus();
    I2CBus::Result pollDiag();

// Commands (Master -> Mega1)
I2CBus::Result cmdSetMode(uint8_t mode);                 // 0=MANUELL,1=AUTO
I2CBus::Result cmdSetWeiche(uint8_t idx, bool gerade);   // 0..11
I2CBus::Result cmdSetBhfPower(uint8_t bhf, bool on);     // 0..3

}
