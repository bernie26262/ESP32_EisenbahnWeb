#include "mega2_link.h"

#include <Arduino.h>
#include <Wire.h>

#include "config/pins.h"

#include "core2/bus/i2c_bus.h"
#include "core2/mega/mega2_client.h"
#include "network/eth_manager.h"


// ------------------------------------------------------------
// Konfiguration
// ------------------------------------------------------------
static constexpr uint32_t I2C_BOOT_DELAY_MS  = 500;
static constexpr uint32_t MEGA2_POLL_MS      = 200;
static constexpr uint32_t MEGA2_RECONNECT_MS = 5000;

// ------------------------------------------------------------
// Zustand
// ------------------------------------------------------------
static bool     s_i2cStarted  = false;
static bool     s_mega2Online = false;
static uint32_t s_bootMs      = 0;
static uint32_t s_lastPollMs  = 0;
static uint32_t s_lastRetryMs = 0;
static bool     s_scanned     = false;

// ------------------------------------------------------------
// I2C-Scanner (Debug, bewusst drin)
// ------------------------------------------------------------
#if DEBUG_ENABLED
static void i2cScanOnce()
{
    Serial.println(F("[I2C] Scan start"));

    for (uint8_t addr = 1; addr < 127; addr++)
    {
        Wire.beginTransmission(addr);
        if (Wire.endTransmission() == 0)
        {
            Serial.printf("[I2C] Device @ 0x%02X\n", addr);
        }
    }

    Serial.println(F("[I2C] Scan done"));
}
#else
static void i2cScanOnce() {}
#endif


// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------
void Mega2Link::begin()
{
    s_bootMs = millis();
}

void Mega2Link::update()
{
    // ------------------------------
    // WICHTIG: Erst starten, wenn Ethernet läuft
    // ------------------------------
    if (!Net::EthManager::isConnected())
        return;

    uint32_t now = millis();

    // --------------------------------------------------
    // Verzögerter I2C-Start (Boot-sicher)
    // --------------------------------------------------
    if (!s_i2cStarted)
    {
        if (now - s_bootMs >= I2C_BOOT_DELAY_MS)
        {
            I2CBus::begin(PIN_I2C_SDA, PIN_I2C_SCL);
            Mega2Client::begin();
            s_i2cStarted = true;

            Serial.println(F("[I2C] Bus aktiviert"));
        }
        return;
    }

    // --------------------------------------------------
    // Einmaliger Scan nach Bus-Start
    // --------------------------------------------------
    if (!s_scanned)
    {
        i2cScanOnce();
        s_scanned = true;
    }

    // --------------------------------------------------
    // Reconnect / Polling
    // --------------------------------------------------
    if (s_mega2Online)
    {
        if (now - s_lastPollMs >= MEGA2_POLL_MS)
        {
            s_lastPollMs = now;

            if (!Mega2Client::pollStatus())
            {
                s_mega2Online = false;
                s_lastRetryMs = now;
                Serial.println(F("[I2C] Mega2 offline"));
            }
        }
    }
    else
    {
        if (now - s_lastRetryMs >= MEGA2_RECONNECT_MS)
        {
            s_lastRetryMs = now;
            Serial.println(F("[I2C] Reconnect Mega2..."));

            if (Mega2Client::pollStatus())
            {
                s_mega2Online = true;
                s_lastPollMs  = now;
                Serial.println(F("[I2C] Mega2 wieder online"));
            }
        }
    }
}

bool Mega2Link::isOnline()
{
    return s_mega2Online;
}

bool Mega2Link::safetyAck()
{
    if (!s_mega2Online)
    {
        Serial.println(F("Safety ACK ignored (Mega2 offline)"));
        return false;
    }

    bool ok = Mega2Client::safetyAck();
    Serial.println(ok ? F("Safety ACK OK") : F("Safety ACK FAIL"));
    return ok;
}
