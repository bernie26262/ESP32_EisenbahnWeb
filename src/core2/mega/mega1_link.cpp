#include "mega1_link.h"

#include <Arduino.h>
#include <Wire.h>

#include "core2/mega/mega1_client.h"
#include "core2/state/system_runtime_state.h"
#include "core2/bus/i2c_bus.h"
#include "core2/bus/gpio_isr_once.h"
#include "config/pins.h"
#include "debug.h"

// (moved into anonymous namespace below to avoid symbol/type ambiguity)

// WebSocket push trigger (defined in webserver.cpp; also set by SystemRuntimeState setters)
extern volatile bool g_stateDirty;
// Diag WS push trigger (exists in webserver.cpp)
extern volatile bool g_diagDirty;

#if defined(ESP32)
  #include "freertos/FreeRTOS.h"
  #include "freertos/portmacro.h"
  #include "driver/gpio.h"
  static portMUX_TYPE s_cmdMux = portMUX_INITIALIZER_UNLOCKED;
#endif

// ------------------------------------------------------------
// Command Queue (WebUI / Automatik -> Mega1)
// ------------------------------------------------------------
namespace
{
    enum : uint8_t { CMDQ_SET_MODE = 1, CMDQ_SET_WEICHE = 2, CMDQ_SET_BHF_POWER = 3, CMDQ_START_SELFTEST = 4 };

    // Mega1 I2C protocol (see Mega1 include/I2CProtocol.h):
    // CMD_START_SELFTEST = 0x07, Mega1 addr = 0x10
    static constexpr uint8_t M1_CMD_START_SELFTEST = 0x07;
    // ------------------------------------------------------------
    // Mega1 Diag: Relays/Outputs snapshot (CMD_GET_RELAYS = 0xD2)
    // Addr = 0x10
    // ------------------------------------------------------------
    #pragma pack(push, 1)
    struct Mega1DiagRelaysV1
    {
        uint8_t  version;      // = 1
        uint8_t  flags;        // bit0: valid
        uint8_t  seq;          // increments only on change (wrap ok)
        uint8_t  reserved0;

        uint16_t weicheGMask;
        uint16_t weicheAMask;
        uint16_t weicheRedMask;

        uint8_t  bhfPowerMask;
        uint8_t  reserved1;

        uint16_t uptime16;     // uptime/100ms (optional)
    };
    #pragma pack(pop)

    static_assert(sizeof(Mega1DiagRelaysV1) <= 32, "Mega1DiagRelaysV1 must fit into a single I2C frame (<=32B).");

    static constexpr uint8_t M1_CMD_GET_RELAYS = 0xD2;
    static constexpr uint8_t M1_I2C_ADDR      = 0x10;

    // Latest relays snapshot (updated by polling; served via diag WS)
    static Mega1DiagRelaysV1 s_m1Relays{};
    static uint8_t           s_m1RelaysSeqSeen = 0;
    static uint32_t          s_m1RelaysLastMs  = 0;
    static bool              s_m1RelaysValid   = false;

    // Expose for webserver.cpp (diag JSON builder)
    const Mega1DiagRelaysV1* mega1Link_getRelaysSnap(uint32_t* outAgeMs)
    {
        if (!s_m1RelaysValid) return nullptr;
        if (outAgeMs) *outAgeMs = (uint32_t)(millis() - s_m1RelaysLastMs);
        return &s_m1Relays;
    }
    
    static I2CBus::Result pollMega1RelaysReadOnly()
    {
        Mega1DiagRelaysV1 r{};
        const uint8_t cmd = M1_CMD_GET_RELAYS;

        // In this project, I2CBus::write/read return bool (success/fail).
        const bool okW = I2CBus::write(M1_I2C_ADDR, &cmd, 1);
        if (!okW) return I2CBus::Result::ERROR;

        const bool okR = I2CBus::read(M1_I2C_ADDR, (uint8_t*)&r, sizeof(r));
        if (!okR) return I2CBus::Result::ERROR;

        // Protocol sanity (no dedicated PROTO/FAIL enum here)
        if (r.version != 1 || (r.flags & 0x01u) == 0)
            return I2CBus::Result::ERROR;

        s_m1Relays       = r;
        s_m1RelaysLastMs = (uint32_t)millis();
        s_m1RelaysValid  = true;

        // spritzig: only on change
        if (r.seq != s_m1RelaysSeqSeen)
        {
            s_m1RelaysSeqSeen = r.seq;
            g_stateDirty = true;
            g_diagDirty  = true;
        }

        return I2CBus::Result::OK;
    }   


    struct CmdQItem
    {
        uint8_t type = 0;
        uint8_t a    = 0;
        uint8_t b    = 0;
    };

    static constexpr uint8_t CMDQ_SIZE = 8;
    static CmdQItem s_cmdq[CMDQ_SIZE];
    static volatile uint8_t s_qHead = 0;
    static volatile uint8_t s_qTail = 0;
    static volatile uint8_t s_qCount = 0;

    static inline bool cmdqPush(uint8_t type, uint8_t a, uint8_t b)
    {
#if defined(ESP32)
        portENTER_CRITICAL(&s_cmdMux);
#endif
        if (s_qCount >= CMDQ_SIZE)
        {
#if defined(ESP32)
            portEXIT_CRITICAL(&s_cmdMux);
#endif
            return false;
        }

        CmdQItem item;
        item.type = type;
        item.a = a;
        item.b = b;
        s_cmdq[s_qTail] = item;
        s_qTail = (uint8_t)((s_qTail + 1) % CMDQ_SIZE);
        s_qCount++;

#if defined(ESP32)
        portEXIT_CRITICAL(&s_cmdMux);
#endif
        return true;
    }

    static inline bool cmdqPeek(CmdQItem& out)
    {
#if defined(ESP32)
        portENTER_CRITICAL(&s_cmdMux);
#endif
        if (s_qCount == 0)
        {
#if defined(ESP32)
            portEXIT_CRITICAL(&s_cmdMux);
#endif
            return false;
        }

        out = s_cmdq[s_qHead];
#if defined(ESP32)
        portEXIT_CRITICAL(&s_cmdMux);
#endif
        return true;
    }

    static inline void cmdqPop()
    {
#if defined(ESP32)
        portENTER_CRITICAL(&s_cmdMux);
#endif
        if (s_qCount)
        {
            s_qHead = (uint8_t)((s_qHead + 1) % CMDQ_SIZE);
            s_qCount--;
        }
#if defined(ESP32)
        portEXIT_CRITICAL(&s_cmdMux);
#endif
    }
} // namespace

// ------------------------------------------------------------
// Export: Mega1 Relays/Outputs snapshot for webserver.cpp (diag WS)
// Returns true if a valid snapshot exists.
// ------------------------------------------------------------
bool mega1Link_getRelaysRO(uint8_t* outSeq,
                           uint32_t* outAgeMs,
                           uint16_t* outWeicheGMask,
                           uint16_t* outWeicheAMask,
                           uint16_t* outWeicheRedMask,
                           uint8_t*  outBhfPowerMask)
{
    // NOTE: These symbols live inside the anonymous namespace above.
    // We can still access them here because we're in the same translation unit.
    if (!s_m1RelaysValid) return false;

    if (outSeq)           *outSeq           = s_m1Relays.seq;
    if (outAgeMs)         *outAgeMs         = (uint32_t)(millis() - s_m1RelaysLastMs);
    if (outWeicheGMask)   *outWeicheGMask   = s_m1Relays.weicheGMask;
    if (outWeicheAMask)   *outWeicheAMask   = s_m1Relays.weicheAMask;
    if (outWeicheRedMask) *outWeicheRedMask = s_m1Relays.weicheRedMask;
    if (outBhfPowerMask)  *outBhfPowerMask  = s_m1Relays.bhfPowerMask;

    return true;
}

static uint32_t s_nextPollMs      = 0;
static uint32_t s_nextDiagPollMs  = 0;
static uint32_t s_pollIntervalMs  = 0;
static uint8_t  s_pollFailCount   = 0;
static bool     s_hadOk          = false;
static uint32_t s_lastPendMaskMs  = 0;
static uint32_t s_lastDrdyReadMs  = 0;
static uint8_t  s_drdyRr          = 0; // 0=status first, 1=diag first

static constexpr uint32_t POLL_STATUS_MS = 8000;
static constexpr uint32_t POLL_DIAG_MS   = 8000;
static constexpr uint32_t BUSY_RETRY_MS  = 30;

// ------------------------------------------------------------
// I2C Start-Gate: starte Polling erst, wenn Mega1 wirklich am Bus antwortet
// ------------------------------------------------------------
static bool     s_gateOk = false;
static uint32_t s_nextGateProbeMs = 0;
static constexpr uint32_t GATE_PROBE_MS = 250;

static bool probeI2CAddr(uint8_t addr)
{
    Wire.beginTransmission(addr);
    const uint8_t e = Wire.endTransmission(true);
    return (e == 0);
}


// ------------------------------------------------------------
// Mega1 DRDY (GPIO36): latch IRQ
// ------------------------------------------------------------
static volatile uint32_t s_drdyIrqCount = 0;
static volatile bool     s_drdyLatched  = false;

// cached pending mask (read via CMD_GET_PENDING_MASK)
static uint16_t s_cachedPendingMask = 0;
static uint32_t s_lastPendReadMs    = 0;
static bool     s_havePendingMask   = false;
static bool     s_rrPreferStatus    = true;
static constexpr uint32_t PEND_POLL_MIN_MS = 20; // debounce/limit I2C reads
static constexpr uint32_t PEND_POLL_IDLE_MS = 250; // baseline heartbeat poll when DRDY is HIGH
static uint32_t s_nextFastMs       = 0; // RR-Read Termin nach DRDY (entkoppelt von FullPoll)
static constexpr uint32_t DRDY_COOLDOWN_MS = PEND_POLL_MIN_MS; // limit DRDY burst while pin stays LOW
static uint32_t s_lastDrdyPollMs   = 0; // last DRDY-driven poll (pending + one payload)

// ------------------------------------------------------------
// Startup bootstrap poll (robust against missed DRDY edges)
// During the first seconds after gate OK, we actively pull STATUS+DIAG.
// This ensures UI does not get stuck in "selftest running" until first external toggle.
// ------------------------------------------------------------
static bool     s_bootstrapActive     = false;
static uint32_t s_bootstrapUntilMs    = 0;
static uint32_t s_lastBootstrapPollMs = 0;
static constexpr uint32_t BOOTSTRAP_MS       = 1200; // short burst
static constexpr uint32_t BOOTSTRAP_POLL_MS  = 50;   // fast during burst

// After burst: backoff polling while checklist still needs fresh DIAG (edge-miss-safe)
static uint32_t s_nextBackoffDiagMs   = 0;
static uint32_t s_backoffDiagMs       = 250;  // start gently
static constexpr uint32_t BACKOFF_MIN_MS = 250;
static constexpr uint32_t BACKOFF_MAX_MS = 1000;

// (removed duplicate relays snapshot; keep the one inside the anonymous namespace above)

// ------------------------------------------------------------
// Selftest/Startup watchdog:
// While Mega1 selftest is running (or checklist still needs it),
// do NOT rely on DRDY edges only. Poll DIAG periodically.
// ------------------------------------------------------------
static uint32_t s_nextFastDiagMs = 0;
static constexpr uint32_t FAST_DIAG_MS = 250; // less spam, still responsive


static void IRAM_ATTR onMega1DrdyIsr()
{
    s_drdyIrqCount++;
    s_drdyLatched = true;
}

#if defined(ESP32)
static void IRAM_ATTR onMega1DrdyIsr_idf(void* arg)
{
    (void)arg;
    onMega1DrdyIsr();
}
#endif

void Mega1Link::begin()
{
    Mega1Client::begin();

    s_nextPollMs     = millis() + 25;
    s_pollIntervalMs = POLL_STATUS_MS;
    s_pollFailCount  = 0;
    s_gateOk         = false;
    s_nextGateProbeMs = 0;
    s_hadOk          = false;


    s_bootstrapActive     = false;
    s_bootstrapUntilMs    = 0;
    s_lastBootstrapPollMs = 0;


    // DRDY input (idle HIGH, active LOW)
    pinMode(PIN_DATAREADY_1, INPUT_PULLUP);
#if defined(ESP32)
    // Log-free install: install ISR service only if needed
    (void)gpioIsrAddHandlerAutoInstall((gpio_num_t)PIN_DATAREADY_1,
                                       onMega1DrdyIsr_idf,
                                       nullptr,
                                       GPIO_INTR_NEGEDGE);
#else
    attachInterrupt(digitalPinToInterrupt(PIN_DATAREADY_1), onMega1DrdyIsr, FALLING);
#endif
    s_drdyIrqCount = 0;
    s_drdyLatched  = false;
    s_cachedPendingMask = 0;
    s_lastPendReadMs    = 0;
    s_lastDrdyPollMs     = 0;
    s_havePendingMask   = false;
    s_rrPreferStatus    = true;

    s_nextFastMs       = 0;
    
    // If DRDY is already LOW at boot (no falling edge for IRQ), treat as active immediately.
    if (digitalRead(PIN_DATAREADY_1) == LOW)
    {
        s_drdyLatched = true;
        DBG_PRINTLN("[M1LINK] DRDY already LOW at begin -> latch active");
    }

    DBG_PRINTLN("[M1LINK] begin()");
}

void Mega1Link::requestPollNow()
{
    s_nextPollMs     = 0;
    s_pollIntervalMs = POLL_STATUS_MS;
}

void Mega1Link::update()
{
    const uint32_t now = millis();

    // --------------------------------------------------------
    // Gate: solange Mega1 (0x10) nicht sauber ACKt -> keine I2C Reads/Commands
    // --------------------------------------------------------
    if (!s_gateOk)
    {
        if (s_nextGateProbeMs == 0 || (uint32_t)(now - s_nextGateProbeMs) >= GATE_PROBE_MS)
        {
            s_nextGateProbeMs = now;
            if (probeI2CAddr(0x10))
            {
                s_gateOk = true;
                s_nextPollMs = now + 25;
                s_pollIntervalMs = POLL_STATUS_MS;
                s_pollFailCount = 0;
                DBG_PRINTLN("[M1LINK] gate OK (addr 0x10)");
                s_nextFastDiagMs = now + 25;
            }
        }
        return;
    }

    // Start bootstrap exactly once after gate becomes OK
    if (!s_hadOk)
    {
        s_hadOk = true;
        s_bootstrapActive     = true;
        s_bootstrapUntilMs    = now + BOOTSTRAP_MS;
        s_lastBootstrapPollMs = 0;
        
        // reset backoff helper
        s_nextBackoffDiagMs = 0;
        s_backoffDiagMs     = BACKOFF_MIN_MS;
    }

    // --------------------------------------------------
    // Bootstrap polling: do not rely on DRDY edges during startup.
    // Some Mega1 transitions (boot/selftest-end) may not produce a new DRDY falling edge
    // while the pin is already LOW. This guarantees we observe selftestRunning->false.
    // --------------------------------------------------
    if (s_bootstrapActive)
    {
        if (now >= s_bootstrapUntilMs)
        {
            s_bootstrapActive = false;
        }
        else if (s_lastBootstrapPollMs == 0 || (uint32_t)(now - s_lastBootstrapPollMs) >= BOOTSTRAP_POLL_MS)
        {
            s_lastBootstrapPollMs = now;
            const I2CBus::Result br = Mega1Client::pollStatusAndDiag();
            if (br == I2CBus::Result::OK) {
                SystemRuntimeState::noteMega1LinkActivity();
            }
            g_stateDirty = true;
        }
    }

    if (s_pollIntervalMs == 0) s_pollIntervalMs = POLL_STATUS_MS;

    // --------------------------------------------------
    // Selftest/Startup watchdog: poll DIAG periodically while needed
    // After the short burst above, switch to a calm backoff scheme.
    // --------------------------------------------------
    {
        const auto& d = SystemRuntimeState::mega1Diag();
        const bool running = ((d.selftestFlags & 0x01u) != 0);
        const bool needs   = SystemRuntimeState::mega1NeedsStartupChecklist();
        const bool done    = SystemRuntimeState::mega1SelftestDone();
        const bool needFastDiag = running || (needs && !done);

        if (needFastDiag)
        {
            // During initial burst we already pull status+diag frequently.
            // Afterwards: use backoff polling to avoid "poll like crazy".
            if (!s_bootstrapActive)
            {
                if (s_nextBackoffDiagMs == 0 || (uint32_t)(now - s_nextBackoffDiagMs) >= s_backoffDiagMs)
                {
                    s_nextBackoffDiagMs = now;
                    const I2CBus::Result dr = Mega1Client::pollDiag();  // edge-miss-safe
                    (void)pollMega1RelaysReadOnly();     // outputs/relays snapshot (read-only)
                    if (dr == I2CBus::Result::OK) {
                        SystemRuntimeState::noteMega1LinkActivity();
                    }
                    g_stateDirty = true;

                    // backoff: 250 -> 500 -> 1000 (cap)
                    if (s_backoffDiagMs < BACKOFF_MAX_MS)
                    {
                        s_backoffDiagMs <<= 1;
                        if (s_backoffDiagMs > BACKOFF_MAX_MS) s_backoffDiagMs = BACKOFF_MAX_MS;
                    }
                }
            }
        }
        else
        {
            s_nextFastDiagMs = 0;
            s_nextBackoffDiagMs = 0;
            s_backoffDiagMs     = BACKOFF_MIN_MS;
        }
    }


    // --------------------------------------------------
    // DRDY quick-path (Mega2-like):
    // - If DRDY is active (IRQ latched or pin LOW), do:
    //   1) read pendingMask
    //   2) fetch max ONE payload (Status/Diag) via simple RR
    // This avoids the "needs next click" symptom when the main loop is busy.
    // --------------------------------------------------

bool didI2cRead = false;

const bool drdyLevelLow = (digitalRead(PIN_DATAREADY_1) == LOW);
const bool drdyActive   = drdyLevelLow || s_drdyLatched;
const bool wasLatched   = s_drdyLatched;

if (drdyActive && (uint32_t)(now - s_lastDrdyPollMs) >= DRDY_COOLDOWN_MS)
{
    s_lastDrdyPollMs = now;

    uint16_t pm = 0;
    const auto pr = Mega1Client::pollPendingMask(pm);
    didI2cRead = true; // we did at least one I2C transaction in this tick

    if (pr == I2CBus::Result::OK)
    {
        // Log inkl. Mask (sonst sieht man im DRDY-Log nicht, *was* ansteht)
        DBG_PRINTF("[M1LINK][DRDY] irq=%lu pin=%u latched=%u mask=0x%04X\n",
                   (unsigned long)s_drdyIrqCount,
                   drdyLevelLow ? 0u : 1u,
                   wasLatched ? 1u : 0u,
                   (unsigned)pm);

        if (pm)
        {
            DBG_PRINTF("[M1LINK] pending=0x%04X\n", (unsigned)pm);
        }

        s_cachedPendingMask = pm;
        s_havePendingMask   = true;
        s_lastPendReadMs    = now;

        // Heartbeat: pending-mask OK means Mega1 is alive (update online timeout)
        SystemRuntimeState::noteMega1LinkActivity();

        // === WICHTIG: Burst-Ende sauber erkennen ===
        // pin HIGH + mask==0 => nichts pending und DRDY ist vorbei -> latch MUSS weg.
        if (!drdyLevelLow && s_cachedPendingMask == 0)
        {
            s_drdyLatched = false;
            s_nextFastMs  = 0;
            return;
        }

        // Wenn wir hier sind, ist entweder pin LOW oder mask!=0 (oder beides):
        // Latch aktiv halten, damit wir den Burst nicht verlieren.
        s_drdyLatched = true;

        if (s_cachedPendingMask != 0)
        {
            // One RR payload read per DRDY tick
            I2CBus::Result rr = I2CBus::Result::ERROR;

            const bool hasStatus = (s_cachedPendingMask & Mega1Client::M1_PEND_STATUS) != 0;
            const bool hasDiag   = (s_cachedPendingMask & Mega1Client::M1_PEND_DIAG)   != 0;

            if ((s_rrPreferStatus && hasStatus) || (!hasDiag && hasStatus))
            {
                DBG_PRINTLN("[M1LINK] read STATUS...");
                rr = Mega1Client::pollStatus();
                if (rr == I2CBus::Result::OK) DBG_PRINTLN("[M1LINK] read STATUS ok");
                if (rr == I2CBus::Result::OK) s_cachedPendingMask &= ~Mega1Client::M1_PEND_STATUS;
            }
            else if (hasDiag)
            {
                DBG_PRINTLN("[M1LINK] read DIAG...");
                rr = Mega1Client::pollDiag();
                (void)pollMega1RelaysReadOnly();
                if (rr == I2CBus::Result::OK) DBG_PRINTLN("[M1LINK] read DIAG ok");
                if (rr == I2CBus::Result::OK) s_cachedPendingMask &= ~Mega1Client::M1_PEND_DIAG;
            }

            s_rrPreferStatus = !s_rrPreferStatus;

            if (rr == I2CBus::Result::OK)
            {
                s_pollFailCount  = 0;
                s_pollIntervalMs = POLL_STATUS_MS;
                s_nextFastMs     = 0;
                s_nextPollMs     = now + POLL_STATUS_MS;

                // Heartbeat: any successful RR read (STATUS or DIAG) proves Mega1 is alive.
                // This prevents "phantom offline" when we read DIAG frequently via DRDY.
                SystemRuntimeState::noteMega1LinkActivity();

                // Immediate WS push after RR (changed data actually read)
                g_stateDirty     = true;
            }
            else if (rr == I2CBus::Result::BUSY)
            {
                // retry soon (but don't block full poll)
                s_nextFastMs = now + BUSY_RETRY_MS;
                s_nextPollMs = now + POLL_STATUS_MS;
            }
            else
            {
                // Payload reject/ERROR: drop cached mask so we re-sync on next DRDY tick
                s_havePendingMask   = false;
                s_cachedPendingMask = 0;
                s_nextFastMs        = now + BUSY_RETRY_MS;
            }
        }

        // Wenn Pin wieder HIGH ist, ist der DRDY-Impulse vorbei -> latch weg.
        // (Auch wenn pm!=0 war: wir haben entweder gelesen oder bewusst nicht gelesen,
        // aber wir dürfen NICHT in einer künstlichen DRDY-Schleife hängen bleiben.)
        if (!drdyLevelLow)
        {
            s_drdyLatched = false;
        }
    }
}

    // --------------------------------------------------
    // Idle pendingMask poll (Heartbeat baseline)
    // When DRDY is HIGH (pending==0), we still want periodic "alive" confirmation.
    // This is cheap (1 byte) and avoids going offline after ~8s of silence.
    // --------------------------------------------------
    // IMPORTANT:
    // Do NOT starve the full poll (STATUS/DIAG every 8s). If full poll is due,
    // we must not consume the "one I2C op per tick" budget with pendingMask.
    const bool fullPollDue = (now >= s_nextPollMs);

    if (!didI2cRead && !drdyActive && !fullPollDue &&
        (uint32_t)(now - s_lastPendReadMs) >= PEND_POLL_IDLE_MS)
    {
        uint16_t pm = 0;
        const auto pr = Mega1Client::pollPendingMask(pm);
        didI2cRead = true;
        if (pr == I2CBus::Result::OK)
        {
            s_cachedPendingMask = pm;
            s_havePendingMask   = true;
            s_lastPendReadMs    = now;

            // Heartbeat: pending-mask OK means Mega1 is alive
            SystemRuntimeState::noteMega1LinkActivity();

            // If something became pending while DRDY didn't fire (or we missed it), do RR quickly.
            if (s_cachedPendingMask != 0) s_nextFastMs = now + 2;
        }
    }


    // --------------------------------------------------
    // RR-Reads (max 1 Read pro Tick)
    // --------------------------------------------------
    const uint32_t rrDue = (s_nextFastMs != 0) ? s_nextFastMs : s_nextPollMs;
    if (!didI2cRead && s_havePendingMask && s_cachedPendingMask != 0 && now >= rrDue)
    {
        I2CBus::Result rr = I2CBus::Result::ERROR;

        const bool hasStatus = (s_cachedPendingMask & Mega1Client::M1_PEND_STATUS) != 0;
        const bool hasDiag   = (s_cachedPendingMask & Mega1Client::M1_PEND_DIAG)   != 0;

        if ((s_rrPreferStatus && hasStatus) || !hasDiag)
        {
            rr = Mega1Client::pollStatus();
            if (rr == I2CBus::Result::OK) s_cachedPendingMask &= ~Mega1Client::M1_PEND_STATUS;
        }
        else
        {
            rr = Mega1Client::pollDiag();
            (void)pollMega1RelaysReadOnly();
            if (rr == I2CBus::Result::OK) s_cachedPendingMask &= ~Mega1Client::M1_PEND_DIAG;
        }

        s_rrPreferStatus = !s_rrPreferStatus;

        if (rr == I2CBus::Result::OK)
        {
            didI2cRead = true;
            // Heartbeat: any successful RR read proves Mega1 is alive.
            // (Even if a payload is rejected later, link is still physically present.)
            SystemRuntimeState::noteMega1LinkActivity();


            // Debug (temporär): zeigt sofort, dass RR wirklich passiert
            static uint32_t s_lastRrLog = 0;
            if (now - s_lastRrLog > 500) {
                s_lastRrLog = now;
                DBG_PRINTF("[M1LINK][RR] ok pm_now=0x%04X\n", (unsigned)s_cachedPendingMask);
            }
            
            s_pollFailCount  = 0;
            s_pollIntervalMs = POLL_STATUS_MS;
            // wenn noch was pending ist -> sehr bald nochmal (Fast), sonst zurück zu FullPoll
            s_nextFastMs = (s_cachedPendingMask != 0) ? (now + BUSY_RETRY_MS) : 0;
            s_nextPollMs = now + POLL_STATUS_MS;
            g_stateDirty = true; // ensure immediate WS push after RR
        }
        else if (rr == I2CBus::Result::BUSY)
        {
            didI2cRead = true;
            s_nextFastMs = now + BUSY_RETRY_MS;
            // FullPoll bleibt auf 8s
            s_nextPollMs = now + POLL_STATUS_MS;
        }
        else
        {
            // ERROR (z.B. Status/Diag reject): Pending NICHT verwerfen.
            // Stattdessen zeitnah erneut versuchen, damit UI ohne nächsten Klick nachzieht.
            didI2cRead = true;
            s_nextFastMs = now + BUSY_RETRY_MS;
            // s_havePendingMask / s_cachedPendingMask bleiben bewusst unverändert
        }
    }

    if (!didI2cRead && now >= s_nextPollMs)
    {
        const I2CBus::Result r = Mega1Client::pollStatus();

        if (r == I2CBus::Result::OK)
        {
            
            s_pollFailCount  = 0;
            s_pollIntervalMs = POLL_STATUS_MS;

            static uint32_t s_lastOkLog = 0;
            if (now - s_lastOkLog > 5000)
            {
                s_lastOkLog = now;
                if (!s_hadOk)
                {
                    s_hadOk = true;
                    DBG_PRINTLN("[M1LINK] poll OK");
                }
            }
            
        }
        else if (r == I2CBus::Result::BUSY)
        {
            s_pollIntervalMs = BUSY_RETRY_MS;

            static uint32_t s_lastBusyLog = 0;
            if (now - s_lastBusyLog > 5000)
            {
                s_lastBusyLog = now;
                DBG_PRINTLN("[M1LINK] bus busy");
            }
        }
        else // ERROR
        {
            if (s_pollFailCount < 6) s_pollFailCount++;
            const uint32_t backoff = POLL_STATUS_MS << s_pollFailCount;
            s_pollIntervalMs = (backoff > 5000) ? 5000 : backoff;

            static uint8_t s_lastLoggedFail = 0xFF;
            if (s_lastLoggedFail != s_pollFailCount)
            {
                s_lastLoggedFail = s_pollFailCount;
                DBG_PRINTF("[M1LINK] poll ERROR -> backoff %ums (level %u)\n",
                           (unsigned)s_pollIntervalMs,
                           (unsigned)s_pollFailCount);
            }
        }

        // Zusätzlich: Diagnosepaket (read-only, <=32B)
        //
        // IMPORTANT:
        // Do NOT gate this by mega1Online(). Otherwise we get a deadlock:
        // - payloadOk times out -> mega1Online() becomes false
        // - DIAG poll is skipped -> payloadOk can never recover
        // Result: Mega1 stays offline even while link/pendingMask is still alive.
        if (now >= s_nextDiagPollMs)
        {
            s_nextDiagPollMs = now + POLL_DIAG_MS;
            const I2CBus::Result dr = Mega1Client::pollDiag();
            (void)pollMega1RelaysReadOnly();
            if (dr != I2CBus::Result::OK)
            {
                static uint32_t s_lastDiagErrLog = 0;
                if ((uint32_t)(now - s_lastDiagErrLog) >= 1000)
                {
                    s_lastDiagErrLog = now;
                    DBG_PRINTF("[M1LINK] diag poll %s\n", (dr == I2CBus::Result::BUSY) ? "BUSY" : "ERROR");
                }
            }
        }
        // Schedule next full poll only after we actually attempted the full poll.
        s_nextPollMs = now + s_pollIntervalMs;
    }

    // --------------------------------------------------
    // Pending Commands (serialisiert über I2C)
    // --------------------------------------------------
    CmdQItem cmd{};
    if (cmdqPeek(cmd))
    {
        I2CBus::Result cr = I2CBus::Result::ERROR;

        switch (cmd.type)
        {
            case CMDQ_SET_MODE:
                cr = Mega1Client::cmdSetMode(cmd.a);
                break;
            case CMDQ_SET_WEICHE:
                cr = Mega1Client::cmdSetWeiche(cmd.a, cmd.b != 0);
                break;
            case CMDQ_SET_BHF_POWER:
                cr = Mega1Client::cmdSetBhfPower(cmd.a, cmd.b != 0);
                break;
            case CMDQ_START_SELFTEST:
            {
                // Use Mega1Client helper so we always consume the 1-byte ACK
                cr = Mega1Client::cmdStartSelftest();
            } break;
            default:
                cr = I2CBus::Result::ERROR;
                break;
        }

        if (cr == I2CBus::Result::OK || cr == I2CBus::Result::BUSY)
        {
            // BUSY: Command bleibt in Queue und beim nächsten update() erneut probieren
            if (cr == I2CBus::Result::OK)
            {
                cmdqPop();
                // Trigger a fast follow-up read cycle (UI should update << 200ms)
                // We rely on DRDY/pending, but we also ensure we re-check quickly even if pending is chatty.
                s_havePendingMask = false;
                s_cachedPendingMask = 0;
                s_nextFastMs = now + 2;
                // Status/Diag kommt per DRDY/FullPull rein
            }
        }
    }

    const bool online = SystemRuntimeState::mega1Online();
    static bool s_prevOnline = false;
    if (online != s_prevOnline)
    {
        s_prevOnline = online;
        DBG_PRINTF("[M1LINK] online=%d\n", online ? 1 : 0);
    }

        
}



bool Mega1Link::queueSetMode(uint8_t mode)
{
    if (mode > 1) return false;
    return cmdqPush(CMDQ_SET_MODE, mode, 0);
}

bool Mega1Link::queueTurnoutSet(uint8_t idx, bool gerade)
{
    if (idx >= 12) return false;
    return cmdqPush(CMDQ_SET_WEICHE, idx, gerade ? 1 : 0);
}

bool Mega1Link::queueBhfPowerSet(uint8_t bhf, bool on)
{
    if (bhf >= 4) return false;
    return cmdqPush(CMDQ_SET_BHF_POWER, bhf, on ? 1 : 0);
}

bool Mega1Link::queueStartSelftest()
{
    // keine Parameter (reflects Mega1 default: startSelftest())
    return cmdqPush(CMDQ_START_SELFTEST, 0, 0);
}
