#include "i2c_bus.h"
#include <Wire.h>

void I2CBus::begin(int sda, int scl, uint32_t freq)
{
    Wire.begin(sda, scl);
    Wire.setClock(freq);
}

bool I2CBus::read(uint8_t addr, void* data, uint16_t len)
{
    if (Wire.requestFrom(addr, (uint8_t)len) != len)
        return false;

    Wire.readBytes((uint8_t*)data, len);
    return true;
}

bool I2CBus::write(uint8_t addr, const void* data, uint16_t len)
{
    Wire.beginTransmission(addr);
    Wire.write((const uint8_t*)data, len);
    return (Wire.endTransmission() == 0);
}
