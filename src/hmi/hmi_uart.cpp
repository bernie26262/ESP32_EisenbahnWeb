#include "hmi_uart.h"
#include "../config/pins.h"

#include <HardwareSerial.h>

namespace HMI
{
    static HardwareSerial uart(1);
    static uint32_t lastSend = 0;
    static String rxLine;

    void begin()
    {
        uart.begin(115200, SERIAL_8N1, PIN_HMI_UART_RX, PIN_HMI_UART_TX);
        rxLine.reserve(192);
    }

    void loop()
    {
        // RX wird über readLine() im main loop verarbeitet.
    }

    bool sendJson(const String& s)
    {
        uint32_t now = millis();
        if (now - lastSend < 200) return false;

        uint16_t len = s.length();

        uart.write(0xA5);
        uart.write(0x5A);
        uart.write((uint8_t)(len & 0xFF));
        uart.write((uint8_t)((len >> 8) & 0xFF));
        uart.write((const uint8_t*)s.c_str(), len);

        lastSend = now;
        return true;
    }
    
    bool readLine(String& outLine)
    {
        while (uart.available())
        {
            const char c = (char)uart.read();

            if (c == '\n')
            {
                outLine = rxLine;
                rxLine = "";
                return outLine.length() > 0;
            }

            if (c == '\r')
            {
                continue;
            }

            if (rxLine.length() < 180)
            {
                rxLine += c;
            }
        }

        return false;
    }
}