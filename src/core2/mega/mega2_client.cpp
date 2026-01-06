#include "mega2_client.h"

#include "../bus/i2c_bus.h"
#include "../state/system_runtime_state.h"

#include "proto_common.h"
#include "system/system_status_payload.h"

#include "debug.h"


//#define DEBUG_I2C   // ← HIER

static constexpr uint8_t MEGA2_ADDR = 0x11;

// ------------------------------------------------------------
// Initialisierung (derzeit leer)
// ------------------------------------------------------------
void Mega2Client::begin()
{
    // aktuell nichts nötig
}

// ------------------------------------------------------------
// Polling: Status von Mega2 abholen
// ------------------------------------------------------------
bool Mega2Client::pollStatus()
{
    SystemStatus tmpStatus{};
    constexpr uint16_t expected = sizeof(SystemStatus);

    // Mega2 liefert SystemStatus direkt auf requestFrom (ohne vorheriges CMD)
    if (!I2CBus::read(MEGA2_ADDR, &tmpStatus, expected))
        return false;

    // Sanity / Version check (v2)
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
        return false;
    }

    SystemRuntimeState::updateMega2Status(tmpStatus);
    return true;
}

// ------------------------------------------------------------
// SAFETY: Fehler quittieren (ACK)
// Protokoll: 1 Byte Command, 1 Byte Response
// ------------------------------------------------------------ 
bool Mega2Client::safetyAck()
{
    uint8_t cmd = M2_CMD_ACK_ERROR;

    uint8_t resp = 0;
    if (!I2CBus::writeRead(MEGA2_ADDR, &cmd, sizeof(cmd), &resp, sizeof(resp), 1000))
        return false;

    return (resp == 1);
}

// ------------------------------------------------------------
// SAFETY: NOTAUS setzen / lösen
// Protokoll: [cmd, 0/1], keine Response
// ------------------------------------------------------------
bool Mega2Client::setNotaus(bool on)
{
    uint8_t buf[2];
    buf[0] = M2_CMD_SET_NOTAUS;
    buf[1] = on ? 1 : 0;

    // 1) Command senden
    if (!I2CBus::write(MEGA2_ADDR, buf, sizeof(buf)))
        return false;

    // 2) kurze Pause
    delayMicroseconds(1000);

    // 3) 1-Byte-Response lesen (WICHTIG!)
    uint8_t resp = 0;
    if (!I2CBus::read(MEGA2_ADDR, &resp, sizeof(resp)))
        return false;

    DBG_PRINTF(
        resp
            ? (on ? "[M2] NOTAUS SET OK\n" : "[M2] NOTAUS RELEASE OK\n")
            : "[M2] NOTAUS CMD FAIL\n"
    );

    return (resp == 1);
}

// ------------------------------------------------------------
// POWER ON
// ------------------------------------------------------------
bool Mega2Client::powerOn()
{
    uint8_t cmd = M2_CMD_POWER_ON;

    // 1) Command senden
    if (!I2CBus::write(MEGA2_ADDR, &cmd, sizeof(cmd)))
        return false;

    // 2) kurze Pause
    delayMicroseconds(1000);

    // 3) 1-Byte-Response lesen (WICHTIG!)
    uint8_t resp = 0;
    if (!I2CBus::read(MEGA2_ADDR, &resp, sizeof(resp)))
        return false;

    DBG_PRINTF(
        resp
            ? "[M2] POWER ON OK\n"
            : "[M2] POWER ON FAIL\n"
    );

    return (resp == 1);
}

// ------------------------------------------------------------
// Generisch: SSR schalten (Mega2 SafetySSR)
// Protokoll: [cmd, ssrIndex, 0/1] + 1-Byte-Response
// ------------------------------------------------------------
bool Mega2Client::setSsr(uint8_t idx, bool on)
{
    uint8_t buf[3];
    buf[0] = M2_CMD_SET_SSR;
    buf[1] = idx;
    buf[2] = on ? 1 : 0;

    if (!I2CBus::write(MEGA2_ADDR, buf, sizeof(buf)))
        return false;

    delayMicroseconds(1000);

    uint8_t resp = 0;
    if (!I2CBus::read(MEGA2_ADDR, &resp, sizeof(resp)))
        return false;

    DBG_PRINTF(
        resp
            ? (on ? "[M2] SSR %u ON OK\n" : "[M2] SSR %u OFF OK\n")
            : "[M2] SSR %u CMD FAIL\n",
        (unsigned)idx
    );

    return (resp == 1);
}

// ------------------------------------------------------------
// STOP/PowerOff: MAIN_ENABLE aus
// ------------------------------------------------------------
bool Mega2Client::powerOff()
{
    return setSsr(SSR_MAIN_ENABLE, false);
}



namespace Mega2Client {
bool pollEntryMatrix()
{
    uint8_t cmd = M2_CMD_GET_ENTRY_MATRIX;
    if (!I2CBus::write(MEGA2_ADDR, &cmd, sizeof(cmd)))
        return false;

    delayMicroseconds(1000);

    uint16_t entry[9] = {0};
    if (!I2CBus::read(MEGA2_ADDR, entry, sizeof(entry)))
        return false;

    SystemRuntimeState::updateMega2EntryAllowed(entry, 9);
    return true;
}


bool pollEntryPreviewMatrix()
{
    uint8_t cmd = M2_CMD_GET_ENTRY_PREVIEW_MATRIX;
    if (!I2CBus::write(MEGA2_ADDR, &cmd, sizeof(cmd)))
        return false;

    delayMicroseconds(1000);

    uint16_t entry[9] = {0};
    if (!I2CBus::read(MEGA2_ADDR, entry, sizeof(entry)))
        return false;

    SystemRuntimeState::updateMega2EntryPreview(entry, 9);
    return true;
}
} // namespace Mega2Client
