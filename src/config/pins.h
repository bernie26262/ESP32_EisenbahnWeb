#pragma once
#include <Arduino.h>

// I2C Pins ESP32-S3
static const uint8_t I2C_SDA_PIN = 8;
static const uint8_t I2C_SCL_PIN = 9;

// Interrupt vom Mega2560 (Mega → ESP)
static const uint8_t MEGA_INT_PIN = 4;

// I2C-Adressen der Slaves
static const uint8_t I2C_ADDR_MEGA   = 0x10;  // Bahnhofssteuerung
static const uint8_t I2C_ADDR_SLAVE2 = 0x11;  // zweiter Slave (z.B. Booster)
