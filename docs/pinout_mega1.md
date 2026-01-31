# Mega1 Pinout (Arduino Mega2560)
Stand: **geplant nach Konfliktfix** (Timerstart-Sensoren von A8–A11 auf D26/D29/D30/D36 umgezogen) und **D13 freigemacht** (W3 A -> D7).
**Konventionen:** Sensoren sind i.d.R. `INPUT_PULLUP` → **LOW = aktiv**. Weichen-/Relais-Ausgänge sind i.d.R. **idle HIGH** (Schaltimpuls aktiv LOW).
## Digitale Pins (D0–D53)
| Pin | Funktion | IN/OUT | Aktiv | Pull | Gruppe | Kommentar |
|---:|---|:---:|---|---|---|---|
| D2 | Weiche W7: G (Gerade) | OUT | idle HIGH / Puls LOW | – | Weiche | – |
| D3 | Weiche W7: A (Abzweig) | OUT | idle HIGH / Puls LOW | – | Weiche | – |
| D5 | Weiche W0: G | OUT | idle HIGH / Puls LOW | – | Weiche | – |
| D6 | Weiche W0: A | OUT | idle HIGH / Puls LOW | – | Weiche | – |
| D7 | Weiche W3: A (Abzweig) | OUT | idle HIGH / Puls LOW | – | Weiche | **NEU** (vorher D13) |
| D8 | Weiche W1: G | OUT | idle HIGH / Puls LOW | – | Weiche | – |
| D9 | Weiche W1: A | OUT | idle HIGH / Puls LOW | – | Weiche | – |
| D10 | Weiche W2: G | OUT | idle HIGH / Puls LOW | – | Weiche | – |
| D11 | Weiche W2: A | OUT | idle HIGH / Puls LOW | – | Weiche | – |
| D12 | Weiche W3: G | OUT | idle HIGH / Puls LOW | – | Weiche | – |
| D14 | Weiche W4: G | OUT | idle HIGH / Puls LOW | – | Weiche | – |
| D15 | Weiche W4: A | OUT | idle HIGH / Puls LOW | – | Weiche | – |
| D16 | Weiche W5: G | OUT | idle HIGH / Puls LOW | – | Weiche | – |
| D17 | Weiche W5: A | OUT | idle HIGH / Puls LOW | – | Weiche | – |
| D18 | Weiche W6: G | OUT | idle HIGH / Puls LOW | – | Weiche | – |
| D19 | Weiche W6: A | OUT | idle HIGH / Puls LOW | – | Weiche | – |
| D20 | I²C SDA | I/O (OD) | I²C | Pullup extern | Bus | wird defensiv als INPUT_PULLUP gesetzt (Bus release) |
| D21 | I²C SCL | I/O (OD) | I²C | Pullup extern | Bus | dito |
| D22 | Sensor S0 Fahrstraße (Schaltgleis) | IN | LOW=aktiv | PULLUP | Sensor | – |
| D23 | Sensor S2 Einfahrt Bhf0/1 (shared) | IN | LOW=aktiv | PULLUP | Sensor | – |
| D24 | Sensor S4 Fahrstraße | IN | LOW=aktiv | PULLUP | Sensor | – |
| D25 | Sensor S6 Fahrstraße | IN | LOW=aktiv | PULLUP | Sensor | – |
| D26 | Sensor S19 Timerstart Bhf0 | IN | LOW=aktiv | PULLUP | Sensor | **NEU** (vorher A8) |
| D27 | Sensor S8 Einfahrt Bhf2/3 (shared) | IN | LOW=aktiv | PULLUP | Sensor | – |
| D28 | Sensor S1 Fahrstraße | IN | LOW=aktiv | PULLUP | Sensor | – |
| D29 | Sensor S18 Timerstart Bhf1 | IN | LOW=aktiv | PULLUP | Sensor | **NEU** (vorher A9) |
| D30 | Sensor S22 Timerstart Bhf2 | IN | LOW=aktiv | PULLUP | Sensor | **NEU** (vorher A10) |
| D31 | Sensor S7 Fahrstraße | IN | LOW=aktiv | PULLUP | Sensor | – |
| D32 | Sensor S5 Fahrstraße | IN | LOW=aktiv | PULLUP | Sensor | – |
| D33 | Sensor S3 Fahrstraße | IN | LOW=aktiv | PULLUP | Sensor | – |
| D34 | Sensor S10 Fahrstraße | IN | LOW=aktiv | PULLUP | Sensor | – |
| D35 | Sensor S9 Fahrstraße | IN | LOW=aktiv | PULLUP | Sensor | – |
| D36 | Sensor S23 Timerstart Bhf3 | IN | LOW=aktiv | PULLUP | Sensor | **NEU** (vorher A11) |
| D38 | Weiche W0: Rückmeldekontakt | IN | LOW=aktiv | PULLUP | Rückmelder | – |
| D39 | Weiche W1: Rückmeldekontakt | IN | LOW=aktiv | PULLUP | Rückmelder | – |
| D40 | Weiche W2: Rückmeldekontakt | IN | LOW=aktiv | PULLUP | Rückmelder | – |
| D41 | Weiche W3: Rückmeldekontakt | IN | LOW=aktiv | PULLUP | Rückmelder | – |
| D42 | Weiche W4: Rückmeldekontakt | IN | LOW=aktiv | PULLUP | Rückmelder | – |
| D43 | Weiche W5: Rückmeldekontakt | IN | LOW=aktiv | PULLUP | Rückmelder | – |
| D44 | Weiche W6: Rückmeldekontakt | IN | LOW=aktiv | PULLUP | Rückmelder | – |
| D45 | Weiche W7: Rückmeldekontakt | IN | LOW=aktiv | PULLUP | Rückmelder | – |
| D46 | Weiche W8: Rückmeldekontakt | IN | LOW=aktiv | PULLUP | Rückmelder | – |
| D47 | Weiche W9: Rückmeldekontakt | IN | LOW=aktiv | PULLUP | Rückmelder | – |
| D48 | Weiche W10: Rückmeldekontakt | IN | LOW=aktiv | PULLUP | Rückmelder | – |
| D49 | Weiche W11: Rückmeldekontakt | IN | LOW=aktiv | PULLUP | Rückmelder | – |
| D50 | Reduktions-Relais (shared) für W10/W11 | OUT | HIGH=Reduktion AUS | – | Relais | gemeinsam für W10+W11 |
| D51 | DATA_READY (DRDY) -> ESP | OUT (open-drain) | LOW=trigger / idle Hi-Z | Pullup extern | Bus | Init: OUTPUT LOW, danach INPUT (Hi-Z) als idle HIGH |

## Analoge Pins (A0–A15)
| Pin | Funktion | IN/OUT | Aktiv | Pull | Gruppe | Kommentar |
|---:|---|:---:|---|---|---|---|
| A0 | Weiche W8: G (Gerade) | OUT | idle HIGH / Puls LOW | – | Weiche | wird zusätzlich bei Boot für randomSeed(analogRead(A0)) gelesen |
| A1 | Weiche W8: A (Abzweig) | OUT | idle HIGH / Puls LOW | – | Weiche |  |
| A2 | Weiche W9: G | OUT | idle HIGH / Puls LOW | – | Weiche |  |
| A3 | Weiche W9: A | OUT | idle HIGH / Puls LOW | – | Weiche |  |
| A4 | Weiche W10: G | OUT | idle HIGH / Puls LOW | – | Weiche |  |
| A5 | Weiche W10: A | OUT | idle HIGH / Puls LOW | – | Weiche |  |
| A6 | Weiche W11: G | OUT | idle HIGH / Puls LOW | – | Weiche |  |
| A7 | Weiche W11: A | OUT | idle HIGH / Puls LOW | – | Weiche |  |
| A8 | Bhf0 TrackPower Relais | OUT | HIGH=Strom AN, LOW=aus | – | Power | frei von Timerstart-Konflikt (Timerstart -> D26) |
| A9 | Bhf1 TrackPower Relais | OUT | HIGH=Strom AN, LOW=aus | – | Power | Timerstart -> D29 |
| A10 | Bhf2 TrackPower Relais | OUT | HIGH=Strom AN, LOW=aus | – | Power | Timerstart -> D30 |
| A11 | Bhf3 TrackPower Relais | OUT | HIGH=Strom AN, LOW=aus | – | Power | Timerstart -> D36 |
| A12 | Weiche W6: Reduktions-Pin | OUT | HIGH=Reduktion AUS | – | Weiche |  |
| A13 | Weiche W7: Reduktions-Pin | OUT | HIGH=Reduktion AUS | – | Weiche |  |
| A14 | Weiche W8: Reduktions-Pin | OUT | HIGH=Reduktion AUS | – | Weiche |  |
| A15 | Weiche W9: Reduktions-Pin | OUT | HIGH=Reduktion AUS | – | Weiche |  |

## Hinweise
- **D13 meiden**: Onboard-LED. In diesem Stand ist D13 **frei** (W3 A wurde auf D7 gelegt).
- **Timerstart-Konflikt gelöst**: Timerstart-Sensoren S18/S19/S22/S23 liegen nicht mehr auf A8–A11, damit A8–A11 ausschließlich TrackPower-Relais sind.
- **Sensoren**: werden im Code als `INPUT_PULLUP` initialisiert → **aktiv bei LOW**.
- **DRDY (D51)**: open-drain Betrieb (Pullup extern auf ESP-Seite erforderlich).
