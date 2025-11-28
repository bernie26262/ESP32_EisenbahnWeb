#include "webserver.h"

#include <ESPAsyncWebServer.h>
#include <AsyncTCP.h>
#include <LittleFS.h>
#include <ArduinoJson.h>

#include "../network/wifi_manager.h"

// -----------------------------------------------------------------------------
// Globale Objekte
// -----------------------------------------------------------------------------
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// -----------------------------------------------------------------------------
// WebSocket: Status an alle Clients senden
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
            ws_sendStatus();  // Neue Clients sofort updaten
            break;

        case WS_EVT_DISCONNECT:
            Serial.printf("[WebSocket] Client %u getrennt\n", client->id());
            break;

        case WS_EVT_DATA:
            Serial.printf("[WebSocket] Daten von Client %u erhalten\n", client->id());
            // TODO: später Steuerbefehle
            break;

        case WS_EVT_ERROR:
            Serial.printf("[WebSocket] Fehler bei Client %u\n", client->id());
            break;

        default:
            break;
    }
}

// -----------------------------------------------------------------------------
// Webserver initialisieren
// -----------------------------------------------------------------------------
void web_init() {

    // --- LittleFS starten ----------------------------------------------------
    if (!LittleFS.begin()) {
        Serial.println("[FS] Fehler beim Starten von LittleFS!");
    } else {
        Serial.println("[FS] LittleFS bereit.");
    }

    // -------------------------------------------------------------------------
    // WICHTIG: WebSocket und API vor static files registrieren!
    // -------------------------------------------------------------------------

    // --- WebSocket zuerst ----------------------------------------------------
    ws.onEvent(handleWebSocketEvent);
    server.addHandler(&ws);

    // --- API: Ping -----------------------------------------------------------
    server.on("/api/ping", HTTP_GET, [](AsyncWebServerRequest *request){
        request->send(200, "application/json", "{\"pong\":true}");
    });

    // --- API: Status ---------------------------------------------------------
    server.on("/api/status", HTTP_GET, [](AsyncWebServerRequest *request){
        StaticJsonDocument<128> doc;

        doc["wifi"] = wifi_isConnected();
        doc["ip"] = wifi_isConnected() ? WiFi.localIP().toString() : "";

        String json;
        serializeJson(doc, json);

        request->send(200, "application/json", json);
    });

    // -------------------------------------------------------------------------
    // Statische Dateien (erst *nach* API & WebSocket!)
    // -------------------------------------------------------------------------

    // favicon.ico direkt liefern
    server.serveStatic("/favicon.ico", LittleFS, "/favicon.ico");

    // Root → index.html
    server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");

    // -------------------------------------------------------------------------
    // Server starten
    // -------------------------------------------------------------------------
    server.begin();
    Serial.println("[Web] Webserver gestartet auf Port 80");
}

// -----------------------------------------------------------------------------
// Loop
// -----------------------------------------------------------------------------
void web_loop() {
    ws.cleanupClients();
}
