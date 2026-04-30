# ShadowYardController – Checkliste und technische Dokumentation

## Ziel

Dieses Dokument hält den aktuellen fachlichen Stand der SBHF-Steuerung auf Mega2 fest.

Es dient als Referenz für:

- weitere Code-Bereinigung
- Tests an der Anlage
- spätere Anpassungen in ETH, WebUI und HMI
- Review der State-Machine
- Diagnose von SBHF-Fehlern und Timeout-Situationen

---

# 1. Fachliche Zielsetzung

Die SBHF-Steuerung regelt die Ausfahrt aus einem Schattenbahnhofsgleis nach Block 6 und die anschließende Einfahrt eines neuen Zuges aus Block 5 in dasselbe Zielgleis.

Kernprinzipien:

- **Block5 → SBHF** ist nur während des expliziten Zustands `EntryRunning` aktiv.
- Die Ausfahrt aus dem Ziel-SBHF-Gleis und die anschließende Einfahrt des nächsten Zuges werden als zusammenhängender Zyklus modelliert.
- Die elektrische Ausfahrt und die elektrische Einfahrt sind klar voneinander getrennt.
- Der SBHF gehört vollständig zum unteren Trafo-Bereich.
- Trafo unten AUS darf keine falsche Emergency durch weiterlaufende Entry-/Exit-Timeouts erzeugen.

---

# 2. Zustandsmodell

## States

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
- alle relevanten SBHF-Powerpfade aus
- `S11` darf einen neuen Zyklus starten

### `PrepareCycle`

Vorbereitung eines neuen SBHF-Zyklus.

- Zielgleis auswählen
- feststellen, ob das Zielgleis zunächst belegt ist
- Weichenplan vorbereiten
- interne Marker und Timer für den neuen Zyklus initialisieren

### `SettingWeichen`

Weichenfolge für das Zielgleis läuft.

- Weichen werden geschaltet und geprüft
- bei kritischem Fehler: `Error`
- bei Erfolg: Übergang abhängig davon, ob zuerst eine Ausfahrt nötig ist

### `WaitBlock6`

Nur relevant, wenn im Zielgleis zunächst ein Zug steht.

- warten, bis die Ausfahrt vom aktiven SBHF-Gleis nach Block 6 erlaubt ist
- danach wird der jeweilige Exit-Powerpfad `SBHF Glx → Block6` eingeschaltet

### `ExitRunning`

Ausfahrt des vorhandenen Zuges aus dem Ziel-SBHF-Gleis.

- jeweiliger Powerpfad `SBHF Glx → Block6` aktiv
- Ausfahrt wird überwacht
- nach Erreichen des zielgleisspezifischen Markers `S12/S13/S14` wird der jeweilige Exit-Powerpfad ausgeschaltet
- anschließend Übergang nach `WaitEntryAfterExitFree`

Wichtig:

- `S12/S13/S14` sind während `ExitRunning` der Abschaltpunkt für den Exit-Powerpfad.
- `S12/S13/S14` beenden **nicht** die spätere Einfahrt; dafür gilt in `EntryRunning` eine eigene Logik.

### `WaitEntryAfterExitFree`

Zwischenzustand vor der Einfahrt.

- Zielgleis muss frei sein
- Freimeldung muss **1250 ms stabil** anliegen
- danach Start der Einfahrt

### `EntryRunning`

Einfahrt des neuen Zuges von Block 5 in das Ziel-SBHF-Gleis.

- nur in diesem State ist `Block5 → SBHF` aktiv
- Ende der Einfahrt nicht über kombinierte Blockbelegung
- Ende der Einfahrt erst dann, wenn:
  1. der zielgleisspezifische Einfahrmarker `S12/S13/S14` erkannt wurde und
  2. danach der zugehörige Zielkontakt `GF1/GF2/GF3` erkannt wurde

Zuordnung:

- SBHF1 → zuerst `S12`, danach `GF1`
- SBHF2 → zuerst `S13`, danach `GF2`
- SBHF3 → zuerst `S14`, danach `GF3`

Wichtig:

- `S12/S13/S14` beenden `EntryRunning` **nicht allein**.
- `GF1/GF2/GF3` beendet `EntryRunning` nur dann, wenn zuvor der passende Einfahrmarker erkannt wurde.

### `Error`

Fehlerzustand.

- SBHF gestoppt
- sichere Leistungslage
- Fehler wird über Mega2 → ETH → WebUI/HMI eindeutig gemeldet
- ACK / Selftest / Resume erforderlich

---

# 3. Ablauf des SBHF-Zyklus

## Start über `S11`

Der SBHF-Zyklus wird über `S11` gestartet.

Dabei gilt:

- `S11` wird nur im Zustand `Idle` ausgewertet.
- pro `Idle`-Phase darf `S11` den Zyklus nur **einmal** starten.
- nach vollständigem Zyklusende und Rückkehr nach `Idle` wird der Trigger wieder freigegeben.

Besonderheit bei aktiver Blocksperre:

- Wenn `S11` im Zustand `Idle` erkannt wird, während die Blocksperre noch aktiv ist, darf dieser Trigger nicht verloren gehen.
- Stattdessen wird ein Pending-Start gespeichert.
- Sobald die Blocksperre beendet ist und der SBHF noch immer in `Idle` steht, wird der Zyklus automatisch genau einmal gestartet.

## Fall A: Zielgleis ist zunächst belegt

1. `Idle`
2. `PrepareCycle`
3. `SettingWeichen`
4. `WaitBlock6`
5. `ExitRunning`
6. bei `S12/S13/S14`: jeweiliger Exit-Powerpfad `SBHF Glx → Block6` AUS
7. `WaitEntryAfterExitFree`
8. Zielgleis 1250 ms stabil frei
9. `EntryRunning`
10. `Block5 → SBHF` EIN
11. zielgleisspezifischer Einfahrmarker `S12/S13/S14` wird ausgelöst
12. danach zugehöriger Zielkontakt `GF1/GF2/GF3` wird ausgelöst
13. `Block5 → SBHF` AUS
14. zurück nach `Idle`

## Fall B: Zielgleis ist zunächst leer

1. `Idle`
2. `PrepareCycle`
3. `SettingWeichen`
4. direkt `WaitEntryAfterExitFree`
5. Zielgleis 1250 ms stabil frei
6. `EntryRunning`
7. `Block5 → SBHF` EIN
8. zielgleisspezifischer Einfahrmarker `S12/S13/S14` wird ausgelöst
9. danach zugehöriger Zielkontakt `GF1/GF2/GF3` wird ausgelöst
10. `Block5 → SBHF` AUS
11. zurück nach `Idle`

---

# 4. Power-Regeln

## Grundregel

`Block5 → SBHF` darf **nur** in `EntryRunning` aktiv sein.

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

muss der jeweilige Powerpfad `SBHF Glx → Block6` sofort ausgeschaltet werden.

Ziel:

Der anschließend einfahrende Zug darf nicht direkt wieder aus dem SBHF-Gleis nach Block 6 weiterfahren.

## Trafo-Zuordnung

Der SBHF ist vollständig dem unteren Trafo zugeordnet.

Konsequenzen:

- Trafo oben AUS beeinflusst SBHF nicht.
- Trafo unten AUS blockiert SBHF-Fahrten korrekt.
- Bei Trafo unten AUS dürfen keine Entry-/Exit-Timeouts weiterlaufen.

---

# 5. Sensorlogik

## Freigabe zur Einfahrt

Für `WaitEntryAfterExitFree` ist die kombinierte Freierkennung des Zielgleises zulässig:

- Kontakt
- Stromauswertung
- ODER-Verknüpfung über Blockbelegung

Ziel:

Vor Beginn der Einfahrt muss das Zielgleis sicher frei sein.

## Ende der Einfahrt

Für das Ende von `EntryRunning` gilt ausdrücklich:

**Nicht** kombinierte Blockbelegung verwenden.

Stattdessen gilt die folgende Reihenfolge:

1. zunächst muss der zielgleisspezifische Einfahrmarker erkannt werden:
   - `S12` für SBHF-Gleis 1
   - `S13` für SBHF-Gleis 2
   - `S14` für SBHF-Gleis 3
2. danach muss der zugehörige Zielkontakt erkannt werden:
   - `GF1` für SBHF-Gleis 1
   - `GF2` für SBHF-Gleis 2
   - `GF3` für SBHF-Gleis 3

Nur diese Kombination beendet `EntryRunning`.

Wichtig:

- `S12/S13/S14` allein beendet `EntryRunning` nicht.
- `GF1/GF2/GF3` allein beendet `EntryRunning` nicht.
- die Reihenfolge ist verbindlich:
  - `S12 → GF1`
  - `S13 → GF2`
  - `S14 → GF3`

Das ist nötig, damit wirklich nachgewiesen wird, dass der Zug über den Einfahrpfad `Block5 → SBHF` in das Zielgleis eingefahren ist.

---

# 6. Timeout-Logik

## Ziel

Timeouts sollen echte Fehler erkennen, aber keine Emergency auslösen, wenn der untere Trafo ausgeschaltet ist und deshalb kein Zug fahren kann.

## Exit Timeout

Gilt während `ExitRunning`.

Bei Trafo unten AUS oder Power-Recovery:

- Exit-Powerpfad wird abgeschaltet
- Timeout-Überwachung wird pausiert bzw. neu gestartet
- nach Trafo unten EIN beginnt die relevante Timeout-Zeit wieder neu

Ziel:

Kein `Exit Timeout SBHF`, nur weil die Fahrspannung unten ausgeschaltet wurde.

## Entry Timeout

Gilt während `EntryRunning`.

Es gibt zwei Phasen:

1. vor dem Einfahrmarker `S12/S13/S14`
2. nach dem Einfahrmarker bis zum Zielkontakt `GF1/GF2/GF3`

Bei Trafo unten AUS oder Power-Recovery:

- `Block5 → SBHF` wird abgeschaltet
- Entry-Überwachung wird deaktiviert
- Entry-Timer werden zurückgesetzt
- bereits erkannte Marker bleiben fachlich erhalten, soweit sie für den Resume benötigt werden
- nach Trafo unten EIN startet die Überwachung sauber neu

Ziel:

Kein `Timeout Einfahrt SBHF`, nur weil Trafo unten aus ist.

---

# 7. Fehlerdiagnose / Emergency

Die Fehlerdiagnosekette läuft seit 127e eindeutig:

Mega2 → ETH → WebUI → HMI

Gemeldet werden:

- `errorCause`
- `errorIndex`
- `errorDetailCode`

## Relevante SBHF-Fehlerfälle

- Falschfahrt SBHF
- Timeout Einfahrt SBHF
- Einfahrt falsches Gleis
- Exit Timeout SBHF
- SBHF Controller-Fehler

## Overlay-Prinzip

In WebUI/HMI gilt:

- Titel = Ursache
- Wirkung = `Notaus aktiv. Fahrspannung abgeschaltet.`
- Maßnahme = konkreter Bedienhinweis je Fehlerfall

---

# 8. Resume-Logik

## Ziel

Nach Fehler / NOTAUS / ACK soll die Anlage möglichst sinnvoll weiterlaufen können, ohne dass Züge manuell entfernt werden müssen.

## Zielrichtung

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

# 9. Aktueller technischer Stand

## Umgesetzt

- State-Machine eingeführt
- `PrepareCycle`, `WaitEntryAfterExitFree`, `EntryRunning` vorhanden
- `Block5 → SBHF` state-gesteuert
- `S12/S13/S14` beenden nicht mehr direkt den Gesamtzyklus
- Exit-Powerpfade werden getrennt von der Einfahrt behandelt
- Resume auf `PrepareCycle` ausgerichtet
- alte Block5-Hilfslogik weitgehend entfernt
- eindeutige SBHF-Fehlerdiagnose bis WebUI/HMI
- Trafo-unten-Freeze für SBHF-Entry und SBHF-Exit berücksichtigt
- Entry-/Exit-Timeouts werden bei Trafo unten AUS/Recovery nicht falsch weitergezählt

## Weiterhin wichtig bei Änderungen

- `S11` darf bei aktiver Blocksperre nicht verloren gehen.
- `EntryRunning` endet nur über `S12/S13/S14` **und danach** `GF1/GF2/GF3`.
- `S13` muss für SBHF-Gleis 2 symmetrisch zu `S12` und `S14` behandelt werden.
- vorhandene `SensorKontakt`-Instanzen verwenden.
- Status-/Debugpfade auf neue States prüfen.
- Power-/Timeout-Freeze darf nur den unteren Trafo für SBHF berücksichtigen.

---

# 10. Checkliste Code

## A. State-Machine

- [ ] `PrepareCycle` ist überall statt alter `PrepareExit`-Logik verwendet
- [ ] `SettingWeichen` verzweigt korrekt nach `WaitBlock6` oder `WaitEntryAfterExitFree`
- [ ] `EntryRunning` ist der einzige State mit aktivem `Block5 → SBHF`
- [ ] `S11` wird in `Idle` bei aktiver Blocksperre gepuffert und später genau einmal nachgezogen
- [ ] `Error` setzt sichere Leistungslage

## B. Powerpfade

- [ ] `Block5 → SBHF` nur in `EntryRunning`
- [ ] `SBHF Glx → Block6` nur während aktiver Ausfahrt
- [ ] `S12/S13/S14` schalten den jeweiligen Exit-Powerpfad sicher AUS
- [ ] kein gleichzeitiger widersprüchlicher Powerzustand
- [ ] Trafo oben AUS blockiert SBHF nicht
- [ ] Trafo unten AUS blockiert SBHF-Fahrten korrekt

## C. Sensorik

- [ ] `WaitEntryAfterExitFree` nutzt Freierkennung des Zielgleises
- [ ] Freiverzögerung 1250 ms aktiv
- [ ] `EntryRunning` endet nur nach `S12/S13/S14` und anschließend `GF1/GF2/GF3`
- [ ] Zuordnung ist korrekt: `S12→GF1`, `S13→GF2`, `S14→GF3`
- [ ] `SensorKontakt`-Instanzen werden verwendet, kein paralleles `digitalRead()`-Nebenmodell

## D. Timeout / Trafo unten

- [ ] Exit Timeout läuft bei Trafo unten AUS nicht weiter
- [ ] Exit Timeout startet nach Trafo unten EIN sauber neu
- [ ] Entry Timeout läuft bei Trafo unten AUS nicht weiter
- [ ] Entry-Timer werden bei Trafo unten AUS/Recovery zurückgesetzt
- [ ] Nach Trafo unten EIN entsteht keine falsche Emergency

## E. Resume / Reset

- [ ] Resume-Checkpoint wird gesetzt
- [ ] Resume geht auf `PrepareCycle`
- [ ] Reset löscht keine für Resume nötigen Informationen zu früh
- [ ] ACK / Selftest / Resume verhalten sich anlagenfreundlich

## F. Bereinigung

- [ ] alte Block5-Altlogik entfernt
- [ ] veraltete Member und Kommentare entfernt
- [ ] State-Namen in Debug/Status konsistent
- [ ] Compiler-Warnungen bereinigt oder bewusst dokumentiert

---

# 11. Checkliste Tests an der Anlage

## Test 1 – Zielgleis belegt

- [ ] `S11` startet Zyklus
- [ ] `S11` geht bei aktiver Blocksperre nicht verloren, sondern startet den Zyklus nach Freigabe
- [ ] Weichen werden korrekt gestellt
- [ ] `WaitBlock6` wird erreicht
- [ ] `ExitRunning` startet korrekt
- [ ] bei `S12/S13/S14` geht Exit-Powerpfad AUS
- [ ] `WaitEntryAfterExitFree` wird erreicht
- [ ] nach 1250 ms frei startet `EntryRunning`
- [ ] `Block5 → SBHF` wird aktiv
- [ ] passender Einfahrmarker `S12/S13/S14` wird erkannt
- [ ] Ende der Einfahrt erst nach anschließendem `GF1/GF2/GF3`
- [ ] Rückkehr nach `Idle`

## Test 2 – Zielgleis leer

- [ ] `S11` startet Zyklus
- [ ] Weichen werden korrekt gestellt
- [ ] `ExitRunning` wird übersprungen
- [ ] direkt `WaitEntryAfterExitFree`
- [ ] nach 1250 ms frei startet `EntryRunning`
- [ ] passender Einfahrmarker `S12/S13/S14` wird erkannt
- [ ] Ende erst nach anschließendem `GF1/GF2/GF3`

## Test 3 – Einfahrender Zug fährt nicht wieder aus

- [ ] nach `S12/S13/S14` ist Exit-Powerpfad sicher AUS
- [ ] während `EntryRunning` bleibt Exit-Powerpfad AUS
- [ ] einfahrender Zug fährt nicht direkt nach Block 6 weiter

## Test 4 – Ende der Einfahrt nur über Zielkontakt

- [ ] kombinierte Blockbelegung allein beendet `EntryRunning` nicht
- [ ] `S12/S13/S14` allein beendet `EntryRunning` nicht
- [ ] `GF1/GF2/GF3` ohne vorherigen Einfahrmarker beendet `EntryRunning` nicht
- [ ] nur `S12→GF1`, `S13→GF2`, `S14→GF3` beendet `EntryRunning`

## Test 5 – Resume nach Fehler

- [ ] Fehler in `SettingWeichen` testbar
- [ ] Fehler in `WaitBlock6` testbar
- [ ] Fehler in `ExitRunning` testbar
- [ ] Fehler in `WaitEntryAfterExitFree` testbar
- [ ] Fehler in `EntryRunning` testbar
- [ ] Resume läuft sinnvoll weiter

## Test 6 – Trafo unten AUS während Exit

- [ ] `ExitRunning` aktiv
- [ ] Trafo unten AUS
- [ ] Exit-Powerpfad geht AUS
- [ ] kein `Exit Timeout SBHF`
- [ ] Trafo unten EIN
- [ ] Timeout-Überwachung startet sauber neu

## Test 7 – Trafo unten AUS während Entry

- [ ] `EntryRunning` aktiv
- [ ] Trafo unten AUS
- [ ] `Block5 → SBHF` geht AUS
- [ ] kein `Timeout Einfahrt SBHF`
- [ ] Trafo unten EIN
- [ ] Entry-Überwachung startet sauber neu
- [ ] Zyklus bleibt fachlich nachvollziehbar

## Test 8 – Trafo oben AUS während SBHF

- [ ] SBHF-Zyklus aktiv
- [ ] Trafo oben AUS
- [ ] SBHF wird nicht allein dadurch blockiert
- [ ] keine falsche SBHF-Emergency

---

# 12. Abgrenzung zur Blocksteuerungs-Doku

Die Trafo-getrennte Freigabelogik der allgemeinen Blockpfade ist in der Blocksteuerungs-Doku beschrieben.

Dieses Dokument beschreibt nur die SBHF-spezifische Sicht:

- SBHF gehört zum unteren Trafo
- Entry/Exit-Powerpfade
- State-Machine
- Sensorreihenfolge
- SBHF-Timeouts
- SBHF-Fehlerdiagnose

---

# 13. Spätere Optionen

- zusätzliche Diagnoseausgaben pro State
- Testmodus für Entry-/Exit-Zyklus
- separate Anzeige des neuen SBHF-Zustands in ETH / WebUI / HMI
- grafische State-Machine für die Doku

---

# 14. Kurzfazit

Die SBHF-Steuerung ist zustandsgeführt und deutlich sauberer als die frühere Freigabelogik.

Der wesentliche Architekturwechsel lautet:

- **früher:** freie Gleise implizit → Einfahrt erlaubt
- **jetzt:** expliziter State `EntryRunning` → Einfahrt erlaubt

Zusätzlich gilt seit 127e/127f:

- Fehler werden eindeutig bis WebUI/HMI gemeldet.
- Trafo unten AUS erzeugt keine falschen Entry-/Exit-Timeout-Emergencies.
- SBHF ist sauber vom oberen Trafo entkoppelt.
