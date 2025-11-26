#include <Arduino.h>
#include <Wire.h>

#define I2C_SLAVE_ADDRESS 0x20

void setup() {
  Serial.begin(115200);
  Wire.begin(); // ESP32 als I2C Master
  Serial.println("ESP32 WeichenWeb v0.1 gestartet");
}

void loop() {
  // Später: I2C-Kommandos an Mega senden
  delay(1000);
}