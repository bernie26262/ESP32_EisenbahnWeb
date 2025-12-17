#include <Arduino.h>

#include "config/pins.h"

#include "network/net_config.h"
#include "network/eth_manager.h"
#include "web/webserver.h"

#include "core2/mega/mega2_link.h"

// ============================================================================
// SETUP
// ============================================================================
void setup()
{
    Serial.begin(115200);
    delay(200);

    Serial.println();
    Serial.println(F("===== ESP32-S3 Eisenbahn (core2) ====="));

    Net::EthManager::begin();
    Web::begin();

    Mega2Link::begin();

    Serial.println(F("[ESP] Setup abgeschlossen"));
}

// ============================================================================
// LOOP
// ============================================================================
void loop()
{
    Web::pushStateIfDirty();
    Web::loop();
    Mega2Link::update();

    if (Serial.available())
    {
        char c = Serial.read();
        if (c == 'a')
        {
            Mega2Link::safetyAck();
        }
    }
    
}
