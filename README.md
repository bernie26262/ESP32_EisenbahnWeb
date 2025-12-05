# ESP32_EisenbahnWeb
ESP32 I2C Master + Webserver für Weichensteuerung, Blocksteuerung und Schattenbahnhof

🎉 v1.2.0 — ESP32-S3 W5500 Ethernet + WebSockets

🚀 Highlights

Vollständige W5500-Ethernetintegration für Waveshare ESP32-S3 ETH

Reiner Ethernetbetrieb ohne WiFi

Zuverlässiges DHCP + automatischer Fallback auf 192.168.11.160

Neuer WebSocket-Server (/ws) für Echtzeitkommunikation

Test-Webinterface unter http://<IP>/

🔧 Änderungen

Neue Module: eth_manager.*, webserver.*, net_config.h

Aktualisierte platformio.ini (espressif32@6.5.0, USB-CDC aktiv)

Richtige W5500-Pins:

MOSI 11, MISO 12, SCK 13, CS 14, INT 10, RST 9

🐛 Fixes

Entfernte alte Ethernet-Libs

HTTP_GET / HTTP_ANY Fehler beseitigt

Stabilere SPI-Initialisierung für ESP32-S3

⚠️ Breaking Changes

WiFi-Webserver wurde durch Ethernet ersetzt

Erfordert Arduino ESP32-Core ≥ 3.1.x

Alte HTTP/WebSocket-Implementationen inkompatibel

📂 Struktur
src/
 ├─ main.cpp
 ├─ network/
 ├─ web/
