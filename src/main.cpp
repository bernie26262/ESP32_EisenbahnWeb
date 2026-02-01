#include <Arduino.h>
#include <Wire.h>

#include "config/pins.h"

#include "network/net_config.h"
#include "network/eth_manager.h"
#include "web/webserver.h"

#include "core2/mega/mega2_link.h"
#include "core2/mega/mega1_link.h"
#include "core2/bus/i2c_bus.h"
#include "core2/ui/oled_status.h"

#include <WiFi.h>
#include <esp_wifi.h>
#include <esp_bt.h>

static void disableWirelessHard()
{
  WiFi.persistent(false);
  WiFi.disconnect(true, true);
  WiFi.mode(WIFI_OFF);

  // IDF: toleriert "already stopped/deinit" -> Fehlercodes ignorieren
  esp_wifi_stop();
  esp_wifi_deinit();

  // Bluetooth ebenfalls aus
  esp_bt_controller_disable();
  esp_bt_controller_deinit();
}

// ============================================================================
// SETUP
// ============================================================================
void setup()
{
    disableWirelessHard(); // <-- ganz am Anfang
    Serial.begin(115200);
    delay(200);

    // Bestätigung, dass WiFi/BT wirklich hart deaktiviert wurde (vor Netzwerk-Init)
    Serial.println(F("[HW] WiFi/BT hard-off (disableWirelessHard ran)"));

    Serial.println();
    Serial.println(F("===== ESP32-S3 Eisenbahn (core2) ====="));

    Net::EthManager::begin();
    Web::begin();

    // I2C Master initialisieren (WICHTIG: sonst Wire-NULL-TX / lock-errors)
    I2CBus::begin(PIN_I2C_SDA, PIN_I2C_SCL, 100000);

    //pinMode(PIN_I2C_SDA, INPUT_PULLUP); // sind beide über einen 4k7-Widerstand auf dem I2C-Board verbunden
    //pinMode(PIN_I2C_SCL, INPUT_PULLUP);

    delay(2);

    Serial.printf("[I2C] SDA=%d SCL=%d (after begin)\n", digitalRead(PIN_I2C_SDA), digitalRead(PIN_I2C_SCL));
    Serial.println("[I2C] scan...");
    int found = 0;
    for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    uint8_t err = Wire.endTransmission();
    if (err == 0) {
        Serial.printf("  - addr 0x%02X\n", a);
        found++;
    }
    }
    Serial.printf("[I2C] scan done, found=%d\n", found);



    Ui::OledStatus::begin(0x3C); // 0x78 (8-bit) => 0x3C (7-bit)


    Serial.printf("[I2C] SDA=%d SCL=%d (before links)\n", digitalRead(PIN_I2C_SDA), digitalRead(PIN_I2C_SCL));
    
    
    
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