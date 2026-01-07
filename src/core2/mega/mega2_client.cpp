#include "mega2_client.h"

#include "../bus/i2c_bus.h"
#include "../state/system_runtime_state.h"

#include "proto_common.h"
#include "system/system_status_payload.h"

#include "debug.h"

static constexpr uint8_t MEGA2_ADDR = 0x11;

void Mega2Client::begin()
{
    // aktuell nichts nötig
}

I2CBus::Result Mega2Client::pollStatus()
{
    SystemStatus tmpStatus{};
    constexpr uint16_t expected = sizeof(SystemStatus);

    const auto r = I2CBus::readEx(MEGA2_ADDR, &tmpStatus, expected);
    if (r != I2CBus::Result::OK)
        return r;

    if (tmpStatus.version != SYSTEM_STATUS_VERSION ||
        tmpStatus.size    != sizeof(SystemStatus)  ||
        tmpStatus.nodeId  != NODE_MEGA2)
    {
        DBG_PRINTF(
            "[M2] Status reject: ver=%u(exp %u) size=%u(exp %u) node=%u\n",
            tmpStatus.version, SYSTEM_STATUS_VERSION,
            tmpStatus.size, (unsigned)sizeof(SystemStatus),
            tmpStatus.nodeId
        );
        return I2CBus::Result::ERROR;
    }

    SystemRuntimeState::updateMega2Status(tmpStatus);
    return I2CBus::Result::OK;
}

bool Mega2Client::pollSafetyStatus()
{
    uint8_t cmd = M2_CMD_GET_SAFETY_STATUS;

    const auto w = I2CBus::writeEx(MEGA2_ADDR, &cmd, sizeof(cmd));
    if (w != I2CBus::Result::OK)
        return false;

    delayMicroseconds(1000);

    Mega2SafetyStatus st{};
    const auto r = I2CBus::readEx(MEGA2_ADDR, &st, sizeof(st));
    if (r != I2CBus::Result::OK)
        return false;

    SystemRuntimeState::updateMega2SafetyStatus(st);
    return true;
}

bool Mega2Client::safetyAck()
{
    // Hinweis: proto_common sagt [cmd, mask]. Aktuell senden wir nur cmd.
    // Wenn Mega2 mask erwartet: später buf[2] machen.
    uint8_t cmd = M2_CMD_ACK_ERROR;

    uint8_t resp = 0;
    const auto r = I2CBus::writeReadEx(MEGA2_ADDR, &cmd, sizeof(cmd), &resp, sizeof(resp), 1000);
    if (r != I2CBus::Result::OK)
        return false;

    return (resp == 1);
}

bool Mega2Client::setNotaus(bool on)
{
    uint8_t buf[2];
    buf[0] = M2_CMD_SET_NOTAUS;
    buf[1] = on ? 1 : 0;

    const auto w = I2CBus::writeEx(MEGA2_ADDR, buf, sizeof(buf));
    if (w != I2CBus::Result::OK)
        return false;

    delayMicroseconds(1000);

    uint8_t resp = 0;
    const auto r = I2CBus::readEx(MEGA2_ADDR, &resp, sizeof(resp));
    if (r != I2CBus::Result::OK)
        return false;

    DBG_PRINTF(
        resp
            ? (on ? "[M2] NOTAUS SET OK\n" : "[M2] NOTAUS RELEASE OK\n")
            : "[M2] NOTAUS CMD FAIL\n"
    );

    return (resp == 1);
}

bool Mega2Client::powerOn()
{
    uint8_t cmd = M2_CMD_POWER_ON;

    const auto w = I2CBus::writeEx(MEGA2_ADDR, &cmd, sizeof(cmd));
    if (w != I2CBus::Result::OK)
        return false;

    delayMicroseconds(1000);

    uint8_t resp = 0;
    const auto r = I2CBus::readEx(MEGA2_ADDR, &resp, sizeof(resp));
    if (r != I2CBus::Result::OK)
        return false;

    DBG_PRINTF(resp ? "[M2] POWER ON OK\n" : "[M2] POWER ON FAIL\n");
    return (resp == 1);
}

bool Mega2Client::setSsr(uint8_t idx, bool on)
{
    uint8_t buf[3];
    buf[0] = M2_CMD_SET_SSR;
    buf[1] = idx;
    buf[2] = on ? 1 : 0;

    const auto w = I2CBus::writeEx(MEGA2_ADDR, buf, sizeof(buf));
    if (w != I2CBus::Result::OK)
        return false;

    delayMicroseconds(1000);

    uint8_t resp = 0;
    const auto r = I2CBus::readEx(MEGA2_ADDR, &resp, sizeof(resp));
    if (r != I2CBus::Result::OK)
        return false;

    DBG_PRINTF(
        resp
            ? (on ? "[M2] SSR %u ON OK\n" : "[M2] SSR %u OFF OK\n")
            : "[M2] SSR %u CMD FAIL\n",
        (unsigned)idx
    );

    return (resp == 1);
}

bool Mega2Client::powerOff()
{
    return setSsr(SSR_MAIN_ENABLE, false);
}

bool Mega2Client::pollEntryMatrix()
{
    uint8_t cmd = M2_CMD_GET_ENTRY_MATRIX;

    const auto w = I2CBus::writeEx(MEGA2_ADDR, &cmd, sizeof(cmd));
    if (w != I2CBus::Result::OK)
        return false;

    delayMicroseconds(1000);

    uint16_t entry[9] = {0};
    const auto r = I2CBus::readEx(MEGA2_ADDR, entry, sizeof(entry));
    if (r != I2CBus::Result::OK)
        return false;

    SystemRuntimeState::updateMega2EntryAllowed(entry, 9);
    return true;
}

bool Mega2Client::pollEntryPreviewMatrix()
{
    uint8_t cmd = M2_CMD_GET_ENTRY_PREVIEW_MATRIX;

    const auto w = I2CBus::writeEx(MEGA2_ADDR, &cmd, sizeof(cmd));
    if (w != I2CBus::Result::OK)
        return false;

    delayMicroseconds(1000);

    uint16_t entry[9] = {0};
    const auto r = I2CBus::readEx(MEGA2_ADDR, entry, sizeof(entry));
    if (r != I2CBus::Result::OK)
        return false;

    SystemRuntimeState::updateMega2EntryPreview(entry, 9);
    return true;
}
