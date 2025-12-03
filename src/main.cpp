#include <Arduino.h>
#include "network/eth_manager.h"
#include "web/webserver.h"

void setup() {
    Serial.begin(115200);
    delay(500);

    Serial.println("\n===== ESP32-S3 Ethernet-Only Start =====");

    eth_init();     // Ethernet LAN8720 starten
    web_init();     // HTTP + WebSocket + LittleFS starten
}

void loop() {
    eth_loop();     // Platzhalter für spätere Funktionen
    web_loop();     // AsyncWebServer benötigt keine Loop
    delay(10);
}
