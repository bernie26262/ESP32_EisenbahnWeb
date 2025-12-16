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
    Mega2Link::begin();   // darf bleiben, wartet intern auf ETH

    Serial.println(F("[ESP] Setup abgeschlossen"));
}


// ============================================================================
// LOOP
// ============================================================================
void loop()
{
    static bool webStarted = false;

    Net::EthManager::update();

    if (Net::EthManager::isConnected())
    {
        if (!webStarted)
        {
            Web::begin();
            webStarted = true;
        }

        Web::loop();
        Mega2Link::update();
    }

    

    if (Serial.available())
    {
        char c = Serial.read();
        if (c == 'a')
        {
            Mega2Link::safetyAck();
        }
    }
}
