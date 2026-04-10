# Mega1 – Coverage-Matrix Sensor-Polling (Definiert ↔ gelesen ↔ Export ↔ UI, Stand 2026-04-10)

Stand: basierend auf dem ZIP *Mega1.fuerPins.zip* und der aktuellen Scheduler-Logik (SensorHub/WeichenHub) im ESP-WS-State.

## A) Polling-/Update-Mechanik (Scheduler)

| Komponente | Was wird gelesen/aktualisiert? | Wo? | Frequenz | Ergebnis/State | Export/WS-State (ESP → Browser) |
|---|---|---:|---:|---|---|
| SensorHub | Schalt-/Kontakt-/Fahrstraßen-Sensoren, Einfahrt, Timerstart (digital) | `SensorHub::update()` (aus `loop()`) | ~5 ms | `trainPresent[]`, `changedMask()`, `activeMask()/riseMask()/fallMask()` | **über DIAG exportiert** |
| WeichenHub | Weichen-Rückmelder (IST) | `weichenHub.pollRueckmelders(now)` | ~20 ms | `weicheIstBits` (IST) | `mega1.diag.weicheIstBits` |
| WeichenHub | Weichen-Soll/Slow/Ansteuerung | `weichenHub.update()` (aus `loop()`) | ~5 ms | Soll/Slow/Outputs | `mega1.diag.weicheSollBits`, `mega1.diag.weicheSlowSelectedBits` |
| Fahrstraße/Bahnhof | nutzt SensorEvents | `fahrstrassen.handleSensorEvents(...)`, `bfController.update(...)` | ~10 ms (nur AUTO) | Fahrstraßen-/Bahnhof-Logik | überwiegend **indirekt**, Sensorzustände aber zusätzlich über DIAG sichtbar |
| Selftest | Ablauf & Status | (Selftest-Logik) | – | `selftestRunning`, `selftestDone`, `failMask`, `currentIdx` | `mega1.diag.selftestRunning`, `mega1.diag.selftestDone`, `mega1.diag.selftestFailMask`, `mega1.diag.selftestCurrentIdx` |

> **Wichtig (Robustheit):** Unbenutzte Sensor-Slots sind in `SENSOR_PINS[]` als `-1` markiert.  
> Damit `digitalRead(-1)` nicht zu Phantom-Änderungen führt, sollte `SensorHub::update()` Pins `<0` überspringen.

---

## B) Digitale Inputs (SensorHub): SensorIndex → Pin → Nutzung → Export/UI

### B1) Fahrstraße / Schaltgleise / Einfahrt / Timerstart

| SensorIndex | Funktion | Pin | Aktiv-Level | Wird gelesen in | Verwendung (Logik) | Export/WS-State (Browser) |
|---:|---|---:|---|---|---|---|
| S0 | Schaltgleis (Fahrstraße) | D22 | LOW=aktiv | `SensorHub::update()` | Fahrstraßen-Trigger | `mega1.diag.sensorActiveMask` / rise / fall |
| S1 | Fahrstraße | D28 | LOW=aktiv | `SensorHub::update()` | Fahrstraße | **nicht direkt exportiert** |
| S2 | **Einfahrt Bhf0/1 (shared)** | D23 | LOW=aktiv | `SensorHub::update()` | Bahnhof-Logik | **nicht direkt exportiert** |
| S3 | Fahrstraße | D33 | LOW=aktiv | `SensorHub::update()` | Fahrstraße | **nicht direkt exportiert** |
| S4 | Fahrstraße | D24 | LOW=aktiv | `SensorHub::update()` | Fahrstraße | **nicht direkt exportiert** |
| S5 | Fahrstraße | D32 | LOW=aktiv | `SensorHub::update()` | Fahrstraße | **nicht direkt exportiert** |
| S6 | Fahrstraße | D25 | LOW=aktiv | `SensorHub::update()` | Fahrstraße | **nicht direkt exportiert** |
| S7 | Fahrstraße | D31 | LOW=aktiv | `SensorHub::update()` | Fahrstraße | **nicht direkt exportiert** |
| S8 | **Einfahrt Bhf2/3 (shared)** | D27 | LOW=aktiv | `SensorHub::update()` | Bahnhof-Logik | **nicht direkt exportiert** |
| S9 | Fahrstraße | D35 | LOW=aktiv | `SensorHub::update()` | Fahrstraße | **nicht direkt exportiert** |
| S10 | Fahrstraße | D34 | LOW=aktiv | `SensorHub::update()` | Fahrstraße | `mega1.diag.sensorActiveMask` / rise / fall |
| S11–S17 | unbenutzt | -1 | – | (sollte übersprungen werden) | – | – |
| S18 | Timerstart Bhf1 / FS5 Trigger | D29 | LOW=aktiv | `SensorHub::update()` | Bahnhof-Logik + Fahrstraße FS5 | `mega1.diag.sensorActiveMask` / rise / fall |
| S19 | Timerstart Bhf0 | D26 | LOW=aktiv | `SensorHub::update()` | Bahnhof-Logik | `mega1.diag.sensorActiveMask` / rise / fall |
| S20–S21 | unbenutzt | -1 | – | (sollte übersprungen werden) | – | – |
| S22 | Timerstart Bhf2 | D30 | LOW=aktiv | `SensorHub::update()` | Bahnhof-Logik | `mega1.diag.sensorActiveMask` / rise / fall |
| S23 | Timerstart Bhf3 | D36 | LOW=aktiv | `SensorHub::update()` | Bahnhof-Logik | `mega1.diag.sensorActiveMask` / rise / fall |

**Interpretation:**  
- **Definiert:** ja (Pin-Mapping)  
- **Gelesen:** ja (SensorHub 5 ms)  
- **Export/UI:** zusätzlich direkt über die DIAG-Sensormasken sichtbar.

➡️ **Aktueller Stand:** Die reine Anzeige erfolgt bereits über
`mega1.diag.sensorActiveMask`, `mega1.diag.sensorRiseMask`, `mega1.diag.sensorFallMask`.

---

## C) Weichen-Rückmelder: Weiche → Pin → Polling → Export/UI

| Weiche | Rückmelde-Pin | Aktiv-Level | Wird gelesen in | Frequenz | Export/WS-State (Browser) |
|---:|---:|---|---|---:|---|
| W0 | D38 | LOW=aktiv | `weichenHub.pollRueckmelders()` | ~20 ms | `mega1.diag.weicheIstBits` |
| W1 | D39 | LOW=aktiv | dito | dito | `mega1.diag.weicheIstBits` |
| W2 | D40 | LOW=aktiv | dito | dito | `mega1.diag.weicheIstBits` |
| W3 | D41 | LOW=aktiv | dito | dito | `mega1.diag.weicheIstBits` |
| W4 | D42 | LOW=aktiv | dito | dito | `mega1.diag.weicheIstBits` |
| W5 | D43 | LOW=aktiv | dito | dito | `mega1.diag.weicheIstBits` |
| W6 | D44 | LOW=aktiv | dito | dito | `mega1.diag.weicheIstBits` |
| W7 | D45 | LOW=aktiv | dito | dito | `mega1.diag.weicheIstBits` |
| W8 | D46 | LOW=aktiv | dito | dito | `mega1.diag.weicheIstBits` |
| W9 | D47 | LOW=aktiv | dito | dito | `mega1.diag.weicheIstBits` |
| W10 | D48 | LOW=aktiv | dito | dito | `mega1.diag.weicheIstBits` |
| W11 | D49 | LOW=aktiv | dito | dito | `mega1.diag.weicheIstBits` |

---

## D) Weitere sinnvolle Export/WS-State Felder (bereits vorhanden)

| Thema | Export/WS-State Pfad |
|---|---|
| Mega1 online | `mega1.online` |
| Mega1 Status-Struct | `mega1.status.*` (z. B. `ver`, `size`, `node`, `flags`) |
| Mega1 WarningMask | `mega1.warningMask` |
| Mega1 DIAG komplett | `mega1.diag.*` |

