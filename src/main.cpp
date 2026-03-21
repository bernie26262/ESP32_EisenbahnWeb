#include <Arduino.h>
#include <Wire.h>

#include "config/pins.h"

#include "network/net_config.h"
#include "network/eth_manager.h"
#include "web/webserver.h"
#include "hmi/hmi_uart.h"
#include "hmi/hmi_state.h"

#include "core2/mega/mega2_link.h"
#include "core2/mega/mega1_link.h"
#include "core2/bus/i2c_bus.h"
#include "core2/ui/oled_status.h"

#include <WiFi.h>
#include <esp_wifi.h>
#include <esp_bt.h>

#include "debug.h"

static uint32_t s_lastHmiSend = 0;

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
    EE_LOGI("HW", "WiFi/BT hard-off (disableWirelessHard ran)");

    
    EE_LOGI("BOOT", "===== ESP32-S3 Eisenbahn (core2) =====");

    Net::EthManager::begin();
    Web::begin();

    // I2C Master initialisieren (WICHTIG: sonst Wire-NULL-TX / lock-errors)
    I2CBus::begin(PIN_I2C_SDA, PIN_I2C_SCL, 100000);

    //pinMode(PIN_I2C_SDA, INPUT_PULLUP); // sind beide über einen 4k7-Widerstand auf dem I2C-Board verbunden
    //pinMode(PIN_I2C_SCL, INPUT_PULLUP);

    delay(2);

#if EE_DEBUG_I2C
    LOG_I2C("[I2C] SDA=%d SCL=%d (after begin)",
            digitalRead(PIN_I2C_SDA), digitalRead(PIN_I2C_SCL));
    LOG_I2C("[I2C] scan...");
    int found = 0;
    for (uint8_t a = 1; a < 127; a++) {
        Wire.beginTransmission(a);
        uint8_t err = Wire.endTransmission();
        if (err == 0) {
            LOG_I2C("  - addr 0x%02X", a);
            found++;
        }
    }
    LOG_I2C("[I2C] scan done, found=%d", found);
#endif


    Ui::OledStatus::begin(0x3C); // 0x78 (8-bit) => 0x3C (7-bit)

#if EE_DEBUG_I2C
    LOG_I2C("[I2C] SDA=%d SCL=%d (before links)", digitalRead(PIN_I2C_SDA), digitalRead(PIN_I2C_SCL));
#endif
    
    
    Mega2Link::begin();

    Mega1Link::begin();
    EE_LOGI("BOOT", "Setup abgeschlossen");

    HMI::begin();
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

    // ----------------------------------------------------
    // HMI UART
    // ----------------------------------------------------
    HMI::loop();

    const uint32_t now = millis();
    if (now - s_lastHmiSend > 500)
    {
        String s = buildHmiStateJson();
        HMI::sendJson(s);
        s_lastHmiSend = now;
    }

    Ui::OledStatus::tick();
}