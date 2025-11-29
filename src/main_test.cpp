#include <Arduino.h>
#include <Wire.h>

#define SDA_PIN 8
#define SCL_PIN 9

#define SLAVE1_ADDR 0x10   // Mega2560
#define SLAVE2_ADDR 0x11   // Zweiter Slave

String requestSlave(uint8_t addr) {
    Wire.beginTransmission(addr);
    Wire.write("PING");
    uint8_t result = Wire.endTransmission();

    if (result != 0) {
        Serial.printf("[I2C] Slave 0x%02X Sendefehler: %d\n", addr, result);
        return "";
    }

    delay(10);

    Wire.requestFrom(addr, (uint8_t)32);
    if (!Wire.available()) {
        Serial.printf("[I2C] Slave 0x%02X antwortet nicht!\n", addr);
        return "";
    }

    String response = "";
    while (Wire.available()) {
        char c = Wire.read();
        if (c >= 32 && c <= 126) response += c;
    }
    return response;
}

void setup() {
    Serial.begin(115200);
    delay(2000);

    Serial.println("=== ESP32 Multi-Slave I2C Test ===");
    Wire.begin(SDA_PIN, SCL_PIN);

    Serial.printf("I2C gestartet auf SDA=%d, SCL=%d\n", SDA_PIN, SCL_PIN);
}

void loop() {
    Serial.println("\n--- Test Slave 1 (Mega2560) ---");
    String s1 = requestSlave(SLAVE1_ADDR);
    Serial.println("Antwort von 0x10: " + s1);

    Serial.println("\n--- Test Slave 2 ---");
    String s2 = requestSlave(SLAVE2_ADDR);
    Serial.println("Antwort von 0x11: " + s2);

    Serial.println("-----------------------------");
    delay(3000);
}
