#include <Arduino.h>

#include "config/pins.h"

#include "network/net_config.h"
#include "network/eth_manager.h"
#include "web/webserver.h"

#include "core2/mega/mega2_link.h"
#include "core2/mega/mega1_link.h"
#include "core2/bus/i2c_bus.h"
#include "core2/ui/oled_status.h"

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

    // I2C Master initialisieren (WICHTIG: sonst Wire-NULL-TX / lock-errors)
    I2CBus::begin(PIN_I2C_SDA, PIN_I2C_SCL, 100000);
    Ui::OledStatus::begin(0x3C); // 0x78 (8-bit) => 0x3C (7-bit)

    Mega2Link::begin();

    Mega1Link::begin();
    Serial.println(F("[ESP] Setup abgeschlossen"));
}

// ============================================================================
// LOOP
// ============================================================================
void loop()
{
    Web::loop();
    Mega2Link::update();

    Mega1Link::update();
    if (Serial.available())
    {
        char c = Serial.read();
        if (c == 'a')
        {
            Mega2Link::safetyAck();
        }
    }
    Ui::OledStatus::tick();
}