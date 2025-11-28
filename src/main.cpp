#include <Arduino.h>
#include "core/system_state.h"
#include "core/mega_link.h"
#include "network/wifi_manager.h"
#include "web/webserver.h"

void setup() {
    Serial.begin(115200);
    delay(300);

    Serial.println("\n===== ESP32-S3 Eisenbahn-Projekt gestartet =====");

    wifi_init();
    core_init();
    web_init();  // Webserver starten
    mega_link_init();   
}

void loop() {
    wifi_loop();
    core_update();
    web_loop(); // bleibt leer, aber für Konsistenz
    mega_link_loop();
    
}
