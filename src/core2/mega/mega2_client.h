#pragma once

#include <stdint.h>

#include "../bus/i2c_bus.h"
#include "system/system_status_payload.h"
#include "proto_common.h" // Mega2AnalogPayload + CMD_GET_M2_ANALOG

namespace Mega2Client
{
    void begin();

    I2CBus::Result pollStatus();

    I2CBus::Result pollSafetyStatus();

    I2CBus::Result pollEntryMatrix();
    I2CBus::Result pollEntryPreviewMatrix();

    // PendingMask (digital DRDY-driven)
    I2CBus::Result pollPendingMask(Mega2PendingMaskPayload& out);

    // einzelne Statuspakete (digital DRDY-driven)
    I2CBus::Result pollBlocksStatus();
    I2CBus::Result pollShadowStatus();
    I2CBus::Result pollTurnoutsStatus();

    // Mega2 Diag Sensors (Kontaktgleise + Schaltgleise) – read-only
    I2CBus::Result pollDiagSensors(Mega2DiagSensorsPayload& out);

    // Mega2 Diag Relays (Relais-Pin-Level, active-low) – read-only
    I2CBus::Result pollDiagRelays(Mega2DiagRelaysPayload& out);
     
    // Analogwerte (Trafo + Blockströme)
    I2CBus::Result pollAnalog();
    const Mega2AnalogPayload& analog();

    bool safetyAck();
    bool sbhfSelftestRetry();
    bool sbhfSelftestStartup();
    bool setNotaus(bool on);
    bool powerOn();
    // Mega2 Betriebsmodus: 0=AUTOMATIK, 1=DIAG_TEST
    bool setRunMode(uint8_t mode);

    bool powerOff();
    bool setSsr(uint8_t idx, bool on);
}
