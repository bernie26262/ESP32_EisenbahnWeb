#include "network/eth_manager.h"
#include "network/net_config.h"

using Net::EthManager;

bool EthManager::s_connected = false;

bool EthManager::begin()
{
  Serial.println();
  Serial.println(F("=== EthManager: ESP32-S3 + W5500 initialisieren ==="));

  Serial.printf("MOSI_GPIO: %d\n", MOSI_GPIO);
  Serial.printf("MISO_GPIO: %d\n", MISO_GPIO);
  Serial.printf("SCK_GPIO : %d\n", SCK_GPIO);
  Serial.printf("CS_GPIO  : %d\n", CS_GPIO);
  Serial.printf("INT_GPIO : %d\n", INT_GPIO);
  Serial.printf("RST_GPIO : %d\n", RST_GPIO);
  Serial.printf("SPI_HOST : %d\n", ETH_SPI_HOST);
  Serial.printf("SPI_CLK  : %d MHz\n", SPI_CLOCK_MHZ);

  // W5500-Reset-Pin kurz betätigen (Low-Active, je nach Board; Waveshare nutzt i.d.R. LOW = reset)
  pinMode(RST_GPIO, OUTPUT);
  digitalWrite(RST_GPIO, LOW);
  delay(10);
  digitalWrite(RST_GPIO, HIGH);
  delay(100);

  // Event-Handler der Library aktivieren (Link-Up/Down usw.)
  ESP32_W5500_onEvent();

  // Zufällige MAC-Adresse aus Pool wählen (wie im Example)
  uint16_t macIndex = millis() % NUMBER_OF_MAC;
  uint8_t* macAddr  = MAC_POOL[macIndex];

  Serial.print(F("Verwende MAC: "));
  for (int i = 0; i < 6; i++)
  {
    if (i) Serial.print(':');
    if (macAddr[i] < 0x10) Serial.print('0');
    Serial.print(macAddr[i], HEX);
  }
  Serial.println();

  // ETH.begin(MISO, MOSI, SCK, CS, INT, CLK_MHz, HOST, MAC)
  bool ok = ETH.begin(MISO_GPIO, MOSI_GPIO, SCK_GPIO, CS_GPIO, INT_GPIO,
                      SPI_CLOCK_MHZ, ETH_SPI_HOST, macAddr);

  if (!ok)
  {
    Serial.println(F("ETH.begin() fehlgeschlagen!"));
    s_connected = false;
    return false;
  }

  // DHCP versuchen
  Serial.println(F("DHCP wird versucht..."));

  // Warte bis zu 10 Sekunden auf eine zugewiesene IP
  const unsigned long start = millis();
  IPAddress ip;

  do
  {
    ip = ETH.localIP();
    if (ip != IPAddress(0, 0, 0, 0))
      break;

    delay(200);
  } while (millis() - start < 10000UL);

  if (ip == IPAddress(0, 0, 0, 0))
  {
    // DHCP ist gescheitert -> Fallback auf statische IP
    Serial.println(F("DHCP fehlgeschlagen, setze Fallback-IP 192.168.11.160"));

    bool cfgOk = ETH.config(FALLBACK_IP, FALLBACK_GW, FALLBACK_SN, FALLBACK_DNS);

    if (!cfgOk)
    {
      Serial.println(F("ETH.config(Fallback) fehlgeschlagen!"));
      s_connected = false;
      return false;
    }

    ip = FALLBACK_IP;
  }

  Serial.println(F("Ethernet ist aktiv."));
  Serial.print(F("IP-Adresse: "));
  Serial.println(ip);

  Serial.print(F("Gateway   : "));
  Serial.println(FALLBACK_GW);

  Serial.print(F("Subnet    : "));
  Serial.println(FALLBACK_SN);

  Serial.print(F("DNS       : "));
  Serial.println(FALLBACK_DNS);

  s_connected = true;
  return true;
}

bool EthManager::isConnected()
{
  IPAddress ip = ETH.localIP();
  return (ip != IPAddress(0, 0, 0, 0));
}

IPAddress EthManager::localIP()
{
  return ETH.localIP();
}
