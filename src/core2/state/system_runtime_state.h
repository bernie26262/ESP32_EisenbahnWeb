#pragma once
#include <Arduino.h>
#include <stdint.h>
#include "system/system_status_payload.h"

// =====================================================
// Safety-Grund (Diagnose, keine Logik!)
// =====================================================
enum class SafetyReason : uint8_t
{
    NONE = 0,
    NOTAUS,
    ERROR_PRESENT,
    CONTROLLER_RESET,
    UNKNOWN
};

namespace SystemRuntimeState
{
    // Update vom Mega2 (Polling)
    void updateMega2Status(const SystemStatus& st);

    // Verbindungsstatus
    bool mega2Online();

    // Rohstatus (Payload)
    const SystemStatus& mega2Status();

    // Abgeleitete Safety-Informationen
    bool safetyLock();
    SafetyReason safetyReason();
}
