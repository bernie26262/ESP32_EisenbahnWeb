# 🔧 HMI Werkbank-Doku (ESP32-P4)

## 🎯 Zweck

Schnelle Referenz für:
- Verkabelung
- USB-Anschlüsse
- typische Fehler

👉 Für Aufbau / Service an der Anlage

---

# ⚡ 1. USB-Anschlüsse (SEHR WICHTIG)

Das Board hat **2 USB-C Ports**:

## 🔌 USB (links am Board)

✔ Beschriftung: **USB**

Verwendung:
- Flashen
- Debugging
- Datenverbindung

👉 Kabel:
- **USB DATA Kabel verwenden**

---

## 🔌 USB to UART (rechts am Board)

✔ Beschriftung: **USB to UART**

Verwendung:
- **NUR Stromversorgung**

👉 Kabel:
- **USB Power-Only Kabel verwenden**

---

## ⚠️ MERKSATZ

👉 **USB = Daten**  
👉 **USB to UART = Strom**

---

# 🔌 2. UART-Verkabelung (ETH ↔ HMI)

## Pins

### HMI (ESP32-P4)

```cpp
#define HMI_UART_TX_GPIO 34
#define HMI_UART_RX_GPIO 36
ETH
#define PIN_HMI_UART_RX 16
#define PIN_HMI_UART_TX 17
Verbindung
HMI	ETH
TX (34)	RX (16)
RX (36)	TX (17)
GND	GND
⚠️ WICHTIG

❌ NICHT verbinden:

3.3V zwischen Boards

✅ MUSS:

GND verbunden
🔧 3. Kabel-Empfehlung

Für stabile Kommunikation:

TX/RX → Twisted Pair
möglichst kurz
optional: geschirmt

👉 verhindert:

JSON Fehler
Verbindungsprobleme
⚡ 4. Stromversorgung

Empfohlen:

👉 über USB to UART Port

Alternativ:

externe 5V

Wichtig:

stabile Spannung
gemeinsame Masse mit ETH
🧪 5. Schnelltest nach Aufbau
Strom an (USB to UART)
Flash-Kabel an USB (falls nötig)
ETH starten

Erwartung:

HMI bootet sofort
Verbindung steht nach wenigen Sekunden
❗ 6. Typische Fehler
❌ Kein Bild / kein Boot

→ falscher USB-Port

❌ Keine Kommunikation

→ TX/RX vertauscht
→ GND fehlt

❌ Instabile Anzeige

→ schlechte Kabel
→ keine gemeinsame Masse

❌ Flashen geht nicht

→ falscher USB-Port benutzt

🧠 7. Schnell-Diagnose
Problem	Ursache
keine Daten	RX/TX falsch
flackern	UART Störung
langsam	Serial Logging
tot	falscher USB
✅ 8. Minimal-Setup (Merkliste)
USB (DATA) → PC
USB to UART (POWER) → Versorgung
TX ↔ RX
GND ↔ GND
kein 3.3V