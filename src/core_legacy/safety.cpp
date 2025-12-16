#include "safety.h"

namespace Safety {

static bool s_active = false;
static NothaltReason s_reason = NothaltReason::NONE;
static uint32_t s_info = 0;

// ---------------------------------------------------------
//  String-Konvertierung der Reason Codes
// ---------------------------------------------------------
const char* reasonToString(NothaltReason reason)
{
    switch (reason) {
        case NothaltReason::NONE:          return "NONE";
        case NothaltReason::SENSOR_FAULT:  return "Sensor Fault";
        case NothaltReason::MEGA_TIMEOUT:  return "Mega Timeout";
        case NothaltReason::OVERCURRENT:   return "Overcurrent";
        case NothaltReason::MANUAL:        return "Manual Emergency Stop";
        case NothaltReason::ETH_LOSS:      return "Ethernet Loss";
        default:                           return "Unknown";
    }
}

// ---------------------------------------------------------
//  Not-Halt setzen
// ---------------------------------------------------------
void setNothalt(NothaltReason reason, uint32_t info)
{
    s_active = true;
    s_reason = reason;
    s_info   = info;

    Serial.printf("[NOTHALT] Activated: %s (info=%u)\n",
                  reasonToString(reason), info);
}

// ---------------------------------------------------------
//  Not-Halt löschen
// ---------------------------------------------------------
void clearNothalt()
{
    Serial.printf("[NOTHALT] Cleared (last=%s)\n", reasonToString(s_reason));
    s_active = false;
    s_reason = NothaltReason::NONE;
    s_info   = 0;
}

bool isActive() { return s_active; }
NothaltReason lastReason() { return s_reason; }
uint32_t lastInfo() { return s_info; }

} // namespace Safety
