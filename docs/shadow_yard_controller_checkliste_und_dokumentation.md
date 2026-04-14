# ShadowYardController – Checkliste und technische Dokumentation

## Ziel

Dieses Dokument hält den aktuellen fachlichen Stand der neuen SBHF-Steuerung fest.

Es dient als Referenz für:

- weitere Code-Bereinigung
- Tests an der Anlage
- spätere Anpassungen in ETH, WebUI und HMI
- Review der State-Machine

---

# 1. Fachliche Zielsetzung

Die neue SBHF-Steuerung soll die Einfahrt von **Block 5 in den Schattenbahnhof** nicht mehr implizit aus freien Gleisen ableiten, sondern explizit über den Zustand des `ShadowYardController` steuern.

Kernprinzip:

- **Block5 -> SBHF** ist nur während eines expliziten Einfahr-Zustands aktiv.
- Die Ausfahrt aus dem Ziel-SBHF-Gleis und die anschließende Einfahrt des nächsten Zuges werden als zusammenhängender Zyklus modelliert.
- Die elektrische Ausfahrt und die elektrische Einfahrt sind klar voneinander getrennt.

---

# 2. Zustandsmodell

## Aktuelle Ziel-States

```cpp
enum class SBhfState : uint8_t {
    Idle = 0,
    PrepareCycle,
    SettingWeichen,
    WaitBlock6,
    ExitRunning,
    WaitEntryAfterExitFree,
    EntryRunning,
    Error
};
```

## Bedeutung der States

### `Idle`
Grundzustand.

- kein aktiver SBHF-Zyklus
- keine laufende Ausfahrt
- keine laufende Einfahrt
- alle relevanten Powerpfade aus

### `PrepareCycle`
Vorbereitung eines neuen SBHF-Zyklus.

- Zielgleis auswählen
- feststellen, ob das Zielgleis zunächst belegt ist
- Weichenplan vorbereiten

### `SettingWeichen`
Weichenfolge für das Zielgleis läuft.

- Weichen werden geschaltet und geprüft
- bei kritischem Fehler: `Error`
- bei Erfolg: Übergang abhängig davon, ob zuerst eine Ausfahrt nötig ist

### `WaitBlock6`
Nur relevant, wenn im Zielgleis zunächst ein Zug steht.

- warten, bis die Ausfahrt vom aktiven SBHF-Gleis nach Block 6 erlaubt ist
- danach jeweiliges SBHF-Gleis einschalten

### `ExitRunning`
Ausfahrt des vorhandenen Zuges aus dem Ziel-SBHF-Gleis.

- jeweiliger Powerpfad `SBHF Glx -> Block6` aktiv
- Ausfahrt wird überwacht
- bei Überfahrt von `S12/S13/S14` wird der jeweilige Exit-Powerpfad ausgeschaltet

### `WaitEntryAfterExitFree`
Zwischenzustand vor der Einfahrt.

- Zielgleis muss frei sein
- Freimeldung muss **1250 ms stabil** anliegen
- danach Start der Einfahrt

### `EntryRunning`
Einfahrt des neuen Zuges von Block 5 in das Ziel-SBHF-Gleis.

- nur in diesem State ist `Block5 -> SBHF` aktiv
- Ende der Einfahrt **nicht** über kombinierte Blockbelegung
- Ende erst über den zielgleisspezifischen Kontakt:
  - SBHF1 → GF1
  - SBHF2 → GF2
  - SBHF3 → GF3

### `Error`
Fehlerzustand.

- SBHF gestoppt
- sichere Leistungslage
- ACK / Selftest / Resume erforderlich

---

# 3. Ablauf des neuen Zyklus

## Fall A: Zielgleis ist zunächst belegt

1. `Idle`
2. `PrepareCycle`
3. `SettingWeichen`
4. `WaitBlock6`
5. `ExitRunning`
6. bei `S12/S13/S14`: jeweiliges `SBHF Glx -> Block6` AUS
7. `WaitEntryAfterExitFree`
8. Zielgleis 1250 ms stabil frei
9. `EntryRunning`
10. `Block5 -> SBHF` EIN
11. Zielkontakt GF1/GF2/GF3 wird ausgelöst
12. `Block5 -> SBHF` AUS
13. zurück nach `Idle`

## Fall B: Zielgleis ist zunächst leer

1. `Idle`
2. `PrepareCycle`
3. `SettingWeichen`
4. direkt `WaitEntryAfterExitFree`
5. Zielgleis 1250 ms stabil frei
6. `EntryRunning`
7. `Block5 -> SBHF` EIN
8. Zielkontakt GF1/GF2/GF3 wird ausgelöst
9. `Block5 -> SBHF` AUS
10. zurück nach `Idle`

---

# 4. Power-Regeln

## Grundregel

`Block5 -> SBHF` darf **nur** in `EntryRunning` aktiv sein.

## Exit-Powerpfade

Die Ausfahrpfade sind:

- SBHF Gl1 → Block 6
- SBHF Gl2 → Block 6
- SBHF Gl3 → Block 6

Diese dürfen nur während der aktiven Ausfahrt eingeschaltet sein.

## Regel bei `S12/S13/S14`

Bei Überfahrt von:

- `S12`
- `S13`
- `S14`

muss der jeweilige Powerpfad `SBHF Glx -> Block6` sofort ausgeschaltet werden.

Ziel:

Der anschließend einfahrende Zug darf nicht direkt wieder aus dem SBHF-Gleis nach Block 6 weiterfahren.

---

# 5. Sensorlogik

## Freigabe zur Einfahrt

Für `WaitEntryAfterExitFree` ist weiterhin die kombinierte Belegtauswertung des Zielgleises zulässig:

- Blockstrom
- Kontakt
- ODER-Verknüpfung über Blockbelegung

Ziel:

Vor Beginn der Einfahrt muss das Zielgleis sicher frei sein.

## Ende der Einfahrt

Für das Ende von `EntryRunning` gilt ausdrücklich:

**Nicht** kombinierte Blockbelegung verwenden.

Stattdessen nur den zielgleisspezifischen Kontakt verwenden:

- `k_sbhf1`
- `k_sbhf2`
- `k_sbhf3`

Das ist nötig, damit wirklich nachgewiesen wird, dass der Zug über den Einfahrpfad `Block5 -> SBHF` in das Zielgleis eingefahren ist.

---

# 6. Resume-Logik

## Ziel

Nach Fehler / NOTAUS / ACK soll die Anlage möglichst sinnvoll weiterlaufen können, ohne dass Züge manuell entfernt werden müssen.

## Aktuelle Zielrichtung

- Resume bleibt erhalten
- Resume springt auf `PrepareCycle`
- Weichenplan wird sauber neu aufgebaut
- der Zyklus wird kontrolliert wieder aufgenommen

## Zu prüfende Fälle

- Fehler in `SettingWeichen`
- Fehler in `WaitBlock6`
- Fehler in `ExitRunning`
- Fehler in `WaitEntryAfterExitFree`
- Fehler in `EntryRunning`

---

# 7. Aktueller technischer Stand

## Bereits umgesetzt

- neue State-Machine eingeführt
- `PrepareCycle`, `WaitEntryAfterExitFree`, `EntryRunning` vorhanden
- `Block5 -> SBHF` state-gesteuert
- `S12/S13/S14` beenden nicht mehr direkt den Gesamtzyklus
- Exit-Powerpfade werden getrennt von der Einfahrt behandelt
- Resume auf `PrepareCycle` ausgerichtet
- alte Block5-Hilfslogik weitgehend entfernt

## Noch sicherzustellen

- `EntryRunning` endet über GF1/GF2/GF3, nicht über kombinierte Blockbelegung
- vorhandene `SensorKontakt`-Instanzen verwenden
- Status-/Debugpfade auf neue States prüfen

---

# 8. Checkliste Code

## A. State-Machine

- [ ] `PrepareCycle` ist überall statt alter `PrepareExit`-Logik verwendet
- [ ] `SettingWeichen` verzweigt korrekt nach `WaitBlock6` oder `WaitEntryAfterExitFree`
- [ ] `EntryRunning` ist der einzige State mit aktivem `Block5 -> SBHF`
- [ ] `Error` setzt sichere Leistungslage

## B. Powerpfade

- [ ] `Block5 -> SBHF` nur in `EntryRunning`
- [ ] `SBHF Glx -> Block6` nur während aktiver Ausfahrt
- [ ] `S12/S13/S14` schalten den jeweiligen Exit-Powerpfad sicher AUS
- [ ] kein gleichzeitiger widersprüchlicher Powerzustand

## C. Sensorik

- [ ] `WaitEntryAfterExitFree` nutzt Freierkennung des Zielgleises
- [ ] Freiverzögerung 1250 ms aktiv
- [ ] `EntryRunning` endet ausschließlich über GF1/GF2/GF3
- [ ] `SensorKontakt`-Instanzen werden verwendet, kein paralleles `digitalRead()`-Nebenmodell

## D. Resume / Reset

- [ ] Resume-Checkpoint wird gesetzt
- [ ] Resume geht auf `PrepareCycle`
- [ ] Reset löscht keine für Resume nötigen Informationen zu früh
- [ ] ACK / Selftest / Resume verhalten sich anlagenfreundlich

## E. Bereinigung

- [ ] alte Block5-Altlogik entfernt
- [ ] veraltete Member und Kommentare entfernt
- [ ] State-Namen in Debug/Status konsistent
- [ ] Compiler-Warnungen bereinigt oder bewusst dokumentiert

---

# 9. Checkliste Tests an der Anlage

## Test 1 – Zielgleis belegt

- [ ] `S11` startet Zyklus
- [ ] Weichen werden korrekt gestellt
- [ ] `WaitBlock6` wird erreicht
- [ ] `ExitRunning` startet korrekt
- [ ] bei `S12/S13/S14` geht Exit-Powerpfad AUS
- [ ] `WaitEntryAfterExitFree` wird erreicht
- [ ] nach 1250 ms frei startet `EntryRunning`
- [ ] `Block5 -> SBHF` wird aktiv
- [ ] Ende der Einfahrt erst bei GF1/GF2/GF3
- [ ] Rückkehr nach `Idle`

## Test 2 – Zielgleis leer

- [ ] `S11` startet Zyklus
- [ ] Weichen werden korrekt gestellt
- [ ] `ExitRunning` wird übersprungen
- [ ] direkt `WaitEntryAfterExitFree`
- [ ] nach 1250 ms frei startet `EntryRunning`
- [ ] Ende über GF1/GF2/GF3

## Test 3 – Einfahrender Zug fährt nicht wieder aus

- [ ] nach `S12/S13/S14` ist Exit-Powerpfad sicher AUS
- [ ] während `EntryRunning` bleibt Exit-Powerpfad AUS
- [ ] einfahrender Zug fährt nicht direkt nach Block 6 weiter

## Test 4 – Ende der Einfahrt nur über Zielkontakt

- [ ] kombinierte Blockbelegung allein beendet `EntryRunning` nicht
- [ ] nur GF1/GF2/GF3 beendet `EntryRunning`

## Test 5 – Resume nach Fehler

- [ ] Fehler in `SettingWeichen` testbar
- [ ] Fehler in `WaitBlock6` testbar
- [ ] Fehler in `ExitRunning` testbar
- [ ] Fehler in `WaitEntryAfterExitFree` testbar
- [ ] Fehler in `EntryRunning` testbar
- [ ] Resume läuft sinnvoll weiter

---

# 10. Offene Punkte / spätere Optionen

## Derzeit bewusst nicht umgesetzt

### Timeout für `EntryRunning`
Nicht sinnvoll als fixer kurzer Timeout, weil der Fahrweg von `S11` bis zu den Zielkontakten im SBHF lang ist.

### Entfernung aller möglichen Plausibilitätsfunktionen
`determineInboundTargetGleisFromIst()` kann für Schutz-/Plausibilitätsprüfungen weiterhin sinnvoll bleiben.

## Später denkbar

- zusätzliche Diagnoseausgaben pro State
- Testmodus für Entry-/Exit-Zyklus
- separate Anzeige des neuen SBHF-Zustands in ETH / WebUI / HMI

---

# 11. Kurzfazit

Die neue SBHF-Steuerung ist im Kern zustandsgeführt und deutlich sauberer als die frühere Freigabelogik.

Der wesentliche Architekturwechsel lautet:

- **früher:** freie Gleise implizit → Einfahrt erlaubt
- **neu:** expliziter State `EntryRunning` → Einfahrt erlaubt

Damit wird das Verhalten des Schattenbahnhofs klarer, robuster und für WebUI, HMI und ETH konsistenter nachvollziehbar.

