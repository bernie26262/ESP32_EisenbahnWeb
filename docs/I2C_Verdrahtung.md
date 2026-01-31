# I²C + DataReady Verdrahtungsplan (finaler Stand)

## Zielsetzung
- ESP32 (3,3 V) ist **I²C-Master**
- Mega1 und Mega2 (5 V) sind **I²C-Slaves**
- Pegelwandlung über **BSS138 Level Converter**
- Leitungslängen:
  - ESP → Level Converter: ca. 10 cm
  - Level Converter → Mega1: ca. 20 cm
  - Level Converter → Mega2: ca. 30 cm
- I²C-Takt: **100 kHz**
- Umgebung: EMV-belastet (Relais, SSR, AC-Fahrstrom)

---

## A) Systemübersicht

        (ESP-Zentrale, 3.3 V)
┌───────────────────────────────┐
│ ESP32 │
│ │
│ SDA ────────────────┐ │
│ SCL ────────────────┼───10cm─┼──► Level Converter A (I²C)
│ GND ────────────────┴────────┘
│ │
│ Data Ready (Inputs): │
│ GPIO21 ◀──── DR1 (Mega1) │
│ GPIO16 ◀──── DR2 (Mega2) │
│ GPIO2, GPIO15 (Reserve) │
└───────────────────────────────┘


---

## B) I²C Pegelwandler (Level Converter A)

**Baustein:** BSS138 Level Converter  
**Position:** möglichst nahe am ESP (3,3-V-Seite kurz halten)

### Pull-ups
- **LV-Seite (3,3 V):**
  - SDA → 3V3: **4,7 kΩ**
  - SCL → 3V3: **4,7 kΩ**
- **HV-Seite (5 V):**
  - SDA → 5V: **1,0 kΩ**
  - SCL → 5V: **1,0 kΩ**
- Zusätzlich vorhanden:
  - **10 kΩ Pull-ups („103“) auf dem Converter-Board**

**Effektiv:**
- LV ≈ 3,2 kΩ  
- HV ≈ 0,9 kΩ  
→ sehr robuste Flanken, EMV-fest

---

### Blockdarstellung

ESP32 (3.3 V) Level Converter A Mega-Seite (5 V)
┌──────────────┐ ┌─────────────────────────┐
│ SDA ─────────┼───────▶│ SDA_LV ──4k7→3V3 │
│ SCL ─────────┼───────▶│ SCL_LV ──4k7→3V3 │
│ GND ─────────┼────────▶│ GND │
└──────────────┘ │ │
│ SDA_HV ──1k→5V──┬─► Mega1 SDA
│ └─► Mega2 SDA
│ SCL_HV ──1k→5V──┬─► Mega1 SCL
│ └─► Mega2 SCL
│ GND gemeinsam │
└─────────────────────────┘


**Optional (bei starker EMV / Stern):**
- 33–47 Ω Serienwiderstände in SDA_HV und SCL_HV direkt nach dem Converter

---

## C) Leitungen zu Mega1 / Mega2

### Topologie
- Sternförmig ab Level Converter A
- Abgänge kurz (20 cm / 30 cm)

### LAN-Aderbelegung (pro Mega, empfohlen: 1 Kabel pro Mega)

**TIA-568B Farben**

| Aderpaar | Farbe            | Signal |
|--------|------------------|--------|
| Paar 1 | Weiß-Orange      | SDA    |
|        | Orange           | GND    |
| Paar 2 | Weiß-Grün        | SCL    |
|        | Grün             | GND    |
| Paar 3 | Weiß-Blau        | +5 V (optional) |
|        | Blau             | GND    |
| Paar 4 | Weiß-Braun/Braun | Reserve / GND |

**Prinzip:**  
> Jedes Signal hat sein eigenes GND-Rückleiterpaar.

---

## D) Data Ready (DR) – separater Level Converter B

- Zweiter BSS138-Level-Converter **nur für DR**
- Keine gemeinsame Nutzung mit SDA/SCL

ESP32 (3.3 V) Level Converter B Mega-Seite (5 V)
┌──────────────┐ ┌─────────────────────┐
│ GPIO21 ◀─────┼─────▶│ LV1 ── BSS138 ── HV1 ◀── DR1 (Mega1)
│ GPIO16 ◀─────┼─────▶│ LV2 ── BSS138 ── HV2 ◀── DR2 (Mega2)
│ GND ─────────┼─────▶│ GND │
└──────────────┘ └─────────────────────┘


**Hinweis:**  
Später möglich: DR direkt (ohne Level Converter) als Open-Drain (aktiv LOW) mit Pull-up am ESP.

---

## E) Schirmung (bei geschirmtem Cat-Kabel)

- **Schirm nur einseitig anschließen**
  - ESP-Zentrale → GND-Sternpunkt
- Mega-Seite: **Schirm offen lassen**
- Schirm **nicht** als Signal-GND benutzen

**Praktische Umsetzung:**
- Rohrschelle auf freigelegtem Geflecht
- kurze Litze → GND-Sammelpunkt

---

## Zusammenfassung (Final)

- I²C @ **100 kHz**
- Pull-ups:
  - LV: **4,7 kΩ**
  - HV: **1,0 kΩ**
- Level Converter nahe am ESP
- GND immer separat führen
- Schirm einseitig
- DR getrennt von I²C

**Status:**  
> Elektrisch robust, EMV-fest, dauerhaft stabil.

---