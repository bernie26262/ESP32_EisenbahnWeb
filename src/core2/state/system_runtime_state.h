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
    // 🔴 NEU: Klartext für Safety-Fehler
    const char* safetyErrorText(uint8_t type, uint8_t index);

    extern uint8_t  errorType;
    extern uint8_t  errorIndex;

    // UI: blockReason für WebUI (SAFETY_BLOCK_* Werte aus proto_common.h)
    uint8_t safetyBlockReason();

    // UI: Text wenn Lock aktiv aber kein spezifischer Fehlertext existiert
    const char* safetyLockText();


// ----------------------------------------------------
// Step 3.5: Block-Einfahrten (FROM->TO) (Mega2)
// Array index: from-1 (B1..B9), Bit(to-1)=1 => Einfahrt erlaubt
// ----------------------------------------------------
const uint16_t* mega2EntryAllowed();
void updateMega2EntryAllowed(const uint16_t* arr, uint8_t n);

// Preview: Topologie + Ziel frei (ohne Laufzeitbedingungen)
const uint16_t* mega2EntryPreview();
void updateMega2EntryPreview(const uint16_t* arr, uint8_t n);

}
