🛑 Safety-Konzept – Elektrische Eisenbahn

Stand: final konsolidiert (Mega2 Safety-Master)

1. Ziel und Grundprinzipien

Dieses Dokument beschreibt das verbindliche Safety-Konzept der Anlage.

Grundprinzipien

Mega2 ist alleiniger Safety-Master

Mega1 erzeugt keine Not-Aus-Situationen

ESP ist reiner Vermittler & Visualisierer

Safety ist zustandsbasiert, nicht ereignisbasiert

Jeder Safety-Zustand ist:

erklärbar

quittierbar (oder bewusst nicht)

eindeutig visualisierbar

2. Rollen & Verantwortlichkeiten
Mega2 (Safety-Master)

Blocksteuerung

Schattenbahnhof (inkl. Weichen SBhf)

Stromüberwachung (I_block_x)

SSR-Steuerung (Trafo A/B)

Not-Aus, Emergency, Warnings

Entscheidung über lock / unlock

Mega1 (Betriebscontroller)

Weichen Blöcke 1–4

Bahnhöfe

Bahnhofsstromgleise

Kontaktgleise Bahnhöfe

nur Warnungen, niemals Not-Aus

ESP (WebUI & Kommunikation)

I²C-Master

Zustandsweitergabe

UI-Darstellung

ACK / PowerOn Weiterleitung

keine Safety-Logik

3. Safety-Zustände (Mega2)
3.1 Zustandsübersicht
Zustand	Beschreibung
NONE	Normalbetrieb
BOOT	Startzustand, PowerOn gesperrt
EMERGENCY	Not-Aus aktiv
ERROR_LOCK	sicherheitsrelevanter Fehler, quittierpflichtig
4. Emergency-Reasons (Mega2)

Emergency = sofortige Abschaltung, lock = true, ACK erforderlich

UI-Regel ab Protokoll V4:
- **Titel** benennt die Ursache
- **Wirkung** lautet „Notaus aktiv. Fahrspannung abgeschaltet.“
- **Maßnahme** ist ursachenspezifisch

4.1 Übersicht
Reason	Beschreibung
EMERG_ESTOP_CHAIN_OPEN	Hardware-Not-Aus ausgelöst
EMERG_OVERCURRENT_BLOCK_x	Überstrom in Block x
EMERG_SSR_STUCK_ON_TRAFO_A/B	SSR schaltet nicht ab
EMERG_SBH_FALSE_ENTRY	Falschfahrt SBHF: Nothalt-/Stopzone-Kontakt aktiv bei Trafo unten an und Block 6 ohne Strom
EMERG_SBH_ENTRY_TIMEOUT	Timeout in der Einfahrt SBHF (S12/S13/S14 bzw. GF1/GF2/GF3 nicht rechtzeitig)
EMERG_SBH_ENTRY_WRONG_TRACK	Einfahrt SBHF in falsches Gleis
EMERG_SBH_EXIT_TIMEOUT	Aktives SBHF-Ausfahrgleis bleibt trotz Ausfahrbefehl belegt
EMERG_WEICHENFEHLER_SBHF	Weiche SBhf erreicht Sollstellung nicht
EMERG_DOPPELTE_BLOCKBELEGUNG_x	Mögliche Doppelbelegung
EMERG_CONTROLLER_FAULT	Generischer Safety-Controllerfehler
EMERG_SBH_CONTROLLER_FAULT	Interner SBHF-Ablauf-/Zustandsfehler
4.2 Trigger-Definitionen (formal)
Überstrom Block
SSR_x_cmd == ON
AND I_block_x > I_MAX
FOR T_emerg

SSR stuck ON
SSR_x_cmd == OFF
AND Sum(I_block_assigned_to_x) > I_MIN_RUN
FOR T_emerg

Doppelbelegung Block x
blockPowerCmd[entry_to_x] == OFF
AND ΔI_block_x > ΔI_threshold
AND TrafoVoltage ~ konstant
FOR T_emerg

5. Reset / ACK-Regeln (Emergency)
Allgemein

ACK ist immer manuell

ACK hebt nicht automatisch die Ursache auf

Nach ACK:

erneuter Prüf- oder Schaltversuch

bei erneutem Fehler → sofort zurück in EMERGENCY

Spezifische Fälle
Weichenfehler SBhf

ACK → Weiche wird erneut angesteuert

Erfolg → Normalbetrieb

Misserfolg → erneut EMERGENCY

Doppelbelegung

ACK nur nach manueller Sichtprüfung

System nimmt Zustand zurück, ohne Annahmen

6. Warnings (normativ)

Warnings sind **Betriebs-/Diagnosehinweise**. Sie sind sichtbar in der UI, führen aber **nicht**
zu `safety.lock` und lösen **keinen** Not-Aus aus.

Grundregeln
- Warning => Anzeige / Hinweis, Betrieb grundsätzlich möglich (menschliche Bewertung)
- Emergency => `safety.lock` / Not-Aus / Blockade (Mega2-only)

6.1 Mega2-Warnings (Quelle: Mega2)

Mega2 erzeugt Warnings ausschließlich auf Mega2 selbst und überträgt sie an den ESP (Anzeige).
Der ESP interpretiert keine Safety-Sachverhalte, sondern zeigt die gemeldeten Zustände an.

Mechanismen
- `warningMask` (Bitmaske): mindestens ein Warning-Bit aktiv => Systemstatus WARNING
- `restricted` (bool, UI-Convenience): Betrieb eingeschränkt => Systemstatus WARNING

Hinweis:
- UI-Keys `WARN_*` sind Darstellung.
- Die normative Bedeutung der Bits/Flags ist im Mega2-Protokoll dokumentiert.

6.2 Mega1-Warnings (Quelle: Mega1)

Mega1-Warnings sind Betriebswarnungen (z.B. Weichen-/Bahnhofsthemen). Sie dürfen niemals:
- `lock` setzen
- SSR beeinflussen
- Not-Aus auslösen

Mega1 signalisiert "Warning present" über `SystemStatus.flags` mit `SYS_WARNING_PRESENT`.
Details werden über `mega1.diag` übertragen.

 
#### Mega1 Warning Bitmask (`m1WarningMask`)

Mega1 verwendet zusätzlich eine Bitmaske zur eindeutigen Identifikation der aktiven Warning(s).

| Bit | Maske | Warning-Key | Bedeutung |
|-----|-------|-------------|-----------|
| 0 | 0x01 | WARN_WEICHEN_NO_SWITCH | Eine oder mehrere Weichen schalten nicht in Sollstellung |
| 1 | 0x02 | WARN_BAHNHOF_DURCHFAHRT | Bahnhofsdurchfahrt trotz abgeschaltetem Stromgleis *(reserviert, Umsetzung offen)* |
| 2 | 0x04 | reserviert | frei |
| 3 | 0x08 | reserviert | frei |
| 4–7 | 0xF0 | reserviert | Erweiterungen |

Regeln:
- `m1WarningMask != 0` ⇒ `SYS_WARNING_PRESENT = 1`
- Mehrere Bits dürfen gleichzeitig gesetzt sein
- Die Maske wird ausschließlich von Mega1 gesetzt/gelöscht
- ESP/WebUI zeigen die gemeldeten Warnings an, ohne eigene Interpretation

Hinweis:
- Bit 1 (`WARN_BAHNHOF_DURCHFAHRT`) ist aktuell **reserviert**.
- Die möglichen Umsetzungsvarianten und die offene Design-Entscheidung
  sind im Abschnitt **„WARN_BAHNHOF_DURCHFAHRT – Status / Umsetzung: offen“**
  beschrieben.

### WARN_WEICHEN_NO_SWITCH
- Bedeutung: Weiche(n) schalten nicht in Sollstellung
- Trigger: Soll ≠ Ist nach Timeout (Selftest oder Betrieb)
- Wirkung: `SYS_WARNING_PRESENT=1`, Systemstatus WARNING
- Details: `diag.selftestFailMask` (Defekte Weichen)

### WARN_BAHNHOF_DURCHFAHRT
- Bedeutung: Bahnhofsdurchfahrt trotz abgeschaltetem Stromgleis
- Trigger: Stromgleis AUS ∧ Timer läuft ∧ Strom > Threshold
- Wirkung: `SYS_WARNING_PRESENT=1`, Systemstatus WARNING
- Details: optional Block / Strom / Restzeit
#### Status / Umsetzung: offen (Option für später)

Diese Warning ist konzeptionell sinnvoll, ist aber aktuell **nicht implementiert**, weil die
benötigten Informationen auf zwei Controllern liegen:
- Mega1: Bahnhof-Kontaktsensorik / Timer / Stromgleis-Schaltzustand
- Mega2: Strommessung (Threshold-Entscheidung)

Damit kann Mega1 die Warning nicht allein entscheiden, ohne eine definierte Datenbrücke zu Mega2.

##### Umsetzungsoptionen (Design-Entscheidung offen)

**Option A – Mega2 entscheidet (empfohlen, wenn Warning später wichtig wird)**
- Mega1 übermittelt an Mega2 einen kleinen Kontext:
  - pro Bahnhof: `powerOff`  `timerRunning` (und ggf. betroffener Bahnhof/Block)
- Mega2 kombiniert Kontext  Strommessung und setzt ein Mega2-Warning-Bit.
- ESP/WebUI bleiben “dumm”: Anzeige des gemeldeten Mega2-Warnings.
- Vorteil: Keine Safety-Entscheidung im ESP; Entscheidung bleibt controllerseitig.

**Option B – Info-only (ohne kombinierte Warning)**
- Mega1 zeigt nur: “Durchfahrt-Fenster aktiv / Stromgleis aus / Timer läuft”
- Mega2 zeigt nur: “Strom über Threshold im Block …”
- Die UI stellt beide Infos dar, ohne daraus eine “gemeinsame” Warning abzuleiten.
- Vorteil: Keine Kopplung Mega1↔Mega2; Nachteil: Nutzer muss kombinieren.

**Option C – ESP/UI kombiniert (Komfort-Heuristik, nicht empfohlen für Safety-Logik)**
- ESP kombiniert Mega1-Kontext  Mega2-Strommessung und erzeugt UI-Warnhinweis.
- Vorteil: Schnell umzusetzen; Nachteil: verletzt Prinzip “ESP entscheidet nicht”.

##### Entscheidung
Die Entscheidung, ob und wie `WARN_BAHNHOF_DURCHFAHRT` umgesetzt wird, wird später getroffen.


Deprecated / Kompatibilität
  `WARN_WEICHEN_SLOW` (deprecated) → ersetzt durch `WARN_WEICHEN_NO_SWITCH`
- `WARN_BAHNHOFSDURCHFAHRT` (deprecated) → ersetzt durch `WARN_BAHNHOF_DURCHFAHRT`


8. Kommunikation (Safety-Contract)
Mega2 → ESP
{
  "safety": {
    "lock": true,
    "reason": "EMERG_DOPPELTE_BLOCKBELEGUNG",
    "errorType": 4,
    "errorIndex": 3
  }
}

ESP → UI

reine Abbildung

Texte & Farben aus Mapping

keine Interpretation

9. UI-Regeln (Kurz)
Zustand	Farbe	Overlay	ACK
OK	Grün	nein	nein
Warning	Gelb	nein	nein
Emergency	Rot	ja	ja
10. Zentrale Design-Entscheidungen

Trigger dürfen erkannt werden, auch im Not-Aus

Aktionen werden ggf. ignoriert, nicht Trigger

Safety ist zustandsgetrieben, nicht event-getrieben

UI folgt Safety, nicht umgekehrt

11. Status

✅ Safety-Konzept vollständig
✅ Mega1 / Mega2 klar getrennt
✅ UI-fähig
✅ erweiterbar (weitere Reasons möglich)