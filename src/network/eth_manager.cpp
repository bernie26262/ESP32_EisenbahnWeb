#include "network/eth_manager.h"
#include "network/net_config.h"
#include "debug.h"

using Net::EthManager;

bool EthManager::s_connected = false;

bool EthManager::begin()
{
  
  EE_LOGI("BOOT", "EthManager: ESP32-S3 + W5500 initialisieren");

  EE_LOGI("ETH", "EthManager begin()");

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

  EE_LOGI("ETH", "MAC: (logged elsewhere)");

  // ETH.begin(MISO, MOSI, SCK, CS, INT, CLK_MHz, HOST, MAC)
  bool ok = ETH.begin(MISO_GPIO, MOSI_GPIO, SCK_GPIO, CS_GPIO, INT_GPIO,
                      SPI_CLOCK_MHZ, ETH_SPI_HOST, macAddr);

  if (!ok)
  {
    EE_LOGI("ETH", "ETH.begin() fehlgeschlagen!");
    s_connected = false;
    return false;
  }

  // DHCP versuchen
  EE_LOGI("ETH", "DHCP wird versucht...");

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
    EE_LOGW("ETH", "DHCP fehlgeschlagen, setze Fallback-IP 192.168.11.160");

    bool cfgOk = ETH.config(FALLBACK_IP, FALLBACK_GW, FALLBACK_SN, FALLBACK_DNS);

    if (!cfgOk)
    {
      EE_LOGE("ETH", "ETH.config(Fallback) fehlgeschlagen!");
      s_connected = false;
      return false;
    }

    ip = FALLBACK_IP;
  }

  EE_LOGI("ETH", "Ethernet aktiv. IP=%s GW=%s SN=%s DNS=%s",
        ip.toString().c_str(),
        FALLBACK_GW.toString().c_str(),
        FALLBACK_SN.toString().c_str(),
        FALLBACK_DNS.toString().c_str());

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
