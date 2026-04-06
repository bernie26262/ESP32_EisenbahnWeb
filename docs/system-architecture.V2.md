# System Architecture – Modelleisenbahn Steuerung

Stand: 2026-04-03

---

# 1. Gesamtüberblick

Das System besteht aus vier Hauptkomponenten:

    WebUI (Browser)
           │
     WebSocket (ETH)
           │
    ┌───────────────┐
    │   ETH-ESP32   │  ← Zentrale Instanz
    │ (Webserver)   │
    └──────┬────────┘
           │
 ┌─────────┴─────────┐
 │                   │

I²C + DRDY UART
│                    │
┌──────────┐ ┌────────────┐
│ Mega1    │ │ HMI        │
│ (Bahnhof │ │ Touch UI   │
│ + Weichen) │ (ESP32-S3) │
└──────────┘ └────────────┘
│
┌──────────┐
│ Mega2    │
│ (SBHF +  │
│ Safety + │
│ Analog)  │
└──────────┘

---

# 2. Rollen der Komponenten

## 2.1 ETH (ESP32-S3 ETH)

Zentrale Steuerinstanz:

- Webserver (WebUI)
- WebSocket-State-Verteilung
- Kommunikation:
  - I²C → Mega1 + Mega2
  - UART → HMI
- Aggregiert Systemzustand
- Führt **Push-Logik (state-lite)** aus

👉 ETH ist die **Single Source of Truth für UI**

---

## 2.2 Mega1

Zuständig für:

- Bahnhöfe (BHF0–BHF3)
- Weichen (W0–W11)
- Rückmelder

Eigenschaften:

- kennt lokalen Zustand
- liefert Daten an ETH via I²C
- reagiert auf Steuerbefehle

---

## 2.3 Mega2

Kritische Instanz:

- Schattenbahnhof (SBHF)
- Blocksteuerung
- Safety-Logik
- Strom-/Spannungsmessung

⚠️ Wichtig:

> **Nur Mega2 darf Not-Aus auslösen**

Designentscheidung:

- sicherheitskritische Logik **zentralisiert**
- verhindert Inkonsistenzen

---

## 2.4 HMI (ESP32-S3 Display)

- Visualisierung
- Bedienung
- keine eigene Logik

Eigenschaften:

- bekommt Zustand vom ETH
- sendet nur Aktionen
- arbeitet mit **state-lite + merge**

---

# 3. Kommunikationskanäle

## 3.1 ETH ↔ Mega (I²C + DRDY)

### Prinzip

- ETH = Master
- Mega1/Mega2 = Slave
- DRDY signalisiert:
  → „neue Daten verfügbar“

### DRDY-Mechanik

- LOW → Daten bereit
- HIGH → idle

Open-Drain simuliert:

- LOW → OUTPUT LOW
- HIGH → INPUT (Pull-up)

👉 Vorteil:
- keine Polling-Last
- schnelle Reaktion

---

## 3.2 ETH ↔ HMI (UART)

### Eigenschaften

- framed JSON
- robust gegen Fehler
- bidirektional

### Datenfluss

ETH → HMI:
- state-lite (on-change + periodic)
- analog (zyklisch)

HMI → ETH:
- actions

---

## 3.3 ETH ↔ WebUI (WebSocket)

- vollständiger Zustand
- höhere Datenmenge
- Diagnose + Bedienung

---

# 4. Datenmodell

## 4.1 state-lite (HMI)

Minimaler Zustand:

- ETH Status
- Mega1/Mega2 Status
- Startup
- Safety
- Warning
- WS Clients

👉 Ziel:
- klein
- deterministisch
- schnell

---

## 4.2 analog

- Spannungen (Vrms * 10)
- Ströme (mA)

👉 getrennt, um UI zu entlasten

---

## 4.3 action

Vom HMI:

- powerOn / powerOff
- setAuto / setManual
- startupAck
- retry

---

# 5. Update-Strategie (ETH → UI)

## Kombination aus:

### On-Change Push
- bei Änderungen
- Hash-basiert
- verhindert Duplikate

### Periodic Push (~1s)
- „Ground Truth“
- korrigiert Drift

---

# 6. UI-Logik (HMI)

## Grundprinzip

- kein vollständiger Zustand pro Frame
- sondern:
  → **Merge-Modell**

### Vorteil

- keine Flicker
- kein Reset
- stabile Anzeige

---

## Overlay-System

Anzeige bei:

- Startup nicht fertig
- Safety aktiv
- Ack erforderlich

### Wichtig

- Buttons immer sichtbar
- nur enabled/disabled

---

# 7. Safety-Konzept

Zentrale Regeln:

- Power ist **nach Boot AUS**
- ACK schaltet **nicht automatisch Power ein**
- Mega2 entscheidet über:
  - Not-Aus
  - Freigaben

---

## Safety-Felder

- lock
- ackRequired
- notausActive
- powerOn

---

# 8. Blocksteuerung (Mega2)

- Belegung (occMask)
- Freigaben (grantMask)

### Mapping wichtig

UI ≠ Bitreihenfolge

→ zentrale Mapping-Funktionen:

- `hmiBlockOccDisplayBitToMaskBit`
- `hmiGrantDisplayBitToMaskBit`

---

# 9. Analogsystem

## Sampling

- deterministischer Scheduler
- 1 kHz intern

## RMS

- echtes RMS
- Fenster ~200 ms

## Ausgabe

- Integer (kein Float)
- stabil und effizient

---

# 10. Wichtige Designentscheidungen

## Keine Floats im Protokoll
→ kleinere Payloads

## Merge statt Replace
→ stabile UI

## Entkopplung analog/state
→ weniger Lag

## Safety zentral in Mega2
→ deterministisch

---

# 11. Typische Fehler & Ursachen

## UI reagiert träge

→ Ursache:
- zu viele Updates
- fehlendes Rate-Limit

---

## jsonErr hoch

→ Ursache:
- UART-Störungen
- schlechte Verkabelung

---

## Falscher Status im HMI

→ Ursache:
- kein Merge
- unvollständige Frames

---

## Keine Kommunikation HMI

→ Ursache:
- falscher UART-Schalter

---

# 12. Dinge, die man garantiert vergisst ⚠️

👉 Wichtigste Praxispunkte:

- HMI:
  - Upload = UART1
  - Betrieb = UART2

- UART:
  - TX/RX als twisted pair
  - GND verbinden
  - kein 3.3V

- state-lite:
  - ist **kein Full State**
  - muss gemerged werden

- ETH:
  - ist zentrale Instanz
  - nicht Mega1/Mega2

- Safety:
  - kommt von Mega2
  - nicht vom UI

---

# 13. Aktueller Systemstatus

- UI modularisiert
- state-lite stabil
- analog entkoppelt
- Overlay korrekt
- Performance akzeptabel

---

# 14. Nächste Schritte (optional)

- HMI: Anzeige „kein Schreibrecht“
- UI-Feinschliff
- Debug-Level steuerbar
- evtl. CRC im UART

---

# Fazit

Das System ist:

- modular
- robust
- fehlertolerant
- klar strukturiert

Und vor allem:

👉 **gut wartbar — wenn man diese Doku hat 😄**     