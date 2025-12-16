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

// ---------------------------------------------------------
// Status JSON
// ---------------------------------------------------------
static String buildStatusJson()
{
    StaticJsonDocument<512> doc;

    // Ethernet
    doc["eth"]["connected"] = Net::EthManager::isConnected();
    doc["eth"]["ip"]        = Net::EthManager::localIP().toString();

    // Mega2 / Safety
    if (SystemRuntimeState::mega2Online())
    {
        const auto& st = SystemRuntimeState::mega2Status();

        doc["mega2"]["online"] = true;
        doc["mega2"]["flags"]  = st.flags;

        doc["mega2"]["safety_lock"] =
            SystemRuntimeState::safetyLock();

        doc["mega2"]["safety_reason"] =
            static_cast<uint8_t>(
                SystemRuntimeState::safetyReason()
            );
    }
    else
    {
        doc["mega2"]["online"] = false;
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
        client->text(buildStatusJson());
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
    // Safety ACK (Mega2)
    // -------------------------------------------------
    if (!strcmp(action, "safetyAck"))
    {
        bool ok = Mega2Client::safetyAck();
        client->text(ok ? "ACK_OK" : "ACK_FAIL");
    }

    // Status zurückschicken
    client->text(buildStatusJson());
}

// ---------------------------------------------------------
// Web::begin
// ---------------------------------------------------------
void Web::begin()
{
    if (!LittleFS.begin(true))
    {
        Serial.println("[FS] LittleFS Mount FAILED");
    }
    else
    {
        Serial.println("[FS] LittleFS mounted");
    }

    // -----------------------------
    // Statische Assets unter /static
    // -----------------------------
    server.serveStatic("/static", LittleFS, "/");

    // -----------------------------
    // Root-Seite
    // -----------------------------
    server.on("/", HTTP_GET, [](AsyncWebServerRequest* req)
    {
        req->send(LittleFS, "/index.html", "text/html");
    });

    // -----------------------------
    // JSON-Status
    // -----------------------------
    server.on("/status", HTTP_GET, [](AsyncWebServerRequest* req)
    {
        req->send(200, "application/json", buildStatusJson());
    });

    // -----------------------------
    // SPA-Fallback
    // -----------------------------
    server.onNotFound([](AsyncWebServerRequest* req)
    {
        req->send(LittleFS, "/index.html", "text/html");
    });

    ws.onEvent(onWsEvent);
    server.addHandler(&ws);

    server.begin();

    Net::EthManager::markConnected(
        IPAddress(1,1,1,1)   // Platzhalter reicht
    );
    
    Serial.println("[Web] Server gestartet");
}

// ---------------------------------------------------------
// Web::loop
// ---------------------------------------------------------
void Web::loop()
{
    ws.cleanupClients();
}
