#include "web/webserver.h"

#include <Arduino.h>
#include "network/net_config.h"
#include "network/eth_manager.h"
#include "core/mega_link.h"          // für mega_cmd_* und mega_getState

// AsyncWebServer + WebSocket
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// ---------------------- WebSocket Event-Handler ------------------------

static void onWsEvent(AsyncWebSocket * server,
                      AsyncWebSocketClient * client,
                      AwsEventType type,
                      void * arg,
                      uint8_t * data,
                      size_t len)
{
  if (type == WS_EVT_CONNECT)
  {
    Serial.printf("[WS] Client %u verbunden, URL: %s\n", client->id(), server->url());

    // Kleine Begrüßungsnachricht
    client->text(F("{\"type\":\"hello\",\"msg\":\"Hello from ESP32-S3 + W5500 WebSocket-Server\"}"));
  }
  else if (type == WS_EVT_DISCONNECT)
  {
    Serial.printf("[WS] Client %u getrennt\n", client->id());
  }
  else if (type == WS_EVT_ERROR)
  {
    Serial.printf("[WS] Fehler bei Client %u\n", client->id());
  }
  else if (type == WS_EVT_PONG)
  {
    // optional: Pong-Handling
    // Serial.printf("[WS] Pong von Client %u\n", client->id());
  }
  else if (type == WS_EVT_DATA)
  {
    AwsFrameInfo * info = (AwsFrameInfo*)arg;

    // Wir betrachten nur vollständige, unfragmentierte Nachrichten
    if (info->final && info->index == 0 && info->len == len)
    {
      // TEXT oder BINARY?
      if (info->opcode == WS_TEXT)
      {
        // Nullterminierung für String-Verarbeitung
        data[len] = 0;
        String msg = (char*)data;

        Serial.printf("[WS] RX (Text) von Client %u: %s\n", client->id(), msg.c_str());

        // ---------------------------------------------------------
        // CMD-Handling: {"type":"cmd", "action":"...", ...}
        // ---------------------------------------------------------
        if (msg.startsWith("{") && msg.indexOf("\"type\":\"cmd\"") >= 0)
        {
          // Minimaler JSON-"Parser" (string-basiert, ohne externe Lib)
          auto extract = [&](const char* key) -> String {
            int pos = msg.indexOf(key);
            if (pos < 0) return "";
            pos = msg.indexOf(':', pos);
            if (pos < 0) return "";
            int start = pos + 1;

            // String-Wert?
            if (msg[start] == '\"') {
              start++;
              int end = msg.indexOf('\"', start);
              if (end < 0) return "";
              return msg.substring(start, end);
            }

            // Zahl-Wert
            int end = msg.indexOf(',', start);
            if (end < 0) end = msg.indexOf('}', start);
            if (end < 0) end = msg.length();
            return msg.substring(start, end);
          };

          String action = extract("\"action\"");
          String slaveS = extract("\"slave\"");
          uint8_t slave = (uint8_t) slaveS.toInt();

          bool ok = false;

          // ------------------------------
          // 1) Weiche stellen
          //    { "type":"cmd", "action":"set_weiche", "slave":x, "id":w, "value":0/1 }
          // ------------------------------
          if (action == "set_weiche")
          {
            uint8_t id  = (uint8_t) extract("\"id\"").toInt();
            uint8_t val = (uint8_t) extract("\"value\"").toInt();

            ok = mega_cmd_setWeiche(slave, id, val);

            if (ok)
              client->text(F("{\"type\":\"ack\",\"action\":\"set_weiche\"}"));
            else
              client->text(F("{\"type\":\"error\",\"msg\":\"set_weiche failed\"}"));
          }

          // ------------------------------
          // 2) Bahnhof-Strom schalten
          //    { "type":"cmd", "action":"bahnhof_power", "slave":x, "id":b, "value":0/1 }
          // ------------------------------
          else if (action == "bahnhof_power")
          {
            uint8_t id  = (uint8_t) extract("\"id\"").toInt();
            uint8_t val = (uint8_t) extract("\"value\"").toInt();

            ok = mega_cmd_setBahnhof(slave, id, val);

            if (ok)
              client->text(F("{\"type\":\"ack\",\"action\":\"bahnhof_power\"}"));
            else
              client->text(F("{\"type\":\"error\",\"msg\":\"bahnhof_power failed\"}"));
          }

          // ------------------------------
          // 3) Modus setzen
          //    { "type":"cmd", "action":"set_mode", "slave":x, "value":0/1/... }
          // ------------------------------
          else if (action == "set_mode")
          {
            uint8_t mode = (uint8_t) extract("\"value\"").toInt();

            ok = mega_cmd_setMode(slave, mode);

            if (ok)
              client->text(F("{\"type\":\"ack\",\"action\":\"set_mode\"}"));
            else
              client->text(F("{\"type\":\"error\",\"msg\":\"set_mode failed\"}"));
          }

          // ------------------------------
          // 4) FULL-Sync anfordern
          //    { "type":"cmd", "action":"get_full", "slave":x }
          // ------------------------------
          else if (action == "get_full")
          {
            ok = mega_cmd_requestFull(slave);

            if (ok)
              client->text(F("{\"type\":\"ack\",\"action\":\"get_full\"}"));
            else
              client->text(F("{\"type\":\"error\",\"msg\":\"get_full failed\"}"));
          }

          // Unbekannte Action
          else
          {
            client->text(F("{\"type\":\"error\",\"msg\":\"unknown action\"}"));
          }

          // CMD wurde verarbeitet – hier raus
          return;
        }

        // ---------------------------------------------------------
        // Keine CMD-Nachricht → einfach loggen und echo'n
        // ---------------------------------------------------------
        client->text("Echo: " + msg);
      }
      else
      {
        // Binary-Daten: wir loggen nur, behandeln sie aber nicht speziell
        Serial.printf("[WS] RX (Binary) von Client %u, len=%u\n",
                      client->id(), (unsigned)len);
      }
    }
    else
    {
      // Fragmentierte Frames oder Multi-Frame Nachrichten
      // Für dein Projekt aktuell nicht relevant → nur loggen
      Serial.printf("[WS] Fragmentierte WS-Nachricht von Client %u (num=%u, index=%llu, len=%llu)\n",
                    client->id(),
                    info->num,
                    (unsigned long long)info->index,
                    (unsigned long long)info->len);
    }
  }
}

// -------------------------- HTTP-Handler -------------------------------

static void handleRoot(AsyncWebServerRequest *request)
{
  // Kleine HTML-Seite mit WebSocket-Test
  String html;

  IPAddress ip = Net::EthManager::localIP();

  html  = F("<!DOCTYPE html><html><head><meta charset='utf-8'>");
  html += F("<title>ESP32-S3 W5500 WebSocket</title></head><body>");
  html += F("<h1>ESP32-S3 + W5500 (AsyncWebServer_ESP32_SC_W5500)</h1>");

  html += F("<p>Ethernet-IP: ");
  if (ip != IPAddress(0,0,0,0))
  {
    html += ip.toString();
  }
  else
  {
    html += F("keine IP");
  }
  html += F("</p>");

  html += F("<p>Status: <span id='status'>Verbinde...</span></p>");
  html += F("<button onclick='sendMsg()'>Test-Nachricht senden</button>");
  html += F("<pre id='log'></pre>");

  html += F("<script>"
            "var ws;"
            "function log(msg){"
              "document.getElementById('log').textContent += msg + '\\n';"
            "}"
            "function connectWs(){"
              "var proto = (location.protocol === 'https:') ? 'wss://' : 'ws://';"
              "var url = proto + window.location.host + '/ws';"
              "ws = new WebSocket(url);"
              "ws.onopen = function(){"
                "document.getElementById('status').textContent = 'verbunden';"
                "log('WebSocket verbunden: ' + url);"
              "};"
              "ws.onmessage = function(evt){"
                "log('Server: ' + evt.data);"
              "};"
              "ws.onclose = function(){"
                "document.getElementById('status').textContent = 'getrennt';"
                "log('WebSocket getrennt');"
              "};"
              "ws.onerror = function(e){"
                "log('WebSocket Fehler');"
              "};"
            "}"
            "function sendMsg(){"
              "if(ws && ws.readyState === WebSocket.OPEN){"
                "var msg = JSON.stringify({type:'cmd',action:'get_full',slave:0});"
                "ws.send(msg);"
                "log('Client: ' + msg);"
              "} else {"
                "log('WebSocket nicht verbunden');"
              "}"
            "}"
            "window.onload = connectWs;"
            "</script>");

  html += F("</body></html>");

  request->send(200, "text/html", html);
}

// -------------------------- API ----------------------------------------

void Web::begin()
{
  Serial.println(F("Web::begin() – starte HTTP- und WebSocket-Server"));

  ws.onEvent(onWsEvent);
  server.addHandler(&ws);

  server.on("/", handleRoot);

  server.onNotFound([](AsyncWebServerRequest *request)
  {
    request->send(404, "text/plain", "Not found");
  });

  server.begin();
  Serial.println(F("HTTP-Server läuft auf Port 80"));
}

void Web::loop()
{
  // WebSocket-Clients regelmäßig aufräumen
  ws.cleanupClients();
}

void Web::broadcastText(const String& msg)
{
  ws.textAll(msg);
}
