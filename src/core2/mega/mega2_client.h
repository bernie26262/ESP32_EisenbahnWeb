#pragma once

#include <stdint.h>
#include "system/system_status_payload.h"

namespace Mega2Client
{
    void begin();

    bool pollStatus();

    // NEU: SafetyStatus (CMD 0x20)
    bool pollSafetyStatus();

    // Step 3.5
    bool pollEntryMatrix();
    bool pollEntryPreviewMatrix();

    // Safety / Power
    bool safetyAck();          // ACK
    bool setNotaus(bool on);   // bleibt für Test/Sim
    bool powerOn();            // M2_CMD_POWER_ON

    // NEU: STOP/PowerOff = SSR_MAIN_ENABLE aus
    bool powerOff();

    // NEU: generisch SSR setzen (für PowerOff/PowerOn-Alternativen)
    bool setSsr(uint8_t idx, bool on);
}
