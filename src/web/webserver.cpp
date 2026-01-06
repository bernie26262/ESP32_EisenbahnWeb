#include "webserver.h"

#include <ArduinoJson.h>
#include <AsyncWebServer_ESP32_SC_W5500.h>
#include <AsyncTCP.h>

#include "network/eth_manager.h"
#include "core2/state/system_runtime_state.h"
#include "core2/mega/mega2_link.h"

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
    StaticJsonDocument<768> doc;

    doc["type"] = "state";
    doc["ts"]   = (uint32_t)millis();

    doc["eth"]["connected"] = Net::EthManager::isConnected();
    doc["eth"]["ip"]        = Net::EthManager::localIP().toString();

    const bool m2online = SystemRuntimeState::mega2Online();
    doc["mega2"]["online"] = m2online;

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

        JsonObject sbhf = doc["mega2"]["sbhf"].to<JsonObject>();
        sbhf["state"]        = m2s.sbhfState;
        sbhf["occupiedMask"] = m2s.sbhfOccupiedMask;
        sbhf["currentGleis"] = m2s.sbhfCurrentGleis;
        sbhf["allowedMask"]  = allowedMask;
        sbhf["warningMask"]  = warningMask;

        const bool restricted =
            ((warningMask & 0x01) != 0) ||
            (allowedMask != 0x07 && allowedMask != 0x00);

        sbhf["restricted"] = restricted;

        JsonObject t = doc["mega2"]["turnouts"].to<JsonObject>();
        t["sollMask"] = m2s.turnoutSollMask;
        t["istMask"]  = m2s.turnoutIstMask;

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
        // Client bekommt sofort state
        client->text(buildWsStateJson());
        return;
    }

    if (type != WS_EVT_DATA)
        return;

    AwsFrameInfo* info = (AwsFrameInfo*)arg;
    if (!info->final || info->index != 0 || info->len != len)
        return;

    // data ist nicht null-terminiert -> direkt mit len parsen
    StaticJsonDocument<256> cmd;
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

    // UI-STOP (PowerOff) – bewusst getrennt von HW-NOTAUS
    if (!strcmp(action, "powerOff"))
    {
        Mega2Link::powerOff();
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

    // Statische Dateien (WebUI) – Cache abschalten, damit nach "UploadFS"
    // neue script.js/style.css sofort übernommen werden (Browser-Caching).
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


