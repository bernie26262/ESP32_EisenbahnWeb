#ifndef ETH_MANAGER_H
#define ETH_MANAGER_H

#include <Arduino.h>
#include <WiFi.h>
#include <ETH.h>

void eth_init();
void eth_loop();

bool eth_is_ready();
IPAddress eth_get_ip();

#endif
