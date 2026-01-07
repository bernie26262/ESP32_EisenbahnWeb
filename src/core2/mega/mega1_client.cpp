#include "mega1_client.h"

#include "../bus/i2c_bus.h"
#include "../state/system_runtime_state.h"

#include "debug.h"
#include "system/system_status_payload.h"

static constexpr uint8_t MEGA1_ADDR = 0x10;

void Mega1Client::begin()
{
    // aktuell nichts nötig
}

I2CBus::Result Mega1Client::pollStatus()
{
    SystemStatus tmpStatus{};
    constexpr uint16_t expected = sizeof(SystemStatus);

    const auto r = I2CBus::readEx(MEGA1_ADDR, &tmpStatus, expected);
    if (r != I2CBus::Result::OK)
        return r;

    if (tmpStatus.version != SYSTEM_STATUS_VERSION ||
        tmpStatus.size    != sizeof(SystemStatus)  ||
        tmpStatus.nodeId  != NODE_MEGA1)
    {
        DBG_PRINTF(
            "[M1] Status reject: ver=%u(exp %u) size=%u(exp %u) node=%u\n",
            tmpStatus.version, SYSTEM_STATUS_VERSION,
            tmpStatus.size, (unsigned)sizeof(SystemStatus),
            tmpStatus.nodeId
        );
        return I2CBus::Result::ERROR;
    }

    SystemRuntimeState::updateMega1Status(tmpStatus);
    return I2CBus::Result::OK;
}
