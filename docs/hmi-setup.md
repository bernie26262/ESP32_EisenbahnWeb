# 1. Überblick

Das HMI (ESP32-S3 Touch Display) ist ein eigenständiges UI-System, das über UART mit dem ETH-Controller (ESP32-S3 ETH mit W5500) kommuniziert.

- **ETH-Board** = zentrale Logik + Webserver + I²C zu Megas
- **HMI** = Visualisierung + Bedienung
- **Kommunikation** = UART (JSON, framed)

---

# 2. UART-Schnittstelle (ETH ↔ HMI)

## Pinbelegung im ETH-Repo

```cpp
// ========================================================
// HMI UART (Display-ESP)
// ========================================================
#define PIN_HMI_UART_RX  16   // ESP empfängt (Display TX)
#define PIN_HMI_UART_TX  17   // ESP sendet   (Display RX)
Kommunikationsprinzip
ETH → HMI:
state-lite (on-change + periodic)
analog (zyklisch, entkoppelt)
HMI → ETH:
Aktionen (powerOn, powerOff, auto, etc.)
Framing:
Header: 0xA5 0x5A
Length: 16-bit
Payload: JSON
3. WICHTIG: UART-Umschaltung (HMI-Board)

Das HMI-Board hat einen Hardware-Schalter für UART.

Betriebsarten
Modus	Schalter	Verwendung
Upload	UART1	Flashen über USB
Betrieb	UART2	Kommunikation mit ETH
⚠️ Kritischer Hinweis

Wenn der Schalter falsch steht:

Upload funktioniert nicht oder
Kommunikation mit ETH funktioniert nicht
4. Verkabelung HMI ↔ ETH
Verbindung UART
HMI	ETH
TX	RX (Pin 16)
RX	TX (Pin 17)
GND	GND
⚠️ Wichtige Regeln
❌ NICHT verbinden:
3.3V zwischen HMI und ETH
✅ MUSS verbunden sein:
GND (gemeinsame Masse)
Kabel-Empfehlung

Für stabile Kommunikation:

TX/RX als Twisted Pair
möglichst:
geschirmtes Kabel (shielded)
kurze Leitung
vermeidet:
Störungen
JSON-Fehler
UART-Overflows
5. Stromversorgung HMI
Anschluss
über Power-Stecker am HMI
Versorgung:
5V
GND
⚠️ Hinweis
Versorgung nicht über UART
eigene stabile Stromquelle verwenden
6. Typische Fehlerbilder
Kein Upload möglich

→ Schalter steht auf UART2
✔ Lösung: auf UART1 stellen

HMI zeigt keine Daten

→ Schalter steht auf UART1
✔ Lösung: auf UART2 stellen

JSON-Fehler / instabile Anzeige

→ häufig:

schlechte Masseverbindung
ungeschirmte Leitungen
zu lange Kabel

✔ Lösung:

GND prüfen
twisted pair verwenden
ggf. Shielding
7. Zusammenfassung (Kurzfassung)
UART Pins ETH:
RX = 16
TX = 17
HMI:
Upload → UART1
Betrieb → UART2
Verkabelung:
TX ↔ RX
GND ↔ GND
kein 3.3V
Strom:
5V über Power-Stecker
8. Status der Implementierung
state-lite stabil
analog getrennt
UI modularisiert
Overlay-System implementiert
Performance stabil
9. ToDo / Erweiterungen
Anzeige "kein Schreibrecht (diag lease)" im HMI
weitere UI-Vereinheitlichung mit WebUI
optional:
UART-Debug-Level konfigurierbar
CRC im Protokoll