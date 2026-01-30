#pragma once
#include <stdint.h>
#include <stddef.h> // offsetof

// =====================================================
// Mega1 Diagnosepaket (read-only, <= 32 Bytes, V1)
// CMD: 0xD1  (Master schreibt 1 Byte CMD, danach Read)
// =====================================================
//
// Bits: Weiche i (0..11)
//  - istGeradeBits:   1 = Rückmelder sagt "gerade"
//  - sollGeradeBits:  1 = letzter Sollzustand "gerade"
//  - slowSelectedBits: 1 = Slow/Reduktion (wie im Mega1 berechnet und gesendet)
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
    // WICHTIG: Reihenfolge muss 1:1 zum Mega1 passen (IST -> SOLL -> SLOW)
    uint16_t weicheSollGeradeBits;      // Bit i
    uint16_t weicheSlowSelectedBits;    // Bit i
    

    uint8_t  powerMask;      // Bit i (0..3)
    uint16_t uptime16;       // uptime/100ms (wrap ok)

    // -------------------------------------------------
    // Startup-Checklist / Weichen-Selbsttest (Mega1)
    // -------------------------------------------------
    // selftestFlags:
    //   bit0: running
    //   bit1: done (Selbsttest einmal durchgelaufen)
    //   bit2: hasFail (optional Quick-Flag; FailMask bleibt Source of Truth)
    uint8_t  selftestFlags;
    uint16_t selftestFailMask;    // Bit i: 1 = FAIL bei Weiche i (0..11)
    uint8_t  selftestCurrentIdx;  // 0..11 (nur Anzeige), 0xFF = none
};
#pragma pack(pop)

static_assert(sizeof(Mega1DiagV1) <= 32, "Mega1DiagV1 must fit into a single I2C frame (<=32B).");
static_assert(offsetof(Mega1DiagV1, weicheIstGeradeBits) + 2 == offsetof(Mega1DiagV1, weicheSollGeradeBits),
              "Mega1DiagV1 layout mismatch: SOLL must follow IST");
static_assert(offsetof(Mega1DiagV1, weicheSollGeradeBits) + 2 == offsetof(Mega1DiagV1, weicheSlowSelectedBits),
              "Mega1DiagV1 layout mismatch: SLOW must follow SOLL");
