#pragma once

#include <Arduino.h>
#include <IPAddress.h>

namespace Net
{
  class EthManager
  {
  public:
    // Startet W5500 + Ethernet, versucht DHCP und fällt bei Bedarf auf Static zurück.
    static bool begin();

    // Ist eine gültige IP konfiguriert?
    static bool isConnected();

    // Liefert die aktuelle IP-Adresse (oder 0.0.0.0, wenn keine)
    static IPAddress localIP();

  private:
    static bool s_connected;
  };
}
