# Blocksteuerung -- Systemdokumentation (Vollversion)

## Überblick

Die Blocksteuerung läuft vollständig auf Mega2 und übernimmt: -
Belegungserkennung - Freigabelogik (Grant) - Sicherheitsregeln -
Speziallogik Block 4 - Integration SBHF

## Blockstruktur

Blöcke 1--6: Strecke\
Blöcke 7--9: SBHF

## Belegung

occupied = contactActive OR currentAboveThreshold

### Kontaktgleis

-   digital, active LOW
-   sofort

### Strom

-   RMS-basiert
-   kontinuierlich

## Blocklogik

isOccupied() isReallyFree(now)

Freigabeverzögerung \~2.5 s

## Grant-Logik

canEnter(from, to)

## Spezialfall Block 4

-   3→4 abhängig von Block 6 + Lastverteilung
-   6→4 abhängig von Block 1--3
-   Priorität: Block 6

## Relais

updateBlockGrantRelays()

## Freeze (Trafo EIN)

Trigger: - Trafo von 0V → \>4V - Kontakt belegt

Wirkung: - keine neuen Grants - Relais bleiben stabil - Belegung läuft
weiter

Variable: m_grantFreezeUntilMs

Logs: \[BLK\] freeze start \[BLK\] freeze end

## Ziel

-   kein ungewolltes Losfahren
-   deterministisch
