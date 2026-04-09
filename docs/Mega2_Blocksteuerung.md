# Blocksteuerung -- Systemdokumentation

## Überblick

Die Blocksteuerung läuft auf Mega2 und übernimmt Belegung, Freigaben und
Sicherheitslogik.

## Belegung

occupied = contactActive OR currentAboveThreshold

## Freeze

Nach Trafo EIN wird für 2000 ms keine neue Grant-Berechnung
durchgeführt.
