# HMI Dokumentation (ESP32-P4, Stand 2026-04-29)

## 1. Überblick

Das HMI basiert auf dem **ESP32-P4 Touch Display (7")** und ist ein eigenständiges UI-System.

Systemarchitektur:

- ETH (ESP32-S3 + W5500) → zentrale Logik
- HMI (ESP32-P4) → Anzeige + Bedienung
- Kommunikation → UART (framed JSON, ACK-basiert)

---

## 2. Architektur des P4-HMI

### UI-Struktur

Linkes Panel:
- Weichen
- Bahnhöfe
- Blöcke
- Einstellungen

Rechtes Panel:
- Power / Auto
- Trafo-Werte
- Systemstatus
- Meldungen

---

## 3. Wichtige Neuerungen

### 3.1 Rendering

- vollständige LVGL-native UI
- keine SVGs mehr
- Lazy Rendering (nur aktive Ebene)

Ergebnis:
- stabile Performance (~66 / ~33 FPS)
- kein Flackern

---

### 3.2 Kommunikation

- UART: 230400 Baud
- ACK-gesteuert
- genau 1 Frame gleichzeitig

---

### 3.3 Serial Guard

Problem:
- Logging ohne Monitor → starke Verlangsamung

Lösung:
- zentraler Serial Guard

Ergebnis:
- stabile Reaktionszeiten

---

### 3.4 Einstellungen (neu)

- Helligkeit (Slider)
- Screen-Off Timer

Speicherung:
- persistent über NVS

---

### 3.5 Screen-Off

- PWM Backlight
- Timeout gesteuert
- erster Touch → nur Wake-Up

---

### 3.6 Meldungsbereich (neu)

Struktur:


Meldungen:
├─ Mega1 Fehler (rot)
├─ SBHF Fehler (rot)
├─ SBHF Betriebsmodus (grün/gelb)
└─ erlaubte Gleise (grau)


Texte:

- "SBHF: normaler Betrieb"
- "SBHF: eingeschraenkter Betrieb aktiv"
- "SBHF erlaubte Gleise: X"

---

### 3.7 Klick-Feedback

Für:
- Weichen W0–W11
- Bahnhöfe Bhf0–Bhf3
- Power / Auto Buttons

Verhalten:
- visueller Outline-Flash
- Dauer: 220 ms

---

## 4. UART Kommunikation

### ETH Pins

```cpp
#define PIN_HMI_UART_RX 16
#define PIN_HMI_UART_TX 17
HMI (ESP32-P4) Pins
#define HMI_UART_TX_GPIO 34
#define HMI_UART_RX_GPIO 36
Verkabelung
HMI	ETH
TX (34)	RX (16)
RX (36)	TX (17)
GND	GND
5. ⚠️ Verdrahtung
Regeln

❌ NICHT verbinden:

3.3V zwischen Boards

✅ MUSS verbunden sein:

GND
Kabel

Empfohlen:

TX/RX als Twisted Pair
möglichst kurz
optional geschirmt
6. ⚡ USB-C Ports (P4 Board)

Das Board hat zwei USB-C Anschlüsse:

6.1 Port: "USB"

Beschriftung: USB

Funktion:

Programmieren
Debugging
Datenverbindung

Kabel:

USB DATA Kabel
6.2 Port: "USB to UART"

Beschriftung: USB to UART

Funktion im Projekt:

nur Stromversorgung

Kabel:

USB Power-Only Kabel
⚠️ Wichtige Praxisregel
Port	Verwendung	Kabel
USB	Flash + Debug	DATA
USB to UART	Strom	POWER
7. Stromversorgung

Optionen:

USB to UART Port (empfohlen)
externe 5V Versorgung

Wichtig:

stabile Spannung
gemeinsame Masse mit ETH
8. Typische Fehler
Keine Kommunikation
TX/RX vertauscht
GND fehlt
JSON Fehler
schlechte Kabel
Störungen
Flashen geht nicht
falscher USB-Port
Langsame UI
Serial Logging aktiv ohne Guard
9. Zusammenfassung
Kommunikation
UART, 230400 Baud
ACK-basiert
Pins
ETH: RX 16 / TX 17
HMI: TX 34 / RX 36
USB
USB → Flash/Debug (DATA)
USB to UART → Strom (POWER)
UX
strukturierter Meldungsbereich
SBHF Status sichtbar
Klick-Feedback
Einstellungen + Screen-Off
10. Fazit

Das ESP32-P4 HMI ist:

performant
stabil
übersichtlich
praxisgerecht verdrahtbar

Besonders wichtig im Betrieb:

klare Statusanzeige
unmittelbares Feedback
robuste Kommunikation