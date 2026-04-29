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

#if EE_DEBUG_REACT
static uint32_t g_reactLastLoopStartMs = 0;
static uint32_t g_reactLastSummaryMs = 0;
static uint32_t g_reactLoopCount = 0;
static uint32_t g_reactLoopMaxMs = 0;

static inline void reactLoopBegin()
{
    g_reactLastLoopStartMs = (uint32_t)millis();
}

static inline void reactLoopEnd()
{
    const uint32_t now = (uint32_t)millis();
    const uint32_t dt = (uint32_t)(now - g_reactLastLoopStartMs);
    ++g_reactLoopCount;
    if (dt > g_reactLoopMaxMs) g_reactLoopMaxMs = dt;

    if (dt >= 50) {
        LOG_REACT("loop slow dt=%lu heap=%lu",
                  (unsigned long)dt,
                  (unsigned long)ESP.getFreeHeap());
    }

    if ((uint32_t)(now - g_reactLastSummaryMs) >= 5000) {
        LOG_REACT("loop summary count=%lu maxDt=%lu heap=%lu minHeap=%lu",
                  (unsigned long)g_reactLoopCount,
                  (unsigned long)g_reactLoopMaxMs,
                  (unsigned long)ESP.getFreeHeap(),
                  (unsigned long)ESP.getMinFreeHeap());
        g_reactLastSummaryMs = now;
        g_reactLoopCount = 0;
        g_reactLoopMaxMs = 0;
    }
}
#else
static inline void reactLoopBegin() {}
static inline void reactLoopEnd() {}
#endif

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
#if EE_DEBUG_REACT
    const uint32_t reactSetupStartMs = (uint32_t)millis();
#endif
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
#if EE_DEBUG_REACT
    LOG_REACT("setup done dt=%lu heap=%lu minHeap=%lu",
              (unsigned long)((uint32_t)millis() - reactSetupStartMs),
              (unsigned long)ESP.getFreeHeap(),
              (unsigned long)ESP.getMinFreeHeap());
#endif
}

static constexpr uint32_t HMI_CMD_FORCEFULL_DELAY_MS = 100;
static constexpr uint32_t HMI_CMD_STATELITE_SUPPRESS_MS = 200;
static constexpr uint32_t HMI_CMD_ANALOG_SUPPRESS_MS = 200;
static constexpr uint32_t HMI_TURNOUT_FORCEFULL_DELAY_MS = 50;
static constexpr uint32_t HMI_TURNOUT_SUPPRESS_MS = 220;

static inline void markStateDirtyAllAndForceHmi()
{
    markStateDirtyAll();
    HmiPush::forceFull();
}

static inline void markStateDirtyAllAndForceHmiDelayed()
{
    HMI::resetTxAfterLocalCommand(HMI_CMD_STATELITE_SUPPRESS_MS, "hmi-cmd");
    markStateDirtyAll();
    HmiPush::suppressStateLiteUntil(HMI_CMD_STATELITE_SUPPRESS_MS);
    HmiPush::forceFullDelayed(HMI_CMD_FORCEFULL_DELAY_MS);
}

static inline void markTurnoutDirtyAllAndForceHmiDelayed()
{
    HMI::resetTxAfterLocalCommand(HMI_TURNOUT_SUPPRESS_MS, "hmi-turnout");
    markStateDirtyAll();
    HmiPush::suppressStateLiteUntil(HMI_TURNOUT_SUPPRESS_MS);
    HmiPush::suppressAnalogUntil(HMI_TURNOUT_SUPPRESS_MS);
    HmiPush::forceFullDelayed(HMI_TURNOUT_FORCEFULL_DELAY_MS);
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

    if (strcmp(type, "ack") == 0)
    {
        const uint32_t seq = doc["seq"] | 0;
        if (seq != 0)
        {
            HMI::noteAck(seq);
        }
        return;
    }

    if (strcmp(type, "action") != 0 || action[0] == '\0') {
        return;
    }

    EE_LOGI("HMI", "action=%s", action);

    if (!strcmp(action, "safetyAck")) {
        Mega2Link::safetyAck();
        markStateDirtyAllAndForceHmiDelayed();
        return;
    }

    if (!strcmp(action, "powerOff")) {
        Mega2Link::powerOff();
        markStateDirtyAllAndForceHmiDelayed();
        return;
    }

    if (!strcmp(action, "powerOn")) {
        Mega2Link::powerOn();
        markStateDirtyAllAndForceHmiDelayed();
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
            markStateDirtyAllAndForceHmiDelayed();
        }
        return;
    }

    if (!strcmp(action, "m1SelftestStart")) {
        Mega1Link::queueStartSelftest();
        markStateDirtyAllAndForceHmiDelayed();
        return;
    }

    if (!strcmp(action, "m1WeicheSet") || !strcmp(action, "m1TurnoutSet")) {
        const int idx_i = doc["idx"] | -1;
        if (idx_i < 0 || idx_i > 11) {
            EE_LOGI("HMI", "m1WeicheSet reject: idx=%d out of range", idx_i);
            return;
        }
        const uint8_t idx = (uint8_t)idx_i;

        bool gerade = false;
        JsonVariant vGerade = doc["gerade"];
        if (vGerade.is<bool>()) {
            gerade = vGerade.as<bool>();
        } else if (vGerade.is<int>()) {
            gerade = (vGerade.as<int>() != 0);
        } else if (vGerade.is<const char*>()) {
            const char* s = vGerade.as<const char*>();
            if (s) gerade = (!strcasecmp(s, "true") || !strcasecmp(s, "on") || !strcmp(s, "1"));
        }

        const bool ok = Mega1Link::queueTurnoutSet(idx, gerade);
        EE_LOGI("HMI", "m1WeicheSet idx=%u gerade=%s ok=%d",
            (unsigned)idx,
            gerade ? "true" : "false",
            ok ? 1 : 0);

        markTurnoutDirtyAllAndForceHmiDelayed();
        return;
    }

    if (!strcmp(action, "m1PowerSet")) {
        const int bhf_i = doc["bhf"] | -1;
        if (bhf_i < 0 || bhf_i > 3) {
            EE_LOGI("HMI", "m1PowerSet reject: bhf=%d out of range", bhf_i);
            return;
        }
        const uint8_t bhf = (uint8_t)bhf_i;

        bool on = false;
        JsonVariant vOn = doc["on"];
        if (vOn.is<bool>()) {
            on = vOn.as<bool>();
        } else if (vOn.is<int>()) {
            on = (vOn.as<int>() != 0);
        } else if (vOn.is<const char*>()) {
            const char* s = vOn.as<const char*>();
            if (s) on = (!strcasecmp(s, "true") || !strcasecmp(s, "on") || !strcmp(s, "1"));
        }

        const bool ok = Mega1Link::queueBhfPowerSet(bhf, on);
        EE_LOGI("HMI", "m1PowerSet bhf=%u on=%s ok=%d",
            (unsigned)bhf,
            on ? "true" : "false",
            ok ? 1 : 0);

        markStateDirtyAllAndForceHmiDelayed();
        return;
    }

    if (!strcmp(action, "sbhfSelftestRetry")) {
        Mega2Link::sbhfSelftestRetry();
        markStateDirtyAllAndForceHmiDelayed();
        return;
    }

    if (!strcmp(action, "sbhfSelftestStartup")) {
        Mega2Link::sbhfSelftestStartup();
        markStateDirtyAllAndForceHmiDelayed();
        return;
    }

    if (!strcmp(action, "markMega1ChecklistDone")) {
        SystemRuntimeState::markMega1ChecklistDone();
        markStateDirtyAllAndForceHmiDelayed();
        return;
    }

    if (!strcmp(action, "markMega2ChecklistDone")) {
        SystemRuntimeState::markMega2ChecklistDone();
        markStateDirtyAllAndForceHmiDelayed();
        return;
    }
}

// ============================================================================
// LOOP
// ============================================================================
void loop()
{
    reactLoopBegin();

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
    HmiPush::loopAnalog();

    Ui::OledStatus::tick();

    reactLoopEnd();
}