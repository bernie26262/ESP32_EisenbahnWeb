# Blocksteuerung -- Systemdokumentation (Vollversion)

## Überblick

Die Blocksteuerung läuft vollständig auf Mega2 und übernimmt:

- Belegungserkennung
- Freigabelogik (Grant)
- Sicherheitsregeln
- Speziallogik Block 4
- Integration SBHF
- Trafo-getrennte Energiepfadsteuerung

---

## Blockstruktur

Blöcke 1–6: Strecke  
Blöcke 7–9: SBHF

---

## Belegung

occupied = contactActive OR currentAboveThreshold

### Kontaktgleis

- digital, active LOW
- sofort wirksam

### Strom

- RMS-basiert
- kontinuierlich
- mit Stabilitätsbewertung

---

## Blocklogik

- isOccupied()
- isReallyFree(now)

Freigabeverzögerung: ~2.5 s

---

## Grant-Logik

canEnter(from, to)

entscheidet über Einfahrfreigaben unter Berücksichtigung von:

- Belegung
- Stabilität
- Trafo-Zustand
- SBHF-Zustand

---

## Trafo-getrennte Sperrlogik (seit 127f)

Die Freigabelogik ist vollständig nach Energiepfaden getrennt.

### Konzept

Nicht der Startblock bestimmt die Freigabe, sondern:

👉 der Energiezustand des Zielbereichs

---

### 🔵 Trafo oben (Blöcke 1–3)

Betroffene Pfade:

- 4 → 1
- 1 → 2
- 2 → 3

Wenn Trafo oben AUS:

- diese Einfahrten sind gesperrt

---

### 🟢 Trafo unten (Blöcke 4–6 + SBHF)

Betroffene Pfade:

- 3 → 4
- 4 → 5
- 5 → SBHF
- SBHF → 6
- 6 → 4

Wenn Trafo unten AUS:

- diese Einfahrten sind gesperrt

---

## Trafo-Grenzen

Besonders kritisch sind:

- 4 → 1 (Übergang unten → oben)
- 3 → 4 (Übergang oben → unten)

Diese werden jeweils durch den Ziel-Trafo gesteuert.

---

## Verhalten bei Trafo AUS

Beim Unterschreiten der AUS-Schwelle:

- nur betroffene Pfade werden gesperrt
- keine globale Blockade
- bestehende Belegungen bleiben gültig

---

## Verhalten bei Trafo EIN (Recovery)

Beim Wiedereinschalten:

- getrennte Recovery-Timer:
  - oben
  - unten

Während Recovery:

- keine Freigaben im jeweiligen Pfad

Ziel:

- stabile Messwerte vor Freigabe

---

## Spezialfall Block 4

- 3→4 abhängig vom unteren Pfad
- 6→4 abhängig von Block 1–3
- Priorität: Block 6

---

## Relais

updateBlockGrantRelays()

setzt physische Sperr-/Freigaberelais entsprechend der Grant-Logik

---

## SBHF-Integration

Der SBHF ist vollständig dem unteren Trafo zugeordnet.

### Konsequenzen

- Trafo oben beeinflusst SBHF nicht
- Trafo unten steuert SBHF vollständig

---

## Timeout-Logik SBHF (kritisch)

### Exit Timeout

- wird bei Trafo unten AUS:
  - gestoppt
  - nach EIN neu gestartet

### Entry Timeout (seit 127f fix)

- wird bei Trafo unten AUS:
  - deaktiviert
  - Timer werden zurückgesetzt

- nach Trafo unten EIN:
  - kompletter Neustart der Überwachung

### Ziel

- keine falschen Emergencies bei Spannungsverlust
- deterministisches Verhalten bei Resume

---

## Abgrenzung zum alten System

Vor 127f:

- globale Sperre (`m_powerUnavailable`)
- globale Recovery

Jetzt:

- getrennte Pfade
- keine unnötigen Blockierungen
- klar nachvollziehbare Freigaben

---

## Zielsystem

- keine Einfahrt in spannungslose Bereiche
- stabile Blockfreigaben
- robuste SBHF-Integration
- keine Fehlalarme durch Trafo-Aus/EIN