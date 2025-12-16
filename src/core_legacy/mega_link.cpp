#include <Arduino.h>
#include <Wire.h>
#include <string.h>

#include "mega_link.h"
#include "i2c_packets.h"
#include "config/pins.h"
#include "web/webserver.h"
#include "event_log.h"
#include "mega_proto.h"
#include "proto_common.h"   // <-- Mega2 Safety-Commands
#include "system/status_system.h"

// =====================================================================
//   Slave-State Speicher
// =====================================================================
static SlaveState slaves[NUM_SLAVES];

// I2C-Adressen der Slaves
static const uint8_t I2C_ADDR[NUM_SLAVES] = {
    0x10, 0x11, 0x12, 0x13
};

// DataReady-Flags
static volatile bool dr_flag[NUM_SLAVES] = {false, false, false, false};

// Mega2 Status Rate-Limit
static uint32_t lastMega2StatusMs = 0;
static const uint32_t MEGA2_STATUS_INTERVAL_MS = 200;

// =====================================================================
//   DataReady ISRs
// =====================================================================
static void IRAM_ATTR dr_isr_0() { dr_flag[0] = true; }
static void IRAM_ATTR dr_isr_1() { dr_flag[1] = true; }
static void IRAM_ATTR dr_isr_2() { dr_flag[2] = true; }
static void IRAM_ATTR dr_isr_3() { dr_flag[3] = true; }

// =====================================================================
//   Mega2 SystemStatus (read-only, polling)
// =====================================================================

static SystemStatus s_m2System{};
static uint32_t s_m2SystemLastRx = 0;
static bool s_m2SystemOnline = false;

static const uint32_t MEGA2_SYSTEM_POLL_MS = 200; // 5 Hz
static uint32_t lastMega2SystemPoll = 0;


// =====================================================================
//   Payload-Version prüfen (nur Mega1 relevant)
// =====================================================================
static bool checkPayloadVersion(uint8_t sid, uint8_t version)
{
    if (version != MEGA_PAYLOAD_VERSION)
    {
        eventLogAdd(
            "Mega " + String(sid) +
            ": inkompatible Payload-Version " + String(version)
        );
        return false;
    }
    return true;
}

// =====================================================================
//   LOW-Level Requests
// =====================================================================

static bool requestFull(uint8_t sid)
{
    if (sid >= NUM_SLAVES) return false;
    const uint8_t addr = I2C_ADDR[sid];

    Wire.beginTransmission(addr);
    Wire.write(I2C_CMD_GET_FULL);
    if (Wire.endTransmission() != 0) return false;

    delayMicroseconds(1500);

    const uint8_t expectedSize = sizeof(I2C_FullPayload);
    if (Wire.requestFrom(addr, expectedSize) != expectedSize) return false;

    I2C_FullPayload pkt;
    Wire.readBytes((uint8_t*)&pkt, sizeof(pkt));

    if (pkt.pktType != I2C_PKT_FULL) return false;

    SlaveState &st = slaves[sid];
    st.valid        = true;
    st.timestamp    = pkt.timestamp;
    st.weichenBits  = pkt.weichenBits;
    st.bhfStromBits = pkt.bhfStromBits;
    st.mode         = pkt.mode;

    return true;
}

// =====================================================================
//   DELTA-Events
// =====================================================================
static bool requestDelta(uint8_t sid)
{
    if (sid >= NUM_SLAVES) return false;
    const uint8_t addr = I2C_ADDR[sid];

    Wire.beginTransmission(addr);
    Wire.write(I2C_CMD_GET_DELTA);
    if (Wire.endTransmission() != 0) return false;

    delayMicroseconds(1500);

    const uint8_t expectedSize = sizeof(I2C_DeltaPayload);
    if (Wire.requestFrom(addr, expectedSize) != expectedSize) return false;

    I2C_DeltaPayload pkt;
    Wire.readBytes((uint8_t*)&pkt, sizeof(pkt));

    if (pkt.pktType != I2C_PKT_DELTA) return false;

    for (uint8_t i = 0; i < pkt.count && i < I2C_MAX_DELTA_EVENTS; ++i)
    {
        const auto &ev = pkt.events[i];
        if (ev.type == EVT_WEICHE)
        {
            if (ev.value) slaves[sid].weichenBits |=  (1u << ev.id);
            else          slaves[sid].weichenBits &= ~(1u << ev.id);
        }
        else if (ev.type == EVT_BHF_STROM)
        {
            if (ev.value) slaves[sid].bhfStromBits |=  (1u << ev.id);
            else          slaves[sid].bhfStromBits &= ~(1u << ev.id);
        }
    }
    return true;
}

// =====================================================================
//   Mega2 Zusatzstatus
// =====================================================================
static bool requestMega2Status(uint8_t sid)
{
    if (sid >= NUM_SLAVES) return false;
    const uint8_t addr = I2C_ADDR[sid];

    Wire.beginTransmission(addr);
    Wire.write(I2C_CMD_GET_MEGA2_STATUS);
    if (Wire.endTransmission() != 0) return false;

    delayMicroseconds(1500);

    I2C_Header header;
    if (Wire.requestFrom(addr, sizeof(header)) != sizeof(header)) return false;
    Wire.readBytes((uint8_t*)&header, sizeof(header));

    if (header.packetType != I2C_PKT_MEGA2_STATUS) return false;

    I2C_Mega2Status payload;
    if (Wire.requestFrom(addr, header.payloadLen) != header.payloadLen) return false;
    Wire.readBytes((uint8_t*)&payload, sizeof(payload));

    SlaveState &st = slaves[sid];
    st.nothalt = payload.nothalt;
    st.sbhfMode = payload.sbhfMode;
    st.sbhfState = payload.sbhfState;

    return true;
}

// =====================================================================
//   Mega2 SystemStatus – polling (unabhängig von DataReady)
// =====================================================================
static void pollMega2SystemStatus(uint32_t now)
{
    if (now - lastMega2SystemPoll < MEGA2_SYSTEM_POLL_MS)
        return;

    lastMega2SystemPoll = now;

    const uint8_t addr = I2C_ADDR[MEGA2_SID];

    if (Wire.requestFrom(addr, (uint8_t)sizeof(SystemStatus)) != sizeof(SystemStatus))
    {
        s_m2SystemOnline = false;
        return;
    }

    Wire.readBytes((uint8_t*)&s_m2System, sizeof(SystemStatus));

    if (s_m2System.version != SYSTEM_STATUS_VERSION ||
        s_m2System.nodeId  != NODE_MEGA2)
    {
        s_m2SystemOnline = false;
        return;
    }

    s_m2SystemLastRx = now;
    s_m2SystemOnline = true;
}

// =====================================================================
//   PUBLIC API
// =====================================================================

void mega_link_begin()
{
    Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, 400000);
    memset(slaves, 0, sizeof(slaves));

    pinMode(PIN_DATAREADY_1, INPUT_PULLUP);
    pinMode(PIN_DATAREADY_2, INPUT_PULLUP);
    pinMode(PIN_DATAREADY_3, INPUT_PULLUP);
    pinMode(PIN_DATAREADY_4, INPUT_PULLUP);

    attachInterrupt(PIN_DATAREADY_1, dr_isr_0, RISING);
    attachInterrupt(PIN_DATAREADY_2, dr_isr_1, RISING);
    attachInterrupt(PIN_DATAREADY_3, dr_isr_2, RISING);
    attachInterrupt(PIN_DATAREADY_4, dr_isr_3, RISING);
}

void mega_update()
{
    uint32_t now = millis();

    // --------------------------------------------------
    // NEU: Mega2 SystemStatus – immer pollen
    // --------------------------------------------------
    pollMega2SystemStatus(now);

    // --------------------------------------------------
    // BESTEHEND: Delta / Event Logik (unverändert)
    // --------------------------------------------------
    for (uint8_t sid = 0; sid < NUM_SLAVES; sid++)
    {
        if (!dr_flag[sid]) continue;
        dr_flag[sid] = false;

        requestDelta(sid);

        if (sid == MEGA2_SID)
        {
            if (now - lastMega2StatusMs >= MEGA2_STATUS_INTERVAL_MS)
            {
                requestMega2Status(sid);
                lastMega2StatusMs = now;
            }
        }
    }
}


const SlaveState &mega_getState(uint8_t sid)
{
    static SlaveState dummy;
    if (sid >= NUM_SLAVES) return dummy;
    return slaves[sid];
}

// =====================================================================
//   MEGA2 – Safety Commands (Phase 1)
// =====================================================================

static bool mega2_send(const uint8_t* data, size_t len)
{
    const uint8_t addr = I2C_ADDR[MEGA2_SID];
    Wire.beginTransmission(addr);
    Wire.write(data, len);
    return Wire.endTransmission() == 0;
}

bool mega2_cmd_setNotaus(bool enable)
{
    uint8_t buf[2] = { M2_CMD_SET_NOTAUS, uint8_t(enable) };
    bool ok = mega2_send(buf, sizeof(buf));
    eventLogAdd(ok ? "Mega2: Not-Aus gesetzt/freigegeben"
                   : "Mega2: Not-Aus Kommando FEHLER");
    return ok;
}

bool mega2_cmd_setSafetySSR(SafetySSR ssr, bool enable)
{
    if (ssr >= SSR__COUNT) return false;
    uint8_t buf[3] = { M2_CMD_SET_SSR, uint8_t(ssr), uint8_t(enable) };
    bool ok = mega2_send(buf, sizeof(buf));
    eventLogAdd(ok ? "Mega2: Safety-SSR geändert"
                   : "Mega2: Safety-SSR Kommando FEHLER");
    return ok;
}

bool mega2_cmd_ackError(uint8_t mask)
{
    uint8_t buf[2] = { M2_CMD_ACK_ERROR, mask };
    bool ok = mega2_send(buf, sizeof(buf));
    eventLogAdd(ok ? "Mega2: Fehler quittiert"
                   : "Mega2: Fehler-ACK FEHLER");
    return ok;
}
bool mega2SystemOnline()
{
    return s_m2SystemOnline && (millis() - s_m2SystemLastRx < 1000);
}

const SystemStatus& mega2SystemStatus()
{
    return s_m2System;
}