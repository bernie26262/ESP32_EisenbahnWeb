# HMI Kommunikationsprotokoll (ETH ↔ HMI)

Stand: 2026-04-03  
Projekt: Modelleisenbahn Steuerung

---

# 1. Überblick

Die Kommunikation zwischen ETH-Controller (ESP32-S3 ETH) und HMI erfolgt über UART.

Eigenschaften:

- framing-basiert (binär + JSON)
- robust gegen Teilframes
- zwei Datenkanäle logisch getrennt:
  - **state-lite** → Systemzustand
  - **analog** → Messwerte

---

# 2. Frame-Format

Jede Nachricht hat folgendes Format:

| Feld | Größe | Beschreibung |
|------|------|-------------|
| Header | 2 Byte | `0xA5 0x5A` |
| Length | 2 Byte | Länge des JSON-Payloads |
| Payload | n Byte | JSON |

---

## Beispiel (konzeptionell)


[A5 5A] [len_hi len_lo] { JSON }


---

## Parser-Verhalten (HMI)

- wartet auf Header
- liest Länge
- sammelt Payload
- verarbeitet nur **komplette Frames**

### Wichtige Eigenschaften

- Teilframes werden **nicht verworfen**
- Timeout-Handling:
  - Header-Timeout
  - Payload-Timeout
- Fehler führen **nicht zu Reset des Zustands**

---

# 3. Nachrichtentypen

## Übersicht

| Typ | Richtung | Beschreibung |
|-----|--------|-------------|
| `state-lite` | ETH → HMI | kompakter Systemzustand |
| `analog` | ETH → HMI | Messwerte |
| `action` | HMI → ETH | Benutzeraktionen |

---

# 4. state-lite

## Ziel

- vollständiger UI-Zustand
- klein, deterministisch
- kein unnötiger Ballast

---

## Beispielstruktur

```json
{
  "type": "state-lite",
  "eth": {
    "connected": true,
    "ip": "192.168.1.100"
  },
  "mega1": {
    "online": true,
    "modeAuto": true
  },
  "mega2": {
    "online": true
  },
  "startup": {
    "ready": true,
    "m1SelftestDone": true,
    "m2SelftestDone": true
  },
  "safety": {
    "lock": false,
    "ackRequired": false,
    "notausActive": false,
    "powerOn": true
  },
  "summary": {
    "warningPresent": false
  },
  "wsClients": {
    "count": 1
  }
}
Semantik
ETH
connected → Ethernet aktiv
ip → Anzeige im UI
Mega1
online
modeAuto (Auto / Manuell)
Mega2
online
Startup
steuert Overlay
ready → System freigegeben
Safety
lock → gesperrt
ackRequired → Quittierung notwendig
notausActive → Not-Aus aktiv
powerOn → Anlage eingeschaltet
Summary
warningPresent → globaler Warnstatus
Wichtig: Merge-Logik im HMI
JSON wird nicht als Vollzustand interpretiert
sondern:
merge in bestehenden Zustand

→ verhindert:

falsche Defaults
Flackern
„Offline“-Artefakte
5. analog
Ziel
entkoppelte Übertragung
konstante Rate (~500 ms)
keine UI-Drosselung
Beispiel
{
  "type": "analog",
  "vA10": 145,
  "vB10": 138,
  "currents": [120, 0, 35, ...]
}
Semantik
vA10, vB10
Spannung * 10 (Integer)
Beispiel:
145 → 14.5 V
currents
mA (Integer)
Designentscheidung

Warum getrennt?

analog ändert sich ständig
state-lite nur bei Änderungen

→ reduziert:

UART-Last
UI-Lag
6. Aktionen (HMI → ETH)
Format
{
  "type": "action",
  "action": "powerOn"
}
Typische Aktionen
Action	Bedeutung
powerOn	Anlage einschalten
powerOff	Anlage ausschalten
setAuto	Auto-Modus
setManual	Manuell
startupAck	Quittieren
retryM1	Mega1 Selbsttest
retryM2	Mega2 Selbsttest
Verhalten ETH
validiert Aktion
leitet weiter an:
Mega1
Mega2
Safety-Logik
7. Update-Strategie ETH → HMI
Kombination aus:
1. On-Change Push
bei Zustandsänderung
mit Hash-Vergleich
gleiche Payload wird verworfen
2. Periodic Push (~1s)
„Ground Truth“
verhindert Drift
Debug-Logs (Beispiele)
[HMIPUSH] DIRTY skip same-hash
[HMIPUSH] PERIODIC try ok=1
8. Fehlerbehandlung
UART-Ebene
Frame-Timeouts
Length-Checks
Overflow-Zähler
JSON-Ebene
parse errors → gezählt
Frame wird verworfen
Zustand bleibt erhalten
9. Typische Probleme
Viele jsonErr

→ Ursachen:

Störungen auf UART
schlechte Verkabelung
Verzögerte UI

→ Ursachen:

zu viele state pushes
fehlendes Rate-Limit
Flicker

→ Ursache:

fehlende Merge-Logik
10. Designprinzipien
Deterministisch
fehlertolerant
entkoppelt
kein Float im Protokoll
kleine Payloads
11. Erweiterungen (optional)
CRC im Frame
Versionierung im JSON
Debug-Level steuerbar
Kompression (falls nötig)
12. Fazit

Das Protokoll ist:

stabil
effizient
robust gegen Störungen
optimal für Embedded + UI