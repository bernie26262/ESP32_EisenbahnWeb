#include "mega2_client.h"

#include "../bus/i2c_bus.h"
#include "../state/system_runtime_state.h"

#include "proto_common.h"
#include "system/system_status_payload.h"

#include "debug.h"

#include <Wire.h>

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
// Polling: kompletten SystemStatus lesen
// Gibt false zurück, wenn Mega2 nicht erreichbar ist
// ------------------------------------------------------------


bool Mega2Client::pollStatus()
{
    // 1. Adresse ansprechen (Existenz prüfen)
    Wire.beginTransmission(MEGA2_ADDR);
    uint8_t rc = Wire.endTransmission();
    

    #ifdef DEBUG_I2C
    Serial.printf("[I2C][pollStatus] endTransmission rc=%u\n", rc);
    #endif

    if (rc != 0)
        return false;

    // 2. Status anfordern
    SystemStatus tmpStatus;

    constexpr uint8_t expected = sizeof(SystemStatus);
    uint8_t got = Wire.requestFrom(MEGA2_ADDR, expected);

    #ifdef DEBUG_I2C
    Serial.printf(
        "[I2C][pollStatus] requestFrom got=%u (expected %u)\n",
        got, sizeof(SystemStatus)
    );
    #endif

    if (got < expected)
        return false;

    // 3. In temporären Puffer lesen
    Wire.readBytes(
        reinterpret_cast<uint8_t*>(&tmpStatus),
        expected
    );

    // 4. Gültigen Status ins Runtime-State übernehmen
    SystemRuntimeState::updateMega2Status(tmpStatus);

    #ifdef DEBUG_I2C
    Serial.println("[I2C][pollStatus] OK");
    #endif

    return true;
}



// ------------------------------------------------------------
// SAFETY: Fehler quittieren (ACK)
// Protokoll: 1 Byte Command, 1 Byte Response
// ------------------------------------------------------------
bool Mega2Client::safetyAck()
{
    uint8_t cmd = M2_CMD_ACK_ERROR;

    // 1) Command senden
    if (!I2CBus::write(MEGA2_ADDR, &cmd, sizeof(cmd)))
        return false;

    // 2) kurze Pause
    delayMicroseconds(1000);

    // 3) 1-Byte-Response lesen
    uint8_t resp = 0;
    if (!I2CBus::read(MEGA2_ADDR, &resp, sizeof(resp)))
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

    bool ok = I2CBus::write(MEGA2_ADDR, buf, sizeof(buf));

    DBG_PRINTF(
        ok
            ? (on ? "[M2] NOTAUS SET\n" : "[M2] NOTAUS RELEASE\n")
            : "[M2] NOTAUS CMD FAIL\n"
    );

    return ok;
}

// ------------------------------------------------------------
// SAFETY: explizites Wiedereinschalten der Leistung
// Protokoll: [cmd], keine Response
// ------------------------------------------------------------
bool Mega2Client::powerOn()
{
    uint8_t cmd = M2_CMD_POWER_ON;

    bool ok = I2CBus::write(MEGA2_ADDR, &cmd, sizeof(cmd));

    DBG_PRINTF(
        ok
            ? "[M2] POWER ON CMD\n"
            : "[M2] POWER ON CMD FAIL\n"
    );

    return ok;
}
