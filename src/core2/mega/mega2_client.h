#pragma once

#include <stdint.h>

#include "../bus/i2c_bus.h"
#include "system/system_status_payload.h"
#include "proto_common.h" // Mega2AnalogPayload + CMD_GET_M2_ANALOG

namespace Mega2Client
{
    void begin();

    I2CBus::Result pollStatus();

    bool pollSafetyStatus();

    bool pollEntryMatrix();
    bool pollEntryPreviewMatrix();

    // PendingMask (digital DRDY-driven)
    bool pollPendingMask(Mega2PendingMaskPayload& out);

    // einzelne Statuspakete (digital DRDY-driven)
    bool pollBlocksStatus();
    bool pollShadowStatus();
     
     // Analogwerte (Trafo + Blockströme)
     bool pollAnalog();
     const Mega2AnalogPayload& analog();

    bool safetyAck();
    bool sbhfSelftestRetry();
    bool setNotaus(bool on);
    bool powerOn();

    bool powerOff();
    bool setSsr(uint8_t idx, bool on);
}
