#include <WebServer.h>            // Wichtig: stellt HTTP_GET, HTTP_ANY usw. bereit
#include <ESPAsyncWebServer.h>
#include <AsyncTCP.h>
#include <ArduinoJson.h>
#include <LittleFS.h>

#include "../network/eth_manager.h"
#include "webserver.h"

// -----------------------------------------------------------------------------
// Globale Objekte
// -----------------------------------------------------------------------------
static AsyncWebServer server(80);
static AsyncWebSocket ws("/ws");

// -----------------------------------------------------------------------------
// Hilfsfunktion: Status an alle WebSocket-Clients senden
// -----------------------------------------------------------------------------
void ws_sendState(const char* key, int value) {
    DynamicJsonDocument doc(256);
    doc["type"] = "state";
    doc["key"]  = key;
    doc["value"] = value;

    String json;
    serializeJson(doc, json);
    ws.textAll(json);
}

// -----------------------------------------------------------------------------
// WebSocket-Event-Handler
// -----------------------------------------------------------------------------
static void onWsEvent(AsyncWebSocket *server,
                      AsyncWebSocketClient *client,
                      AwsEventType type,
                      void *arg,
                      uint8_t *data,
                      size_t len) {

    if (type == WS_EVT_CONNECT) {
        Serial.printf("WS: Client #%u connected from %s\n",
                      client->id(),
                      client->remoteIP().toString().c_str());
        // Optional direkt nach Connect: initialen Zustand schicken
        ws_sendState("ping", 1);
    }
    else if (type == WS_EVT_DISCONNECT) {
        Serial.printf("WS: Client #%u disconnected\n", client->id());
    }
    else if (type == WS_EVT_DATA) {
        // Eingehende Nachricht auswerten
        String msg;
        msg.reserve(len);
        for (size_t i = 0; i < len; i++) {
            msg += (char)data[i];
        }

        Serial.printf("WS: Received from #%u: %s\n", client->id(), msg.c_str());

        DynamicJsonDocument doc(256);
        DeserializationError err = deserializeJson(doc, msg);
        if (err) {
            Serial.printf("WS JSON error: %s\n", err.c_str());
            return;
        }

        // Beispiel: {"ping":true}
        if (doc["ping"].is<bool>() && doc["ping"] == true) {
            DynamicJsonDocument reply(128);
            reply["pong"] = true;

            String out;
            serializeJson(reply, out);
            client->text(out);
        }

        // Hier später: Befehle an Mega1/Mega2 auswerten
    }
}

// -----------------------------------------------------------------------------
// HTTP-Handler: /api/state  (simple JSON-Status)
// -----------------------------------------------------------------------------
static void handleApiState(AsyncWebServerRequest *req) {
    DynamicJsonDocument doc(256);

    // Platzhalter-Daten – hier später echte Zustände der Megas einbauen
    doc["mega1"]["name"] = "Weichen-Bahnhofssteuerung";
    doc["mega1"]["ok"]   = true;

    doc["mega2"]["name"] = "Block-Schattenbahnhofssteuerung";
    doc["mega2"]["ok"]   = true;

    String json;
    serializeJson(doc, json);
    req->send(200, "application/json", json);
}

// -----------------------------------------------------------------------------
// Initialisierung Webserver
// -----------------------------------------------------------------------------
void web_init() {
    Serial.println("Web: init...");

    // LittleFS mounten (für /data Inhalt: index.html, style.css, script.js, favicon.ico)
    if (!LittleFS.begin()) {
        Serial.println("LittleFS mount failed!");
    } else {
        Serial.println("LittleFS mounted.");
    }

    // Statischer Inhalt aus LittleFS
    // -> PlatformIO: board_build.filesystem = littlefs, Ordner: data/
    server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");

    // API-Endpoint für Status
    server.on("/api/state", HTTP_GET, handleApiState);

    // WebSocket anmelden
    ws.onEvent(onWsEvent);
    server.addHandler(&ws);

    // Optional: simpler Ping-Endpoint zum Testen
    server.on("/ping", HTTP_GET, [](AsyncWebServerRequest *req) {
        req->send(200, "text/plain", "pong");
    });

    server.begin();
    Serial.println("Web: server started on port 80.");
}

// -----------------------------------------------------------------------------
// Loop-Funktion (nur Cleanup der WS-Clients)
// -----------------------------------------------------------------------------
void web_loop() {
    ws.cleanupClients();
}
