#pragma once

#include <IPAddress.h>

namespace Net
{
    class EthManager
    {
    public:
        static void begin();
        static void update();

        static bool isConnected();
        static IPAddress localIP();

        // Wird vom Webserver signalisiert
        static void markConnected(IPAddress ip);

    private:
        static bool      s_connected;
        static IPAddress s_ip;
    };
}
