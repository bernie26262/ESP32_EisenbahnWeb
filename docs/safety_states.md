# Safety-Zustände & UI-Abbildung

Diese Datei beschreibt alle möglichen Safety-Zustände
und deren Bedeutung für Anzeige und Bedienung.

---

## SafetyBlockReason (logisch)

| Wert | Name | Bedeutung |
|----|----|----|
| 0 | NONE | Kein Safety-Block, Normalbetrieb |
| 1 | BOOT | Systemstart, Quittierung erforderlich |
| 2 | EMERGENCY | Not-Aus aktiv |

---

## Flags (Mega2 → ESP)

| Flag | Bedeutung |
|----|----|
| SYS_NOTAUS_ACTIVE | Not-Aus aktiv |
| SYS_ERROR_PRESENT | Safety-Fehler vorhanden |
| SYS_POWER_ON | Leistung eingeschaltet |
| SYS_CONTROLLER_RESET | Controller-Reset / Boot |

---

## Ableitung im ESP (SystemRuntimeState)

Priorität (wichtig!):

1. `SYS_CONTROLLER_RESET` → **BOOT**
2. `SYS_NOTAUS_ACTIVE` → **EMERGENCY**
3. `SYS_ERROR_PRESENT` → **ERROR_PRESENT**
4. `flags == 0` → **NONE**

---

## UI-Verhalten

| Zustand | Overlay | ACK | PowerOn | Text |
|------|------|----|--------|-----|
| BOOT | ja | ja | nein | „Systemstart – Quittierung erforderlich“ |
| NOTAUS | ja | ja | nein | „NOT-AUS – Anlage gestoppt“ |
| ERROR | ja | ja | nein | Fehlertext |
| OK | nein | nein | ja | „System OK“ |

---

## Wichtig

- **ACK hebt keinen Not-Aus auf**, sondern nur die Sperre
- **PowerOn ist nur möglich**, wenn `blockReason == NONE`
- UI darf Zustände **nicht erraten**, sondern nur anzeigen
