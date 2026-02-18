#include "mega2_client.h"

#include <Arduino.h>

#include "../bus/i2c_bus.h"
#include "../state/system_runtime_state.h"

#include "proto_common.h"
#include "system/system_status_payload.h"

#include "debug.h"
 


static constexpr uint8_t MEGA2_ADDR = 0x11;

// ------------------------------------------------------------
// Mega2 Analog cache / rate-limit
// ------------------------------------------------------------
static Mega2AnalogPayload s_m2Analog{};
static uint32_t s_m2AnalogMs = 0;


static I2CBus::Result writeReadRetry(uint8_t addr,
                                    const void* tx, size_t txLen,
                                    void* rx, size_t rxLen,
                                    uint32_t timeout_us = 3000)
{
    // Prefer combined transaction if available.
    I2CBus::Result r = I2CBus::writeReadEx(addr, tx, txLen, rx, rxLen, timeout_us);
    if (r == I2CBus::Result::OK)
        return r;

    // Fallback: write then poll-read until timeout.
    r = I2CBus::writeEx(addr, tx, txLen);
    if (r != I2CBus::Result::OK)
        return r;

    const uint32_t t0 = micros();
    do {
        r = I2CBus::readEx(addr, rx, rxLen);
        if (r == I2CBus::Result::OK)
            return r;

        // Don't busy-wait. Give the scheduler/bus a chance.
#if defined(ESP32)
        delay(0);
#else
        yield();
#endif
    } while ((uint32_t)(micros() - t0) < timeout_us);

    return r;
}



I2CBus::Result Mega2Client::pollPendingMask(Mega2PendingMaskPayload& out)
{
    const uint8_t cmd = M2_CMD_GET_PENDING_MASK;
    Mega2PendingMaskPayload p{};
    const auto r = I2CBus::writeReadEx(MEGA2_ADDR, &cmd, sizeof(cmd), &p, sizeof(p), 1000);
    if (r == I2CBus::Result::OK) out = p;
    return r;
}

I2CBus::Result Mega2Client::pollBlocksStatus()
{
    const uint8_t cmd = M2_CMD_GET_BLOCK_STATUS;

    BlockStatus blocks[M2_NUM_BLOCKS]{};
    const auto r = writeReadRetry(MEGA2_ADDR, &cmd, sizeof(cmd), blocks, sizeof(blocks), 3000);
    if (r == I2CBus::Result::OK)
        SystemRuntimeState::updateMega2BlockStatus(blocks, M2_NUM_BLOCKS);
    return r;
}

I2CBus::Result Mega2Client::pollShadowStatus()
{
    const uint8_t cmd = M2_CMD_GET_SHADOW_STATUS;

    ShadowYardStatus st{};
    const auto r = writeReadRetry(MEGA2_ADDR, &cmd, sizeof(cmd), &st, sizeof(st), 3000);
    if (r == I2CBus::Result::OK)
        SystemRuntimeState::updateMega2ShadowStatus(st);
    return r;
}

I2CBus::Result Mega2Client::pollTurnoutsStatus()
{
    const uint8_t cmd = M2_CMD_GET_TURNOUTS;

    Mega2TurnoutsPayload t{};
    const auto r = writeReadRetry(MEGA2_ADDR, &cmd, sizeof(cmd), &t, sizeof(t), 2000);
    if (r == I2CBus::Result::OK)
        SystemRuntimeState::updateMega2Turnouts(t);
    return r;
}

I2CBus::Result Mega2Client::pollDiagSensors(Mega2DiagSensorsPayload& out)
{
    const uint8_t cmd = M2_CMD_GET_DIAG_SENSORS;
    Mega2DiagSensorsPayload p{};
    const auto r = writeReadRetry(MEGA2_ADDR, &cmd, sizeof(cmd), &p, sizeof(p), 2000);
    if (r == I2CBus::Result::OK) out = p;
    return r;
}

I2CBus::Result Mega2Client::pollDiagRelays(Mega2DiagRelaysPayload& out)
{
    const uint8_t cmd = M2_CMD_GET_DIAG_RELAYS;
    Mega2DiagRelaysPayload p{};
    const auto r = writeReadRetry(MEGA2_ADDR, &cmd, sizeof(cmd), &p, sizeof(p), 2000);
    if (r == I2CBus::Result::OK) out = p;
    return r;
}

void Mega2Client::begin()
{
    // aktuell nichts nötig
}
 
 
 I2CBus::Result Mega2Client::pollAnalog()
 {
     // rate-limit (~500ms)
     const uint32_t now = millis();
     if ((uint32_t)(now - s_m2AnalogMs) < 500)
         return I2CBus::Result::OK;
 
     const uint8_t cmd = CMD_GET_M2_ANALOG; // ESP nutzt CMD_GET_M2_*
     Mega2AnalogPayload p{};
 
     const auto r = writeReadRetry(MEGA2_ADDR, &cmd, sizeof(cmd), &p, sizeof(p), 2000);
     if (r != I2CBus::Result::OK)
         return r;
 
     s_m2Analog = p;
     s_m2AnalogMs = now;
 
     SystemRuntimeState::updateMega2Analog(p);
     return I2CBus::Result::OK;
 }
 
 const Mega2AnalogPayload& Mega2Client::analog()
 {
     return s_m2Analog;
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
        // If a command response (1 byte OK/FAIL) is still pending on Mega2,
        // a plain read() may consume that 1 byte first and the remaining bytes
        // are zero-filled -> looks like ver=0/size=0/node=0.
        // In that case: do one immediate retry to fetch the real SystemStatus.
        if (tmpStatus.version == 0 && tmpStatus.size == 0 && tmpStatus.nodeId == 0)
        {
            const auto r2 = I2CBus::readEx(MEGA2_ADDR, &tmpStatus, expected);
            if (r2 == I2CBus::Result::OK &&
                tmpStatus.version == SYSTEM_STATUS_VERSION &&
                tmpStatus.size    == sizeof(SystemStatus) &&
                tmpStatus.nodeId  == NODE_MEGA2)
            {
                SystemRuntimeState::updateMega2Status(tmpStatus);
                return I2CBus::Result::OK;
            }
        }

        DBG_PRINTF(
            "[M2] Status reject: ver=%u(exp %u) size=%u(exp %u) node=%u\n",
            tmpStatus.version, SYSTEM_STATUS_VERSION,
            tmpStatus.size, (unsigned)sizeof(SystemStatus),
            tmpStatus.nodeId
        );
        return I2CBus::Result::ERROR;
    }

    SystemRuntimeState::updateMega2Status(tmpStatus);

    // Optional: Analogwerte (rate-limited internally)
    (void)Mega2Client::pollAnalog();
 
    return I2CBus::Result::OK;
}


 I2CBus::Result Mega2Client::pollSafetyStatus()
{
    const uint8_t cmd = M2_CMD_GET_SAFETY_STATUS;

    Mega2SafetyStatus st{};
    const auto r = I2CBus::writeReadEx(MEGA2_ADDR, &cmd, sizeof(cmd), &st, sizeof(st), 1000);
    if (r == I2CBus::Result::OK)
        SystemRuntimeState::updateMega2SafetyStatus(st);
    return r;
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

bool Mega2Client::sbhfSelftestRetry()
{
    const uint8_t cmd = M2_CMD_SBH_SELFTEST_RETRY;

    uint8_t resp = 0;
    const auto r = I2CBus::writeReadEx(MEGA2_ADDR, &cmd, sizeof(cmd), &resp, sizeof(resp), 1000);
    if (r != I2CBus::Result::OK)
        return false;

    return (resp == 1);
}

bool Mega2Client::sbhfSelftestStartup()
{
    const uint8_t cmd = M2_CMD_SBH_SELFTEST_STARTUP;
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

    uint8_t resp = 0;
    const auto r = writeReadRetry(MEGA2_ADDR, buf, sizeof(buf), &resp, sizeof(resp), 8000);
    if (r != I2CBus::Result::OK)
        return false;

    DBG_PRINTF(
        resp
            ? (on ? "[M2] NOTAUS SET OK\n" : "[M2] NOTAUS RELEASE OK\n")
            : "[M2] NOTAUS CMD FAIL\n"
    );

    return (resp == 1);
}

bool Mega2Client::setRunMode(uint8_t mode)
{
    uint8_t buf[2];
    buf[0] = M2_CMD_SET_RUNMODE;
    buf[1] = mode; // 0=AUTOMATIK, 1=DIAG_TEST

    uint8_t resp = 0;
    const auto r = writeReadRetry(MEGA2_ADDR, buf, sizeof(buf), &resp, sizeof(resp), 8000);
    if (r != I2CBus::Result::OK)
        return false;

    DBG_PRINTF(resp ? "[M2] RUNMODE %u OK\n" : "[M2] RUNMODE %u FAIL\n", (unsigned)mode);
    return (resp == 1);
}

bool Mega2Client::powerOn()
{
    const uint8_t cmd = M2_CMD_POWER_ON;

    uint8_t resp = 0;
    const auto r = writeReadRetry(MEGA2_ADDR, &cmd, sizeof(cmd), &resp, sizeof(resp), 8000);
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

    uint8_t resp = 0;
    const auto r = writeReadRetry(MEGA2_ADDR, buf, sizeof(buf), &resp, sizeof(resp), 8000);
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


bool Mega2Client::diagRelaySet(uint8_t bit, bool on)
{
    uint8_t buf[1 + sizeof(Mega2DiagRelaySetPayload)];
    buf[0] = M2_CMD_SET_DIAG_RELAY;
    buf[1] = bit;
    buf[2] = on ? 1 : 0;

    uint8_t resp = 0;
    const auto r = writeReadRetry(MEGA2_ADDR, buf, sizeof(buf), &resp, sizeof(resp), 8000);
    if (r != I2CBus::Result::OK)
        return false;

    DBG_PRINTF(resp ? "[M2] DIAG_RELAY_SET bit=%u on=%u OK\n" : "[M2] DIAG_RELAY_SET bit=%u on=%u FAIL\n",
               (unsigned)bit, (unsigned)(on ? 1 : 0));

    return (resp == 1);
}

bool Mega2Client::diagRelayPulse(uint8_t bit, uint16_t ms)
{
    // Payload: [cmd, bit, msLo, msHi]
    uint8_t buf[1 + sizeof(Mega2DiagRelayPulsePayload)];
    buf[0] = M2_CMD_PULSE_DIAG_RELAY;
    buf[1] = bit;
    buf[2] = (uint8_t)(ms & 0xFF);
    buf[3] = (uint8_t)((ms >> 8) & 0xFF);

    uint8_t resp = 0;
    const auto r = writeReadRetry(MEGA2_ADDR, buf, sizeof(buf), &resp, sizeof(resp), 8000);
    if (r != I2CBus::Result::OK)
        return false;

    DBG_PRINTF(resp ? "[M2] DIAG_RELAY_PULSE bit=%u ms=%u OK\n" : "[M2] DIAG_RELAY_PULSE bit=%u ms=%u FAIL\n",
               (unsigned)bit, (unsigned)ms);

    return (resp == 1);
}

bool Mega2Client::powerOff()
{
    return setSsr(SSR_MAIN_ENABLE, false);
}

I2CBus::Result Mega2Client::pollEntryMatrix()
{
    const uint8_t cmd = M2_CMD_GET_ENTRY_MATRIX;

    uint16_t entry[9] = {0};
    const auto r = writeReadRetry(MEGA2_ADDR, &cmd, sizeof(cmd), entry, sizeof(entry), 15000);
    if (r == I2CBus::Result::OK)
        SystemRuntimeState::updateMega2EntryAllowed(entry, 9);
    return r;
}
I2CBus::Result Mega2Client::pollEntryPreviewMatrix()
{
    const uint8_t cmd = M2_CMD_GET_ENTRY_PREVIEW_MATRIX;

    uint16_t entry[9] = {0};
    const auto r = writeReadRetry(MEGA2_ADDR, &cmd, sizeof(cmd), entry, sizeof(entry), 15000);
    if (r == I2CBus::Result::OK)
        SystemRuntimeState::updateMega2EntryPreview(entry, 9);
    return r;
}