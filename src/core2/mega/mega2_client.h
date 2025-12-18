#pragma once

#include <stdint.h>
#include "system/system_status_payload.h"

namespace Mega2Client
{
    void begin();

    // Liefert true, wenn Mega2 erreichbar und Status gültig
    bool pollStatus();

    // Safety
    bool safetyAck();          // ACK (M2_CMD_ACK_ERROR)
    bool setNotaus(bool on);   // NOTHALT / POWER ON (M2_CMD_SET_NOTAUS)
}
