#ifndef PINS_H
#define PINS_H

// ========================================================
// I2C – ESP32-S3 als MASTER (frei wählbar, konfliktfrei)
// ========================================================
#define PIN_I2C_SDA      41
#define PIN_I2C_SCL      42

// ========================================================
// DataReady von den Mega2560-Slaves (freie Pins!)
// ========================================================
#define PIN_DATAREADY_1  36
#define PIN_DATAREADY_2  37
#define PIN_DATAREADY_3  38
#define PIN_DATAREADY_4  39

// ========================================================
// Status LED (frei verfügbar)
// ========================================================
#define PIN_STATUS_LED   35

// ========================================================
// HMI UART (Display-ESP)
// ========================================================
#define PIN_HMI_UART_RX  16   // ESP empfängt (Display TX)
#define PIN_HMI_UART_TX  17   // ESP sendet   (Display RX)

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
