#include "oled_status.h"

#include <Wire.h>

// Adafruit libs
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>

#include "network/eth_manager.h"
#include "core2/state/system_runtime_state.h"
#include "core2/mega/mega2_link.h"

// Pins are fixed in your project
#ifndef PIN_I2C_SDA
  #define PIN_I2C_SDA 41
#endif
#ifndef PIN_I2C_SCL
  #define PIN_I2C_SCL 42
#endif

namespace Ui
{
  static constexpr int OLED_W = 128;
  static constexpr int OLED_H = 64;

  static uint8_t  s_addr7    = 0x3C;
  static bool     s_ok       = false;
  static uint32_t s_lastMs   = 0;

  // Keep last rendered values to reduce redraws
  static String s_lastIp;
  static bool   s_lastM1 = false;
  static bool   s_lastM2 = false;

  // Reset pin = -1 (none) for I2C modules
  static Adafruit_SH1106G s_disp(OLED_W, OLED_H, &Wire, -1);

  void OledStatus::begin(uint8_t i2cAddr7)
  {
    s_addr7 = i2cAddr7;

    // I2C bus is initialized by core2/bus/i2c_bus (shared bus with Mega1/Mega2).
    // Do not change Wire clock here.

    s_ok = s_disp.begin(s_addr7, true);
    if (!s_ok)
    {
      // If this fails, your address might be 0x3D.
      // (PCB 0x7A 8-bit -> 0x3D 7-bit)
      return;
    }

    s_disp.clearDisplay();
    s_disp.setTextSize(1);
    s_disp.setTextColor(SH110X_WHITE); // <-- Fix
    s_disp.setCursor(0, 0);
    s_disp.println(F("ESP32 Eisenbahn"));
    s_disp.println(F("OLED ready"));
    s_disp.display();

    // Force first real render on next tick
    s_lastIp = "";
    s_lastM1 = false;
    s_lastM2 = false;
    s_lastMs = 0;
  }

  bool OledStatus::isReady()
  {
    return s_ok;
  }

  void OledStatus::tick()
  {
    if (!s_ok)
      return;

    const uint32_t now = millis();
    if (now - s_lastMs < 500)
      return;
    s_lastMs = now;

    const bool ethUp = Net::EthManager::isConnected();
    const String ip = ethUp ? Net::EthManager::localIP().toString() : String("-");

    // Online flags from the same sources as the WebUI
    const bool m1 = SystemRuntimeState::mega1Online();
    const bool m2 = Mega2Link::mega2Online();

    // Only redraw when something changed (avoids flicker and I2C load)
    if (ip == s_lastIp && m1 == s_lastM1 && m2 == s_lastM2)
      return;

    s_lastIp = ip;
    s_lastM1 = m1;
    s_lastM2 = m2;

    render(ip, m1, m2);
  }

  void OledStatus::render(const String& ip, bool m1Online, bool m2Online)
  {
    s_disp.clearDisplay();
    s_disp.setCursor(0, 0);

    s_disp.println(F("ESP32 Eisenbahn"));
    s_disp.println();

    s_disp.print(F("IP: "));
    s_disp.println(ip);

    s_disp.print(F("Mega1: "));
    s_disp.println(m1Online ? F("ONLINE") : F("offline"));

    s_disp.print(F("Mega2: "));
    s_disp.println(m2Online ? F("ONLINE") : F("offline"));

    s_disp.display();
  }
}
