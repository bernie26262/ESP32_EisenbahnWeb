#include "webserver.h"

#include <ArduinoJson.h>
#include <AsyncWebServer_ESP32_SC_W5500.h>
#include <AsyncTCP.h>

#include "network/eth_manager.h"
#include "core2/state/system_runtime_state.h"
#include "core2/mega/mega2_client.h"

#include <LittleFS.h>

// ---------------------------------------------------------
// Globale Objekte
// ---------------------------------------------------------
static AsyncWebServer server(80);
static AsyncWebSocket ws("/ws");

// 🔴 NEU: Dirty-Flag (Definition)
volatile bool g_stateDirty = true;

// ---------------------------------------------------------
// Status JSON (LEGACY / Debug)
// ---------------------------------------------------------
static String buildStatusJson()
{
    StaticJsonDocument<512> doc;

    doc["eth"]["connected"] = Net::EthManager::isConnected();
    doc["eth"]["ip"]        = Net::EthManager::localIP().toString();

    doc["mega2"]["online"] = SystemRuntimeState::mega2Online();
    if (SystemRuntimeState::mega2Online())
    {
        doc["mega2"]["flags"] = SystemRuntimeState::mega2Status().flags;
        doc["mega2"]["safety_lock"] = SystemRuntimeState::safetyLock();
        doc["mega2"]["safety_reason"] =
            (uint8_t)SystemRuntimeState::safetyReason();
    }

    String out;
    serializeJson(doc, out);
    return out;
}

// ---------------------------------------------------------
// 🔴 NEU: WebSocket State JSON (EVENT-BASIERT)
// ---------------------------------------------------------
static String buildWsStateJson()
{
    StaticJsonDocument<512> doc;

    doc["type"] = "state";
    doc["ts"]   = (uint32_t)millis();

    doc["eth"]["connected"] = Net::EthManager::isConnected();
    doc["eth"]["ip"]        = Net::EthManager::localIP().toString();

    bool m2online = SystemRuntimeState::mega2Online();
    doc["mega2"]["online"] = m2online;

    JsonObject s = doc["safety"].to<JsonObject>();

// -----------------------------
// Safety-Status (abgeleitet, ESP-Ebene)
// -----------------------------
const auto& m2 = SystemRuntimeState::mega2Status();

// Grundzustand
s["lock"]        = SystemRuntimeState::safetyLock();
s["blockReason"] = SystemRuntimeState::safetyBlockReason();

// Power-Status (aus Flags)
s["powerOn"] = (m2.flags & SYS_POWER_ON) != 0;

if (m2online)
{
    doc["mega2"]["flags"] = m2.flags;

    s["errorType"]  = SystemRuntimeState::errorType;
    s["errorIndex"] = SystemRuntimeState::errorIndex;

    s["text"] = SystemRuntimeState::safetyErrorText(
        SystemRuntimeState::errorType,
        SystemRuntimeState::errorIndex
    );
}
else
{
    s["errorType"]  = 0;
    s["errorIndex"] = 0;
    s["text"] = "Mega2 offline";
}


    String out;
    serializeJson(doc, out);
    return out;
}

// ---------------------------------------------------------
// WebSocket Events
// ---------------------------------------------------------
static void onWsEvent(AsyncWebSocket*,
                      AsyncWebSocketClient* client,
                      AwsEventType type,
                      void* arg,
                      uint8_t* data,
                      size_t len)
{
    if (type == WS_EVT_CONNECT)
    {
        client->text(buildWsStateJson());
        return;
    }

    if (type != WS_EVT_DATA)
        return;

    AwsFrameInfo* info = (AwsFrameInfo*)arg;
    if (!info->final || info->index != 0 || info->len != len)
        return;

    data[len] = 0;

    StaticJsonDocument<256> cmd;
    if (deserializeJson(cmd, (char*)data))
        return;

    const char* action = cmd["action"];
    if (!action)
        return;

    // -------------------------------------------------
    // Safety Commands
    // -------------------------------------------------
    if (!strcmp(action, "safetyAck"))
    {
        Mega2Client::safetyAck();
        return;
    }

    if (!strcmp(action, "nothalt"))
    {
        Mega2Client::setNotaus(true);
        return;
    }

    if (!strcmp(action, "powerOn"))
    {
        Mega2Client::powerOn();
        return;
    }
}


// ---------------------------------------------------------
// Web::begin
// ---------------------------------------------------------
void Web::begin()
{
    LittleFS.begin(true);

    server.serveStatic("/", LittleFS, "/")
      .setDefaultFile("index.htm")
      .setCacheControl("no-cache");
    server.on("/", HTTP_GET,
        [](AsyncWebServerRequest *req){
            req->send(LittleFS, "/index.html", "text/html");
        });

    server.on("/status", HTTP_GET,
        [](AsyncWebServerRequest* req){
            req->send(200, "application/json", buildStatusJson());
        });

    ws.onEvent(onWsEvent);
    server.addHandler(&ws);

    server.begin();
    Serial.println("[Web] Server gestartet");
}

// ---------------------------------------------------------
// 🔴 NEU: Push bei Änderung
// ---------------------------------------------------------
void Web::pushStateIfDirty()
{
    if (!g_stateDirty)
        return;

    ws.textAll(buildWsStateJson());
    g_stateDirty = false;
}

// ---------------------------------------------------------
// Web::loop
// ---------------------------------------------------------
void Web::loop()
{
    ws.cleanupClients();
    Web::pushStateIfDirty();
}
