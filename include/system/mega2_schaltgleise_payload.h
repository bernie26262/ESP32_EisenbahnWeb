#pragma once
#include <stdint.h>
#include <stddef.h> // offsetof

// =====================================================
// Mega2 Schaltgleise S11..S16 (Diag, read-only) – V1
// Purpose: expose LEVEL + separate rising/falling counters for pulse sensors.
//
// Transport: I2C CMD 0xD3 (proposal)
// Master writes: [CMD], then reads one frame (<=32B).
//
// Mapping:
//   idx 0..5 => S11..S16
//
// Semantics:
//   - levelBits bit=1 means LEVEL=HIGH on the Arduino pin.
//   - Many sensors are INPUT_PULLUP => active LOW (HIGH->LOW is activation).
//   - Counters are uint16_t (wrap ok).
// =====================================================

#pragma pack(push, 1)
struct Mega2SchaltgleiseDiagV1
{
    uint8_t  version;     // = 1
    uint8_t  seq;         // monotonic counter (wrap ok)
    uint8_t  levelBits;   // bit0..5 = S11..S16
    uint8_t  reserved;    // padding
    uint16_t riseCount[6];
    uint16_t fallCount[6];
};
#pragma pack(pop)

static_assert(sizeof(Mega2SchaltgleiseDiagV1) <= 32, "Mega2SchaltgleiseDiagV1 must fit into a single I2C frame (<=32B).");