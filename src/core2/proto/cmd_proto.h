#pragma once
#include <stdint.h>
#include "system/status_system.h"

// =====================================================
// Command Protocol (ESP <-> Mega)
// =====================================================

static constexpr uint8_t CMD_PROTO_VERSION = 1;

// Zielknoten


// Command-IDs
enum CmdId : uint16_t {
    // Mega2 Safety
    CMD_M2_SAFETY_ACK    = 0x0201,
    CMD_M2_SAFETY_RESUME = 0x0202,
};

// Fehlercodes
enum CmdError : uint8_t {
    CMD_OK               = 0,
    CMD_ERR_UNKNOWN      = 1,
    CMD_ERR_INVALID      = 2,
    CMD_ERR_DENIED       = 3,
    CMD_ERR_SAFETY       = 4,
};

// Request (ESP -> Mega)
struct __attribute__((packed)) CmdRequest {
    uint8_t  version;     // CMD_PROTO_VERSION
    uint8_t  nodeId;      // CmdNode System NodeId (NODE_MEGA1, NODE_MEGA2)
    uint16_t seq;         // laufende Nummer
    uint16_t cmdId;       // CmdId
    uint16_t payloadLen;  // 0 für Safety ACK
};

// Response (Mega -> ESP)
struct __attribute__((packed)) CmdResponse {
    uint8_t  version;
    uint8_t  nodeId;
    uint16_t seq;
    uint16_t cmdId;
    uint8_t  ok;          // 1 = OK, 0 = FAIL
    uint8_t  err;         // CmdError
};
