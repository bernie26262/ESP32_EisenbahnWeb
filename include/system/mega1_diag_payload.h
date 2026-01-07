#pragma once
#include <stdint.h>

// =====================================================
// Mega1 Diagnosepaket (read-only, <= 32 Bytes, V1)
// CMD: 0xD1  (Master schreibt 1 Byte CMD, danach Read)
// =====================================================
//
// Bits: Weiche i (0..11)
//  - istGeradeBits:   1 = Rückmelder sagt "gerade"
//  - slowActiveBits:  1 = Reduktions-Relais aktiv (pinRed LOW)
//  - sollGeradeBits:  1 = letzter Sollzustand "gerade"
//
// powerMask Bits: Bahnhof i (0..3)
//  - 1 = Stromgleis AN (Signal grün), 0 = AUS (Signal rot)
//
// warnings: frei (bitfield), aktuell 0
//
#pragma pack(push, 1)
struct Mega1DiagV1
{
    uint8_t  version;        // = 1
    uint8_t  flags;          // bit0: valid
    uint8_t  seq;            // monotonic counter (wrap ok)
    uint8_t  mode;           // 0=MANUELL, 1=AUTOMATIK
    uint16_t warnings;       // bitfield (frei)

    uint16_t weicheIstGeradeBits;   // Bit i
    uint16_t weicheSlowActiveBits;  // Bit i
    uint16_t weicheSollGeradeBits;  // Bit i

    uint8_t  powerMask;      // Bit i (0..3)
    uint16_t uptime16;       // uptime/100ms (wrap ok)
};
#pragma pack(pop)

static_assert(sizeof(Mega1DiagV1) <= 32, "Mega1DiagV1 must fit into a single I2C frame (<=32B).");
