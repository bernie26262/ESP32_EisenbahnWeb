#include <Arduino.h>
#include "network/net_config.h"
#include "network/eth_manager.h"
#include "web/webserver.h"

using Net::EthManager;

void setup()
{
  Serial.begin(115200);
  while (!Serial && millis() < 3000) { /* auf USB-Seriell warten */ }

  Serial.println();
  Serial.println(F("===== ESP32-S3 + W5500 Eisenbahn-Projekt ====="));
  Serial.print(F("Board: "));
  Serial.println(ARDUINO_BOARD);
  Serial.print(F("Shield: "));
  Serial.println(SHIELD_TYPE);
  Serial.print(F("Lib Version: "));
  Serial.println(ASYNC_WEBSERVER_ESP32_SC_W5500_VERSION);

  // Ethernet/W5500 starten (mit DHCP + Fallback)
  if (!EthManager::begin())
  {
    Serial.println(F("FEHLER: Ethernet konnte nicht initialisiert werden."));
  }

  // Webserver + WebSocket starten
  Web::begin();
}

void loop()
{
  // WebSocket-Clients aufräumen
  Web::loop();

  // Hier später deine Eisenbahn-Logik, Timer, etc.
  delay(50);
}
