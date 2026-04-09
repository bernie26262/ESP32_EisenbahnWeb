# Mega1 Fahrstraßen – Stand 2026-04 (aktualisiert)

Dieses Dokument beschreibt die aktuell implementierten Fahrstraßen auf Mega1.
Stand nach finaler Abstimmung und Tests an der Anlage.

---

## Übersicht

| FS  | Trigger | Reset      | Besonderheit                    |
|-----|--------|-----------|---------------------------------|
| FS0 | S0     | S3, S6    | W8 alternierend (1./≥2)         |
| FS1 | S2     | S6        | Odd/Even Logik                  |
| FS2 | S4     | –         | feste Schaltung + W8 gerade     |
| FS3 | S7     | –         | feste Schaltung erweitert       |
| FS4 | S8     | S10       | W9 bei 1./3. Überfahrt          |

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
- W8 → **Gerade**  ← **NEU ergänzt**

---

## FS3 – Folgefahrt ab S7

- **Trigger:** S7  
- **Reset:** keiner  

### Verhalten

Bei jeder Überfahrt:
- W2 → **Abbiegen**
- W3 → **Gerade**
- W6 → **Abbiegen**  ← **NEU ergänzt**
- W7 → **Abbiegen**  ← **NEU ergänzt**

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

## Technische Hinweise

### Zählerlogik
- erste Überfahrt → `count = 1`
- Reset → `count = 0`
- Standardlogik:
count >= minCount

- Ausnahme:
- **FS1 verwendet explizite Odd/Even-Logik**

---

### Weichenansteuerung
- erfolgt über:

WeichenHub.enqueueWeiche(index, gerade)

- Verarbeitung sequenziell über Pulssteuerung

---

### Reduktionslogik (wichtig)

- Standard:
- **Abbiegen → Reduktion aktiv**
- **Gerade → Reduktion aus**

- **Sonderfall W6 (Sicherheitsanforderung):**
- Reduktion ist **immer aktiv**, unabhängig von Stellung

---

## Testhinweise

- Fahrstraßen einzeln testen (isoliert)
- Sensor-Trigger mit `diag.htm` vergleichen
- Log beobachten:
- `[FS] trigger`
- `[FS] apply`

### Kritische Tests

- FS1 Odd/Even sauber alternierend?
- FS4 Zählverhalten (1 vs. 3)?
- Mehrfachüberfahrten schnell hintereinander (Debounce!)

---

## Bekannte Besonderheiten

- Sensor-Debounce beeinflusst Trigger-Zählung
- `changedMask` muss korrekt verarbeitet werden (kein Event-Verlust)
- Odd/Even-Logik ist bewusst als Sonderfall implementiert

---

## Stand

- Fahrstraßen FS0–FS4 vollständig implementiert
- Verhalten an Anlage validiert
- Letzte Änderungen:
- FS1 Odd/Even eingeführt
- FS2 um W8 ergänzt
- FS3 erweitert (W6/W7)
- Reduktionslogik W6 sicherheitsfix