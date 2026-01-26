#include "mega2_link.h"

#include <Arduino.h>
#include <Wire.h>
#include "config/pins.h"

#include "core2/mega/mega2_client.h"
#include "core2/bus/i2c_bus.h"
#include "debug.h"

#if defined(ESP32)
  #include "freertos/FreeRTOS.h"
  #include "freertos/portmacro.h"
  static portMUX_TYPE s_actionMux = portMUX_INITIALIZER_UNLOCKED;
#endif

static volatile uint8_t s_pendingActions = 0;
static constexpr uint8_t ACT_ACK      = 0x01;
static constexpr uint8_t ACT_NOTHALT  = 0x02;
static constexpr uint8_t ACT_PON      = 0x04;
static constexpr uint8_t ACT_REL      = 0x08;
static constexpr uint8_t ACT_POFF     = 0x10;
static constexpr uint8_t ACT_STRETRY  = 0x20;

static inline void queueAction(uint8_t mask)
{
#if defined(ESP32)
    portENTER_CRITICAL(&s_actionMux);
    s_pendingActions |= mask;
    portEXIT_CRITICAL(&s_actionMux);
#else
    s_pendingActions |= mask;
#endif
}

static inline uint8_t takeActions()
{
#if defined(ESP32)
    portENTER_CRITICAL(&s_actionMux);
    uint8_t v = s_pendingActions;
    s_pendingActions = 0;
    portEXIT_CRITICAL(&s_actionMux);
    return v;
#else
    uint8_t v = s_pendingActions;
    s_pendingActions = 0;
    return v;
#endif
}

static uint32_t s_lastSafetyMs    = 0;
static uint32_t s_lastMatrixMs    = 0;
static uint32_t s_lastPreviewMs   = 0;

static uint32_t s_nextPollMs      = 0;
static uint32_t s_pollIntervalMs  = 0;
static uint8_t  s_pollFailCount   = 0;
static bool     s_lastStatusOk    = false;

// Kommunikationszustand (ESP-Sicht). Wichtig: Poll-Fehler sind *keine* Safety-Fehler.
// Deshalb wird bei Poll-Fail nur mega2Online=false gesetzt; der letzte gültige Status
// (der zuvor erfolgreich gelesen wurde) bleibt bestehen und es wird *keine* neue ERR/ACK-
// Pflicht abgeleitet.
static bool     s_mega2Online     = false;
static uint32_t s_lastOkMsLink    = 0;
static uint32_t s_lastFailMsLink  = 0;

// ------------------------------------------------------------
// I2C Start-Gate: starte Polling erst, wenn Mega2 wirklich am Bus antwortet
// ------------------------------------------------------------
static bool     s_gateOk = false;
static uint32_t s_nextGateProbeMs = 0;
static constexpr uint32_t GATE_PROBE_MS = 250;

static bool probeI2CAddr(uint8_t addr)
{
    // Achtung: sehr billig, nur "ACK?" (keine Reads)
    Wire.beginTransmission(addr);
    const uint8_t e = Wire.endTransmission(true);
    return (e == 0);
}


// ------------------------------------------------------------
// DRDY (Mega2 DataReady) – active LOW, latched via ISR
// ------------------------------------------------------------
static volatile uint32_t s_drdyIrqCount = 0;
static volatile bool     s_drdyLatched  = false;
static uint32_t          s_lastDrdyPollMs = 0;
static constexpr uint32_t DRDY_COOLDOWN_MS = 50;

static void IRAM_ATTR isr_drdy_m2()
{
    s_drdyIrqCount++;
    s_drdyLatched = true;
}

// Pending mask cache (local) – we fetch max 1 payload per DRDY tick
static uint16_t s_m2PendMask = 0;
static uint8_t  s_drdyRr = 0; // round-robin index for DRDY payload reads
static uint32_t s_lastPendMaskMs = 0;

// Full pull ground-truth interval (slow on purpose for DRDY test)
static constexpr uint32_t FULL_PULL_MS = 8000;
static uint32_t s_lastFullPullMs = 0;

static constexpr uint32_t POLL_STATUS_MS   = 200;
static constexpr uint32_t POLL_SAFETY_MS   = 400;   // Safety halb so oft wie Status
static constexpr uint32_t POLL_MATRIX_MS   = 800;
static constexpr uint32_t POLL_PREVIEW_MS  = 2000;

static constexpr uint32_t BUSY_RETRY_MS    = 30;

namespace Mega2Link
{
void requestPollNow()
{
    s_nextPollMs = 0;
    if (s_pollIntervalMs == 0) s_pollIntervalMs = POLL_STATUS_MS;
}

void begin()
{
    Mega2Client::begin();
    s_lastSafetyMs  = 0;
    s_lastMatrixMs  = 0;
    s_lastPreviewMs = 0;

    s_nextPollMs     = millis() + 10;
    s_pollIntervalMs = POLL_STATUS_MS;
    s_pollFailCount  = 0;
    s_lastStatusOk   = false;

    s_mega2Online    = false;
    s_lastOkMsLink   = 0;
    s_lastFailMsLink = 0;
    s_gateOk         = false;
    s_nextGateProbeMs = 0;

    // DRDY pin (active LOW)
#if !TEST_DISABLE_M2_DRDY
    pinMode(PIN_DATAREADY_2, INPUT_PULLUP);
    attachInterrupt(digitalPinToInterrupt(PIN_DATAREADY_2), isr_drdy_m2, FALLING);
#else
    DBG_PRINTLN("[M2LINK] DRDY disabled by TEST_DISABLE_M2_DRDY");
#endif

    s_lastDrdyPollMs = 0;
    s_lastPendMaskMs = 0;
    s_m2PendMask = 0;
    s_lastFullPullMs = 0;


    DBG_PRINTLN("[M2LINK] begin()");
}

bool mega2Online() { return s_mega2Online; }
uint32_t lastOkMs() { return s_lastOkMsLink; }

void update()
{
    const uint32_t now = millis();
    
    // --------------------------------------------------------
    // Gate: solange Mega2 (0x11) nicht sauber ACKt -> keine I2C Reads/Commands
    // (verhindert requestFrom Error -1 direkt nach ESP Boot / Mega Reboot)
    // --------------------------------------------------------
    if (!s_gateOk)
    {
        if (s_nextGateProbeMs == 0 || (uint32_t)(now - s_nextGateProbeMs) >= GATE_PROBE_MS)
        {
            s_nextGateProbeMs = now;
            if (probeI2CAddr(0x11))
            {
                s_gateOk = true;
                s_nextPollMs = now + 10;
                s_pollIntervalMs = POLL_STATUS_MS;
                s_pollFailCount = 0;
                s_lastStatusOk = false;
                DBG_PRINTLN("[M2LINK] gate OK (addr 0x11)");
            }
        }
        return;
    }

    // 0) Pending Actions (nur hier -> keine I2C Calls aus WS/ISR Kontext)
    const uint8_t act = takeActions();
    if (act)
    {
        if (act & ACT_ACK)
        {
            DBG_PRINTLN("[M2LINK] sending cmd: SAFETY_ACK");
            (void)Mega2Client::safetyAck();
            requestPollNow();
        }
        if (act & ACT_STRETRY)
        {
            DBG_PRINTLN("[M2LINK] sending cmd: SBHF_SELFTEST_RETRY");
            (void)Mega2Client::sbhfSelftestRetry();
            requestPollNow();
        }
        if (act & ACT_NOTHALT)
        {
            DBG_PRINTLN("[M2LINK] sending cmd: NOTHALT=ON");
            (void)Mega2Client::setNotaus(true);
            requestPollNow();
        }
        if (act & ACT_REL)
        {
            DBG_PRINTLN("[M2LINK] sending cmd: NOTHALT=OFF");
            (void)Mega2Client::setNotaus(false);
            requestPollNow();
        }
        if (act & ACT_PON)
        {
            DBG_PRINTLN("[M2LINK] sending cmd: POWER_ON");
            (void)Mega2Client::powerOn();
            requestPollNow();
        }
        if (act & ACT_POFF)
        {
            DBG_PRINTLN("[M2LINK] sending cmd: POWER_OFF");
            (void)Mega2Client::powerOff();
            requestPollNow();
        }
    }

    // 1) Analog (immer rate-limited intern; bleibt bewusst NICHT DRDY-getrieben)
    (void)Mega2Client::pollAnalog();

    // 2) Full Pull (Ground Truth, absichtlich langsam – A/B Test für DRDY)
    if (s_lastFullPullMs == 0 || (uint32_t)(now - s_lastFullPullMs) >= FULL_PULL_MS)
    {
        s_lastFullPullMs = now;

        const I2CBus::Result r = Mega2Client::pollStatus();
        if (r == I2CBus::Result::OK)
        {
            s_lastStatusOk   = true;
            s_pollFailCount  = 0;

            const bool wasOnline = s_mega2Online;
            s_mega2Online  = true;
            s_lastOkMsLink = now;
            if (!wasOnline) DBG_PRINTLN("[M2LINK] online=1");

            // ----------------------------------------------------------------
            // IMPORTANT:
            // Ohne DRDY müssen die "digital caches" (Entry/Preview/Blocks/Shadow/Turnouts/Safety)
            // ebenfalls periodisch aktualisiert werden, sonst bleibt die UI stehen.
            // Das ist bewusst EINMAL pro FULL pull (8s) – kein Burst im DRDY-Mode.
            // ----------------------------------------------------------------
            (void)Mega2Client::pollSafetyStatus();
            (void)Mega2Client::pollEntryMatrix();
            (void)Mega2Client::pollEntryPreviewMatrix();
            (void)Mega2Client::pollBlocksStatus();
            (void)Mega2Client::pollTurnoutsStatus();
            (void)Mega2Client::pollShadowStatus();

            DBG_PRINTF("[M2LINK][FULL] status=OK (every %ums)\n", (unsigned)FULL_PULL_MS);
        }
        else if (r == I2CBus::Result::BUSY)
        {
            s_lastStatusOk = false;
            DBG_PRINTLN("[M2LINK][FULL] status=BUSY");
        }
        else
        {
            s_lastStatusOk = false;

            const bool wasOnline = s_mega2Online;
            s_mega2Online   = false;
            s_lastFailMsLink = now;
            if (wasOnline) DBG_PRINTLN("[M2LINK] online=0");

            if (s_pollFailCount < 6) s_pollFailCount++;
            const uint32_t backoff = 200u << s_pollFailCount; // 200,400,800,...
            s_pollIntervalMs = (backoff > 5000) ? 5000 : backoff;

            DBG_PRINTF("[M2LINK][FULL] status=ERROR backoff=%ums (level %u)\n",
                       (unsigned)s_pollIntervalMs,
                       (unsigned)s_pollFailCount);
        }
    }

    // 3) DRDY-driven: PendingMask lesen + pro Tick max. 1 Payload holen
    const bool drdyLevelLow = (digitalRead(PIN_DATAREADY_2) == LOW);
    const bool drdyActive = drdyLevelLow || s_drdyLatched;

    if (drdyActive && (uint32_t)(now - s_lastDrdyPollMs) >= DRDY_COOLDOWN_MS)
    {
        s_lastDrdyPollMs = now;

        Mega2PendingMaskPayload pm{};
        if (Mega2Client::pollPendingMask(pm) == I2CBus::Result::OK)
        {
            s_m2PendMask = pm.mask;
            s_lastPendMaskMs = now;

            DBG_PRINTF("[M2LINK][DRDY] irq=%u pin=%u mask=0x%04X seq=%u\n",
                       (unsigned)s_drdyIrqCount,
                       (unsigned)(drdyLevelLow ? 0 : 1),
                       (unsigned)s_m2PendMask,
                       (unsigned)pm.seq);

            // Wenn mask=0 und Pin wieder HIGH -> latch löschen
            if (s_m2PendMask == 0 && !drdyLevelLow)
            {
                s_drdyLatched = false;
                return;
            }

            // pro Tick maximal EIN größeres Read (Burst vermeiden) – fair via Round-Robin
            bool ok = true;

            // Order matters (UI first), but RR prevents starvation if one bit is "chatty".
            const uint16_t rrBits[] = {
                M2_PEND_SAFETY,
                M2_PEND_ENTRY,
                M2_PEND_ENTRY_PREV,
                M2_PEND_BLOCKS,
                M2_PEND_TURNOUTS,
                M2_PEND_SHADOW,
            };
            constexpr uint8_t RR_N = sizeof(rrBits) / sizeof(rrBits[0]);

            uint8_t chosen = 0xFF;
            for (uint8_t k = 0; k < RR_N; k++)
            {
                const uint8_t idx = (uint8_t)((s_drdyRr + k) % RR_N);
                if (s_m2PendMask & rrBits[idx]) { chosen = idx; break; }
            }

            if (chosen != 0xFF)
           {
                s_drdyRr = (uint8_t)((chosen + 1) % RR_N);
                switch (rrBits[chosen])
                {
                    case M2_PEND_SAFETY:
                        ok = (Mega2Client::pollSafetyStatus() == I2CBus::Result::OK);
                        // UI "ACK nötig"/Warnings hängen bei uns an SystemStatus flags/warningMask.
                        // Daher bei Safety-Änderung zusätzlich Status ziehen, damit das Overlay sofort verschwindet.
                        if (ok) (void)Mega2Client::pollStatus();
                        break;
                    case M2_PEND_ENTRY:       ok = (Mega2Client::pollEntryMatrix() == I2CBus::Result::OK); break;
                    case M2_PEND_ENTRY_PREV:  ok = (Mega2Client::pollEntryPreviewMatrix() == I2CBus::Result::OK); break;
                    case M2_PEND_BLOCKS:
                        ok = (Mega2Client::pollBlocksStatus() == I2CBus::Result::OK);
                        // Belegung (blockOccupiedMask) sitzt im SystemStatus.
                        // Damit Blocks instant werden (auch wenn UI noch legacy-Feld nutzt),
                        // ziehen wir bei Blocks-Änderung einmal Status nach.
                        if (ok) (void)Mega2Client::pollStatus();
                        break;
                    case M2_PEND_SHADOW:      ok = (Mega2Client::pollShadowStatus() == I2CBus::Result::OK); break;
                    case M2_PEND_TURNOUTS:    ok = (Mega2Client::pollTurnoutsStatus() == I2CBus::Result::OK); break;
                    default: break;
                }
            }

            if (ok)
            {
                // Erfolg -> online, und latch ggf. später löschen wenn Pin HIGH & mask leer
                const bool wasOnline = s_mega2Online;
                s_mega2Online  = true;
                s_lastOkMsLink = now;
                if (!wasOnline) DBG_PRINTLN("[M2LINK] online=1");
            }
            else
            {
                DBG_PRINTLN("[M2LINK][DRDY] payload read FAILED");
            }
        }
        else
        {
            DBG_PRINTLN("[M2LINK][DRDY] pendingMask read FAILED");
        }
    }
}

bool safetyAck()     { queueAction(ACT_ACK);     return true; }
bool sbhfSelftestRetry() { queueAction(ACT_STRETRY); return true; }
bool nothalt()       { queueAction(ACT_NOTHALT); return true; }
bool releaseNotaus() { queueAction(ACT_REL);     return true; }
bool powerOff()      { queueAction(ACT_POFF);    return true; }
bool powerOn()       { queueAction(ACT_PON);     return true; }

} // namespace Mega2Link
