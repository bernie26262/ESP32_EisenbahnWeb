#pragma once
#include <Arduino.h>
#include <stdint.h>
#include "system/system_status_payload.h"
#include "system/mega1_diag_payload.h"
#include "system/mega2_schaltgleise_payload.h"
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

    // Heartbeat: count any successful Mega1 I2C transaction as link activity (updates online timeout)
    void noteMega1LinkActivity();

    bool mega1Online();
    const SystemStatus& mega1Status();

    // Mega1 Diagnose (read-only)
    void updateMega1Diag(const Mega1DiagV1& d);
    const Mega1DiagV1& mega1Diag();

    // ----------------------------------------------------
    // Mega2 Schaltgleise S11..S16 (Diagnose, read-only)
    // ----------------------------------------------------
    void updateMega2Schaltgleise(const Mega2SchaltgleiseDiagV1& p);
    bool mega2SchaltgleiseValid();
    uint8_t mega2SchaltgleiseSeq();
    uint32_t mega2SchaltgleiseLastUpdateMs();
    void mega2GetSchaltgleise6(uint8_t sid[6], uint8_t level[6], uint16_t rise[6], uint16_t fall[6]);

    // ----------------------------------------------------
    // Mega2 Diag Sensors (Kontaktgleise + Schaltgleise, compact masks+counters)
    // read-only, nur im diag WS stream
    // ----------------------------------------------------
    void updateMega2DiagSensors(const Mega2DiagSensorsPayload& p);
    bool mega2DiagSensorsValid();
    uint8_t mega2DiagSensorsSeq();
    uint32_t mega2DiagSensorsLastUpdateMs();
    uint32_t mega2DiagSensorsAgeMs();
    const Mega2DiagSensorsPayload& mega2DiagSensors();;

    // Abgeleitete Safety-Informationen
    bool safetyLock();
    SafetyReason safetyReason();
    const char* safetyErrorText(uint8_t type, uint8_t index);

    extern uint8_t  errorType;
    extern uint8_t  errorIndex;

    uint8_t safetyBlockReason();
    const char* safetyLockText();

    // ----------------------------------------------------
    // Boot-Detection / Startup-Checklist (Supervisor)
    //
    // Zweck:
    // - ESP-Reboot soll NICHT automatisch eine neue Checklist erzwingen,
    //   wenn die Megas bereits laenger laufen.
    // - Mega-Reboot (bootId-Wechsel) soll fuer genau diesen Mega die
    //   Checklist wieder oeffnen.
    
    



    bool mega1NeedsStartupChecklist();
    bool mega2NeedsStartupChecklist();
    bool mega1BootChanged();
    bool mega2BootChanged();
    void markMega1ChecklistDone();
    void markMega2ChecklistDone();
    
    // Mega2 Startup-Checklist Step: SBHF Selftest beendet
    // (setzt NICHT automatisch needsChecklist=false!)
    bool mega2SelftestDone();

    // Mega1 Startup-Checklist Step: Weichen-Selbsttest beendet (durchgefuehrt)
    // Understand: "done" != "PASS". PASS/FAIL wird ueber FailMask als Warning abgebildet.
    // (setzt NICHT automatisch needsChecklist=false!)
    bool mega1SelftestDone();

    // ----------------------------------------------------
    // --- Simulation helpers ---
    void setBypassSbhfSelftest(bool en);
    bool bypassSbhfSelftest();


    // ----------------------------------------------------
    // Step 3.5: Block-Einfahrten (FROM->TO) (Mega2)
    // ----------------------------------------------------
    const uint16_t* mega2EntryAllowed();
    void updateMega2EntryAllowed(const uint16_t* arr, uint8_t n);
    
    const uint16_t* mega2EntryPreview();
    void updateMega2EntryPreview(const uint16_t* arr, uint8_t n); 

    // ----------------------------------------------------
    // Mega2 Blocks / Shadow (digital DRDY-driven)
    // ----------------------------------------------------
    const BlockStatus* mega2BlockStatus();
    void updateMega2BlockStatus(const BlockStatus* arr, uint8_t n);

    const ShadowYardStatus& mega2ShadowStatus();
    void updateMega2ShadowStatus(const ShadowYardStatus& st);

    // Mega2 Turnouts (digital DRDY-driven, SBHF IST/SOLL)
    const Mega2TurnoutsPayload& mega2Turnouts();
    uint32_t mega2TurnoutsAgeMs();
    void updateMega2Turnouts(const Mega2TurnoutsPayload& t);

     // ----------------------------------------------------
     // Mega2 Analog (Trafo + Blockströme)
     // ----------------------------------------------------
     void updateMega2Analog(const Mega2AnalogPayload& p);
     const Mega2AnalogPayload& mega2Analog();
     uint32_t mega2AnalogAgeMs();

     // Diag meta (ESP-seitig): letzte Aktualisierung + gemessene Update-Frequenz
     uint32_t mega2AnalogLastUpdateMs();
     float mega2AnalogHz();
}
