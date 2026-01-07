#pragma once

#include "core2/bus/i2c_bus.h"
#include "system/system_status_payload.h"

namespace Mega1Client
{
    void begin();
    I2CBus::Result pollStatus();
}
