#pragma once
#include <Arduino.h>

// ============================================================================
// Payload-Versionierung
// ============================================================================
static constexpr uint8_t MEGA_PAYLOAD_VERSION = 1;

// ============================================================================
// Gemeinsame Konstanten
// ============================================================================
static const uint8_t MEGA_FRAME_HEADER  = 0xA5;
static const uint8_t MEGA_FRAME_VERSION = 0x01;
static const uint8_t MEGA_FRAME_LENGTH  = 40;   // <--- NEU

// ============================================================================
// Nachrichtentypen
// ============================================================================
enum class MegaMsgType : uint8_t {
    STATUS = 0,
    // später: DELTA = 1, CMD = 2, ...
};

// ============================================================================
// Mega IDs
// ============================================================================
enum class MegaId : uint8_t {
    MEGA1 = 1,
    MEGA2 = 2
};

// ============================================================================
// Bitfelder für Error / Warning / State
// ============================================================================
enum MegaErrorFlags : uint8_t {
    MEGA_ERR_NONE        = 0,
    MEGA_ERR_OVERCURRENT = 1 << 0,
    MEGA_ERR_I2C         = 1 << 1,
    MEGA_ERR_SENSOR      = 1 << 2,
    MEGA_ERR_INTERNAL    = 1 << 3,
};

enum MegaWarnFlags : uint8_t {
    MEGA_WARN_NONE       = 0,
    MEGA_WARN_NEAR_LIMIT = 1 << 0,
};

enum MegaStateFlags : uint8_t {
    MEGA_STATE_NONE        = 0,
    MEGA_STATE_SIMULATION  = 1 << 0,
    MEGA_STATE_LOCAL_EMER  = 1 << 1,
};

// ============================================================================
// Parserstruktur für ESP-Seite
// ============================================================================
struct MegaStatusFrame
{
    uint8_t  header;       // 0xA5
    uint8_t  version;      // 0x01
    MegaMsgType msgType;   // STATUS
    uint8_t  length;       // 40

    MegaId   megaId;       // 1 oder 2
    uint8_t  heartbeat;

    uint8_t  errorFlags;
    uint8_t  warnFlags;
    uint8_t  stateFlags;
    uint8_t  drState;

    uint16_t sensorBits;
    uint16_t weichenIst;
    uint16_t weichenSoll;

    uint16_t analog1;
    uint16_t analog2;

    uint8_t  reservedOld[4];     // Bytes 20–23 (Bestandsschutz)

    uint8_t  lightData[8];       // Bytes 24–31 (Lichtsteuerung später)
    uint8_t  moduleState[4];     // Bytes 32–35 (erweiterte Module)
    uint8_t  userData[3];        // Bytes 36–38 (freie Felder)

    uint8_t  checksum;           // Byte 39
};

// ============================================================================
// Prüfsumme
// ============================================================================
inline uint8_t mega_calcChecksum(const uint8_t* data, size_t lenWithoutChecksum)
{
    uint16_t sum = 0;
    for (size_t i = 0; i < lenWithoutChecksum; ++i)
        sum += data[i];

    return static_cast<uint8_t>(sum & 0xFF);
}
