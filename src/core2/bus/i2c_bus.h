#pragma once
#include <stdint.h>

namespace I2CBus
{
    void begin(int sda, int scl, uint32_t freq = 100000);

    bool read(uint8_t addr, void* data, uint16_t len);
    bool write(uint8_t addr, const void* data, uint16_t len);
}
