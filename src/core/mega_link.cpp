#include <Arduino.h>
#include "Wire.h"
#include <string.h>
#include "mega_link.h"
#include "i2c_packets.h"
#include "config/pins.h"

// =====================================================================
//   Slave-State Speicher
// =====================================================================
static SlaveState slaves[NUM_SLAVES];

// I2C-Adressen der Slaves (müssen zu deinen Mega-Sketchen passen)
static const uint8_t I2C_ADDR[NUM_SLAVES] = {
    0x10, 0x11, 0x12, 0x13
};

// DataReady-Flags (werden in ISR gesetzt)
static volatile bool dr_flag[NUM_SLAVES] = { false, false, false, false };

// ISR für die vier DataReady-Leitungen
static void IRAM_ATTR dr1_isr() { dr_flag[0] = true; }
static void IRAM_ATTR dr2_isr() { dr_flag[1] = true; }
static void IRAM_ATTR dr3_isr() { dr_flag[2] = true; }
static void IRAM_ATTR dr4_isr() { dr_flag[3] = true; }

// Event-Type IDs wie auf dem Mega (EventQueue.h)
static constexpr uint8_t EVT_SENSOR        = 1;
static constexpr uint8_t EVT_WEICHE        = 2;
static constexpr uint8_t EVT_BHF           = 3;
static constexpr uint8_t EVT_MODUS_CHANGE  = 4;
static constexpr uint8_t EVT_RECOVERY_DONE = 5; // aktuell ignoriert

// Forward-Deklarationen interner Helfer
static bool requestFull(uint8_t sid);
static bool requestDelta(uint8_t sid);

// =====================================================================
//   INIT
// =====================================================================
void mega_init()
{
    // I2C Master initialisieren
    Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, 400000);  // 400 kHz

    // States leeren
    memset(slaves, 0, sizeof(slaves));

    // DataReady-Eingänge
    pinMode(PIN_DATAREADY_1, INPUT_PULLUP);
    pinMode(PIN_DATAREADY_2, INPUT_PULLUP);
    pinMode(PIN_DATAREADY_3, INPUT_PULLUP);
    pinMode(PIN_DATAREADY_4, INPUT_PULLUP);

    // Interrupts
    attachInterrupt(PIN_DATAREADY_1, dr1_isr, RISING);
    attachInterrupt(PIN_DATAREADY_2, dr2_isr, RISING);
    attachInterrupt(PIN_DATAREADY_3, dr3_isr, RISING);
    attachInterrupt(PIN_DATAREADY_4, dr4_isr, RISING);

    Serial.println("[MEGA] INIT – FULL-Sync für alle Slaves");

    // Initialer FULL-Sync, damit der ESP einen kompletten Zustand hat
    for (uint8_t i = 0; i < NUM_SLAVES; i++) {
        if (requestFull(i)) {
            Serial.printf("[MEGA] FULL %u OK\n", i);
        } else {
            Serial.printf("[MEGA] FULL %u FAILED\n", i);
        }
    }
}

// =====================================================================
//   FULL – kompletter Zustand eines Slaves
// =====================================================================
static bool requestFull(uint8_t sid)
{
    if (sid >= NUM_SLAVES) return false;
    const uint8_t addr = I2C_ADDR[sid];

    // Anfrage: "gib mir deinen FULL-Status"
    Wire.beginTransmission(addr);
    Wire.write(I2C_CMD_GET_FULL);
    if (Wire.endTransmission() != 0) {
        return false;
    }

    // Mega hat etwas Zeit, das Paket zu füllen
    delayMicroseconds(1500);

    // Antwort lesen
    const uint8_t expectedSize = sizeof(I2C_FullPayload);
    if (Wire.requestFrom(addr, expectedSize) != expectedSize) {
        return false;
    }

    I2C_FullPayload pkt;
    Wire.readBytes(reinterpret_cast<uint8_t*>(&pkt), sizeof(pkt));

    if (pkt.pktType != I2C_PKT_FULL) {
        return false;
    }

    SlaveState &st = slaves[sid];
    st.valid        = true;
    st.timestamp    = pkt.timestamp;
    st.weichenBits  = pkt.weichenBits;
    st.bhfStromBits = pkt.bhfStromBits;
    st.mode         = pkt.mode;

    return true;
}

// =====================================================================
//   DELTA – grouping light: bis zu 8 Events
// =====================================================================
static bool requestDelta(uint8_t sid)
{
    if (sid >= NUM_SLAVES) return false;
    const uint8_t addr = I2C_ADDR[sid];

    // Anfrage: "gib mir deine Deltas"
    Wire.beginTransmission(addr);
    Wire.write(I2C_CMD_GET_DELTA);
    if (Wire.endTransmission() != 0) {
        return false;
    }

    delayMicroseconds(1500);

    const uint8_t expectedSize = sizeof(I2C_DeltaPayload);
    if (Wire.requestFrom(addr, expectedSize) != expectedSize) {
        return false;
    }

    I2C_DeltaPayload pkt;
    Wire.readBytes(reinterpret_cast<uint8_t*>(&pkt), sizeof(pkt));

    if (pkt.pktType != I2C_PKT_DELTA) {
        return false;
    }

    SlaveState &st = slaves[sid];
    st.valid = true;    // Wir haben frische Daten

    // Events anwenden
    const uint8_t n = pkt.count;
    for (uint8_t i = 0; i < n && i < 8; i++) {
        const I2C_DeltaEvent &ev = pkt.ev[i];

        switch (ev.type) {
            case EVT_WEICHE: {
                uint8_t wid = ev.id;
                if (wid < 16) { // wir nutzen 12 Weichen, 16 Bits Reserve
                    if (ev.value) {
                        st.weichenBits |= (1u << wid);
                    } else {
                        st.weichenBits &= ~(1u << wid);
                    }
                }
                break;
            }

            case EVT_BHF: {
                uint8_t bid = ev.id;
                if (bid < 8) { // wir haben 4 Bahnhöfe, 8 Bits Reserve
                    if (ev.value) {
                        st.bhfStromBits |= (1u << bid);
                    } else {
                        st.bhfStromBits &= ~(1u << bid);
                    }
                }
                break;
            }

            case EVT_MODUS_CHANGE: {
                // value entspricht dem Betriebsmodus (MOD_AUTOMATIK / MOD_MANUELL)
                st.mode = ev.value;
                break;
            }

            case EVT_SENSOR:
            case EVT_RECOVERY_DONE:
            default:
                // aktuell keine Auswertung nötig
                break;
        }
    }

    return true;
}

// =====================================================================
//   UPDATE LOOP – im loop() des ESP aufrufen
// =====================================================================
void mega_update()
{
    for (uint8_t i = 0; i < NUM_SLAVES; i++) {
        if (!dr_flag[i]) continue;

        // Flag zurücksetzen
        dr_flag[i] = false;

        // Delta abholen; falls das schiefgeht, könnte man hier fallback-mäßig
        // einen FULL versuchen – aktuell einfach nur ignoriert.
        if (!requestDelta(i)) {
            Serial.printf("[MEGA] DELTA %u FAILED\n", i);
        }
    }
}

// =====================================================================
//   Getter
// =====================================================================
const SlaveState& mega_getState(uint8_t sid)
{
    if (sid >= NUM_SLAVES) {
        // out-of-range → Dummy-Static zurückgeben
        static SlaveState dummy;
        return dummy;
    }
    return slaves[sid];
}
