#include <Arduino.h>
#include "system_runtime_state.h"
#include "debug.h"

// ----------------------------------------------------
// Interner Zustand
// ----------------------------------------------------
static SystemStatus s_m2Status{};
static uint32_t     s_lastRxMs = 0;
uint8_t SystemRuntimeState::errorType  = 0;
uint8_t SystemRuntimeState::errorIndex = 0;

static bool         s_safetyLock   = false;
static SafetyReason s_safetyReason = SafetyReason::NONE;

// 🔴 NEU: Dirty-Flag (extern definiert, z. B. in main.cpp)
extern volatile bool g_stateDirty;

// ----------------------------------------------------
// Interne Ableitung des Safety-Grundes
// ----------------------------------------------------
static SafetyReason deriveSafetyReason(const SystemStatus& st)
{
    if (st.flags & SYS_NOTAUS_ACTIVE)
        return SafetyReason::NOTAUS;
    if (st.flags & SYS_ERROR_PRESENT)
        return SafetyReason::ERROR_PRESENT;
    if (st.flags & SYS_CONTROLLER_RESET)
        return SafetyReason::CONTROLLER_RESET;
    if (st.flags != 0)
        return SafetyReason::UNKNOWN;
    return SafetyReason::NONE;
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

    s_safetyReason = deriveSafetyReason(st);

    // 🔴 NEU: Fehlerdetails aus Mega2 übernehmen
    SystemRuntimeState::errorType  = st.safetyErrorType;
    SystemRuntimeState::errorIndex = st.safetyErrorIndex;

    static uint16_t lastFlags = 0xFFFF;

    if (st.flags != lastFlags)
    {
        lastFlags = st.flags;

        DBG_PRINTF(
            "[SAFETY] lock=%d reason=%u flags=0x%04X\n",
            s_safetyLock,
            (uint8_t)s_safetyReason,
            st.flags
        );
    }

    // 🔴 NEU: Event markieren
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

const char* SystemRuntimeState::safetyErrorText(uint8_t type, uint8_t index)
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
            snprintf(buf, sizeof(buf), "Schattenbahnhof: Fehler an Weiche %u", index);
            return buf;
        }

        default:
            return "";
    }
}

