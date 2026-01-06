#include "i2c_bus.h"

#include <Arduino.h>
#include <Wire.h>

#if defined(ESP32)
  #include "freertos/FreeRTOS.h"
  #include "freertos/semphr.h"
  static SemaphoreHandle_t s_i2cMutex = nullptr;
#endif

static inline bool lockI2C(uint32_t timeoutMs = 20)
{
#if defined(ESP32)
    if (!s_i2cMutex) return true; // mutex not created yet
    return (xSemaphoreTake(s_i2cMutex, pdMS_TO_TICKS(timeoutMs)) == pdTRUE);
#else
    (void)timeoutMs;
    return true;
#endif
}

static inline void unlockI2C()
{
#if defined(ESP32)
    if (s_i2cMutex) xSemaphoreGive(s_i2cMutex);
#endif
}

void I2CBus::begin(int sda, int scl, uint32_t freq)
{
#if defined(ESP32)
    if (!s_i2cMutex)
        s_i2cMutex = xSemaphoreCreateMutex();
#endif

    // ESP32 Wire.begin(sda,scl) initialisiert den Bus und den internen Lock.
    Wire.begin(sda, scl);
    Wire.setClock(freq);

#if defined(ESP32)
    // Wire-Timeouts verhindern "hängen" bei Busfehlern
    Wire.setTimeOut(50); // ms
#endif
}

bool I2CBus::read(uint8_t addr, void* data, uint16_t len)
{
    if (!data || len == 0) return false;
    if (!lockI2C()) return false;

    const uint8_t got = Wire.requestFrom((int)addr, (int)len);
    if (got != (uint8_t)len)
    {
        unlockI2C();
        return false;
    }

    Wire.readBytes((uint8_t*)data, len);
    unlockI2C();
    return true;
}

bool I2CBus::write(uint8_t addr, const void* data, uint16_t len)
{
    if (!data || len == 0) return false;
    if (!lockI2C()) return false;

    Wire.beginTransmission(addr);
    Wire.write((const uint8_t*)data, len);
    const bool ok = (Wire.endTransmission() == 0);

    unlockI2C();
    return ok;
}

bool I2CBus::writeRead(uint8_t addr,
                       const void* wdata, uint16_t wlen,
                       void* rdata, uint16_t rlen,
                       uint32_t delay_us)
{
    if ((wlen > 0 && !wdata) || (rlen > 0 && !rdata)) return false;
    if (!lockI2C()) return false;

    bool ok = true;

    if (wlen > 0)
    {
        Wire.beginTransmission(addr);
        Wire.write((const uint8_t*)wdata, wlen);
        ok = (Wire.endTransmission() == 0);
    }

    if (ok && delay_us > 0)
        delayMicroseconds(delay_us);

    if (ok && rlen > 0)
    {
        const uint8_t got = Wire.requestFrom((int)addr, (int)rlen);
        if (got != (uint8_t)rlen)
            ok = false;
        else
            Wire.readBytes((uint8_t*)rdata, rlen);
    }

    unlockI2C();
    return ok;
}
