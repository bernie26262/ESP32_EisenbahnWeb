#include <Arduino.h>

#include "hal/gpio.h"
#include "network/wifi_manager.h"
#include "web/webserver.h"
#include "core/mega_link.h"   // <-- Wichtig!

void setup() {
    Serial.begin(115200);
    delay(100);

    hal_init();
    mega_init();      // <-- richtig
    wifi_init();
    web_init();
}

void loop() {
    mega_loop();      // <-- richtig
    wifi_loop();
    web_loop();
}
