#pragma once

#include <Arduino.h>

// Log-Level der AsyncWebServer_ESP32_SC_W5500-Library
// 0 = aus, 4 = sehr viel
#define _ASYNC_WEBSERVER_LOGLEVEL_ 3

// -----------------------------------------------------------------------------
// W5500-Pinbelegung für dein Waveshare ESP32-S3 ETH
// (von dir angegeben)
// -----------------------------------------------------------------------------
#define MOSI_GPIO   11
#define MISO_GPIO   12
#define SCK_GPIO    13
#define CS_GPIO     14
#define INT_GPIO    10
#define RST_GPIO     9    // W5500-Reset

// Optional: SPI-Host und Takt (Standardwerte der Lib sind meist ok)
#ifndef ETH_SPI_HOST
  #define ETH_SPI_HOST  SPI3_HOST   // ESP32-S3
#endif

#ifndef SPI_CLOCK_MHZ
  #define SPI_CLOCK_MHZ  25
#endif

// -----------------------------------------------------------------------------
// Netzwerk-Konfiguration
// -----------------------------------------------------------------------------

// Fallback-IP, wenn DHCP nicht funktioniert
static const IPAddress FALLBACK_IP  (192, 168, 11, 160);
static const IPAddress FALLBACK_GW  (192, 168, 11, 1);
static const IPAddress FALLBACK_SN  (255, 255, 255, 0);
static const IPAddress FALLBACK_DNS (8, 8, 8, 8);

// Optional: feste IP-Konfiguration, wenn du später komplett auf static gehen willst
static const IPAddress STATIC_IP  = FALLBACK_IP;
static const IPAddress STATIC_GW  = FALLBACK_GW;
static const IPAddress STATIC_SN  = FALLBACK_SN;
static const IPAddress STATIC_DNS = FALLBACK_DNS;

// Anzahl vordefinierter MAC-Adressen (aus dem Example übernommen)
#define NUMBER_OF_MAC 20

static byte MAC_POOL[NUMBER_OF_MAC][6] =
{
  { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x01 },
  { 0xDE, 0xAD, 0xBE, 0xEF, 0xBE, 0x02 },
  { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x03 },
  { 0xDE, 0xAD, 0xBE, 0xEF, 0xBE, 0x04 },
  { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x05 },
  { 0xDE, 0xAD, 0xBE, 0xEF, 0xBE, 0x06 },
  { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x07 },
  { 0xDE, 0xAD, 0xBE, 0xEF, 0xBE, 0x08 },
  { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x09 },
  { 0xDE, 0xAD, 0xBE, 0xEF, 0xBE, 0x0A },
  { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x0B },
  { 0xDE, 0xAD, 0xBE, 0xEF, 0xBE, 0x0C },
  { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x0D },
  { 0xDE, 0xAD, 0xBE, 0xEF, 0xBE, 0x0E },
  { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x0F },
  { 0xDE, 0xAD, 0xBE, 0xEF, 0xBE, 0x10 },
  { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x11 },
  { 0xDE, 0xAD, 0xBE, 0xEF, 0xBE, 0x12 },
  { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x13 },
  { 0xDE, 0xAD, 0xBE, 0xEF, 0xBE, 0x14 },
};

// -----------------------------------------------------------------------------
// WICHTIG: Library-Header NACH den Defines einbinden
// -----------------------------------------------------------------------------
#include <AsyncWebServer_ESP32_SC_W5500.h>
