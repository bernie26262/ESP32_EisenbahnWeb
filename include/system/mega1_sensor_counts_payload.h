#pragma once
#include <stdint.h>
#include <stddef.h> // offsetof

// =====================================================
// Mega1 Sensor-Counters (Diag, read-only) – V1
// Purpose: expose digital sensors with separate rising/falling counters.
// Transport: I2C CMD 0xD2 (proposal)
// Master writes: [CMD, pageIndex], then reads one frame (<=32B).
//
// We transmit only the *used* sensors of Mega1 in two pages:
//   Page 0: 8 sensors
//   Page 1: 7 sensors
//
// The mapping (index->S-id) is fixed and must match Mega1 firmware + ESP UI:
//
//   idx:  0  1  2  3  4  5  6  7   8   9  10  11  12  13  14
//   S :  S0 S1 S2 S3 S4 S5 S6 S7  S8  S9 S10 S18 S19 S22 S23
//
// Semantics (electrical):
//   - activeBits bit=1 means LEVEL=HIGH on the Arduino pin.
//   - With INPUT_PULLUP wiring, many sensors are "active LOW":
//       HIGH->LOW  => activation (falling edge)
//       LOW->HIGH  => deactivation (rising edge)
//   The UI can present this as "aktiviert/deaktiviert" if desired.
//
// Counters are uint8_t and may wrap (0..255).
// =====================================================

#pragma pack(push, 1)
struct Mega1SensorCountsPageV1
{
    uint8_t  version;     // = 1
    uint8_t  page;        // 0 or 1
    uint8_t  seq;         // monotonic counter (wrap ok) – same for both pages if possible
    uint8_t  activeBits;  // bits for sensors in this page (bit0..N-1)
    // followed by rise/fall counters for each sensor in this page
    uint8_t  riseCount[8]; // for page1 only first 7 used; remaining bytes = 0
    uint8_t  fallCount[8]; // for page1 only first 7 used; remaining bytes = 0
};
#pragma pack(pop)

static_assert(sizeof(Mega1SensorCountsPageV1) <= 32, "Mega1SensorCountsPageV1 must fit into a single I2C frame (<=32B).");
static_assert(offsetof(Mega1SensorCountsPageV1, riseCount) == 4, "layout mismatch");