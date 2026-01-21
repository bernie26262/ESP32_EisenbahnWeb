===========================================================
I2C + DataReady Verdrahtungsplan (aktueller Stand, final)
===========================================================

Ziele:
- ESP32 (3.3V) ist I2C-Master
- Mega1 + Mega2 (5V) sind I2C-Slaves
- Pegelwandler: BSS138 Level Converter (mit 10k "103" Pullups onboard)
- Externe Pullups:
    LV (3.3V): 4k7 an SDA und SCL
    HV (5V)  : 1k0 an SDA und SCL
- I2C Takt: 100 kHz
- DataReady (DR) über zweiten Level-Converter (oder ggf. später OpenDrain direkt)

-----------------------------------------------------------
A) Blockübersicht
-----------------------------------------------------------

            (3.3V / ESP-Zentrale)                          (5V / Anlage)
┌───────────────────────────────┐                 ┌─────────────────────┐
│            ESP32              │                 │ Mega1 (I2C-Slave)    │
│                               │                 │ Mega2 (I2C-Slave)    │
│  I2C SDA  ─────┐              │                 └─────────────────────┘
│  I2C SCL  ─────┼───10cm────────────┐
│  GND      ─────┴───────────────────┴─────────────── GND gemeinsam ──────┐
│                                                                       ┌──┴──┐
│  DR Pins (Inputs):                                                   │      │
│   GPIO21  ◀──────────── DR1 (Mega1)                                  │ Mega1│
│   GPIO16  ◀──────────── DR2 (Mega2)                                  │      │
│   GPIO2   (Reserve)                                                  └──┬───┘
│   GPIO15  (Reserve)                                                     │
└───────────────────────────────┘                                         │
                                                                          │
                                                                          │
                                                                    ┌─────┴───── ┐
                                                                    │   Mega2    │
                                                                    └────────────┘


-----------------------------------------------------------
B) I2C Pegelwandler (Level Converter A) – nahe am ESP
-----------------------------------------------------------

ESP32 (3.3V)                            Level Converter A (BSS138)                  Mega-Seite (5V)
┌──────────────┐                         ┌─────────────────────────────┐
│ 3V3 ─────────┼───────────────┐         │ LV side (3.3V)              │
│ GND ─────────┼───────────────┼────────▶│ GND                         │
│ SDA ─────────┼──────┐        │         │ SDA_LV ───────────────┐     │
│ SCL ─────────┼──────┼──────┐ │         │ SCL_LV ───────────┐   │     │
└──────────────┘      │      │ │         │                   │   │     │
                      │      │ │         │ External Pullups  │   │     │
                      │      │ │         │ 4k7: SDA_LV→3V3   │   │     │
                      │      │ │         │ 4k7: SCL_LV→3V3   │   │     │
                      │      │ │         │ (Board hat 10k "103" zusätzlich)  │
                      │      │ │         │                             │     │
                      │      │ │         │ HV side (5V)                │     │
                      │      │ │         │ SDA_HV ──┬───[1k]──→ +5V     │     │
                      │      │ │         │          │                  │     │
                      │      │ │         │          ├───(Abgang)──► Mega1 SDA │
                      │      │ │         │          │                  │     │
                      │      │ │         │          └───(Abgang)──► Mega2 SDA │
                      │      │ │         │ SCL_HV ──┬───[1k]──→ +5V     │     │
                      │      │ │         │          │                  │     │
                      │      │ │         │          ├───(Abgang)──► Mega1 SCL │
                      │      │ │         │          │                  │     │
                      │      │ │         │          └───(Abgang)──► Mega2 SCL │
                      │      │ │         │ (Board hat 10k "103" zusätzlich)  │
                      │      │ │         │                             │     │
                      │      │ │         │ GND (gemeinsam)              │     │
                      │      │ │         └─────────────────────────────┘
                      │      │ │
                      │      │ └──── 10 cm (ESP ↔ Converter)
                      │      │
                      │      └──── I2C Leitungen
                      │
                      └──── GND / 3V3 Versorgung zum Converter (kurz)

Optional (nur falls nötig, bei EMV/Stern):
  - 33–47Ω Serienwiderstände direkt nach SDA_HV/SCL_HV VOR der Aufteilung zu Mega1/Mega2
    (dämpft Ringing/Reflexionen)

-----------------------------------------------------------
C) Leitungen zu Mega1 / Mega2 (Abgänge ab Level Converter A)
-----------------------------------------------------------

Abgang zu Mega1: ca. 20 cm
Abgang zu Mega2: ca. 30 cm

Empfehlung: verdrillt / Cat-Kabel-Paare mit GND

Pro Mega-Abgang (TIA-568B Farben):
  Paar Orange:   Weiß-Orange = SDA,  Orange = GND
  Paar Grün:     Weiß-Grün   = SCL,  Grün   = GND
  (optional) Paar Blau: Weiß-Blau = +5V, Blau = GND
  Paar Braun: Reserve / zusätzlicher GND

-----------------------------------------------------------
D) DataReady (DR) über Level Converter B (separat)
-----------------------------------------------------------

            Level Converter B (BSS138, getrennt von I2C!)
ESP32 (3.3V)                     ┌─────────────────────────────┐        Mega1/Mega2 (5V)
┌──────────────┐                 │ LV side (3.3V)              │
│ GND ─────────┼────────────────▶│ GND                         │
│ GPIO21 ◀─────┼────────────────▶│ LV1  ──── BSS138 ──── HV1 ◀──┼── DR1 von Mega1
│ GPIO16 ◀─────┼────────────────▶│ LV2  ──── BSS138 ──── HV2 ◀──┼── DR2 von Mega2
│ GPIO2  (res) │                 │ LV3  (frei)                  │
│ GPIO15 (res) │                 │ LV4  (frei)                  │
└──────────────┘                 └─────────────────────────────┘

Hinweis:
- DR ist "1 Bit Status". Später wäre auch möglich: DR direkt (ohne Converter) als Open-Drain (aktiv LOW)
  + Pullup am ESP nach 3.3V. Aber dein aktuelles Setup mit Converter B ist ok.

-----------------------------------------------------------
E) Schirmung (falls geschirmtes Cat-Kabel)
-----------------------------------------------------------

- Schirm nur EINSEITIG an der ESP-Zentrale auf GND (z.B. Rohrschelle + kurze Litze zum GND-Sternpunkt)
- Am Mega-Ende Schirm offen lassen (nicht auf GND legen)
- Signal-GND wird immer über eigene Adern geführt (nicht über Schirm)

===========================================================
END
===========================================================
