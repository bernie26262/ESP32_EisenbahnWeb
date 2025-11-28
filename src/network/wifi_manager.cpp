#include "wifi_manager.h"
#include <WiFi.h>
#include <Arduino.h>

#include "../web/webserver.h"

// -----------------------------------------------------------------------------
// WLAN Zugangsdaten
// -----------------------------------------------------------------------------
const char* WIFI_SSID = "FRITZ!Box 6490 Cable";
const char* WIFI_PASS = "65819772750096933215";

unsigned long lastReconnectAttempt = 0;
bool lastConnected = false;     // neu

// -----------------------------------------------------------------------------
// Initialisierung
// -----------------------------------------------------------------------------
void wifi_init() {
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);

    Serial.printf("MAC-Adresse des ESP32: %s\n", WiFi.macAddress().c_str());
    Serial.print("Verbinde mit WLAN: ");
    Serial.println(WIFI_SSID);

    WiFi.setHostname("esp32-eisenbahn");

    delay(200);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
}

// -----------------------------------------------------------------------------
// Verbindungsstatus
// -----------------------------------------------------------------------------
bool wifi_isConnected() {
    return WiFi.status() == WL_CONNECTED;
}

// -----------------------------------------------------------------------------
// WLAN-Loop (sauberer Reconnect + Debug + Status-Push)
// -----------------------------------------------------------------------------
void wifi_loop() {
    bool connected = wifi_isConnected();

    // 1) Übergang von NICHT-verbunden → verbunden?
    if (connected && !lastConnected) {

        Serial.println("[WiFi] Verbunden!");
        Serial.printf("[WiFi] IP: %s\n", WiFi.localIP().toString().c_str());
        Serial.printf("[WiFi] RSSI: %d dBm\n", WiFi.RSSI());
        Serial.printf("[WiFi] BSSID: %s\n", WiFi.BSSIDstr().c_str());

        ws_sendStatus();   // Status ins WebUI

        lastConnected = true;
        return;
    }

    // 2) Wenn Verbindung stabil → nichts tun
    if (connected) return;

    // 3) Übergang verbunden → getrennt?
    if (!connected && lastConnected) {
        Serial.println("[WiFi] Verbindung verloren!");
        ws_sendStatus();
        lastConnected = false;
    }

    // 4) Alle 5 Sekunden neuer Verbindungsversuch
    unsigned long now = millis();
    if (now - lastReconnectAttempt > 5000) {
        lastReconnectAttempt = now;

        Serial.printf("[WiFi] Status: %d\n", WiFi.status());
        Serial.println("[WiFi] Neuer Verbindungsversuch...");

        WiFi.disconnect();
        WiFi.begin(WIFI_SSID, WIFI_PASS);
    }
}
