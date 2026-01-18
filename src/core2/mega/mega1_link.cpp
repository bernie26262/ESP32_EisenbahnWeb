#include "mega1_link.h"

#include <Arduino.h>

#include "core2/mega/mega1_client.h"
#include "core2/state/system_runtime_state.h"
#include "core2/bus/i2c_bus.h"
#include "debug.h"

#if defined(ESP32)
  #include "freertos/FreeRTOS.h"
  #include "freertos/portmacro.h"
  static portMUX_TYPE s_cmdMux = portMUX_INITIALIZER_UNLOCKED;
#endif

// ------------------------------------------------------------
// Command Queue (WebUI / Automatik -> Mega1)
// ------------------------------------------------------------
namespace
{
    enum : uint8_t { CMDQ_SET_MODE = 1, CMDQ_SET_WEICHE = 2, CMDQ_SET_BHF_POWER = 3, CMDQ_START_SELFTEST = 4 };

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

static uint32_t s_nextPollMs      = 0;
static uint32_t s_nextDiagPollMs  = 0;
static uint32_t s_pollIntervalMs  = 0;
static uint8_t  s_pollFailCount   = 0;
static bool     s_hadOk          = false;

static constexpr uint32_t POLL_STATUS_MS = 200;
static constexpr uint32_t POLL_DIAG_MS   = 500;
static constexpr uint32_t BUSY_RETRY_MS  = 30;

void Mega1Link::begin()
{
    Mega1Client::begin();

    s_nextPollMs     = millis() + 25;
    s_pollIntervalMs = POLL_STATUS_MS;
    s_pollFailCount  = 0;

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

    if (s_pollIntervalMs == 0) s_pollIntervalMs = POLL_STATUS_MS;

    if (now >= s_nextPollMs)
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
                if (!s_hadOk || s_pollFailCount != 0) {
                s_hadOk = true;
                DBG_PRINTLN("[M1LINK] poll OK (recovered)");
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
        if (SystemRuntimeState::mega1Online() && now >= s_nextDiagPollMs)
        {
            s_nextDiagPollMs = now + POLL_DIAG_MS;
            (void)Mega1Client::pollDiag();
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
                    cr = Mega1Client::cmdStartSelftest();
                    break;
                default:
                    cr = I2CBus::Result::ERROR;
                    break;
            }

            if (cr == I2CBus::Result::OK || cr == I2CBus::Result::ERROR)
            {
                // BUSY => stehen lassen und beim nächsten update() erneut probieren
                cmdqPop();
                // Nach erfolgreichem CMD direkt UI aktualisieren
                // (Status/Diag wird ohnehin gepollt – aber wir pushen schneller)
                // -> handled auf Web-Ebene via g_stateDirty im WS callback
            }
        }

        s_nextPollMs = now + s_pollIntervalMs;

        const bool online = SystemRuntimeState::mega1Online();
        static bool s_prevOnline = false;
        if (online != s_prevOnline)
        {
            s_prevOnline = online;
            DBG_PRINTF("[M1LINK] online=%d\n", online ? 1 : 0);
        }
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
