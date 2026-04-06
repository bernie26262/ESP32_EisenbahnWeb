# Mega1 Fahrstraßen – Stand 2026-04

Dieses Dokument beschreibt die aktuell implementierten Fahrstraßen auf Mega1.
Es dient als Referenz für Entwicklung, Debugging und Tests an der Anlage.

---

## Übersicht

| FS  | Trigger | Reset      | Besonderheit            |
|-----|--------|-----------|--------------------------|
| FS0 | S0     | S3, S6    | W8 alternierend (1./≥2) |
| FS1 | S2     | S6        | Odd/Even Logik          |
| FS2 | S4     | –         | feste Schaltung         |
| FS3 | S7     | –         | feste Schaltung         |
| FS4 | S8     | S10       | W9 bei 1./3. Überfahrt  |

---

## FS0 – Zufahrt West / W8 alternierend

- **Trigger:** S0  
- **Reset:** S3, S6  

### Verhalten

Bei jeder Überfahrt:
- W2 → **Gerade**
- W3 → **Abbiegen**

Zusätzlich:
- 1. Überfahrt:  
  - W8 → **Abbiegen**
- 2. und weitere Überfahrten:  
  - W8 → **Gerade**

---

## FS1 – Folgefahrt ab S2 (Odd/Even)

- **Trigger:** S2  
- **Reset:** S6  

### Verhalten

**Ungerade Anzahl Überfahrten (1, 3, 5, …):**
- W1 → **Abbiegen**
- W2 → **Gerade**
- W3 → **Gerade**
- W5 → **Abbiegen**
- W6 → **Gerade**
- W7 → **Gerade**
- W8 → **Gerade**

**Gerade Anzahl Überfahrten (2, 4, 6, …):**
- W5 → **Gerade**

---

## FS2 – Folgefahrt ab S4

- **Trigger:** S4  
- **Reset:** keiner  

### Verhalten

Bei jeder Überfahrt:
- W1 → **Abbiegen**
- W7 → **Gerade**
- W8 → **Gerade**

---

## FS3 – Folgefahrt ab S7

- **Trigger:** S7  
- **Reset:** keiner  

### Verhalten

Bei jeder Überfahrt:
- W2 → **Abbiegen**
- W3 → **Gerade**
- W6 → **Abbiegen**
- W7 → **Abbiegen**

---

## FS4 – Bahnhof Ost / W9 alternierend

- **Trigger:** S8  
- **Reset:** S10  

### Verhalten

- 1. Überfahrt:
  - W9 → **Gerade**
- 2. Überfahrt:
  - keine Änderung
- 3. Überfahrt:
  - W9 → **Abbiegen**
- ab 4.:
  - bleibt auf letzter Stellung (Abbiegen)

---

## Hinweise zur Implementierung

- Zähler (`count`) startet bei **1 für erste Überfahrt**
- Logik basiert auf:
  - `count >= minCount` (Standard-Fahrstraßen)
  - Sonderlogik bei FS1 (Odd/Even)
- Reset setzt Zähler auf **0**
- Weichen werden über `WeichenHub.enqueueWeiche()` gesetzt

---

## Testhinweise

- Jede Fahrstraße einzeln testen (isoliert)
- Zählerverhalten beobachten (insb. FS1, FS4)
- Sensor-Trigger mit `diag.htm` gegenprüfen
- Log-Ausgaben:
  - `[FS] trigger`
  - `[FS] apply`

---

## Bekannte Besonderheiten

- Sensor-Debounce beeinflusst Trigger-Zählung
- `changedMask` muss korrekt verarbeitet werden (kein Verlust von Events)
- Odd/Even-Logik (FS1) ist bewusst als Sonderfall implementiert

---

## Stand

- Alle Fahrstraßen funktional implementiert
- Anpassungen:
  - FS1 Odd/Even ergänzt
  - FS2 um W8 erweitert
  - FS3 um W6/W7 ergänzt
  - FS4 bestätigt korrekt
