#include "i2c_bus.h"

#include <Arduino.h>
#include <Wire.h>

#if defined(ESP32)
  #include "freertos/FreeRTOS.h"
  #include "freertos/semphr.h"
  static SemaphoreHandle_t s_i2cMutex = nullptr;
#endif

static volatile bool s_lockedFlag = false;

static inline bool lockI2C(uint32_t timeoutMs)
{
#if defined(ESP32)
    if (!s_i2cMutex) return true; // mutex not created yet
    const bool ok = (xSemaphoreTake(s_i2cMutex, pdMS_TO_TICKS(timeoutMs)) == pdTRUE);
    if (ok) s_lockedFlag = true;
    return ok;
#else
    (void)timeoutMs;
    s_lockedFlag = true;
    return true;
#endif
}

static inline void unlockI2C_internal()
{
#if defined(ESP32)
    if (s_i2cMutex) xSemaphoreGive(s_i2cMutex);
#endif
    s_lockedFlag = false;
}

void I2CBus::begin(int sda, int scl, uint32_t freq)
{
#if defined(ESP32)
    if (!s_i2cMutex)
        s_i2cMutex = xSemaphoreCreateMutex();
#endif

    Wire.begin(sda, scl);
    Wire.setClock(freq);

#if defined(ESP32)
    Wire.setTimeOut(50); // ms
#endif
}

bool I2CBus::tryLock()
{
    return lockI2C(0);
}

void I2CBus::unlock()
{
    unlockI2C_internal();
}

bool I2CBus::isLocked()
{
    return s_lockedFlag;
}

I2CBus::Result I2CBus::readEx(uint8_t addr, void* data, uint16_t len)
{
    if (!data || len == 0) return Result::ERROR;
    if (!lockI2C(20)) return Result::BUSY;

    const uint8_t got = Wire.requestFrom((int)addr, (int)len);
    if (got != (uint8_t)len)
    {
        unlockI2C_internal();
        return Result::ERROR;
    }

    Wire.readBytes((uint8_t*)data, len);
    unlockI2C_internal();
    return Result::OK;
}

I2CBus::Result I2CBus::writeEx(uint8_t addr, const void* data, uint16_t len)
{
    if (!data || len == 0) return Result::ERROR;
    if (!lockI2C(20)) return Result::BUSY;

    Wire.beginTransmission(addr);
    Wire.write((const uint8_t*)data, len);
    const bool ok = (Wire.endTransmission() == 0);

    unlockI2C_internal();
    return ok ? Result::OK : Result::ERROR;
}

I2CBus::Result I2CBus::writeReadEx(uint8_t addr,
                                   const void* wdata, uint16_t wlen,
                                   void* rdata, uint16_t rlen,
                                   uint32_t delay_us)
{
    if ((wlen > 0 && !wdata) || (rlen > 0 && !rdata)) return Result::ERROR;
    if (!lockI2C(20)) return Result::BUSY;

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

    unlockI2C_internal();
    return ok ? Result::OK : Result::ERROR;
}

// Legacy bool API
bool I2CBus::read(uint8_t addr, void* data, uint16_t len)
{
    return (readEx(addr, data, len) == Result::OK);
}

bool I2CBus::write(uint8_t addr, const void* data, uint16_t len)
{
    return (writeEx(addr, data, len) == Result::OK);
}

bool I2CBus::writeRead(uint8_t addr,
                       const void* wdata, uint16_t wlen,
                       void* rdata, uint16_t rlen,
                       uint32_t delay_us)
{
    return (writeReadEx(addr, wdata, wlen, rdata, rlen, delay_us) == Result::OK);
}
