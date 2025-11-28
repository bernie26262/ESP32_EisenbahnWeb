#pragma once
#include <Arduino.h>

void web_init();
void web_loop();

// Wird vom Mega-Link aufgerufen, um JSON per WebSocket zu senden
void ws_sendMegaStatus(const String& json);
void ws_sendStatus();   // bestehende WiFi/WebUI Statusfunktion
