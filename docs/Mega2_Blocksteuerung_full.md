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

## Sperre bei Trafo AUS / Erholung nach Trafo EIN

### Aktuell wirksame Logik

Im aktuellen Implementierungsstand wird die Einfahrt nicht primär über den
früheren Grant-Freeze geschützt, sondern über die Kombination aus:

- `m_powerUnavailable`
- `m_powerRecoveryBlockUntilMs

### 1. Power unavailable

Sobald mindestens einer der beiden Trafos unter die AUS-Schwelle fällt,
setzt `updateTrafoPowerRecoveryBlock()`:

- `setPowerUnavailable(true)`

Folge:

- `canEnter()` liefert sofort `false`
- alle neuen Einfahrten sind gesperrt

Log:

- `[BLK] power unavailable -> block all entries`

### 2. Power recovery block

Sobald nach einer Low-Phase **beide** Trafos wieder oberhalb der
EIN-Schwelle liegen, wird gestartet:

- `startPowerRecoveryBlock(now)`

Dauer:

- **4000 ms**

Folge:

- `canEnter()` bleibt weiterhin gesperrt
- auch nach Rückkehr der Trafospannung werden zunächst keine neuen Einfahrten
  erlaubt

Log:

- `[BLK] power recovery block start (4000 ms)`
- `[BLK] power recovery block end`

### Technische Wirkung

`canEnter()` blockiert im aktuellen Stand über:

- `m_powerUnavailable || isPowerRecoveryBlockActive(now)`

Die Belegungserkennung selbst läuft weiter.

### Abgrenzung zum alten Grant-Freeze

Im `BlockController` existiert weiterhin zusätzlich:

- `m_grantFreezeUntilMs`
- `GRANT_FREEZE_MS = 2000`

Dieser Mechanismus ist im aktuellen Hauptpfad jedoch **nicht** die maßgebliche
Trafo-Erholsperre.

## Ziel

-   kein ungewolltes Losfahren
-   deterministisch
-   keine Freigabe unmittelbar nach Wiederkehr der Trafospannung
-   stabile Belegungs- und Stromauswertung vor neuen Einfahrten
