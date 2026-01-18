#include <Arduino.h>
#include "system_runtime_state.h"
#include "system/mega1_diag_payload.h"
#include "debug.h"
#include "proto_common.h"   // <-- für SAFETY_BLOCK_* + Mega2SafetyStatus

// ----------------------------------------------------
// Interner Zustand
// ----------------------------------------------------
static SystemStatus s_m2Status{};

static SystemStatus s_m1Status{};
static Mega1DiagV1 s_m1Diag{};
// NEU: Mega2SafetyStatus Cache (separat gepollt)
static Mega2SafetyStatus s_m2Safety{};

// Step 3.5: Entry-Matrix Cache (FROM->TO)
static uint16_t     s_m2EntryAllowed[9]  = {0};
static uint16_t     s_m2EntryPreview[9]  = {0};
static uint32_t     s_lastEntryRxMs = 0;
static uint32_t     s_lastRxMs = 0;

static uint32_t     s_lastRxMsM1 = 0;
uint8_t SystemRuntimeState::errorType  = 0;
uint8_t SystemRuntimeState::errorIndex = 0;

// Online-edge tracking (for checklist logic)
static bool         s_m2OnlinePrev = false;
static bool         s_m1OnlinePrev = false;

// ----------------------------------------------------
// Boot-Detection / Startup-Checklist
// ----------------------------------------------------
// Guard-Zeit: nur fuer den Sonderfall "ESP rebootet und hat sein RAM verloren".
// Wenn ein Mega laenger als diese Zeit laeuft, behandeln wir ihn beim ersten
// Empfang nach ESP-Boot als "nicht frisch gebootet".
static constexpr uint32_t ESP_REBOOT_GUARD_MS = 60000; // 60s konservativ

struct BootTrack {
    bool     seen = false;
    uint16_t lastBootId = 0;
    bool     bootChanged = false;   // sticky within ESP session
    bool     needsChecklist = false;
    uint32_t lastUptimeMs = 0;
};

static BootTrack s_m1Boot{};
static BootTrack s_m2Boot{};

// Selftest edge tracking (Mega2 SBHF)
static bool s_m2SelftestRunningPrev = false;
static bool s_m2SelftestDone = false; // Step marker (does NOT auto-complete checklist)

// Selftest tracking (Mega1 Weichen)
static bool s_m1SelftestDone = false; // Step marker (does NOT auto-complete checklist)
static bool s_m1SelftestRunningPrev = false;
static bool s_m1SelftestEverRunning = false;

static bool updateBootTrack(BootTrack& bt, const SystemStatus& st)
{
    static constexpr uint32_t UPTIME_REBOOT_MARGIN_MS = 5000;
    bool rebootDetected = false;

    if (!bt.seen)
    {
        bt.seen = true;
        bt.lastBootId = st.bootId;
        bt.lastUptimeMs = st.uptimeMs;

        // ESP-Reboot-Fall: Mega lief schon -> keine neue Checklist erzwingen
        bt.needsChecklist = (st.uptimeMs <= ESP_REBOOT_GUARD_MS);
        rebootDetected = bt.needsChecklist; // treat "fresh" as requiring checklist
        return rebootDetected;
    }

    // Reboot detection by uptime going backwards (covers the case bootId is constant/invalid)
    if (st.uptimeMs + UPTIME_REBOOT_MARGIN_MS < bt.lastUptimeMs)
    {
        rebootDetected = true;
        bt.bootChanged = true;      // treat as reboot event
        bt.needsChecklist = true;
        bt.lastBootId = st.bootId;  // keep for completeness
        bt.lastUptimeMs = st.uptimeMs;
        return rebootDetected;
    }

    bt.lastUptimeMs = st.uptimeMs;


    if (st.bootId != bt.lastBootId)
    {
        rebootDetected = true;
        bt.lastBootId = st.bootId;
        bt.bootChanged = true;
        bt.needsChecklist = true;
    }

    return rebootDetected;

}


static bool         s_safetyLock   = false;
static SafetyReason s_safetyReason = SafetyReason::NONE;

// UI-Block-Grund (BOOT / NOTAUS / NONE)
static uint8_t      s_blockReasonUi = SAFETY_BLOCK_NONE;

// Dirty-Flag (extern definiert)
extern volatile bool g_stateDirty;

// ----------------------------------------------------
// Interne Ableitung (Debug / Diagnose)
// ----------------------------------------------------
static SafetyReason deriveSafetyReason(const SystemStatus& st)
{
    if (st.flags & SYS_CONTROLLER_RESET)
        return SafetyReason::CONTROLLER_RESET;

    if (st.flags & SYS_NOTAUS_ACTIVE)
        return SafetyReason::NOTAUS;

    if (st.flags & SYS_ERROR_PRESENT)
        return SafetyReason::ERROR_PRESENT;

    if (st.flags != 0)
        return SafetyReason::UNKNOWN;

    return SafetyReason::NONE;
}

// ----------------------------------------------------
// UI-Block-Grund (entscheidend!)
// ----------------------------------------------------
static uint8_t deriveUiBlockReason(const SystemStatus& st)
{
    if (st.flags & SYS_NOTAUS_ACTIVE)
        return SAFETY_BLOCK_EMERGENCY;

    if (st.flags & SYS_ERROR_PRESENT)
        return SAFETY_BLOCK_BOOT;

    return SAFETY_BLOCK_NONE;
}

// ----------------------------------------------------
// Update vom Mega2 (SystemStatus)
// ----------------------------------------------------
void SystemRuntimeState::updateMega2Status(const SystemStatus& st)
{
    s_m2Status = st;
    s_lastRxMs = millis();

    // selftestRunning is encoded as META bit 0x80 in sbhfOccupiedMask.
    const bool selftestRunning = ((st.sbhfOccupiedMask & 0x80u) != 0);
    // Step marker: Selftest finished (running -> not running) => remember "done".
    // IMPORTANT: does NOT close checklist (contract: only after full user flow incl. ACK).
    if (s_m2Boot.needsChecklist && s_m2SelftestRunningPrev && !selftestRunning)
    {
        s_m2SelftestDone = true;
        g_stateDirty = true;
    }
    s_m2SelftestRunningPrev = selftestRunning;

    // If Mega2 just came back online (offline -> online), treat as a fresh "first seen"
    // for checklist/boot detection. This fixes the case where bt.seen stayed true across
    // transient bus issues or link-layer online changes, causing small uptimeMs to be ignored.
    if (!s_m2OnlinePrev)
        s_m2Boot.seen = false;
    s_m2OnlinePrev = true;
    const bool rebootDetected = updateBootTrack(s_m2Boot, st);
    if (rebootDetected)
        s_m2SelftestDone = false;

    s_safetyLock =
        (st.flags & SYS_NOTAUS_ACTIVE) ||
        (st.flags & SYS_ERROR_PRESENT);

    s_safetyReason  = deriveSafetyReason(st);
    s_blockReasonUi = deriveUiBlockReason(st);

    // Fehlerdetails aus Mega2
    errorType  = st.safetyErrorType;
    errorIndex = st.safetyErrorIndex;

    // REMOVE / DISABLE: checklist auto-clear for Mega2
// if (s_m2Boot.needsChecklist)
// {
//     const bool bootErr = ((st.flags & SYS_ERROR_PRESENT) != 0);
//     const bool notaus  = ((st.flags & SYS_NOTAUS_ACTIVE) != 0);
//     if (s_m2SelftestDone && !bootErr && !notaus)
//     {
//         s_m2Boot.needsChecklist = false;
//         s_m2SelftestDone = false;
//         g_stateDirty = true;
//     }
// }

    static uint16_t lastFlags = 0xFFFF;
    if (st.flags != lastFlags)
    {
        lastFlags = st.flags;

        DBG_PRINTF(
            "[SAFETY] lock=%d reason=%u blockUi=%u flags=0x%04X errT=%u errI=%u\n",
            s_safetyLock,
            (uint8_t)s_safetyReason,
            s_blockReasonUi,
            st.flags,
            errorType,
            errorIndex
        );
    }
    g_stateDirty = true;
}

void SystemRuntimeState::updateMega1Status(const SystemStatus& st)
{
    s_m1Status   = st;
    s_lastRxMsM1 = millis();
    if (!s_m1OnlinePrev)
        s_m1Boot.seen = false;
    s_m1OnlinePrev = true;    
    const bool rebootDetected = updateBootTrack(s_m1Boot, st);
    if (rebootDetected)
    {
        // Reset startup-checklist step markers only on real Mega1 reboot
        // (bootId/uptime detection). Do NOT reset on short online flaps.
        s_m1SelftestDone = false;
        s_m1SelftestRunningPrev = false;
        s_m1SelftestEverRunning = false;
    }
    g_stateDirty = true;
}

bool SystemRuntimeState::mega2SelftestDone()
{
    return s_m2SelftestDone;
}

bool SystemRuntimeState::mega1SelftestDone()
{
    return s_m1SelftestDone;
}


bool SystemRuntimeState::mega1Online()
{
    // I2C polls can temporarily fail (e.g. bus contention). Treat Mega1 as online
    // for a longer grace period to avoid UI flapping.
    const bool on = (millis() - s_lastRxMsM1) < 3000;
    if (!on)
    {
        // Mark link as offline, but keep selftest markers.
        // They must only reset on Mega1 reboot (bootId/uptime), not on short flaps.
        s_m1OnlinePrev = false;
    }
    return on;
}

const SystemStatus& SystemRuntimeState::mega1Status()
{
    return s_m1Status;
}



void SystemRuntimeState::updateMega1Diag(const Mega1DiagV1& d)
{
    s_m1Diag     = d;

    const bool running  = ((d.selftestFlags & 0x01u) != 0);
    if (running) s_m1SelftestEverRunning = true;

    // Startup-Checklist Step: Mega1 Weichen-Selbsttest
    // Contract:
    // - Der Step-Marker s_m1SelftestDone schliesst NICHT automatisch die Checklist.
    // - "Done" gilt, sobald der Selbsttest als DONE gemeldet wird, unabhängig von PASS/FAIL.
    //   PASS/FAIL wird ueber selftestFailMask als Warning/Diag dargestellt.
    if (s_m1Boot.needsChecklist)
    {
        const bool doneFlag = ((d.selftestFlags & 0x02u) != 0);
        // robust/sticky: sobald DONE einmal gesehen wurde, bleibt der Step gesetzt
        // (Reset nur bei Bootwechsel, nicht bei Poll-Flaps und nicht bei FailMask!=0)
        if (doneFlag && !s_m1SelftestDone)
        {
            s_m1SelftestDone = true;
            g_stateDirty = true;
        }
    }
    s_m1SelftestRunningPrev = running;
    g_stateDirty = true;
}

const Mega1DiagV1& SystemRuntimeState::mega1Diag()
{
    return s_m1Diag;
}
// ----------------------------------------------------
// NEU: Update Mega2SafetyStatus (CMD 0x20)
// ----------------------------------------------------
void SystemRuntimeState::updateMega2SafetyStatus(const Mega2SafetyStatus& st)
{
    s_m2Safety = st;
    g_stateDirty = true;
}

const Mega2SafetyStatus& SystemRuntimeState::mega2SafetyStatus()
{
    return s_m2Safety;
}

// ----------------------------------------------------
// Getter
// ----------------------------------------------------
bool SystemRuntimeState::mega2Online()
{
    const bool on = (millis() - s_lastRxMs) < 3000;
    if (!on) { s_m2OnlinePrev = false; s_m2SelftestRunningPrev = false; }
    return on;
}

const SystemStatus& SystemRuntimeState::mega2Status()
{
    return s_m2Status;
}

bool SystemRuntimeState::safetyLock()
{
    return s_safetyLock;
}

SafetyReason SystemRuntimeState::safetyReason()
{
    return s_safetyReason;
}

uint8_t SystemRuntimeState::safetyBlockReason()
{
    return s_blockReasonUi;   
}

// ----------------------------------------------------
// Boot-Detection / Startup-Checklist Getter/Setter
// ----------------------------------------------------
bool SystemRuntimeState::mega1NeedsStartupChecklist()
{
    return s_m1Boot.needsChecklist;
}

bool SystemRuntimeState::mega2NeedsStartupChecklist()
{
    return s_m2Boot.needsChecklist;
}

bool SystemRuntimeState::mega1BootChanged()
{
    return s_m1Boot.bootChanged;
}

bool SystemRuntimeState::mega2BootChanged()
{
    return s_m2Boot.bootChanged;
}

void SystemRuntimeState::markMega1ChecklistDone()
{
    s_m1Boot.needsChecklist = false;
    g_stateDirty = true;
}

void SystemRuntimeState::markMega2ChecklistDone()
{
    s_m2Boot.needsChecklist = false;
    g_stateDirty = true;
}

// ----------------------------------------------------
// Klartext für WebUI
// ----------------------------------------------------
const char* SystemRuntimeState::safetyErrorText(uint8_t type, uint8_t index)
{
    if (type != 0)
    {
        switch (type)
        {
            case 1:
                return "Nothalt ausgelöst";

            case 2: {
                static char buf[32];
                snprintf(buf, sizeof(buf), "Kurzschluss in Block %u", index);
                return buf;
            }

            case 3: {
                static char buf[48];
                snprintf(buf, sizeof(buf),
                         "Schattenbahnhof: Fehler an Weiche %u", index);
                return buf;
            }

            default:
                return "Unbekannter Sicherheitsfehler";
        }
    }

    if (!s_safetyLock)
        return "";

    if (s_blockReasonUi == SAFETY_BLOCK_BOOT)
        return "Systemstart – Quittierung erforderlich";

    if (s_blockReasonUi == SAFETY_BLOCK_EMERGENCY)
        return "NOT-AUS – Anlage gestoppt";

    return "Safety aktiv – bitte quittieren (ACK)";
}

// ----------------------------------------------------
// Entry-Matrix Getter/Setter
// ----------------------------------------------------
const uint16_t* SystemRuntimeState::mega2EntryAllowed()
{
    return s_m2EntryAllowed;
}

const uint16_t* SystemRuntimeState::mega2EntryPreview()
{
    return s_m2EntryPreview;
}

void SystemRuntimeState::updateMega2EntryAllowed(const uint16_t* arr, uint8_t n)
{
    if (!arr) return;
    if (n > 9) n = 9;

    for (uint8_t i = 0; i < n; i++)
        s_m2EntryAllowed[i] = arr[i];

    s_lastEntryRxMs = millis();
    g_stateDirty = true;
}

void SystemRuntimeState::updateMega2EntryPreview(const uint16_t* arr, uint8_t n)
{
    if (!arr) return;
    if (n > 9) n = 9;

    for (uint8_t i = 0; i < n; i++)
        s_m2EntryPreview[i] = arr[i];

    s_lastEntryRxMs = millis();
    g_stateDirty = true;
}
