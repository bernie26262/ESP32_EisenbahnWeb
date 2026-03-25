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
    static uint32_t s_lastSendMs = 0;

    // Hybrid-Test:
    // - periodischer Re-Send bleibt aktiv
    // - on-change kommt zurück, aber rate-limited
    static constexpr uint32_t HMI_FULL_MS = 1000;
    static constexpr uint32_t HMI_DIRTY_MIN_MS = 250;

    static uint32_t s_lastSkipLogMs = 0;
    static uint32_t s_lastSendLogMs = 0;
    static uint32_t s_lastSummaryMs = 0;
    static uint32_t s_cntLoop = 0;
    static uint32_t s_cntWantDirty = 0;
    static uint32_t s_cntWantFull = 0;
    static uint32_t s_cntSendOk = 0;
    static uint32_t s_cntSendFail = 0;
    static uint32_t s_cntHashEqualSkip = 0;

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
}

namespace HmiPush
{
    void loop()
    {
        const uint32_t now = (uint32_t)millis();
        ++s_cntLoop;

        const bool wantFull = s_forceFull || ((uint32_t)(now - s_lastFullMs) >= HMI_FULL_MS);
        const bool dirtyDue =
            ((uint32_t)(now - s_lastSendMs) >= HMI_DIRTY_MIN_MS);
        const bool wantDirty = g_hmiStateDirty && dirtyDue;

        if (g_hmiStateDirty) ++s_cntWantDirty;
        if (wantFull)  ++s_cntWantFull;

        if (!wantFull && !wantDirty)
        {
            if ((uint32_t)(now - s_lastSummaryMs) >= 5000)
            {
                s_lastSummaryMs = now;
                EE_LOGI("HMIPUSH",
                        "summary loop=%lu dirty=%lu full=%lu ok=%lu fail=%lu hashSkip=%lu force=%d hmiDirty=%d dirtyDue=%d lastFullAgo=%lu lastSendAgo=%lu",
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
                        (unsigned long)(now - s_lastSendMs));
            }
            return;
        }

        const String json = buildHmiStateJson();
        const uint32_t hash = fnv1a32(json);

        if (wantFull)
        {
            const bool ok = HMI::sendJson(json);
            if ((uint32_t)(now - s_lastSendLogMs) >= 1000)
            {
                s_lastSendLogMs = now;
                EE_LOGI("HMIPUSH",
                        "PERIODIC try ok=%d len=%u hash=%08lx force=%d hmiDirty=%d lastFullAgo=%lu",
                        ok ? 1 : 0,
                        (unsigned)json.length(),
                        (unsigned long)hash,
                        s_forceFull ? 1 : 0,
                        g_hmiStateDirty ? 1 : 0,
                        (unsigned long)(now - s_lastFullMs));
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

        // Im periodic-only-Test sollte dieser Pfad nie erreicht werden.
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

        const bool ok = HMI::sendJson(json);
        if ((uint32_t)(now - s_lastSendLogMs) >= 1000)
        {
            s_lastSendLogMs = now;
            EE_LOGI("HMIPUSH",
                    "DIRTY try ok=%d len=%u hash=%08lx dirtyMin=%lu",
                    ok ? 1 : 0,
                    (unsigned)json.length(),
                    (unsigned long)hash,
                    (unsigned long)HMI_DIRTY_MIN_MS);
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
        EE_LOGI("HMIPUSH", "forceFull() [hybrid rate-limited]");
    }
}