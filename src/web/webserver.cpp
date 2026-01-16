#include "webserver.h"

#include <ArduinoJson.h>
#include <AsyncWebServer_ESP32_SC_W5500.h>
#include <AsyncTCP.h>

#include "network/eth_manager.h"
#include "core2/state/system_runtime_state.h"
#include "core2/mega/mega2_link.h"
#include "core2/mega/mega1_link.h"

#include <LittleFS.h>



// ---------------------------------------------------------
// Globale Objekte
// ---------------------------------------------------------
static AsyncWebServer server(80);
static AsyncWebSocket ws("/ws");

// IMPORTANT: Dieses Symbol wird (derzeit) auch aus anderen Modulen referenziert.
volatile bool g_stateDirty = true;

// ---------------------------------------------------------
// WebSocket State JSON
// ---------------------------------------------------------
static String buildWsStateJson()
{
    StaticJsonDocument<1024> doc;

    doc["type"] = "state";
    doc["ts"]   = (uint32_t)millis();

    doc["eth"]["connected"] = Net::EthManager::isConnected();
    doc["eth"]["ip"]        = Net::EthManager::localIP().toString();

    // Mega2 online: use link-layer flag (matches [M2LINK] online=1 in Serial)
    const bool m2online = Mega2Link::mega2Online();
    const bool m1online = SystemRuntimeState::mega1Online();

    doc["mega2"]["online"] = m2online;
    doc["mega1"]["online"] = m1online;

    // --- Compatibility + Debug (damit WebUI sicher etwas findet) ---
    doc["mega1Online"] = m1online;  // Legacy: falls script.js das so erwartet

    // -----------------------------
    // Startup checklist / boot detection (ESP)
    // -----------------------------
    const bool m1Needs = SystemRuntimeState::mega1NeedsStartupChecklist();
    const bool m2Needs = SystemRuntimeState::mega2NeedsStartupChecklist();

    // "ready" bedeutet erstmal: aus ESP-Sicht keine offenen Boot-Checklist-Punkte.
    // (Spaeter ersetzen wir das durch "Selftests PASS".)
    JsonObject startup = doc["startup"].to<JsonObject>();
    startup["m1Needs"] = m1Needs;
    startup["m2Needs"] = m2Needs;
    startup["ready"]   = (!m1Needs && !m2Needs);
    startup["m2SelftestDone"] = SystemRuntimeState::mega2SelftestDone();

    // Optional Debug: BootId/Uptime sichtbar machen (sehr hilfreich fürs Verifizieren)
    const auto& m1dbg = SystemRuntimeState::mega1Status();
    const auto& m2dbg = SystemRuntimeState::mega2Status();
    startup["m1BootId"]   = (unsigned)m1dbg.bootId;
    startup["m2BootId"]   = (unsigned)m2dbg.bootId;
    startup["m1UptimeMs"] = (uint32_t)m1dbg.uptimeMs;
    startup["m2UptimeMs"] = (uint32_t)m2dbg.uptimeMs;

    const auto& m1s = SystemRuntimeState::mega1Status();
    JsonObject m1st = doc["mega1"]["status"].to<JsonObject>();
    m1st["ver"]   = m1s.version;
    m1st["size"]  = m1s.size;
    m1st["node"]  = m1s.nodeId;
    m1st["flags"] = m1s.flags;

    // Optional: rxAge als Debug (wenn du s_lastRxMsM1 nicht exposen willst, dann erstmal weglassen)
    // m1st["rxAgeMs"] = SystemRuntimeState::mega1RxAgeMs();

    // -----------------------------
    // Safety (ESP abgeleitet)
    // -----------------------------
    JsonObject s = doc["safety"].to<JsonObject>();

    const auto& m2 = SystemRuntimeState::mega2Status();

    s["lock"]        = SystemRuntimeState::safetyLock();
    s["blockReason"] = SystemRuntimeState::safetyBlockReason();

    // Fehlerdetails (für UI-Textmapping)
    s["errorType"]  = SystemRuntimeState::errorType;
    s["errorIndex"] = SystemRuntimeState::errorIndex;

    // Power-Status (aus Flags)
    s["powerOn"] = (m2.flags & SYS_POWER_ON) != 0;

    // NOTAUS-Status (aus Flags)
    s["notausActive"] = (m2.flags & SYS_NOTAUS_ACTIVE) != 0;

    // Klartext (ESP-seitig)
    s["text"] = SystemRuntimeState::safetyErrorText(
        SystemRuntimeState::errorType,
        SystemRuntimeState::errorIndex
    );

    // Optional: UI kann das direkt nutzen, statt lock/reason zu heuristiken
    s["ackRequired"] = (SystemRuntimeState::safetyLock() && (s["notausActive"] || (SystemRuntimeState::safetyBlockReason() != 0)));

    // -----------------------------
    // Mega2 Details (nur wenn online)
    // -----------------------------
    if (m2online)
    {
        const auto& m2s = SystemRuntimeState::mega2Status();

        doc["mega2"]["flags"]             = m2s.flags;
        doc["mega2"]["blockOccupiedMask"] = m2s.blockOccupiedMask;

        // reserved = (allowedMask<<8) | warningMask
        const uint8_t allowedMask = (uint8_t)((m2s.reserved >> 8) & 0xFF);
        const uint8_t warningMask = (uint8_t)(m2s.reserved & 0xFF);

        // expose masks explicitly for WebUI (warnings + Einschränkungen)
        doc["mega2"]["allowedMask"] = allowedMask;
        doc["mega2"]["warningMask"] = warningMask;

        JsonObject sbhf = doc["mega2"]["sbhf"].to<JsonObject>();
        sbhf["state"] = m2s.sbhfState;
        // Also expose flat fields for backward compatibility / diagnostics.
        // IMPORTANT: sbhfOccupiedMask includes META bits (e.g. 0x80 selftestRunning).
        doc["mega2"]["sbhfState"]        = m2s.sbhfState;
        doc["mega2"]["sbhfOccupiedMask"] = m2s.sbhfOccupiedMask;

        // sbhfOccupiedMask carries occupancy in bits 0..2 (G1..G3).
        // We additionally encode runtime META flags in higher bits to avoid
        // a SystemStatus protocol bump.
        // Bit7 (0x80): SBHF selftest running.
        const uint16_t occRaw = m2s.sbhfOccupiedMask;
        const bool selftestRunning = (occRaw & 0x80u) != 0;
        const uint8_t occ = (uint8_t)(occRaw & 0x07u);

        sbhf["occupiedMask"]    = occ;
        sbhf["occupiedMaskRaw"] = occRaw; // debug/diagnostics
        sbhf["selftestRunning"] = selftestRunning;

        // UI compatibility: provide both naming variants.
        sbhf["currentGleis"] = m2s.sbhfCurrentGleis;
        sbhf["currentTrack"] = m2s.sbhfCurrentGleis;

        // Masks (source: reserved field in SystemStatus)
        sbhf["allowedMask"]  = allowedMask;
        sbhf["warningMask"]  = warningMask;

        const bool restricted =
            ((warningMask & 0x01) != 0) ||
            (allowedMask != 0x07 && allowedMask != 0x00);

        sbhf["restricted"] = restricted;


        JsonObject t = doc["mega2"]["turnouts"].to<JsonObject>();
        t["sollMask"] = m2s.turnoutSollMask;
        t["istMask"]  = m2s.turnoutIstMask;

        // Blocks (UI expects an object)
        JsonObject b = doc["mega2"]["blocks"].to<JsonObject>();
        b["occupiedMask"] = m2s.blockOccupiedMask;

        // Step 3.5: Entry-Matrix (FROM->TO)
        JsonArray entry = doc["mega2"]["entryAllowed"].to<JsonArray>();
        const uint16_t* ea = SystemRuntimeState::mega2EntryAllowed();
        for (uint8_t i = 0; i < 9; i++)
            entry.add(ea[i]);

        JsonArray entryPrev = doc["mega2"]["entryPreview"].to<JsonArray>();
        const uint16_t* ep = SystemRuntimeState::mega2EntryPreview();
        for (uint8_t i = 0; i < 9; i++)
            entryPrev.add(ep[i]);
    }

    // -----------------------------
    // Mega1 Details (nur wenn online)
    // -----------------------------
    doc["mega1"]["hasDiag"] = false;

    if (m1online)
    {
        const auto& m1d = SystemRuntimeState::mega1Diag();

        JsonObject d  = doc["mega1"]["diag"].to<JsonObject>();
        d["mode"]      = m1d.mode;
        d["powerMask"] = m1d.powerMask;

        // NOTE: Mega1DiagV1 field names
        d["weicheIstBits"]  = m1d.weicheIstGeradeBits;
        d["weicheSollBits"] = m1d.weicheSollGeradeBits;
        d["weicheSlowBits"] = m1d.weicheSlowActiveBits;

        doc["mega1"]["hasDiag"] = true;
    }


    String out;
    serializeJson(doc, out);
    return out;
}

// ---------------------------------------------------------
// WS Event Handler
// ---------------------------------------------------------
static void onWsEvent(AsyncWebSocket* server,
                      AsyncWebSocketClient* client,
                      AwsEventType type,
                      void* arg,
                      uint8_t* data,
                      size_t len)
{
    if (type == WS_EVT_CONNECT)
    {
        Serial.printf("[WS] client connected id=%u\n", client ? client->id() : 0);
        client->text(buildWsStateJson());
        return;
    }

    if (type != WS_EVT_DATA)
        return;

    AwsFrameInfo* info = (AwsFrameInfo*)arg;
    if (!info->final || info->index != 0 || info->len != len)
        return;

    JsonDocument cmd;
    if (deserializeJson(cmd, data, len))
        return;

    const char* action = cmd["action"];
    if (!action)
        return;

    Serial.printf("[WS] action rx: %s\n", action);

    if (!strcmp(action, "safetyAck"))
    {
        Mega2Link::safetyAck();
        g_stateDirty = true;
        return;
    }

    if (!strcmp(action, "nothalt"))
    {
        Mega2Link::nothalt();
        g_stateDirty = true;
        return;
    }

    if (!strcmp(action, "powerOn"))
    {
        Mega2Link::powerOn();
        g_stateDirty = true;
        return;
    }

    if (!strcmp(action, "powerOff"))
    {
        Mega2Link::powerOff();
        g_stateDirty = true;
        return;
    }

    if (!strcmp(action, "powerToggle"))
    {
        if (((SystemRuntimeState::mega2Status().flags & SYS_POWER_ON) != 0))
            Mega2Link::powerOff();
        else
            Mega2Link::powerOn();

        g_stateDirty = true;
        return;
    }

    // -------------------------------------------------
    // Mega1 Commands
    // -------------------------------------------------
    if (!strcmp(action, "m1SetMode"))
    {
        const uint8_t mode = (uint8_t)(cmd["mode"] | 0);
        const bool ok = Mega1Link::queueSetMode(mode);
        if (!ok) Serial.println("[WS] m1SetMode rejected (args/queue full)");
        g_stateDirty = true;
        return;
    }

    if (!strcmp(action, "m1TurnoutSet"))
    {
        const uint8_t idxW = (uint8_t)(cmd["idx"] | 0);
        const bool gerade = (bool)(cmd["gerade"] | 0);
        const bool ok = Mega1Link::queueTurnoutSet(idxW, gerade);
        if (!ok) Serial.println("[WS] m1TurnoutSet rejected (args/queue full)");
        g_stateDirty = true;
        return;
    }

    if (!strcmp(action, "m1PowerSet"))
    {
        const int bhf_i = cmd["bhf"] | -1;
        if (bhf_i < 0 || bhf_i > 3) {
            Serial.printf("[WS] m1PowerSet reject: bhf=%d out of range\n", bhf_i);
            return;
        }
        const uint8_t bhf = (uint8_t)bhf_i;

        // robust bool parse: true/false, 0/1, "true"/"false"
        bool on = false;
        JsonVariant vOn = cmd["on"];
        if (vOn.is<bool>()) {
            on = vOn.as<bool>();
        } else if (vOn.is<int>()) {
            on = (vOn.as<int>() != 0);
        } else if (vOn.is<const char*>()) {
            const char* s = vOn.as<const char*>();
            if (s) on = (!strcasecmp(s, "true") || !strcasecmp(s, "on") || !strcmp(s, "1"));
        }

    Serial.printf("[WS] m1PowerSet bhf=%u on=%s\n", bhf, on ? "true" : "false");

    const bool ok = Mega1Link::queueBhfPowerSet(bhf, on);
    if (!ok) Serial.println("[WS] m1PowerSet rejected (args/queue full)");
    g_stateDirty = true;
    return;
}


    if (!strcmp(action, "pollNow"))
    {
        Serial.println("[WS] -> Mega2Link::requestPollNow()");
        Mega2Link::requestPollNow();
        g_stateDirty = true;
        return;
    }

    // SBHF selftest retry (explicit command, NOT mapped to safetyAck)
    if (!strcmp(action, "sbhfSelftestRetry"))
    {
        Serial.println("[WS] -> SBHF Selftest Retry");
        Mega2Link::sbhfSelftestRetry();
        g_stateDirty = true;
        return;
    }
}

// ---------------------------------------------------------
// Web::begin
// ---------------------------------------------------------
void Web::begin()
{
    if (!LittleFS.begin(true))
    {
        Serial.println("[WEB] LittleFS mount FAILED!");
        return;
    }

    ws.onEvent(onWsEvent);
    server.addHandler(&ws);

    server.serveStatic("/", LittleFS, "/")
        .setDefaultFile("index.htm")
        .setCacheControl("no-store, no-cache, must-revalidate, max-age=0");

    server.begin();

    Serial.println("[WEB] HTTP server started");
}

// ---------------------------------------------------------
// Web::loop
// ---------------------------------------------------------
void Web::loop()
{
    ws.cleanupClients();
    Web::pushStateIfDirty();
    
}

// ---------------------------------------------------------
// Web::pushStateIfDirty (laut webserver.h)
// ---------------------------------------------------------
void Web::pushStateIfDirty()
{
    if (!g_stateDirty)
        return;

    ws.textAll(buildWsStateJson());
    g_stateDirty = false;
}
