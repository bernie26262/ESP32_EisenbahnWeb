#pragma once
#include <stdint.h>

namespace I2CBus
{
    void begin(int sda, int scl, uint32_t freq = 100000);

    bool read(uint8_t addr, void* data, uint16_t len);
    bool write(uint8_t addr, const void* data, uint16_t len);

    // Atomare Kombination (Lock wird über beide Phasen gehalten)
    bool writeRead(uint8_t addr,
                   const void* wdata, uint16_t wlen,
                   void* rdata, uint16_t rlen,
                   uint32_t delay_us = 0);
}
