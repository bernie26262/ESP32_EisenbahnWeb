#ifndef PINS_H
#define PINS_H

// ========================================================
// I2C – ESP32-S3 als MASTER (frei wählbar, konfliktfrei)
// ========================================================
#define PIN_I2C_SDA      17
#define PIN_I2C_SCL      18

// ========================================================
// DataReady von den Mega2560-Slaves (freie Pins!)
// ========================================================
#define PIN_DATAREADY_1  21
#define PIN_DATAREADY_2  2
#define PIN_DATAREADY_3  15
#define PIN_DATAREADY_4  16

// ========================================================
// Status LED (frei verfügbar)
// ========================================================
#define PIN_STATUS_LED   35

// ========================================================
// Ethernet W5500 – fest verdrahtet auf Waveshare Board
// NICHT ÄNDERN!
// ========================================================
// MOSI 11
// MISO 13
// CLK  12
// CS   10
// INT  14
// RST   9

#endif
