# Blocksteuerung -- Systemdokumentation

## Überblick

Die Blocksteuerung läuft auf Mega2 und übernimmt Belegung, Freigaben und
Sicherheitslogik.

## Belegung

occupied = contactActive OR currentAboveThreshold

## Sperre bei Trafo AUS / Erholung nach Trafo EIN

Die aktuell wirksame Logik besteht aus zwei Teilen:

1. **Power unavailable**
   - sobald mindestens einer der beiden Trafos unter die AUS-Schwelle fällt,
     werden alle Einfahrten gesperrt

2. **Power recovery block**
   - erst wenn **beide** Trafos wieder oberhalb der EIN-Schwelle liegen,
     startet zusätzlich eine Sperrzeit von **4000 ms**

Während dieser Zustände liefert `canEnter()` immer `false`.

Wichtig:

- die Belegungserkennung läuft weiter
- gesperrt ist die Freigabelogik für neue Einfahrten
- der frühere 2000-ms-Grant-Freeze ist im Code zwar noch vorhanden, ist aber
  im aktuellen Hauptpfad nicht die maßgebliche Sperrlogik
