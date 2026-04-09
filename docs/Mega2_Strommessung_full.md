# Strommessung -- Systemdokumentation (Vollversion)

## Überblick

Strommessung dient zur: - Belegung - Diagnose - Lastüberwachung

## Architektur

Sensoren: - Trafo oben/unten - Block 1--6 - SBHF 1--3

## Prinzip

AC + Bias → ADC → RMS

## SensorStrom

Funktionen: begin(), update(), getMilliAmp(), setThreshold_mA()

## ADC Scheduler

Multiplexing aller Kanäle

## Fix SBHF

Problem: SBHF nicht im Scheduler → 0 mA

Lösung: PIN_ADC_SBH_GL1/2/3 hinzufügen

## Datenfluss

ADC → ISR → Queue → Sensor → Block

## Besonderheiten

-   Trafo AUS → kein Strom
-   MUX-Effekte
-   begrenzte Samplingrate

## Genauigkeit

\~1--2%

## Ziel

robuste Belegung auch ohne Kontakt
