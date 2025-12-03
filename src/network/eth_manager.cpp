#include "eth_manager.h"

// ----- WICHTIG -----
// NIE Namen wie ETH_PHY_ADDR verwenden → kollidiert mit ETH.h
// -------------------

// Waveshare ESP32-S3-ETH RMII Pins
static constexpr int PIN_PHY_ADDR  = 1;
static constexpr int PIN_PHY_POWER = 17;
static constexpr int PIN_PHY_MDC   = 16;
static constexpr int PIN_PHY_MDIO  = 15;

static constexpr eth_phy_type_t   PHY_TYPE     = ETH_PHY_LAN8720;
static constexpr eth_clock_mode_t PHY_CLK_MODE = ETH_CLOCK_GPIO0_IN;

static bool eth_connected = false;

bool eth_is_ready() {
    return eth_connected && ETH.linkUp() && ETH.localIP() != INADDR_NONE;
}

IPAddress eth_get_ip() {
    return ETH.localIP();
}

// Ethernet-Event-Handler
static void onEthEvent(WiFiEvent_t event) {
    switch (event) {
        case ARDUINO_EVENT_ETH_START:
            Serial.println("[ETH] Started");
            ETH.setHostname("esp32-s3-eth");
            break;

        case ARDUINO_EVENT_ETH_CONNECTED:
            Serial.println("[ETH] Connected");
            break;

        case ARDUINO_EVENT_ETH_GOT_IP:
            Serial.printf("[ETH] Got IP: %s\n", ETH.localIP().toString().c_str());
            eth_connected = true;
            break;

        case ARDUINO_EVENT_ETH_DISCONNECTED:
            Serial.println("[ETH] Disconnected");
            eth_connected = false;
            break;

        case ARDUINO_EVENT_ETH_STOP:
            Serial.println("[ETH] Stopped");
            eth_connected = false;
            break;

        default:
            break;
    }
}

void eth_init() {
    Serial.println("[ETH] Initializing...");

    WiFi.onEvent(onEthEvent);

    if (!ETH.begin(
            PIN_PHY_ADDR,
            PIN_PHY_POWER,
            PIN_PHY_MDC,
            PIN_PHY_MDIO,
            PHY_TYPE,
            PHY_CLK_MODE)) {

        Serial.println("[ETH] ERROR: ETH.begin() FAILED!");
        eth_connected = false;
        return;
    }

    Serial.println("[ETH] ETH.begin() OK, waiting for IP...");
}

void eth_loop() {
    // Platz für spätere Funktionen (Reconnect etc.)
}
