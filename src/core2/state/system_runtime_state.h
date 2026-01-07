#pragma once
#include <Arduino.h>
#include <stdint.h>
#include "system/system_status_payload.h"
#include "system/mega1_diag_payload.h"
#include "proto_common.h"   // Mega2SafetyStatus

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

    // NEU: Mega2 SafetyStatus separat (I2C CMD 0x20)
    void updateMega2SafetyStatus(const Mega2SafetyStatus& st);
    const Mega2SafetyStatus& mega2SafetyStatus();

    // Verbindungsstatus
    bool mega2Online();

    // Rohstatus (Payload)
    const SystemStatus& mega2Status();


    // ----------------------------------------------------
    // Mega1 (minimal)
    // ----------------------------------------------------
    void updateMega1Status(const SystemStatus& st);
    bool mega1Online();
    const SystemStatus& mega1Status();

    // Mega1 Diagnose (read-only)
    void updateMega1Diag(const Mega1DiagV1& d);
    const Mega1DiagV1& mega1Diag();
    // Abgeleitete Safety-Informationen
    bool safetyLock();
    SafetyReason safetyReason();
    const char* safetyErrorText(uint8_t type, uint8_t index);

    extern uint8_t  errorType;
    extern uint8_t  errorIndex;

    uint8_t safetyBlockReason();
    const char* safetyLockText();

    // ----------------------------------------------------
    // Step 3.5: Block-Einfahrten (FROM->TO) (Mega2)
    // ----------------------------------------------------
    const uint16_t* mega2EntryAllowed();
    void updateMega2EntryAllowed(const uint16_t* arr, uint8_t n);

    const uint16_t* mega2EntryPreview();
    void updateMega2EntryPreview(const uint16_t* arr, uint8_t n);
}
