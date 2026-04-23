#include <Arduino.h>
#include "system_runtime_state.h"
#include "system/mega1_diag_payload.h"
#include "system/mega2_schaltgleise_payload.h"
#include "debug.h"
#include "proto_common.h"   // <-- für SAFETY_BLOCK_* + Mega2SafetyStatus
#include "web/webserver.h"

// ----------------------------------------------------
// Interner Zustand
// ----------------------------------------------------
static SystemStatus s_m2Status{};
static Mega2AnalogPayload s_m2Analog{};
static uint32_t s_m2AnalogTsMs = 0;
static uint32_t s_m2AnalogPrevTsMs = 0;
static float s_m2AnalogHz = 0.0f;

static SystemStatus s_m1Status{};
static Mega1DiagV1 s_m1Diag{};

// Mega1 sensors (15 used sensors, two pages 8+7)

// Mega2 Schaltgleise S11..S16
static bool     s_m2SchValid = false;
static uint8_t  s_m2SchSeq   = 0;
static uint32_t s_m2SchLastMs = 0;
static uint8_t  s_m2SchLevel[6] = {0};
static uint16_t s_m2SchRise[6]  = {0};
static uint16_t s_m2SchFall[6]  = {0};

// Mega2 Diag Sensors (Kontaktgleise + Schaltgleise, compact masks+counters)
static bool     s_m2DiagSensValid  = false;
static uint8_t  s_m2DiagSensSeq    = 0;
static uint32_t s_m2DiagSensLastMs = 0;
static Mega2DiagSensorsPayload s_m2DiagSens{};

// Mega2 Diag Relays (pin levels, active-low semantics)
static bool     s_m2DiagRelaysValid  = false;
static uint8_t  s_m2DiagRelaysSeq    = 0;
static uint32_t s_m2DiagRelaysLastMs = 0;
static Mega2DiagRelaysPayload s_m2DiagRelays{};

// NEU: Mega2SafetyStatus Cache (separat gepollt)
static Mega2SafetyStatus s_m2Safety{};

// Step 3.5: Entry-Matrix Cache (FROM->TO)
static uint16_t     s_m2EntryAllowed[9]  = {0};
static uint16_t     s_m2EntryPreview[9]  = {0};
static uint32_t     s_lastEntryRxMs = 0;
static uint32_t     s_lastRxMs = 0;


// Mega2 Blocks / Shadow caches (digital, DRDY-driven)
static BlockStatus      s_m2Blocks[M2_NUM_BLOCKS]{};
static ShadowYardStatus s_m2Shadow{};
static Mega2TurnoutsPayload s_m2Turnouts{};
static uint32_t         s_lastTurnoutsRxMs = 0;
static uint32_t         s_lastBlocksRxMs = 0;
static uint32_t         s_lastShadowRxMs = 0;

static uint32_t     s_lastRxMsM1 = 0;
uint8_t SystemRuntimeState::errorCause      = 0;
uint8_t SystemRuntimeState::errorIndex      = 0;
uint8_t SystemRuntimeState::errorDetailCode = 0;

// Online-edge tracking (for checklist logic)
static bool         s_m2OnlinePrev = false;
static bool         s_m1OnlinePrev = false;

// ----------------------------------------------------
// Boot-Detection / Startup-Checklist
// ----------------------------------------------------
struct BootTrack {
    bool     seen = false;
    uint16_t lastBootId = 0;
    bool     bootChanged = false;   // sticky within ESP session
    uint32_t lastUptimeMs = 0;
};

static BootTrack s_m1Boot{};
static BootTrack s_m2Boot{};

// Selftest edge tracking (Mega2 SBHF)
static bool s_m2SelftestRunningPrev = false;
static bool s_m2SelftestDone = false; // Step marker (does NOT auto-complete checklist)
static bool s_m2ChecklistClosed = false; // Startup-Checklist fuer aktuellen Mega2-Boot explizit quittiert

// Selftest tracking (Mega1 Weichen)
static bool s_m1SelftestDone = false; // Step marker (does NOT auto-complete checklist)
static bool s_m1ChecklistClosed = false; // Startup-Checklist fuer aktuellen Mega1-Boot explizit quittiert
static bool s_m1SelftestRunningPrev = false;
static bool s_m1SelftestEverRunning = false;

// Simulation: Startup-Checklist Mega2/SBHF Selftest-Step überspringen
static bool s_bypassSbhfSelftest = false;

static bool updateBootTrack(BootTrack& bt, const SystemStatus& st)
{
    static constexpr uint32_t UPTIME_REBOOT_MARGIN_MS = 5000;
    bool rebootDetected = false;

    // Guard: Ignore clearly invalid status frames.
    // These can occur transiently on I2C glitches / partial reads.
    // If we treat them as real data, we may falsely detect "reboot" and re-open the startup checklist,
    // which then causes the retry-loop you observed.
    if (st.bootId == 0 && st.uptimeMs == 0)
    {
        return false;
    }


    if (!bt.seen)
    {
        bt.seen = true;
        bt.lastBootId = st.bootId;
        bt.lastUptimeMs = st.uptimeMs;

        // Keine Checklist-Heuristik mehr beim ersten Wiedersehen nach ETH-Reboot.
        // Die Startup-Pflicht wird aus den autoritativen Mega-Selbsttestdaten abgeleitet.
        rebootDetected = false;
        return rebootDetected;
    }

    // Reboot detection by uptime going backwards (covers the case bootId is constant/invalid)
    // NOTE: Ignore uptime==0 as "invalid/uninitialized" (do not treat as reboot).
    if (st.uptimeMs != 0 &&
        st.uptimeMs + UPTIME_REBOOT_MARGIN_MS < bt.lastUptimeMs)
    {
        rebootDetected = true;
        bt.bootChanged = true;      // treat as reboot event
        bt.lastBootId = st.bootId;  // keep for completeness
        bt.lastUptimeMs = st.uptimeMs;
        return rebootDetected;
    }

    bt.lastUptimeMs = st.uptimeMs;


    // Ignore bootId changes to/from 0 (invalid/uninitialized).
    // Only treat real bootId changes as reboot trigger.
    if (st.bootId != 0 &&
        bt.lastBootId != 0 &&
        st.bootId != bt.lastBootId)
    {
        rebootDetected = true;
        bt.lastBootId = st.bootId;
        bt.bootChanged = true;
    }

    return rebootDetected;

}


static bool         s_safetyLock   = false;
static SafetyReason s_safetyReason = SafetyReason::NONE;

// UI-Block-Grund (BOOT / NOTAUS / NONE)
static uint8_t      s_blockReasonUi = SAFETY_BLOCK_NONE;

// Diag-Dirty Flag (extern definiert, WebSocket diag channel)
extern volatile bool g_diagDirty;

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
    const SystemStatus prev = s_m2Status;
    s_m2Status = st;
    s_lastRxMs = millis();

    // Change detection (digital fields only). IMPORTANT: ignore uptimeMs/seq to avoid periodic WS spam.
    bool changed = false;
    if (prev.flags             != st.flags)             changed = true;
    if (prev.blockOccupiedMask != st.blockOccupiedMask) changed = true;
    if (prev.reserved          != st.reserved)          changed = true;
    if (prev.sbhfState         != st.sbhfState)         changed = true;
    if (prev.sbhfOccupiedMask  != st.sbhfOccupiedMask)  changed = true;
    if (prev.sbhfCurrentGleis  != st.sbhfCurrentGleis)  changed = true;
    if (prev.turnoutSollMask   != st.turnoutSollMask)   changed = true;
    if (prev.turnoutIstMask    != st.turnoutIstMask)    changed = true;
    if (prev.errorCause       != st.errorCause)       changed = true;
    if (prev.errorIndex       != st.errorIndex)       changed = true;
    if (prev.errorDetailCode  != st.errorDetailCode)  changed = true;

    const bool wasOnlinePrev = s_m2OnlinePrev;

    // selftestRunning is encoded as META bit 0x80 in sbhfOccupiedMask.
    const bool selftestRunning = ((st.sbhfOccupiedMask & 0x80u) != 0);
    // selftestDone is encoded as META bit 0x40 in sbhfOccupiedMask.
    const bool selftestDoneMeta = ((st.sbhfOccupiedMask & 0x40u) != 0);

    // Step marker: Selftest finished (running -> not running) => remember "done".
    // IMPORTANT: does NOT close checklist (contract: only after full user flow incl. ACK).
    if (s_m2SelftestRunningPrev && !selftestRunning)
    {
        s_m2SelftestDone = true;
        markStateDirtyAll();
    }
    // Robust fallback:
    // After cold start we may first observe Mega2 already in DONE state,
    // without ever seeing the running->not running transition locally.
    if (selftestDoneMeta && !s_m2SelftestDone)
    {
        s_m2SelftestDone = true;
        markStateDirtyAll();
    }
    s_m2SelftestRunningPrev = selftestRunning;

    // If Mega2 just came back online (offline -> online), treat as a fresh "first seen"
    // for checklist/boot detection. This fixes the case where bt.seen stayed true across
    // transient bus issues or link-layer online changes, causing small uptimeMs to be ignored.
    if (!s_m2OnlinePrev)
        s_m2Boot.seen = false;
    s_m2OnlinePrev = true;
    
    if (!wasOnlinePrev)
        markStateDirtyAll();
    const bool rebootDetected = updateBootTrack(s_m2Boot, st);
    if (rebootDetected)
    { 
        s_m2SelftestDone = false;
        s_m2ChecklistClosed = false;
        // boot-related UI fields changed (bootId/uptime/checklist)
        markStateDirtyAll();
    }

    s_safetyLock =
        (st.flags & SYS_NOTAUS_ACTIVE) ||
        (st.flags & SYS_ERROR_PRESENT);

    s_safetyReason  = deriveSafetyReason(st);
    s_blockReasonUi = deriveUiBlockReason(st);

    // Fehlerdetails aus Mega2
    errorCause      = st.errorCause;
    errorIndex      = st.errorIndex;
    errorDetailCode = st.errorDetailCode;

    // REMOVE / DISABLE: checklist auto-clear for Mega2
// if (s_m2Boot.needsChecklist)
// {
//     const bool bootErr = ((st.flags & SYS_ERROR_PRESENT) != 0);
//     const bool notaus  = ((st.flags & SYS_NOTAUS_ACTIVE) != 0);
//     if (s_m2SelftestDone && !bootErr && !notaus)
//     {
//         s_m2Boot.needsChecklist = false;
//         s_m2SelftestDone = false;
//         markStateDirtyAll();
//     }
// }

    static uint16_t lastFlags = 0xFFFF;
    if (st.flags != lastFlags)
    {
        lastFlags = st.flags;

        DBG_PRINTF(
            "[SAFETY] lock=%d reason=%u blockUi=%u flags=0x%04X errC=%u errI=%u errD=%u\n",
            s_safetyLock,
            (uint8_t)s_safetyReason,
            s_blockReasonUi,
            st.flags,
            errorCause,
            errorIndex,
            errorDetailCode
        );
    }
    // WS: only mark dirty if something relevant changed.
    if (changed)
        markStateDirtyAll();
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
        s_m1ChecklistClosed = false;
        s_m1SelftestRunningPrev = false;
        s_m1SelftestEverRunning = false;
    }
    markStateDirtyAll();
}

bool SystemRuntimeState::mega2SelftestDone()
{
    // SIM helper: when bypass is enabled, treat the SBHF selftest-step as done.
    // This affects ONLY the startup checklist step marker; it must not alter Mega2 safety logic.
    if (s_bypassSbhfSelftest)
        return true;
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
    // NOTE: Full-poll interval is 8000ms, so timeout must be > 8000ms.
    const bool on = (millis() - s_lastRxMsM1) < 12000;
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

void SystemRuntimeState::noteMega1LinkActivity()
{
    // Count any successful Mega1 transaction (e.g. CMD_GET_PENDING_MASK OK) as link activity.
    // Do NOT touch boot-tracking markers here; those belong to real payload updates (status/diag).
    s_lastRxMsM1 = millis();
}


void SystemRuntimeState::updateMega1Diag(const Mega1DiagV1& d)
{
    s_m1Diag     = d;

    // Treat any valid Mega1 diag packet as link activity (prevents online flaps
    // when STATUS is polled slowly and DIAG is read more often).
    s_lastRxMsM1 = millis();

    const bool running  = ((d.selftestFlags & 0x01u) != 0);
    if (running) s_m1SelftestEverRunning = true;

    // Startup-Checklist Step: Mega1 Weichen-Selbsttest
    // Contract:
    // - Der Step-Marker s_m1SelftestDone schliesst NICHT automatisch die Checklist.
    // - "Done" gilt, sobald der Selbsttest als DONE gemeldet wird, unabhängig von PASS/FAIL.
    //   PASS/FAIL wird ueber selftestFailMask als Warning/Diag dargestellt.
    const bool doneFlag = ((d.selftestFlags & 0x02u) != 0);
    // robust/sticky: sobald DONE einmal gesehen wurde, bleibt der Step gesetzt
    // (Reset nur bei Bootwechsel, nicht bei Poll-Flaps und nicht bei FailMask!=0)
    if (doneFlag && !s_m1SelftestDone)
    {
        s_m1SelftestDone = true;
        markStateDirtyAll();
    }
    s_m1SelftestRunningPrev = running;
    markStateDirtyAll();
}

// =====================================================
// Mega2 Schaltgleise S11..S16 (6 Sensoren)
// =====================================================
void SystemRuntimeState::updateMega2Schaltgleise(const Mega2SchaltgleiseDiagV1& p)
{
    if (p.version != 1) return;

    s_m2SchValid  = true;
    s_m2SchSeq    = p.seq;
    s_m2SchLastMs = (uint32_t)millis();

    for (uint8_t i = 0; i < 6; ++i)
    {
        s_m2SchLevel[i] = ((p.levelBits >> i) & 0x01u);
        s_m2SchRise[i]  = p.riseCount[i];
        s_m2SchFall[i]  = p.fallCount[i];
    }
}

bool SystemRuntimeState::mega2SchaltgleiseValid()
{
    return s_m2SchValid;
}

uint8_t SystemRuntimeState::mega2SchaltgleiseSeq()
{
    return s_m2SchSeq;
}

uint32_t SystemRuntimeState::mega2SchaltgleiseLastUpdateMs()
{
    return s_m2SchLastMs;
}

void SystemRuntimeState::mega2GetSchaltgleise6(uint8_t sid[6], uint8_t level[6], uint16_t rise[6], uint16_t fall[6])
{
    // fixed mapping idx 0..5 => S11..S16
    for (uint8_t i = 0; i < 6; ++i)
    {
        sid[i]   = (uint8_t)(11 + i);
        level[i] = s_m2SchLevel[i];
        rise[i]  = s_m2SchRise[i];
        fall[i]  = s_m2SchFall[i];
    }
}

// =====================================================
// Mega2 Diag Sensors (Kontaktgleise + Schaltgleise)
// =====================================================
void SystemRuntimeState::updateMega2DiagSensors(const Mega2DiagSensorsPayload& p)
{
    // Instant UI update trigger (diag.htm): only if payload advanced.
    const bool changed = (!s_m2DiagSensValid) || (p.seq != s_m2DiagSensSeq);

    s_m2DiagSens = p;
    s_m2DiagSensSeq = p.seq;
    s_m2DiagSensLastMs = (uint32_t)millis();
    s_m2DiagSensValid = true;
    
    if (changed) {
        // NOTE: This follows the same on-change/instant pattern used for other
        // "spritzig" diag elements (coalesced by Web::pushDiagIfNeeded()).
        g_diagDirty = true;
    }
}

bool SystemRuntimeState::mega2DiagSensorsValid()
{
    return s_m2DiagSensValid;
}

uint8_t SystemRuntimeState::mega2DiagSensorsSeq()
{
    return s_m2DiagSensSeq;
}

uint32_t SystemRuntimeState::mega2DiagSensorsLastUpdateMs()
{
    return s_m2DiagSensLastMs;
}

uint32_t SystemRuntimeState::mega2DiagSensorsAgeMs()
{
    if (!s_m2DiagSensValid) return 0xFFFFFFFFu;
    return (uint32_t)((uint32_t)millis() - s_m2DiagSensLastMs);
}

const Mega2DiagSensorsPayload& SystemRuntimeState::mega2DiagSensors()
{
    return s_m2DiagSens;
}

void SystemRuntimeState::updateMega2DiagRelays(const Mega2DiagRelaysPayload& p)
{
    const bool changed = (!s_m2DiagRelaysValid) || (p.seq != s_m2DiagRelaysSeq) || (p.levelMask != s_m2DiagRelays.levelMask);

    s_m2DiagRelays = p;
    s_m2DiagRelaysSeq = p.seq;
    s_m2DiagRelaysLastMs = (uint32_t)millis();
    s_m2DiagRelaysValid = true;

    if (changed) g_diagDirty = true;
}

bool SystemRuntimeState::mega2DiagRelaysValid() { return s_m2DiagRelaysValid; }
uint8_t SystemRuntimeState::mega2DiagRelaysSeq() { return s_m2DiagRelaysSeq; }
uint32_t SystemRuntimeState::mega2DiagRelaysLastUpdateMs() { return s_m2DiagRelaysLastMs; }
uint32_t SystemRuntimeState::mega2DiagRelaysAgeMs()
{
    if (!s_m2DiagRelaysValid) return 0xFFFFFFFFu;
    return (uint32_t)((uint32_t)millis() - s_m2DiagRelaysLastMs);
}
const Mega2DiagRelaysPayload& SystemRuntimeState::mega2DiagRelays() { return s_m2DiagRelays; }

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
    markStateDirtyAll();
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
    // NOTE: Full-poll interval is 8000ms, so timeout must be > 8000ms.
    const bool on = (millis() - s_lastRxMs) < 12000;
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
    if (!mega1Online())
        return false;

    return !s_m1ChecklistClosed;
}

bool SystemRuntimeState::mega2NeedsStartupChecklist()
{
    // SIM helper: when bypass is enabled, treat SBHF startup checklist as not required.
    if (s_bypassSbhfSelftest)
        return false;
    
    if (!mega2Online())
        return false;

    return !s_m2ChecklistClosed;
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
    s_m1ChecklistClosed = true;
    markStateDirtyAll();
}

void SystemRuntimeState::markMega2ChecklistDone()
{
    s_m2ChecklistClosed = true;
    markStateDirtyAll();
}

void SystemRuntimeState::setBypassSbhfSelftest(bool en)
{
    if (s_bypassSbhfSelftest != en)
    {
        s_bypassSbhfSelftest = en;
        markStateDirtyAll();
    }
}

bool SystemRuntimeState::bypassSbhfSelftest()
{
    return s_bypassSbhfSelftest;
}

// ----------------------------------------------------
// Klartext für WebUI
// ----------------------------------------------------
const char* SystemRuntimeState::safetyErrorText(uint8_t cause, uint8_t index, uint8_t detailCode)
{
    (void)detailCode;

    if (cause != 0)
    {
        switch (cause)
        {
            case 1:
                return "Falschfahrt SBHF";

            case 2:
                return "Timeout Einfahrt SBHF";

            case 3:
                return "Einfahrt SBHF in falsches Gleis";

            case 4: {
                static char buf[40];
                snprintf(buf, sizeof(buf), "SBHF Exit Timeout Gleis %u", index);
                return buf;
            }

            case 5: {
                static char buf[48];
                snprintf(buf, sizeof(buf), "Weichenfehler SBHF W%u", index);
                return buf;
            }

            case 6: {
                static char buf[40];
                snprintf(buf, sizeof(buf), "Doppelbelegung Block %u", index);
                return buf;
            }

            case 7: {
                static char buf[40];
                snprintf(buf, sizeof(buf), "Kurzschluss Block %u", index);
                return buf;
            }

            case 8:
                return "Controller-Fehler";

            case 9:
                return "Not-Aus";

            case 10:
                return "Controller-Fehler SBHF";

            default:
                return "Unbekannter Sicherheitsfehler";
        }
    }

    if (!s_safetyLock)
        return "";

    if (s_blockReasonUi == SAFETY_BLOCK_BOOT)
        return "Systemstart – Quittierung erforderlich";

    if (s_blockReasonUi == SAFETY_BLOCK_EMERGENCY)
        return "Notaus aktiv";

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

const BlockStatus* SystemRuntimeState::mega2BlockStatus()
{
    return s_m2Blocks;
}

void SystemRuntimeState::updateMega2BlockStatus(const BlockStatus* arr, uint8_t n)
{
    if (!arr) return;
    if (n > M2_NUM_BLOCKS) n = M2_NUM_BLOCKS;

    for (uint8_t i = 0; i < n; i++)
        s_m2Blocks[i] = arr[i];

    s_lastBlocksRxMs = millis();
    markStateDirtyAll();
}

const ShadowYardStatus& SystemRuntimeState::mega2ShadowStatus()
{
    return s_m2Shadow;
}

void SystemRuntimeState::updateMega2ShadowStatus(const ShadowYardStatus& st)
{
    s_m2Shadow = st;
    s_lastShadowRxMs = millis();

    const bool selftestRunning = ((st.selftestFlags & 0x01u) != 0u);
    const bool selftestDone    = ((st.selftestFlags & 0x02u) != 0u);

    // If Shadow status already reports RUNNING, remember that locally as well.
    // This keeps the later running->not running transition detection robust even
    // if status/shadow packets arrive in an unlucky order.
    if (selftestRunning) {
        s_m2SelftestRunningPrev = true;
    }

    // Robust/sticky startup step marker for Mega2:
    // as soon as DONE is seen in the authoritative ShadowYardStatus, keep the
    // startup selftest-step marked done until the next real Mega2 reboot.
    if (selftestDone && !s_m2SelftestDone) {
        s_m2SelftestDone = true;
        markStateDirtyAll();
    }

    markStateDirtyAll();
}

const Mega2TurnoutsPayload& SystemRuntimeState::mega2Turnouts()
{
    return s_m2Turnouts;
}

uint32_t SystemRuntimeState::mega2TurnoutsAgeMs()
{
    if (s_lastTurnoutsRxMs == 0) return 0xFFFFFFFFu;
    return (uint32_t)(millis() - s_lastTurnoutsRxMs);
}

void SystemRuntimeState::updateMega2Turnouts(const Mega2TurnoutsPayload& t)
{
    s_m2Turnouts = t;
    s_lastTurnoutsRxMs = millis();
    markStateDirtyAll();
}

void SystemRuntimeState::updateMega2EntryAllowed(const uint16_t* arr, uint8_t n)
{
    if (!arr) return;
    if (n > 9) n = 9;

    for (uint8_t i = 0; i < n; i++)
        s_m2EntryAllowed[i] = arr[i];

    s_lastEntryRxMs = millis();
    markStateDirtyAll();
}

void SystemRuntimeState::updateMega2EntryPreview(const uint16_t* arr, uint8_t n)
{
    if (!arr) return;
    if (n > 9) n = 9;

    for (uint8_t i = 0; i < n; i++)
        s_m2EntryPreview[i] = arr[i];

    s_lastEntryRxMs = millis();
    markStateDirtyAll();
}
 
 void SystemRuntimeState::updateMega2Analog(const Mega2AnalogPayload& p)
 {
    // Keep previous timestamp for Hz estimation
    const uint32_t now = (uint32_t)millis();
    const uint32_t prev = s_m2AnalogTsMs;

    s_m2Analog = p;
    s_m2AnalogPrevTsMs = prev;
    s_m2AnalogTsMs = now;

    // Estimate effective update frequency (ESP-side, measured at reception time)
    if (prev != 0 && now > prev) {
        const uint32_t dt = now - prev;
        if (dt > 0) {
            const float instHz = 1000.0f / (float)dt;
            // simple low-pass filter to reduce jitter
            s_m2AnalogHz = (s_m2AnalogHz <= 0.01f) ? instHz : (0.8f * s_m2AnalogHz + 0.2f * instHz);
        }
    }

    // IMPORTANT: analog is streamed separately (periodic WS message),
    // so it must not trigger the full digital WS "state" push.
 }
 
 const Mega2AnalogPayload& SystemRuntimeState::mega2Analog()
 {
     return s_m2Analog;
 }
 
 uint32_t SystemRuntimeState::mega2AnalogAgeMs()
 {
     if (s_m2AnalogTsMs == 0) return 0xFFFFFFFFu;
     return (uint32_t)(millis() - s_m2AnalogTsMs);
 }

uint32_t SystemRuntimeState::mega2AnalogLastUpdateMs()
{
    return s_m2AnalogTsMs;
}

float SystemRuntimeState::mega2AnalogHz()
{
    return s_m2AnalogHz;
}