#pragma once

#include <stdint.h>
#include "system/system_status_payload.h"

namespace Mega2Client
{
    void begin();

    // Liefert true, wenn Mega2 erreichbar und Status gültig
    bool pollStatus();

    // Safety-Quittierung (1-Byte Command / 1-Byte Response)
    bool safetyAck();
}
