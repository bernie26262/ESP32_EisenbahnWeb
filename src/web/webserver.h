#pragma once

#include <Arduino.h>

namespace Web
{
  // Startet AsyncWebServer + WebSocket
  void begin();

  // Optional: in loop() aufrufen, um Clients aufzuräumen
  void loop();

  // Hilfsfunktion: Text an alle WebSocket-Clients senden
  void broadcastText(const String& msg);
}
