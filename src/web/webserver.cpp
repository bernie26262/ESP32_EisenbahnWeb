#include "webserver.h"

#include <ESPAsyncWebServer.h>
#include <AsyncTCP.h>
#include <LittleFS.h>
#include <ArduinoJson.h>

#include "../network/wifi_manager.h"
#include "../core/mega_link.h"

// -----------------------------------------------------------------------------
// Globale Webserver-Objekte
// -----------------------------------------------------------------------------
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// -----------------------------------------------------------------------------
// Sendet den WiFi/Webserver-Status an alle WebSocket-Clients
// -----------------------------------------------------------------------------
void ws_sendStatus() {
    StaticJsonDocument<128> doc;

    doc["type"] = "status";
    doc["wifi"] = wifi_isConnected();
    doc["ip"] = wifi_isConnected() ? WiFi.localIP().toString() : "";

    String json;
    serializeJson(doc, json);
    ws.textAll(json);
}

// -----------------------------------------------------------------------------
// Sendet Mega-Status an alle WebSocket-Clients
// -----------------------------------------------------------------------------
void ws_sendMegaStatus(const String& jsonData) {
    StaticJsonDocument<256> doc;

    doc["type"] = "megaStatus";  
    doc["connected"] = mega_isConnected();
    doc["lastUpdate"] = mega_lastUpdate();
    doc["raw"] = jsonData;

    String out;
    serializeJson(doc, out);

    ws.textAll(out);
}

// -----------------------------------------------------------------------------
// WebSocket Event Handler
// -----------------------------------------------------------------------------
void handleWebSocketEvent(AsyncWebSocket * server,
                           AsyncWebSocketClient * client,
                           AwsEventType type,
                           void * arg,
                           uint8_t * data,
                           size_t len)
{
    switch (type) {

        case WS_EVT_CONNECT:
            Serial.printf("[WebSocket] Client %u verbunden\n", client->id());
            ws_sendStatus();
            break;

        case WS_EVT_DISCONNECT:
            Serial.printf("[WebSocket] Client %u getrennt\n", client->id());
            break;

        case WS_EVT_DATA:
            Serial.printf("[WebSocket] Daten von Client %u erhalten\n", client->id());
            // TODO: später Weichen-Steuerbefehle hier auswerten
            break;

        case WS_EVT_ERROR:
            Serial.printf("[WebSocket] Fehler bei Client %u\n", client->id());
            break;

        default:
            break;
    }
}

// -----------------------------------------------------------------------------
// Initialisierung des Webservers
// -----------------------------------------------------------------------------
void web_init() {

    // --- LittleFS ------------------------------------------------------------
    if (!LittleFS.begin()) {
        Serial.println("[FS] Fehler beim Starten von LittleFS!");
    } else {
        Serial.println("[FS] LittleFS bereit.");
    }

    // --- WebSocket aktivieren ------------------------------------------------
    ws.onEvent(handleWebSocketEvent);
    server.addHandler(&ws);

    // --- Statische Dateien ---------------------------------------------------
    server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");

    // Favicon
    server.serveStatic("/favicon.ico", LittleFS, "/favicon.ico");

    // --- API: Ping -----------------------------------------------------------
    server.on("/api/ping", HTTP_GET, [](AsyncWebServerRequest *request){
        request->send(200, "application/json", "{\"pong\":true}");
    });

    // --- API: WiFi-Status ----------------------------------------------------
    server.on("/api/status", HTTP_GET, [](AsyncWebServerRequest *request){
        StaticJsonDocument<128> doc;
        doc["wifi"] = wifi_isConnected();
        doc["ip"] = wifi_isConnected() ? WiFi.localIP().toString() : "";

        String json;
        serializeJson(doc, json);
        request->send(200, "application/json", json);
    });

    // --- API: Mega-Status ----------------------------------------------------
    server.on("/api/mega/status", HTTP_GET, [](AsyncWebServerRequest *request){

        StaticJsonDocument<256> doc;

        doc["connected"] = mega_isConnected();
        doc["lastUpdate"] = mega_lastUpdate();
        doc["data"] = mega_getLastJson();

        String json;
        serializeJson(doc, json);
        request->send(200, "application/json", json);
    });

    // --- Start ---------------------------------------------------------------
    server.begin();
    Serial.println("[Web] Webserver gestartet auf Port 80");
}

// -----------------------------------------------------------------------------
// Loop (Async → minimal)
// -----------------------------------------------------------------------------
void web_loop() {
    ws.cleanupClients();
}
