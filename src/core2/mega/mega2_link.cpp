#include "mega2_link.h"

#include <Arduino.h>

#include "core2/mega/mega2_client.h"
#include "debug.h"

#if defined(ESP32)
  #include "freertos/FreeRTOS.h"
  #include "freertos/portmacro.h"
  static portMUX_TYPE s_actionMux = portMUX_INITIALIZER_UNLOCKED;
#endif

// Pending Actions (werden in update() im loop-Kontext ausgeführt)
static volatile uint8_t s_pendingActions = 0;
static constexpr uint8_t ACT_ACK     = 0x01;
static constexpr uint8_t ACT_NOTHALT = 0x02;
static constexpr uint8_t ACT_PON     = 0x04;
static constexpr uint8_t ACT_REL     = 0x08;
static constexpr uint8_t ACT_POFF    = 0x10;

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

// Polling-Intervall(e)
static uint32_t s_lastPollMs      = 0;
static uint32_t s_lastMatrixMs    = 0;
static uint32_t s_lastPreviewMs   = 0;

// Backoff/Rate-Limit bei I2C Fehlern (z.B. Mega2 bootet noch / Bus kurz offline)
static uint32_t s_nextPollMs      = 0;
static uint32_t s_pollIntervalMs  = 0;
static uint8_t  s_pollFailCount   = 0;
static bool     s_lastStatusOk    = false;


static constexpr uint32_t POLL_STATUS_MS   = 200;   // Status öfter
static constexpr uint32_t POLL_MATRIX_MS   = 800;   // Entry-Matrix seltener
static constexpr uint32_t POLL_PREVIEW_MS  = 2000;  // Preview noch seltener

namespace Mega2Link
{
    
void requestPollNow()
{
    // Sofortiges Polling (kein Warten auf Backoff/Interval)
    s_nextPollMs = 0;
    // wenn wir gerade im Backoff sind, wieder auf Normal-Intervall zurück
    if (s_pollIntervalMs == 0) s_pollIntervalMs = POLL_STATUS_MS;
}

void begin()
    {
        Mega2Client::begin();
        s_lastPollMs    = 0;
        s_lastMatrixMs  = 0;
        s_lastPreviewMs = 0;
        s_nextPollMs = 0;
        s_pollIntervalMs = 0;
        s_pollFailCount = 0;
        s_lastStatusOk = false;

        DBG_PRINTLN("[M2LINK] begin()");
    }

    void update()
    {
        const uint32_t now = millis();

        // Lebenszeichen (Debug): zeigt, dass update() läuft
        static uint32_t s_lastAlive = 0;
        if (now - s_lastAlive > 10000)
        {
            s_lastAlive = now;
            DBG_PRINTLN("[M2LINK] update alive");
        }

        // 0) Pending Actions ausführen (nur hier -> keine I2C Calls aus WS/ISR Kontext)
        const uint8_t act = takeActions();
        if (act)
        {
            if (act & ACT_ACK)
            {
                DBG_PRINTLN("[M2LINK] sending cmd: SAFETY_ACK");
                (void)Mega2Client::safetyAck();
            }
            if (act & ACT_NOTHALT)
            {
                DBG_PRINTLN("[M2LINK] sending cmd: NOTHALT=ON");
                (void)Mega2Client::setNotaus(true);
            }
            if (act & ACT_REL)
            {
                DBG_PRINTLN("[M2LINK] sending cmd: NOTHALT=OFF");
                (void)Mega2Client::setNotaus(false);
            }
            if (act & ACT_PON)
            {
                DBG_PRINTLN("[M2LINK] sending cmd: POWER_ON");
                (void)Mega2Client::powerOn();
            }
            if (act & ACT_POFF)
            {
                DBG_PRINTLN("[M2LINK] sending cmd: POWER_OFF");
                (void)Mega2Client::powerOff();
            }
        }

        // 1) Status pollen (mit Backoff bei Fehlern)
        if (s_pollIntervalMs == 0) s_pollIntervalMs = POLL_STATUS_MS;
        if (now >= s_nextPollMs)
        {
            const bool ok = Mega2Client::pollStatus();
            s_lastStatusOk = ok;

            if (ok)
            {
                s_pollFailCount  = 0;
                s_pollIntervalMs = POLL_STATUS_MS;
            }
            else
            {
                // Exponentieller Backoff, gedeckelt
                if (s_pollFailCount < 6) s_pollFailCount++;
                const uint32_t backoff = POLL_STATUS_MS << s_pollFailCount; // 200,400,800,...
                s_pollIntervalMs = (backoff > 5000) ? 5000 : backoff;       // max 5s

                // Debug nur beim Wechsel des Backoff-Levels (kein Spam)
                static uint8_t s_lastLoggedFail = 0xFF;
                if (s_lastLoggedFail != s_pollFailCount)
                {
                    s_lastLoggedFail = s_pollFailCount;
                    DBG_PRINTF("[M2LINK] pollStatus failed -> backoff %ums (level %u)\n",
                                (unsigned)s_pollIntervalMs,
                                (unsigned)s_pollFailCount);
                }
            }

            s_nextPollMs = now + s_pollIntervalMs;
            s_lastPollMs = now; // bleibt für evtl. Diagnose erhalten
        }
// 2) Entry-Matrix pollen (nur wenn Mega2 erreichbar)
        if (s_lastStatusOk && (now - s_lastMatrixMs >= POLL_MATRIX_MS))
        {
            s_lastMatrixMs = now;
            (void)Mega2Client::pollEntryMatrix();
        }

        // 3) Entry-Preview pollen (nur wenn Mega2 erreichbar)
        if (s_lastStatusOk && (now - s_lastPreviewMs >= POLL_PREVIEW_MS))
        {
            s_lastPreviewMs = now;
            (void)Mega2Client::pollEntryPreviewMatrix();
        }
    }

    bool safetyAck()
    {
        queueAction(ACT_ACK);
        return true;
    }

    bool nothalt()
    {
        queueAction(ACT_NOTHALT);
        return true;
    }

    bool releaseNotaus()
    {
        queueAction(ACT_REL);
        return true;
    }

    bool powerOff()
    {
        queueAction(ACT_POFF);
        return true;
    }

    bool powerOn()
    {
        queueAction(ACT_PON);
        return true;
    }
}
