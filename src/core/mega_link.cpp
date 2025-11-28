#include "mega_link.h"
#include <Wire.h>
#include "../config/pins.h"

// I2C-Adresse Mega2560
static const uint8_t MEGA_ADDR = 0x12;

// Letzte empfangene JSON-Nachricht
static String lastMegaJson = "{}";

// Letzter Update-Zeitstempel
static unsigned long lastMegaUpdate = 0;

// DataReady-Flag vom Mega
volatile bool megaDataReady = false;

// ISR
void IRAM_ATTR mega_dataReadyISR() {
    megaDataReady = true;
}

// Wird vom WebUI abgefragt
bool mega_isConnected() {
    // simple Heuristik: wenn in den letzten 5 Sekunden Daten kamen → connected
    return (millis() - lastMegaUpdate) < 5000;
}

unsigned long mega_lastUpdate() {
    return lastMegaUpdate;
}

String mega_getLastJson() {
    return lastMegaJson;
}

// Initialisierung
void mega_init() {

    Serial.println("[MEGA] Initialisierung...");

    // I2C starten
    Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, 400000);

    // DataReady-Pin konfigurieren
    pinMode(PIN_MEGA_DATAREADY, INPUT_PULLUP);
    attachInterrupt(digitalPinToInterrupt(PIN_MEGA_DATAREADY),
                    mega_dataReadyISR,
                    FALLING);

    Serial.println("[MEGA] bereit.");
}

// Loop
void mega_loop() {

    if (!megaDataReady)
        return;

    megaDataReady = false;

    // Bis 64 Bytes lesen
    Wire.requestFrom(MEGA_ADDR, (uint8_t)64);

    char buffer[65];
    int idx = 0;

    while (Wire.available() && idx < 64) {
        buffer[idx++] = Wire.read();
    }
    buffer[idx] = '\0';

    lastMegaJson = String(buffer);
    lastMegaUpdate = millis();

    Serial.printf("[MEGA] RX: %s\n", buffer);
}
