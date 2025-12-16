#include <Arduino.h>
#include "system_state.h"

static SystemStatus s_m2Status{};
static uint32_t s_lastRxMs = 0;

void SystemState::updateMega2Status(const SystemStatus& st)
{
    s_m2Status = st;
    s_lastRxMs = millis();
}

bool SystemState::mega2Online()
{
    return (millis() - s_lastRxMs) < 1000;
}

const SystemStatus& SystemState::mega2Status()
{
    return s_m2Status;
}
