#include "hmi_push.h"

#include "hmi_uart.h"
#include "hmi_state.h"
#include "../web/webserver.h"
#include "../../include/debug.h"

#include <Arduino.h>

namespace
{
    static uint32_t s_lastFullMs = 0;
    static uint32_t s_lastHash = 0;
    static bool s_hasHash = false;
    static bool s_forceFull = true;
    static bool s_forceFullDelayedPending = false;
    static uint32_t s_forceFullEarliestMs = 0;
    static uint32_t s_stateLiteSuppressUntilMs = 0;
    static uint32_t s_analogSuppressUntilMs = 0;

    static uint32_t s_lastSendMs = 0;
    static uint32_t s_lastAnalogMs = 0;
    static uint32_t s_lastAnalogHash = 0;
    static bool s_hasAnalogHash = false;

    // Hybrid:
    // - periodischer Re-Send bleibt aktiv
    // - on-change bleibt rate-limited, aber deutlich spritziger
    //   als zuvor
    #ifndef REACT_SLOW_STATELITE
#define REACT_SLOW_STATELITE 0
#endif
#ifndef REACT_STARTUP_STATELITE_GRACE_MS
#define REACT_STARTUP_STATELITE_GRACE_MS 5000
#endif
#if REACT_SLOW_STATELITE
    static constexpr uint32_t HMI_FULL_MS = 2500;
#else
    static constexpr uint32_t HMI_FULL_MS = 1000;
#endif
    static constexpr uint32_t HMI_STARTUP_STATELITE_GRACE_MS = REACT_STARTUP_STATELITE_GRACE_MS;
    static constexpr uint32_t HMI_DIRTY_MIN_MS = 50;
    static constexpr uint32_t HMI_ANALOG_MS = 500;

    static uint32_t s_lastSkipLogMs = 0;
    static uint32_t s_lastSendLogMs = 0;
    static uint32_t s_lastSummaryMs = 0;
    static uint32_t s_cntLoop = 0;
    static uint32_t s_cntWantDirty = 0;
    static uint32_t s_cntWantFull = 0;
    static uint32_t s_cntSendOk = 0;
    static uint32_t s_cntSendFail = 0;
    static uint32_t s_cntHashEqualSkip = 0;
    static bool s_startupSuppressLogged = false;

    static uint32_t fnv1a32(const String& s)
    {
        uint32_t h = 2166136261u;
        for (size_t i = 0; i < s.length(); ++i)
        {
            h ^= (uint8_t)s[i];
            h *= 16777619u;
        }
        return h;
    }

    static String addSeqField(const String& json, uint32_t seq)
    {
        if (seq == 0) return json;
        if (json.length() < 2) return json;
        if (json[0] != '{') return json;

        String out;
        out.reserve(json.length() + 24);
        out += "{\"seq\":";
        out += String(seq);
        out += ",";
        out += json.substring(1);
        return out;
    }
}

namespace HmiPush
{
    void loop()
    {
        const uint32_t now = (uint32_t)millis();
        ++s_cntLoop;

        const bool startupSuppressStateLite =
            (HMI_STARTUP_STATELITE_GRACE_MS > 0) &&
            (now < HMI_STARTUP_STATELITE_GRACE_MS);

        const bool suppressStateLite =
            startupSuppressStateLite ||
            ((int32_t)(now - s_stateLiteSuppressUntilMs) < 0);

        if (s_forceFullDelayedPending) {
            if ((int32_t)(now - s_forceFullEarliestMs) >= 0) {
                s_forceFull = true;
                s_forceFullDelayedPending = false;
                EE_LOGI("HMIPUSH",
                        "forceFullDelayed due now=%lu",
                        (unsigned long)now);
            }
        }

        const bool wantPeriodicFull =
            ((uint32_t)(now - s_lastFullMs) >= HMI_FULL_MS);
        const bool wantFull =
            !suppressStateLite && (s_forceFull || wantPeriodicFull);

        const bool dirtyDue =
            ((uint32_t)(now - s_lastSendMs) >= HMI_DIRTY_MIN_MS);
        const bool wantDirty =
            !suppressStateLite && g_hmiStateDirty && dirtyDue;

        if (suppressStateLite) {
            // Hartes Gate: In der Startup-/Guard-Zeit keine state-lite Frames bauen
            // und nicht enqueuen. Analog läuft separat über loopAnalog() weiter.
            if (startupSuppressStateLite && !s_startupSuppressLogged) {
                s_startupSuppressLogged = true;
                LOG_HMILAT("startup hard-gate state-lite graceMs=%lu",
                           (unsigned long)HMI_STARTUP_STATELITE_GRACE_MS);
                LOG_REACT("hmi state startup hard-gate graceMs=%lu",
                          (unsigned long)HMI_STARTUP_STATELITE_GRACE_MS);
            }
            return;
        }

        if (g_hmiStateDirty) ++s_cntWantDirty;
        if (wantFull)  ++s_cntWantFull;

        if (!wantFull && !wantDirty)
        {
            if ((uint32_t)(now - s_lastSummaryMs) >= 5000)
            {
                s_lastSummaryMs = now;
                EE_LOGI("HMIPUSH",
                        "summary loop=%lu dirty=%lu full=%lu ok=%lu fail=%lu hashSkip=%lu force=%d hmiDirty=%d dirtyDue=%d lastFullAgo=%lu lastSendAgo=%lu q=%u waitAck=%d inFlight=%lu",
                        (unsigned long)s_cntLoop,
                        (unsigned long)s_cntWantDirty,
                        (unsigned long)s_cntWantFull,
                        (unsigned long)s_cntSendOk,
                        (unsigned long)s_cntSendFail,
                        (unsigned long)s_cntHashEqualSkip,
                        s_forceFull ? 1 : 0,
                        g_hmiStateDirty ? 1 : 0,
                        dirtyDue ? 1 : 0,
                        (unsigned long)(now - s_lastFullMs),
                        (unsigned long)(now - s_lastSendMs),
                        (unsigned)HMI::queuedCount(),
                        HMI::hasAckPending() ? 1 : 0,
                        (unsigned long)HMI::inFlightSeq());
            }
            return;
        }

        const String json = buildHmiStateJson();
        const uint32_t seq = HMI::nextTxSeq();
        const String jsonWithSeq = addSeqField(json, seq);
        const uint32_t hash = fnv1a32(json);

        if (wantFull)
        {
            const bool ok = HMI::enqueueJson(jsonWithSeq, HMI::TxKind::StateLite, seq);
            LOG_HMILAT("enqueue state-lite reason=periodic ok=%d len=%u q=%u waitAck=%d seq=%lu",
                       ok ? 1 : 0,
                       (unsigned)json.length(),
                       (unsigned)HMI::queuedCount(),
                       HMI::hasAckPending() ? 1 : 0,
                       (unsigned long)seq);
            LOG_REACT("hmi state periodic enqueue ok=%d len=%u q=%u waitAck=%d seq=%lu",
                      ok ? 1 : 0,
                      (unsigned)json.length(),
                      (unsigned)HMI::queuedCount(),
                      HMI::hasAckPending() ? 1 : 0,
                      (unsigned long)seq);
            if ((uint32_t)(now - s_lastSendLogMs) >= 1000)
            {
                s_lastSendLogMs = now;
                EE_LOGI("HMIPUSH",
                        "PERIODIC enqueue ok=%d len=%u hash=%08lx force=%d hmiDirty=%d lastFullAgo=%lu q=%u waitAck=%d inFlight=%lu",
                        ok ? 1 : 0,
                        (unsigned)json.length(),
                        (unsigned long)hash,
                        s_forceFull ? 1 : 0,
                        g_hmiStateDirty ? 1 : 0,
                        (unsigned long)(now - s_lastFullMs),
                        (unsigned)HMI::queuedCount(),
                        HMI::hasAckPending() ? 1 : 0,
                        (unsigned long)HMI::inFlightSeq());
            }

            if (!ok)
            {
                ++s_cntSendFail;
                return;
            }

            s_lastFullMs = now;
            s_lastSendMs = now;
            s_forceFull = false;
            s_lastHash = hash;
            s_hasHash = true;
            g_hmiStateDirty = false;
            ++s_cntSendOk;
            return;
        }

        if (s_hasHash && hash == s_lastHash)
        {
            ++s_cntHashEqualSkip;
            if ((uint32_t)(now - s_lastSkipLogMs) >= 1000)
            {
                s_lastSkipLogMs = now;
                EE_LOGI("HMIPUSH",
                        "DIRTY skip same-hash len=%u hash=%08lx",
                        (unsigned)json.length(),
                        (unsigned long)hash);
            }
            g_hmiStateDirty = false;
            return;
        }

        const bool ok = HMI::enqueueJson(jsonWithSeq, HMI::TxKind::StateLite, seq);
        LOG_HMILAT("enqueue state-lite reason=dirty ok=%d len=%u q=%u waitAck=%d seq=%lu",
                   ok ? 1 : 0,
                   (unsigned)json.length(),
                   (unsigned)HMI::queuedCount(),
                   HMI::hasAckPending() ? 1 : 0,
                   (unsigned long)seq);
        LOG_REACT("hmi state dirty enqueue ok=%d len=%u q=%u waitAck=%d seq=%lu",
                  ok ? 1 : 0,
                  (unsigned)json.length(),
                  (unsigned)HMI::queuedCount(),
                  HMI::hasAckPending() ? 1 : 0,
                  (unsigned long)seq);
        if ((uint32_t)(now - s_lastSendLogMs) >= 1000)
        {
            s_lastSendLogMs = now;
            EE_LOGI("HMIPUSH",
                    "DIRTY enqueue ok=%d len=%u hash=%08lx dirtyMin=%lu q=%u waitAck=%d inFlight=%lu",
                    ok ? 1 : 0,
                    (unsigned)json.length(),
                    (unsigned long)hash,
                    (unsigned long)HMI_DIRTY_MIN_MS,
                    (unsigned)HMI::queuedCount(),
                    HMI::hasAckPending() ? 1 : 0,
                    (unsigned long)HMI::inFlightSeq());
        }

        if (!ok)
        {
            ++s_cntSendFail;
            return;
        }

        s_lastSendMs = now;
        s_lastHash = hash;
        s_hasHash = true;
        g_hmiStateDirty = false;
        ++s_cntSendOk;
    }

    void forceFull()
    {
        s_forceFull = true;
        EE_LOGI("HMIPUSH", "forceFull() [hybrid queued+ack]");
    }

    void forceFullDelayed(unsigned long delayMs)
    {
        const uint32_t now = (uint32_t)millis();
        s_forceFull = false;
        s_forceFullDelayedPending = true;
        s_forceFullEarliestMs = now + (uint32_t)delayMs;
        EE_LOGI("HMIPUSH",
                "forceFullDelayed delayMs=%lu earliest=%lu",
                (unsigned long)delayMs,
                (unsigned long)s_forceFullEarliestMs);
    }

    void suppressStateLiteUntil(unsigned long delayMs)
    {
        const uint32_t now = (uint32_t)millis();
        s_stateLiteSuppressUntilMs = now + (uint32_t)delayMs;
        EE_LOGI("HMIPUSH",
                "suppressStateLite delayMs=%lu until=%lu",
                (unsigned long)delayMs,
                (unsigned long)s_stateLiteSuppressUntilMs);
    }

    void suppressAnalogUntil(unsigned long delayMs)
    {
        const uint32_t now = (uint32_t)millis();
        s_analogSuppressUntilMs = now + (uint32_t)delayMs;
        EE_LOGI("HMIPUSH",
                "suppressAnalog delayMs=%lu until=%lu",
                (unsigned long)delayMs,
                (unsigned long)s_analogSuppressUntilMs);
    }

    void loopAnalog()
    {
        const uint32_t now = (uint32_t)millis();
        if ((int32_t)(now - s_analogSuppressUntilMs) < 0)
            return;

        if ((uint32_t)(now - s_lastAnalogMs) < HMI_ANALOG_MS)
            return;

        const String json = buildHmiAnalogJson();
        const uint32_t hash = fnv1a32(json);
        if (s_hasAnalogHash && hash == s_lastAnalogHash)
        {
            s_lastAnalogMs = now;
            return;
        }

        const uint32_t seq = HMI::nextTxSeq();
        const String jsonWithSeq = addSeqField(json, seq);
        const bool ok = HMI::enqueueJson(jsonWithSeq, HMI::TxKind::Analog, seq);
        LOG_HMILAT("enqueue analog ok=%d len=%u q=%u waitAck=%d seq=%lu",
                   ok ? 1 : 0,
                   (unsigned)json.length(),
                   (unsigned)HMI::queuedCount(),
                   HMI::hasAckPending() ? 1 : 0,
                   (unsigned long)seq);
        LOG_REACT("hmi analog enqueue ok=%d len=%u q=%u waitAck=%d seq=%lu",
                  ok ? 1 : 0,
                  (unsigned)json.length(),
                  (unsigned)HMI::queuedCount(),
                  HMI::hasAckPending() ? 1 : 0,
                  (unsigned long)seq);
        if (ok)
        {
            s_lastAnalogMs = now;
            s_lastAnalogHash = hash;
            s_hasAnalogHash = true;
        }
    }
}
