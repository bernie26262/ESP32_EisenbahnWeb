#include <Arduino.h>
#include "network/wifi_manager.h"
#include "web/webserver.h"
#include "core/mega_link.h"

void setup() {
    Serial.begin(115200);
    delay(200);

    Serial.println("===== ESP32-S3 Eisenbahn-Projekt gestartet =====");

    wifi_init();
    web_init();
    mega_init();   // <-- richtig
}

void loop() {
    wifi_loop();
    web_loop();
    mega_loop();   // <-- richtig
}
