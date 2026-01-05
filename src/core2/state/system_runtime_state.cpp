#include <Arduino.h>
#include "system_runtime_state.h"
#include "debug.h"
#include "proto_common.h"   // <-- für SAFETY_BLOCK_*

// ----------------------------------------------------
// Interner Zustand
// ----------------------------------------------------
static SystemStatus s_m2Status{};

// Step 3.5: Entry-Matrix Cache (FROM->TO)
static uint16_t     s_m2EntryAllowed[9]  = {0};
static uint16_t     s_m2EntryPreview[9]  = {0};
static uint32_t     s_lastEntryRxMs = 0;
static uint32_t     s_lastRxMs = 0;

uint8_t SystemRuntimeState::errorType  = 0;
uint8_t SystemRuntimeState::errorIndex = 0;

static bool         s_safetyLock   = false;
static SafetyReason s_safetyReason = SafetyReason::NONE;

// 🔴 NEU: UI-Block-Grund (BOOT / NOTAUS / NONE)
static uint8_t      s_blockReasonUi = SAFETY_BLOCK_NONE;

// 🔴 NEU: Dirty-Flag (extern definiert, z. B. in main.cpp)
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
    // NOT-AUS hat Vorrang
    if (st.flags & SYS_NOTAUS_ACTIVE)
        return SAFETY_BLOCK_EMERGENCY;

    // Error ohne Not-Aus = Systemstart / Quittierung
    if (st.flags & SYS_ERROR_PRESENT)
        return SAFETY_BLOCK_BOOT;

    return SAFETY_BLOCK_NONE;
}

// ----------------------------------------------------
// Update vom Mega2
// ----------------------------------------------------
void SystemRuntimeState::updateMega2Status(const SystemStatus& st)
{
    s_m2Status = st;
    s_lastRxMs = millis();

    s_safetyLock =
        (st.flags & SYS_NOTAUS_ACTIVE) ||
        (st.flags & SYS_ERROR_PRESENT);

    s_safetyReason  = deriveSafetyReason(st);
    s_blockReasonUi = deriveUiBlockReason(st);

    // Fehlerdetails aus Mega2
    errorType  = st.safetyErrorType;
    errorIndex = st.safetyErrorIndex;

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

// ----------------------------------------------------
// Getter
// ----------------------------------------------------
bool SystemRuntimeState::mega2Online()
{
    return (millis() - s_lastRxMs) < 1000;
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

// 🔴 NEU: für WebUI
uint8_t SystemRuntimeState::safetyBlockReason()
{
    return s_blockReasonUi;
}

// ----------------------------------------------------
// Klartext für WebUI
// ----------------------------------------------------
const char* SystemRuntimeState::safetyErrorText(uint8_t type, uint8_t index)
{
    // 1️⃣ Konkrete Fehler aus Mega2
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

    // 2️⃣ Kein errorType → UI-Block-Grund entscheidet
    if (!s_safetyLock)
        return "";

    if (s_blockReasonUi == SAFETY_BLOCK_BOOT)
        return "Systemstart – Quittierung erforderlich";

    if (s_blockReasonUi == SAFETY_BLOCK_EMERGENCY)
        return "NOT-AUS – Anlage gestoppt";

    return "Safety aktiv – bitte quittieren (ACK)";
}


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
