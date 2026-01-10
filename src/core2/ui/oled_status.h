#pragma once

#include <Arduino.h>

namespace Ui
{
  // Small I2C OLED status display (debug helper):
  //  - IP address
  //  - Mega1 online
  //  - Mega2 online
  //
  // Designed to be non-blocking. Call begin() once, then tick() periodically.
  class OledStatus
  {
  public:
    // I2C address is 7-bit.
    // Your module prints 0x78 on the PCB (8-bit) -> that corresponds to 0x3C (7-bit).
    static void begin(uint8_t i2cAddr7 = 0x3C);

    // Call from main loop (e.g. every iteration). Internally rate-limited.
    static void tick();

    static bool isReady();

  private:
    static void render(const String& ip, bool m1Online, bool m2Online);
  };
}
