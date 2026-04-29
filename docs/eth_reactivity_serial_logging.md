# ETH Reaktivität – Einfluss von Serial Logging (ESP32-S3)

## Ausgangssituation

Beim Kaltstart des ETH (ESP32-S3 + W5500) wurde eine deutlich reduzierte Reaktivität beobachtet:

- WebUI reagiert verzögert (bis zu mehreren Sekunden)
- HMI-Antworten träge
- Effekt tritt **nur beim echten Power-On** auf
- Nach Reset (ohne Power-Cycle): System sofort schnell

## Beobachtung

Sobald der Serial Monitor geöffnet wird:

- Reaktivität ist **sofort wieder gut**
- unabhängig vom Zeitpunkt

## Analyse

Die Ursache liegt im **Serial Logging ohne aktiven Host**.

### Problem

- Intensive Debug-Ausgaben (`Serial.printf`, etc.)
- insbesondere:
  - `[REACT]`
  - `[HTTP]`
  - `[WS]`
  - `[HMILAT]`

Wenn **kein Serial Monitor verbunden ist**:

- USB-CDC/Serial-Puffer läuft nicht ab
- `Serial.write/printf` blockiert oder verzögert
- ETH-Loop wird gebremst

→ führt zu massiver Verzögerung im gesamten System

### Warum tritt das nur beim Kaltstart auf?

Beim Boot:

- viele Logs gleichzeitig
- zusätzliche Initiallast:
  - Ethernet (W5500)
  - WebSocket
  - HMI Push
  - ggf. WebUI Zugriff

→ Logging verstärkt diese Last massiv

---

## Lösung

### Ziel

Serial Logging nur ausführen, wenn ein Monitor tatsächlich verbunden ist.

### Implementierung

Zentraler Guard:

```cpp
inline bool serialLogReady() {
    return Serial && Serial.dtr();
}

Verwendung in Debug-Logs:

if (serialLogReady()) {
    Serial.printf(...);
}
Ergebnis

Nach Einführung des Guards:

Kaltstart sofort reaktiv
kein Unterschied mehr:
mit Serial Monitor
ohne Serial Monitor
System verhält sich stabil und performant
Auswirkungen
Positiv
drastisch bessere Reaktivität beim Kaltstart
kein Einfluss mehr durch Debug-Logging
reproduzierbares Verhalten
Neutral
Debug-Logs erscheinen nur bei aktivem Monitor
Empfehlungen
1. Für Debug-Logs

Alle häufigen oder hochfrequenten Logs sollten geschützt werden:

Reactivity / Timing
HTTP / WS
HMI Push
2. Für seltene Logs

Boot-/Fehlerlogs können weiterhin direkt ausgegeben werden, sofern sie:

selten sind
keine Schleifen betreffen
3. Für zukünftige Entwicklung
Logging grundsätzlich als potenziellen Performance-Faktor betrachten
insbesondere bei:
UART/USB
Single-Thread-Systemen
hohen Log-Frequenzen
Fazit

Die reduzierte Reaktivität war kein Architekturproblem, sondern:

👉 ein klassischer Effekt von blockierendem Serial Logging ohne aktiven Empfänger.

Die zentrale Guard-Lösung behebt das Problem vollständig.