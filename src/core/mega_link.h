#pragma once
#include <Arduino.h>

// Initialisierung und Loop
void mega_init();
void mega_loop();

// Status-Abfragen für Webserver
bool mega_isConnected();              // Ist der Mega online?
unsigned long mega_lastUpdate();      // Zeitstempel der letzten Daten
String mega_getLastJson();            // Letzte empfangene Mega-Meldung
