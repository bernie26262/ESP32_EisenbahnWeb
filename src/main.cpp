#include <Arduino.h>
#include <Wire.h>

#include "config/pins.h"

#include "network/net_config.h"
#include "network/eth_manager.h"
#include "web/webserver.h"
#include "hmi/hmi_uart.h"
#include "hmi/hmi_state.h"
#include "hmi/hmi_push.h"
#include "core2/state/system_runtime_state.h"

#include "core2/mega/mega2_link.h"
#include "core2/mega/mega1_link.h"
#include "core2/bus/i2c_bus.h"
#include "core2/ui/oled_status.h"

#include <WiFi.h>
#include <esp_wifi.h>
#include <esp_bt.h>
#include <ArduinoJson.h>

#include "debug.h"

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

static void handleHmiActionLine(const String& line)
{
    if (line.length() == 0) return;

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, line);
    if (err) {
        EE_LOGI("HMI", "RX parse error");
        return;
    }

    const char* type   = doc["type"]   | "";
    const char* action = doc["action"] | "";

    if (strcmp(type, "action") != 0 || action[0] == '\0') {
        return;
    }

    EE_LOGI("HMI", "action=%s", action);

    if (!strcmp(action, "safetyAck")) {
        Mega2Link::safetyAck();
        markStateDirtyAll();
        return;
    }

    if (!strcmp(action, "powerOff")) {
        Mega2Link::powerOff();
        markStateDirtyAll();
        return;
    }

    if (!strcmp(action, "powerOn")) {
        Mega2Link::powerOn();
        markStateDirtyAll();
        return;
    }

    if (!strcmp(action, "m1SetMode") || !strcmp(action, "setAuto") || !strcmp(action, "setManual")) {
        int mode = -1;

        if (!strcmp(action, "setAuto")) {
            mode = 1;
        } else if (!strcmp(action, "setManual")) {
            mode = 0;
        } else {
            mode = doc["mode"] | -1;
        }

        if (mode == 0 || mode == 1) {
            Mega1Link::queueSetMode((uint8_t)mode);
            markStateDirtyAll();
        }
        return;
    }

    if (!strcmp(action, "m1SelftestStart")) {
        Mega1Link::queueStartSelftest();
        markStateDirtyAll();
        return;
    }

    if (!strcmp(action, "sbhfSelftestStartup")) {
        Mega2Link::sbhfSelftestStartup();
        markStateDirtyAll();
        return;
    }

    if (!strcmp(action, "markMega1ChecklistDone")) {
        SystemRuntimeState::markMega1ChecklistDone();
        markStateDirtyAll();
        return;
    }

    if (!strcmp(action, "markMega2ChecklistDone")) {
        SystemRuntimeState::markMega2ChecklistDone();
        markStateDirtyAll();
        return;
    }
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

    String hmiLine;
    while (HMI::readLine(hmiLine))
    {
        handleHmiActionLine(hmiLine);
    }

    HmiPush::loop();

    Ui::OledStatus::tick();
}