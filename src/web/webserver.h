#pragma once

// Initialisierung & Loop des Webservers
void web_init();
void web_loop();

// WebSocket: Status an alle Clients senden
void ws_sendStatus();
