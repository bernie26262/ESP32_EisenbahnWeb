# Mega2 Pinout (Mega2560)

Quelle: `include/mega2_pins.h` (und Initialisierung in `include/Mega2PowerControl.h`, `src/Weiche.cpp`, `include/SensorKontakt.h`, `include/PulseSensor.h`, `src/Mega2I2C.cpp`).

## Hinweise

- **Kontakt-/Schaltgleise:** `INPUT_PULLUP`, **LOW = aktiv** (belegt / Puls).
- **Weichen-Spulen:** `OUTPUT`, **Impuls LOW**, idle HIGH (siehe `Weiche.cpp`).
- **Relais (meist):** low-aktiv → **LOW = EIN**, HIGH = AUS (siehe `Mega2PowerControl`).
- **Trafo-CUT-Relais:** **LOW = CUT aktiv (Power AUS)**, HIGH = freigegeben.
- **DRDY:** `OUTPUT`, idle HIGH, aktiv LOW.
- **D13 (Onboard-LED):** aktuell unbenutzt – für neue Verdrahtung möglichst meiden.

## Digitale Pins (D0–D53) – genutzte Pins

| Pin | Funktion | IN/OUT | Aktiv-Level | Pull | Gruppe | Kommentar |
|---|---|---|---|---|---|---|
| D2 | Weiche W12: Gerade-Spule | OUT | Impuls: LOW (idle HIGH) | - | Weiche |  |
| D3 | Weiche W12: Abzweig-Spule | OUT | Impuls: LOW (idle HIGH) | - | Weiche |  |
| D4 | Weiche W13: Gerade-Spule | OUT | Impuls: LOW (idle HIGH) | - | Weiche |  |
| D5 | Weiche W13: Abzweig-Spule | OUT | Impuls: LOW (idle HIGH) | - | Weiche |  |
| D6 | Weiche W14: Gerade-Spule | OUT | Impuls: LOW (idle HIGH) | - | Weiche |  |
| D7 | Weiche W14: Abzweig-Spule | OUT | Impuls: LOW (idle HIGH) | - | Weiche |  |
| D8 | Weiche W15: Gerade-Spule | OUT | Impuls: LOW (idle HIGH) | - | Weiche |  |
| D9 | Weiche W15: Abzweig-Spule | OUT | Impuls: LOW (idle HIGH) | - | Weiche |  |
| D11 | Bahnhofskontakt Block 4 B | IN | LOW = aktiv (belegt) | INPUT_PULLUP | Kontaktgleis |  |
| D12 | DATA_READY Mega2 → ESP32 | OUT | idle HIGH, aktiv LOW | - | DRDY | Push-Pull (OUTPUT) |
| D14 | Bahnhofskontakt Block 2 A | IN | LOW = aktiv (belegt) | INPUT_PULLUP | Kontaktgleis |  |
| D15 | Bahnhofskontakt Block 2 B | IN | LOW = aktiv (belegt) | INPUT_PULLUP | Kontaktgleis |  |
| D16 | Bahnhofskontakt Block 4 A | IN | LOW = aktiv (belegt) | INPUT_PULLUP | Kontaktgleis |  |
| D19 | Kontaktgleis Nothalt (Stopzone) | IN | LOW = aktiv (belegt) | INPUT_PULLUP | Kontaktgleis |  |
| D20 | I²C SDA | IN/OD | I²C | INPUT_PULLUP (defensiv) + Bus-Pullups | I2C | Wire |
| D21 | I²C SCL | IN/OD | I²C | INPUT_PULLUP (defensiv) + Bus-Pullups | I2C | Wire |
| D22 | Kontakt Block 1 | IN | LOW = aktiv (belegt) | INPUT_PULLUP | Kontaktgleis |  |
| D23 | Kontakt Block 2 | IN | LOW = aktiv (belegt) | INPUT_PULLUP | Kontaktgleis |  |
| D24 | Kontakt Block 3 | IN | LOW = aktiv (belegt) | INPUT_PULLUP | Kontaktgleis |  |
| D25 | Kontakt Block 4 | IN | LOW = aktiv (belegt) | INPUT_PULLUP | Kontaktgleis |  |
| D26 | Kontakt Block 5 | IN | LOW = aktiv (belegt) | INPUT_PULLUP | Kontaktgleis |  |
| D27 | Kontakt SBH Gleisfeld 1 | IN | LOW = aktiv (belegt) | INPUT_PULLUP | Kontaktgleis |  |
| D28 | Kontakt SBH Gleisfeld 2 | IN | LOW = aktiv (belegt) | INPUT_PULLUP | Kontaktgleis |  |
| D29 | Kontakt SBH Gleisfeld 3 | IN | LOW = aktiv (belegt) | INPUT_PULLUP | Kontaktgleis |  |
| D30 | Kontakt Block 6 | IN | LOW = aktiv (belegt) | INPUT_PULLUP | Kontaktgleis |  |
| D31 | Schaltgleis S11 (Puls) | IN | Fallende Flanke (HIGH→LOW) | INPUT_PULLUP | Schaltgleis | PulseSensor |
| D32 | Schaltgleis S12 (Puls) | IN | Fallende Flanke (HIGH→LOW) | INPUT_PULLUP | Schaltgleis | PulseSensor |
| D33 | Schaltgleis S13 (Puls) | IN | Fallende Flanke (HIGH→LOW) | INPUT_PULLUP | Schaltgleis | PulseSensor |
| D34 | Schaltgleis S14 (Puls) | IN | Fallende Flanke (HIGH→LOW) | INPUT_PULLUP | Schaltgleis | PulseSensor |
| D35 | Schaltgleis S15 (Puls) | IN | Fallende Flanke (HIGH→LOW) | INPUT_PULLUP | Schaltgleis | PulseSensor |
| D36 | Schaltgleis S16 (Puls) | IN | Fallende Flanke (HIGH→LOW) | INPUT_PULLUP | Schaltgleis | PulseSensor |
| D37 | Weiche W12: Rückmelder Abbiegen | IN | LOW = aktiv | INPUT_PULLUP | Rückmelder |  |
| D38 | Weiche W13: Rückmelder Abbiegen | IN | LOW = aktiv | INPUT_PULLUP | Rückmelder |  |
| D39 | Weiche W14: Rückmelder Abbiegen | IN | LOW = aktiv | INPUT_PULLUP | Rückmelder |  |
| D40 | Weiche W15: Rückmelder Abbiegen | IN | LOW = aktiv | INPUT_PULLUP | Rückmelder |  |
| D41 | Trafo oben CUT (Power-Freigabe) | OUT | LOW = CUT aktiv (Power AUS), HIGH = freigegeben | - | Relais | low-aktiv |
| D42 | Trafo unten CUT (Power-Freigabe) | OUT | LOW = CUT aktiv (Power AUS), HIGH = freigegeben | - | Relais | low-aktiv |
| D43 | Relais Block1 → Block2 | OUT | LOW = EIN, HIGH = AUS | - | Relais | low-aktiv |
| D44 | Relais Block2 → Block3 | OUT | LOW = EIN, HIGH = AUS | - | Relais | low-aktiv |
| D45 | Relais Block3 → Block4 | OUT | LOW = EIN, HIGH = AUS | - | Relais | low-aktiv |
| D46 | Relais Block4 → Block1 | OUT | LOW = EIN, HIGH = AUS | - | Relais | low-aktiv |
| D47 | Relais Block4 → Block5 | OUT | LOW = EIN, HIGH = AUS | - | Relais | low-aktiv |
| D48 | Relais Block5 → SBH | OUT | LOW = EIN, HIGH = AUS | - | Relais | low-aktiv |
| D49 | Relais SBH Gleis 1 → Block 6 | OUT | LOW = EIN, HIGH = AUS | - | Relais | low-aktiv |
| D50 | Relais SBH Gleis 2 → Block 6 | OUT | LOW = EIN, HIGH = AUS | - | Relais | low-aktiv |
| D51 | Relais SBH Gleis 3 → Block 6 | OUT | LOW = EIN, HIGH = AUS | - | Relais | low-aktiv |
| D52 | Relais Nothalt | OUT | LOW = EIN, HIGH = AUS | - | Relais | low-aktiv |
| D53 | Relais Block6 → Block4 | OUT | LOW = EIN, HIGH = AUS | - | Relais | low-aktiv |

## Analoge Pins (A0–A15) – genutzte Pins

| Pin | Funktion | IN/OUT | Aktiv-Level | Pull | Gruppe | Kommentar |
|---|---|---|---|---|---|---|
| A0 | ADC Strom Block1 | IN | analog | - | ADC |  |
| A1 | ADC Strom Block2 | IN | analog | - | ADC |  |
| A2 | ADC Strom Block3 | IN | analog | - | ADC |  |
| A3 | ADC Strom Block4 | IN | analog | - | ADC |  |
| A4 | ADC Strom Block5 | IN | analog | - | ADC |  |
| A5 | ADC Strom SBH Gleis 1 | IN | analog | - | ADC |  |
| A6 | ADC Strom SBH Gleis 2 | IN | analog | - | ADC |  |
| A7 | ADC Strom SBH Gleis 3 | IN | analog | - | ADC |  |
| A8 | ADC Strom Block6 | IN | analog | - | ADC |  |
| A9 | ADC Trafo-Spannung oben (ZMPT101B) | IN | analog | - | ADC |  |
| A10 | ADC Trafo-Spannung unten (ZMPT101B) | IN | analog | - | ADC |  |