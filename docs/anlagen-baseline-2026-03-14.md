# Anlagen-Baseline – 2026-03-14

Diese Baseline dokumentiert einen stabilen Entwicklungsstand der realen Anlage.
Der Stand wurde in allen drei Repositories per Tag gesichert.

---

# Überblick

Stand der Anlage nach mehreren Tests an der Realanlage.

Wichtige Fortschritte:

- AC-Spannungsmessung der Trafos stabil implementiert
- Strommessung pro Block funktionsfähig
- Grundlage für robuste Blockbelegt-Erkennung geschaffen
- Weichenselbsttest auf Mega1 deutlich beschleunigt
- Protokoll zwischen ESP und Mega2 erweitert

Diese Baseline dient als Referenzpunkt für spätere Weiterentwicklung und Debugging.

---

# Repositories und Tags

## Mega2 – Schattenbahnhof / Blocksteuerung

Tag:


mega2-strommessung-good-2026-03-14


Wesentliche Änderungen:

- RMS-Messung der Trafo-Spannung stabilisiert
- Bias-Tracking verbessert
- Snap-to-Zero implementiert
- Fensterhistorie erhöht

Strommessung:

- RMS-Messung für Blockstrom implementiert
- Logging (`IBLOCK`) zur Analyse der Stromwerte
- erste Stromplateaus im Bereich etwa 80–170 mA beobachtet
- Grundlage für Blockbelegt-Schwellenwerte geschaffen

Blocklogik:

- Hysterese für Strombelegung eingeführt
- Kontakte werden über `SensorKontakt::isOccupied()` bewertet
- Blockzustand:


besetzt = kontaktAktiv OR stromAktiv


---

## Mega1 – Bahnhof / Weichensteuerung

Tag:


mega1-selftest-optimized-2026-03-14


Verbesserungen:

- Weichenselbsttest deutlich beschleunigt
- Relaispulse und Wartezeiten optimiert
- Selbsttest erfolgreich auf realer Anlage getestet

Ziel:

- schnellere Startphase der Anlage
- dennoch sichere Überprüfung der Weichenrückmelder

---

## ESP – Zentrale Steuerung / Web-UI

Tag:


esp-proto-align-mega2-analog-2026-03-14


Änderungen:

- Anpassung von `proto_common.h`
- Integration der Mega2-Analogdaten
- Vorbereitung für Anzeige der Trafo-Spannungen und Blockströme

UI:

- Diagnoseansicht (`diag.htm`) zeigt Rohdaten
- Hauptansicht (`index.htm`) zeigt Blockzustände

---

# Messergebnisse (Auszug)

## Trafo-Spannung

Vergleich Multimeter vs Mega2:

| Trafo | Multimeter | Mega2 RMS |
|------|------------|-----------|
| oben | ~19.30 V | ~19.06 V |
| unten | ~18.98 V | ~18.60 V |

Fehlerbereich:

≈ 1–2 %

Für 10-bit-ADC und RMS-Berechnung sehr gut.

---

## Blockstrom

Typische Strombereiche während Fahrt:

| Zustand | Strom |
|-------|------|
| leerer Block | 0–6 mA |
| Lok fährt | 80–170 mA |

Stromplateaus entstehen durch:

- unterschiedliche Fahrspannung
- Diodenabschnitte
- Motorlast

Diese Unterschiede werden bei der Wahl der Block-Thresholds berücksichtigt.

---

# Nächste Schritte

Geplant:

1. Auswertung der Stromlogs zur Bestimmung robuster Schwellenwerte
2. Feintuning der Blockbelegt-Logik
3. Verbesserung der Spannungsmess-Stabilität
4. Integration der Analogwerte in die Web-UI
5. Weitere Tests auf der Realanlage

---

# Bedeutung dieser Baseline

Diese Baseline markiert den ersten Stand, bei dem

- Spannungsmessung
- Strommessung
- Blocklogik
- Weichenselbsttest

gemeinsam stabil auf der Anlage funktionieren.

Sie dient als Referenzpunkt für spätere Änderungen.