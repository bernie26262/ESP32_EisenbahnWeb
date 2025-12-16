#pragma once
#include <Arduino.h>
#include <stdint.h>
#include "system/status_system.h"

namespace SystemState
{
    void updateMega2Status(const SystemStatus& st);
    bool mega2Online();
    const SystemStatus& mega2Status();
}
