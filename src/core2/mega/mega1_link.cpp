#include "mega1_link.h"

#include <Arduino.h>

#include "core2/mega/mega1_client.h"
#include "core2/state/system_runtime_state.h"
#include "core2/bus/i2c_bus.h"
#include "debug.h"

static uint32_t s_nextPollMs      = 0;
static uint32_t s_pollIntervalMs  = 0;
static uint8_t  s_pollFailCount   = 0;

static constexpr uint32_t POLL_STATUS_MS = 200;
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
                DBG_PRINTLN("[M1LINK] poll OK");
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
