#pragma once

#include <Arduino.h>

// Initialisierung der I2C-Verbindung zum Mega
void mega_link_init();

// Muss regelmäßig aus loop() aufgerufen werden
void mega_link_loop();

// Rohdaten-Befehl an den Mega schicken
bool mega_link_sendToMega(const uint8_t* data, size_t len);

// Rohdaten vom Mega holen (z.B. Status-Updates)
// Gibt true zurück, wenn Daten empfangen wurden
bool mega_link_readFromMega(uint8_t* buffer, size_t maxLen, size_t& outLen);
