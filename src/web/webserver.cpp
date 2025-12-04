#include "web/webserver.h"
#include "network/net_config.h"
#include "network/eth_manager.h"

using Net::EthManager;

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
    String hello = F("Hello from ESP32-S3 + W5500 WebSocket-Server");
    client->text(hello);
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
    // optional
  }
  else if (type == WS_EVT_DATA)
  {
    AwsFrameInfo * info = (AwsFrameInfo*)arg;

    if (info->final && info->index == 0 && info->len == len)
    {
      // vollständige Nachricht in einem Frame
      if (info->opcode == WS_TEXT)
      {
        data[len] = 0;
        String msg = (const char*)data;

        Serial.printf("[WS] Text von Client %u: %s\n", client->id(), msg.c_str());

        // Echo + Bestätigung
        client->text("Got your message: " + msg);
      }
      else
      {
        Serial.printf("[WS] Binary data (%u bytes)\n", (unsigned)len);
      }
    }
    else
    {
      // Mehrteilige Frames – für den Anfang ignorieren
      Serial.println(F("[WS] Fragmentierte Nachricht empfangen (wird nicht speziell behandelt)."));
    }
  }
}

// -------------------------- HTTP-Handler -------------------------------

static void handleRoot(AsyncWebServerRequest *request)
{
  // Kleine HTML-Seite mit WebSocket-Test
  String html;

  IPAddress ip = EthManager::localIP();

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
  html += F("<button onclick='sendMsg()'>Nachricht senden</button>");
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
                "ws.send('Hallo vom Browser');"
                "log('Client: Hallo vom Browser');"
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
  // Kann man z.B. nutzen, um regelmäßig aufzuräumen
  ws.cleanupClients();
}

void Web::broadcastText(const String& msg)
{
  ws.textAll(msg);
}
