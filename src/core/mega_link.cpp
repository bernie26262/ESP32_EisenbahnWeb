#include "mega_link.h"

#include <Wire.h>
#include "../config/pins.h"

// Interner Buffer für eingehende Daten (z.B. JSON-Strings)
static const size_t MEGA_BUFFER_SIZE = 128;
static volatile bool mega_hasData = false;  // wird vom Interrupt gesetzt

// Interrupt-Service-Routine: Mega meldet "Daten vorhanden"
void IRAM_ATTR mega_int_isr() {
    mega_hasData = true;
}

void mega_link_init() {
    // I2C als Master starten
    Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
    // Optional: Takt reduzieren, um Probleme auf langen Leitungen zu vermeiden
    Wire.setClock(100000);  // 100 kHz

    // Interrupt-Pin konfigurieren (vom Mega kommend)
    pinMode(MEGA_INT_PIN, INPUT_PULLDOWN);  // Mega zieht auf HIGH bei Datenbereit
    attachInterrupt(digitalPinToInterrupt(MEGA_INT_PIN), mega_int_isr, RISING);

    Serial.println("[I2C] I2C-Master gestartet (ESP32-S3 → Mega)");
}

bool mega_link_sendToMega(const uint8_t* data, size_t len) {
    Wire.beginTransmission(I2C_ADDR_MEGA);
    size_t written = Wire.write(data, len);
    uint8_t result = Wire.endTransmission();

    if (result != 0 || written != len) {
        Serial.printf("[I2C] Senden an Mega fehlgeschlagen (code=%u, written=%u)\n",
                      result, (unsigned)written);
        return false;
    }

    return true;
}

// Rohdaten vom Mega lesen
bool mega_link_readFromMega(uint8_t* buffer, size_t maxLen, size_t& outLen) {
    outLen = 0;

    // Beispiel: wir erwarten vom Mega bis zu maxLen Bytes in einem Rutsch
    // Du kannst hier später dein Protokoll konkretisieren (z.B. Länge voranstellen)
    Wire.requestFrom((int)I2C_ADDR_MEGA, (int)maxLen);

    if (!Wire.available()) {
        return false;
    }

    while (Wire.available() && outLen < maxLen) {
        buffer[outLen++] = Wire.read();
    }

    return outLen > 0;
}

void mega_link_loop() {
    // Nur aktiv werden, wenn der Mega per Interrupt "Daten verfügbar" gemeldet hat
    if (!mega_hasData) return;

    mega_hasData = false;

    uint8_t buffer[MEGA_BUFFER_SIZE];
    size_t len = 0;

    if (mega_link_readFromMega(buffer, sizeof(buffer), len)) {
        // Debug: erst mal alles anzeigen
        Serial.print("[I2C] Daten vom Mega: ");
        for (size_t i = 0; i < len; ++i) {
            char c = (char)buffer[i];
            if (c >= 32 && c <= 126) {
                Serial.print(c);
            } else {
                Serial.print(".");
            }
        }
        Serial.println();

        // HIER: später dein JSON/Protokoll-Parser aufrufen
        // z.B.:
        //   deserializeJson(doc, buffer, len);
        //   system_state_update_from_mega(doc);
    }
}
