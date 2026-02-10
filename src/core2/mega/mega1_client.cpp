#include "mega1_client.h"

#include "../bus/i2c_bus.h"
#include "../state/system_runtime_state.h"

#include "debug.h"
#include "system/system_status_payload.h"
#include "system/mega1_diag_payload.h"
#include <string.h>


// ------------------------------------------------------------
// Minimal instrumentation: accepted vs dropped (rate-limited)
// ------------------------------------------------------------
namespace
{
    static inline bool rl(uint32_t& lastMs, uint32_t now, uint32_t periodMs)
    {
        if ((uint32_t)(now - lastMs) >= periodMs) { lastMs = now; return true; }
        return false;
    }

    static const char* i2cResultStr(I2CBus::Result r)
    {
        switch (r)
        {
            case I2CBus::Result::OK:   return "OK";
            case I2CBus::Result::BUSY: return "BUSY";
            default:                  return "ERROR";
        }
    }

    // per-category rate limiters (max ~1/s)
    static uint32_t s_lastStatusAcceptedMs = 0;
    static uint32_t s_lastStatusDroppedMs  = 0;
    static uint32_t s_lastDiagAcceptedMs   = 0;
    static uint32_t s_lastDiagDroppedMs    = 0;
    
    static bool isAllZero8(const void* p)
    {
        const uint8_t* b = static_cast<const uint8_t*>(p);
        for (int i = 0; i < 8; ++i) if (b[i] != 0) return false;
        return true;
    }

    static void dump8(const void* p, char* out, size_t outSz)
    {
        // Writes up to 8 bytes as hex into out (e.g. "00 1A FF ...")
        if (!out || outSz == 0) return;
        const uint8_t* b = static_cast<const uint8_t*>(p);
        // Each byte uses 3 chars incl space, plus NUL => need >= 3*8+1 = 25
        // If buffer is smaller, we still write a truncated string safely.
        size_t pos = 0;
        for (int i = 0; i < 8; ++i)
        {
            if (pos + 4 > outSz) break;
            const int n = snprintf(out + pos, outSz - pos, "%02X%s",
                                   (unsigned)b[i], (i == 7) ? "" : " ");
            if (n <= 0) break;
            pos += (size_t)n;
        }
    }
} // namespace

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
        SystemStatus tmpStatus2{};
        constexpr uint16_t expected = sizeof(SystemStatus);

        const auto r = I2CBus::readEx(MEGA1_ADDR, &tmpStatus, expected);
        if (r != I2CBus::Result::OK)
        {
            const uint32_t now = millis();
            if (rl(s_lastStatusDroppedMs, now, 1000))
            {
                DBG_PRINTF("[M1] STATUS dropped: i2c=%s\n", i2cResultStr(r));
            }
            return r;
        }

    if (tmpStatus.version != SYSTEM_STATUS_VERSION ||
            tmpStatus.size    != expected ||
            tmpStatus.nodeId  != NODE_MEGA1)
        {
            const uint32_t now = millis();
            if (rl(s_lastStatusDroppedMs, now, 1000))
            {
                char raw8[32] = {0};
                dump8(&tmpStatus, raw8, sizeof(raw8));
                DBG_PRINTF("[M1] STATUS dropped: reason=validate ver=%u(exp %u) size=%u(exp %u) node=%u(exp %u) raw8=%s\n",
                           (unsigned)tmpStatus.version, (unsigned)SYSTEM_STATUS_VERSION,
                           (unsigned)tmpStatus.size,    (unsigned)expected,
                           (unsigned)tmpStatus.nodeId,  (unsigned)NODE_MEGA1,
                           raw8);
            }

            // Special case: header is all zero -> attempt one immediate retry and log whether it recovers.
            // This is diagnostic + minimal self-heal, not a behavioral change beyond a single extra read.
            if (isAllZero8(&tmpStatus))
            {
                const auto r2 = I2CBus::readEx(MEGA1_ADDR, &tmpStatus2, expected);
                bool recovered = false;
                if (r2 == I2CBus::Result::OK)
                {
                    recovered = (tmpStatus2.version == SYSTEM_STATUS_VERSION &&
                                 tmpStatus2.size    == expected &&
                                 tmpStatus2.nodeId  == NODE_MEGA1);
                    if (recovered)
                    {
                        SystemRuntimeState::updateMega1Status(tmpStatus2);
                        const uint32_t now2 = millis();
                        if (rl(s_lastStatusAcceptedMs, now2, 1000))
                        {
                            DBG_PRINTF("[M1] STATUS accepted (retryRecovered=1): ver=%u size=%u node=%u\n",
                                       (unsigned)tmpStatus2.version,
                                       (unsigned)tmpStatus2.size,
                                       (unsigned)tmpStatus2.nodeId);
                        }
                        return I2CBus::Result::OK;
                    }
                }
                // Retry did not recover -> one extra diagnostic line (rate-limited together with dropped).
                const uint32_t now2 = millis();
                if (rl(s_lastStatusDroppedMs, now2, 1000))
                {
                    char raw8b[32] = {0};
                    dump8(&tmpStatus2, raw8b, sizeof(raw8b));
                    DBG_PRINTF("[M1] STATUS retryRecovered=0 i2c=%s raw8=%s\n",
                               i2cResultStr(r2), raw8b);
                }
            }
            return I2CBus::Result::ERROR;
        }

    // Accepted: only log if we really publish into SystemRuntimeState
        SystemRuntimeState::updateMega1Status(tmpStatus);
        const uint32_t now = millis();
        if (rl(s_lastStatusAcceptedMs, now, 1000))
        {
            DBG_PRINTF("[M1] STATUS accepted: ver=%u size=%u node=%u\n",
                       (unsigned)tmpStatus.version,
                       (unsigned)tmpStatus.size,
                       (unsigned)tmpStatus.nodeId);
        }
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
        {
            const uint32_t now = millis();
            if (rl(s_lastDiagDroppedMs, now, 1000))
            {
                DBG_PRINTF("[M1] DIAG dropped: i2c=%s\n", i2cResultStr(r));
            }
            return r;
        }

        // Minimal validator (current protocol): version==1 and VALID flag bit0
        if (d.version != 1 || (d.flags & 0x01) == 0)
        {
            const uint32_t now = millis();
            if (rl(s_lastDiagDroppedMs, now, 1000))
            {
                char raw8[32] = {0};
                dump8(&d, raw8, sizeof(raw8));
                DBG_PRINTF("[M1] DIAG dropped: reason=validate ver=%u flags=0x%02X (expected size=%u) raw8=%s\n",
                           (unsigned)d.version, (unsigned)d.flags, (unsigned)expected, raw8);
            }
            return I2CBus::Result::ERROR;
        }

        // Accepted: only log if we really publish into SystemRuntimeState
        SystemRuntimeState::updateMega1Diag(d);
        const uint32_t now = millis();
        if (rl(s_lastDiagAcceptedMs, now, 1000))
        {
            DBG_PRINTF("[M1] DIAG accepted: ver=%u flags=0x%02X\n",
                       (unsigned)d.version, (unsigned)d.flags);
        }
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
