#pragma once

#include "core2/bus/i2c_bus.h"
#include "system/system_status_payload.h"

namespace Mega1Client
{
    // ------------------------------------------------------------
    // Mega1 DRDY Pending Bits (müssen 1:1 zur Mega1-Firmware passen)
    // ------------------------------------------------------------
    enum : uint16_t
    {
        M1_PEND_STATUS = 0x0001,
        M1_PEND_DIAG   = 0x0002,
        // reserviert:
        // M1_PEND_xxx = 0x0004,
    };

    void begin();
    I2CBus::Result pollStatus();
    I2CBus::Result pollDiag();
    // Convenience (startup bootstrap): poll STATUS then DIAG
    I2CBus::Result pollStatusAndDiag();

    
    // DRDY: pending mask lesen (read-only)
    I2CBus::Result pollPendingMask(uint16_t& outMask);
    // Alias (lesbarer in Link-Code)
    inline I2CBus::Result getPendingMask(uint16_t& outMask) { return pollPendingMask(outMask); }

// Commands (Master -> Mega1)
I2CBus::Result cmdSetMode(uint8_t mode);                 // 0=MANUELL,1=AUTO
I2CBus::Result cmdSetWeiche(uint8_t idx, bool gerade);   // 0..11
I2CBus::Result cmdSetBhfPower(uint8_t bhf, bool on);     // 0..3
I2CBus::Result cmdStartSelftest();                       // start Weichen-Selftest
I2CBus::Result cmdAutoReset();                           // counters reset + Grundstellung

}
