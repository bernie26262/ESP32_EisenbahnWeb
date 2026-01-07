#pragma once
#include <stdint.h>

namespace I2CBus
{
    void begin(int sda, int scl, uint32_t freq = 100000);

    // ------------------------------------------------------------
    // Lock / Bus-Exklusivität
    // ------------------------------------------------------------
    bool tryLock();          // returns false if bus is currently in use
    void unlock();
    bool isLocked();

    // Optional: Unterscheide "busy" von "echtem I2C-Fehler"
    enum class Result : uint8_t
    {
        OK = 0,
        BUSY,
        ERROR
    };

    // Bestehende API (bool) bleibt – BUSY zählt hier als "false"
    bool read(uint8_t addr, void* data, uint16_t len);
    bool write(uint8_t addr, const void* data, uint16_t len);

    // Atomare Kombination (Lock wird über beide Phasen gehalten)
    bool writeRead(uint8_t addr,
                   const void* wdata, uint16_t wlen,
                   void* rdata, uint16_t rlen,
                   uint32_t delay_us = 0);

    // Neue API (liefert BUSY/ERROR getrennt)
    Result readEx(uint8_t addr, void* data, uint16_t len);
    Result writeEx(uint8_t addr, const void* data, uint16_t len);
    Result writeReadEx(uint8_t addr,
                       const void* wdata, uint16_t wlen,
                       void* rdata, uint16_t rlen,
                       uint32_t delay_us = 0);
}
