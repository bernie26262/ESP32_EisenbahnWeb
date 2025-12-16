#include "eth_manager.h"

namespace Net
{
    // -----------------------------
    // Statische Member DEFINIEREN
    // -----------------------------
    bool      EthManager::s_connected = false;
    IPAddress EthManager::s_ip        = IPAddress(0,0,0,0);

    void EthManager::begin()
    {
        s_connected = false;
        s_ip        = IPAddress(0,0,0,0);
    }

    void EthManager::update()
    {
        // bewusst leer
        // Ethernet wird durch AsyncWebServer_ESP32_SC_W5500 gemanaged
    }

    bool EthManager::isConnected()
    {
        return s_connected;
    }

    IPAddress EthManager::localIP()
    {
        return s_ip;
    }

    void EthManager::markConnected(IPAddress ip)
    {
        s_connected = true;
        s_ip        = ip;
    }
}
