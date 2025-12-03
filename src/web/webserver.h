#ifndef WEBSERVER_H
#define WEBSERVER_H

void web_init();
void web_loop();

// WebSocket Broadcast für andere Module
void ws_broadcast(const char* key, int value);

#endif
