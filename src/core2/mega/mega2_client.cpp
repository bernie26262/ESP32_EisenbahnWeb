#include "mega2_client.h"

#include "../bus/i2c_bus.h"
#include "../state/system_runtime_state.h"

#include "proto_common.h"
#include "system/system_status_payload.h"

#include "debug.h"

static constexpr uint8_t MEGA2_ADDR = 0x11;

// ------------------------------------------------------------
// Initialisierung (derzeit leer)
// ------------------------------------------------------------
void Mega2Client::begin()
{
    // aktuell nichts nötig
}

// ------------------------------------------------------------
// Polling: kompletten SystemStatus lesen
// Gibt false zurück, wenn Mega2 nicht erreichbar ist
// ------------------------------------------------------------
bool Mega2Client::pollStatus()
{
    SystemStatus st{};
    if (!I2CBus::read(MEGA2_ADDR, &st, sizeof(st)))
        return false;

    if (st.version != SYSTEM_STATUS_VERSION || st.nodeId != NODE_MEGA2)
        return false;
    
    static uint16_t lastFlags = 0xFFFF;

    if (st.flags != lastFlags)
    {
        lastFlags = st.flags;

        DBG_PRINTF(
            "[M2] flags=0x%04X NOTAUS=%d ERROR=%d\n",
            st.flags,
            (st.flags & SYS_NOTAUS_ACTIVE) != 0,
            (st.flags & SYS_ERROR_PRESENT) != 0
        );
    }

    SystemRuntimeState::updateMega2Status(st);
    return true;
}

// ------------------------------------------------------------
// SAFETY: Notaus / Fehler quittieren
// Protokoll: 1 Byte Command, 1 Byte Response
// ------------------------------------------------------------
bool Mega2Client::safetyAck()
{
    uint8_t cmd = M2_CMD_ACK_ERROR;

    // 1) Command senden
    if (!I2CBus::write(MEGA2_ADDR, &cmd, sizeof(cmd)))
        return false;

    // 2) ESP32 braucht kurze Pause
    delayMicroseconds(1000);

    // 3) 1-Byte-Response lesen
    uint8_t resp = 0;
    if (!I2CBus::read(MEGA2_ADDR, &resp, sizeof(resp)))
        return false;

    return (resp == 1);
}
