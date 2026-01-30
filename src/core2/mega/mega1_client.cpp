#include "mega1_client.h"

#include "../bus/i2c_bus.h"
#include "../state/system_runtime_state.h"

#include "debug.h"
#include "system/system_status_payload.h"
#include "system/mega1_diag_payload.h"

static constexpr uint8_t MEGA1_ADDR = 0x10;

// Mega1 I2CProtocol.h (Mirror)
static constexpr uint8_t CMD_GET_PENDING_MASK = 0xE0; // neu: DRDY pending mask (uint16)
static constexpr uint8_t CMD_GET_DIAG         = 0xD1; // CMD_GET_DIAG (see Mega1/include/I2CProtocol.h)
static constexpr uint8_t CMD_SET_MODE         = 0x02;
static constexpr uint8_t CMD_SET_WEICHE       = 0x03;
static constexpr uint8_t CMD_SET_BHF_PWR      = 0x06; // neu in Mega1 (Power/Signal)
static constexpr uint8_t CMD_SELFTEST_START   = 0x07;

namespace Mega1Client
{
    void begin()
    {
        // aktuell nichts nötig
    }


I2CBus::Result pollPendingMask(uint16_t& outMask)
    {
        const uint8_t cmd = CMD_GET_PENDING_MASK;
        uint16_t tmp = 0;
        const auto r = I2CBus::writeReadEx(MEGA1_ADDR, &cmd, 1, &tmp, sizeof(tmp), 0);
        if (r != I2CBus::Result::OK) return r;
        outMask = tmp;
        return I2CBus::Result::OK;
    }

    I2CBus::Result pollStatus()
    {
        SystemStatus tmpStatus{};
        constexpr uint16_t expected = sizeof(SystemStatus);

        const auto r = I2CBus::readEx(MEGA1_ADDR, &tmpStatus, expected);
        if (r != I2CBus::Result::OK)
            return r;

    if (tmpStatus.version != SYSTEM_STATUS_VERSION ||
            tmpStatus.size != expected ||
            tmpStatus.nodeId != NODE_MEGA1)
        {
            DBG_PRINTF(
                "[M1] Status reject: ver=%u(exp %u) size=%u(exp %u) node=%u\n",
                (unsigned)tmpStatus.version, (unsigned)SYSTEM_STATUS_VERSION,
                (unsigned)tmpStatus.size, (unsigned)expected,
                (unsigned)tmpStatus.nodeId);
            return I2CBus::Result::ERROR;
        }

    SystemRuntimeState::updateMega1Status(tmpStatus);
        return I2CBus::Result::OK;
}

    I2CBus::Result pollDiag()
    {
        Mega1DiagV1 d{};
        constexpr uint16_t expected = sizeof(Mega1DiagV1);

        // Mega1: erst CMD schicken, dann Diagnosepaket lesen (<=32B)
        const uint8_t cmd = CMD_GET_DIAG;
        const auto r = I2CBus::writeReadEx(MEGA1_ADDR, &cmd, 1, &d, expected);
        if (r != I2CBus::Result::OK)
            return r;

        if (d.version != 1 || (d.flags & 0x01) == 0)
        {
            DBG_PRINTF("[M1] Diag reject: ver=%u flags=0x%02X size=%u\n",
                       (unsigned)d.version, (unsigned)d.flags, (unsigned)expected);
            return I2CBus::Result::ERROR;
        }

        SystemRuntimeState::updateMega1Diag(d);
        return I2CBus::Result::OK;
    }

    // Convenience (startup bootstrap): poll STATUS then DIAG
    I2CBus::Result pollStatusAndDiag()
    {
        const auto rs = pollStatus();
        if (rs != I2CBus::Result::OK) return rs;
        return pollDiag();
    }


// ------------------------------------------------------------
// Commands (Master -> Mega1)
// ------------------------------------------------------------

    static I2CBus::Result sendCmdWithAck(const uint8_t* buf, uint8_t len)
    {
        uint8_t ack = 0;

        const auto r = I2CBus::writeReadEx(MEGA1_ADDR, buf, len, &ack, 1);
        if (r != I2CBus::Result::OK)
            return r;

        // Mega1: 1=OK, 0=FAIL, 2=BUSY (optional)
        return (ack == 1) ? I2CBus::Result::OK : I2CBus::Result::ERROR;
    }

    I2CBus::Result cmdSetMode(uint8_t mode)
    {
        const uint8_t buf[2] = { CMD_SET_MODE, mode };
        return sendCmdWithAck(buf, sizeof(buf));
    }

    I2CBus::Result cmdSetWeiche(uint8_t idx, bool gerade)
    {
        const uint8_t buf[3] = { CMD_SET_WEICHE, idx, (uint8_t)(gerade ? 1 : 0) };
        return sendCmdWithAck(buf, sizeof(buf));
    }

    I2CBus::Result cmdSetBhfPower(uint8_t bhf, bool on)
    {
        const uint8_t buf[3] = { CMD_SET_BHF_PWR, bhf, (uint8_t)(on ? 1 : 0) };
        return sendCmdWithAck(buf, sizeof(buf));
    }

    I2CBus::Result cmdStartSelftest()
    {
        const uint8_t buf[1] = { CMD_SELFTEST_START };
        return sendCmdWithAck(buf, sizeof(buf));
    }

} // namespace Mega1Client
