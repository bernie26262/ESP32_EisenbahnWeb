HMI Kommunikationsprotokoll (ETH ↔ HMI)

Stand: 2026-04-20
Projekt: Modelleisenbahn Steuerung

1. Überblick

Die Kommunikation zwischen ETH-Controller (ESP32-S3 ETH) und HMI erfolgt über UART.

Eigenschaften:

framing-basiert (binär + JSON)
robust gegen Teilframes
bidirektional (Action + State)
ACK-basiert synchronisiert
logisch getrennte Datenkanäle:
state-lite → Systemzustand (event-driven)
analog → Messwerte (periodisch)
2. Frame-Format
Feld	Größe	Beschreibung
Header	2 Byte	0xA5 0x5A
Length	2 Byte	Länge des JSON-Payloads
Payload	n Byte	JSON
Beispiel (konzeptionell)
[A5 5A] [len_hi len_lo] { JSON }
Parser-Verhalten (HMI)
wartet auf Header
liest Länge
sammelt Payload
verarbeitet nur komplette Frames
Wichtige Eigenschaften
Teilframes werden gepuffert
kein Reset bei Fehlern
Timeout-Handling:
Header-Timeout
Payload-Timeout
ungültige Frames werden verworfen, Zustand bleibt erhalten
3. Nachrichtentypen
Typ	Richtung	Beschreibung
state-lite	ETH → HMI	kompakter Systemzustand
analog	ETH → HMI	Messwerte
action	HMI → ETH	Benutzeraktionen
ack	HMI → ETH	Empfangsbestätigung
4. ACK-Mechanismus (NEU)
Ziel
kontrollierter Datenfluss
Vermeidung von UART-Überlast
deterministische Reihenfolge
Verhalten
ETH sendet immer nur einen Frame gleichzeitig
HMI sendet nach Verarbeitung:
{ "type": "ack" }
erst danach sendet ETH den nächsten Frame
Eigenschaften
verhindert Frame-Stau
vermeidet Parser-Überlauf im HMI
reduziert „late/stale“ Effekte
5. state-lite
Ziel
vollständiger UI-Zustand
kompakt und deterministisch
nur relevante Daten
Eigenschaften
event-driven (on-change)
zusätzlich periodischer Refresh (~1s)
Hash-basierte Deduplizierung
Coalescing (~200 ms) zur Bündelung von Updates
Beispielstruktur
{
  "type": "state-lite",
  "eth": {
    "connected": true,
    "ip": "192.168.1.100"
  },
  "mega1": {
    "online": true,
    "modeAuto": true
  },
  "mega2": {
    "online": true
  },
  "startup": {
    "ready": true,
    "m1SelftestDone": true,
    "m2SelftestDone": true
  },
  "safety": {
    "lock": false,
    "ackRequired": false,
    "notausActive": false,
    "powerOn": true
  },
  "summary": {
    "warningPresent": false
  },
  "wsClients": {
    "count": 1
  }
}
Startup-Checklist-Semantik (wichtig)
- `startup.m1SelftestDone` / `startup.m2SelftestDone` beschreiben den **technischen Schrittstatus** des jeweiligen Selbsttests.
- `startup.m1Needs` / `startup.m2Needs` sind **Startup-Checklist-Latches pro aktuellem Mega-Boot**.
- Ein erfolgreicher Selftest setzt den Schritt auf „done“, schließt aber die Startup-Checklist **noch nicht automatisch**.
- Die Startup-Checklist bleibt auf WebUI und HMI sichtbar, bis der Benutzer sie explizit quittiert.
- Nach einem reinen ETH-Reboot wird eine noch offene Startup-Checklist aus den Mega-Daten korrekt rekonstruiert und erneut angezeigt.
- `startup.ready` bedeutet: alle für den aktuellen Boot benötigten Startup-Schritte sind technisch erledigt; die Checklist kann dann quittiert werden.

Wichtige Semantik
Merge-Logik im HMI
JSON wird nicht als Vollzustand interpretiert
sondern:

→ Merge in bestehenden Zustand

Vorteile
kein Flackern
keine falschen Defaults
stabile Anzeige bei Teilupdates
6. analog
Ziel
entkoppelte Übertragung
konstante Rate (~500 ms)
keine UI-Blockade
Eigenschaften
eigener Push-Pfad
unabhängig von state-lite
kann temporär unterdrückt werden (z. B. nach Aktionen)
Beispiel
{
  "type": "analog",
  "vA10": 145,
  "vB10": 138,
  "currents": [120, 0, 35]
}
Semantik
Spannung: value / 10
Ströme: mA
Designentscheidung

Trennung von state-lite und analog:

→ reduziert:

UART-Last
UI-Lag
unnötige Re-Renders
7. Aktionen (HMI → ETH)
Format
{
  "type": "action",
  "action": "powerOn"
}
Typische Aktionen
Action	Bedeutung
powerOn	Anlage einschalten
powerOff	Anlage ausschalten
setAuto	Auto-Modus
setManual	Manuell
startupAck	Overlay quittieren
retryM1	Mega1 Selbsttest
retryM2	Mega2 Selbsttest
m1WeicheSet	Weiche stellen
Verhalten ETH
validiert Aktion
führt lokal aus oder delegiert an:
Mega1
Mega2
Safety
8. TX-Guard & Flow-Control (NEU)
Problem

Nach lokalen Aktionen entstehen schnelle Zustandsänderungen → Gefahr von:

veralteten Frames („stale“)
Reihenfolgeproblemen
UI-Flackern
Lösung
1. TX-Guard

Nach HMI-Aktion:

kurze Sendepause (~200 ms)
keine alten Frames mehr senden
2. State-Suppression
state-lite wird kurz verzögert
danach gezielt neu gesendet
3. Analog-Suppression
analog wird temporär blockiert
verhindert Überholen von state-lite
4. Delayed Force-Full
gezielter Full-Refresh nach Aktion
garantiert konsistenten Zustand
9. Update-Strategie ETH → HMI

Kombination aus:

1. On-Change Push
bei Zustandsänderung
mit Hash-Vergleich
identische Payloads werden verworfen
2. Periodic Push (~1s)
„Ground Truth“
verhindert Drift
3. ACK-gesteuertes Senden
genau ein Frame gleichzeitig
10. HMI-Rendering
Eigenschaften
selektive Updates (nur geänderte Werte)
tab-basierte Aktualisierung
Debug-Tab throttled (~250 ms)
Ziel
minimale CPU-Last
flüssige UI
11. Fehlerbehandlung
UART
Frame-Timeouts
Length-Checks
Overflow-Zähler
JSON
parse errors → gezählt
Frame verworfen
Zustand bleibt erhalten
12. Typische Probleme
Problem	Ursache
jsonErr	UART-Störungen
Verzögerung	fehlendes ACK oder zu hohe Rate
Flackern	fehlende Suppression
„late/stale“ Frames	fehlender TX-Guard
13. Designprinzipien
deterministisch
fehlertolerant
entkoppelt
keine Floats
kleine Payloads
ACK-basierter Flow
14. Erweiterungen (optional)
CRC im Frame
Versionierung im JSON
adaptive Rate
höhere Baudrate (z. B. 230400)
15. Fazit

Das Protokoll ist:

stabil
effizient
robust gegen Störungen
optimiert für Embedded + UI
skalierbar für höhere Datenraten
Wichtig

Diese Version beschreibt jetzt wirklich den aktuellen Stand mit:

ACK-Flow
Guard-Mechanismus
Suppression
Coalescing
Rendering-Optimierungen

16. Timing-Diagramme (Verhalten in der Praxis)
16.1 Normaler Update-Zyklus
ETH                          HMI
 |                            |
 |--- state-lite -----------> |
 |                            | parse + merge + UI
 | <--------- ack ----------- |
 |                            |
 |--- analog ---------------> |
 |                            | parse + merge + UI
 | <--------- ack ----------- |
Eigenschaften
strikt sequenziell
genau ein ETH→HMI-Frame gleichzeitig
ACK bestimmt den Versand des nächsten Frames
deterministische Reihenfolge
16.2 Nach Benutzeraktion (z. B. Weiche stellen)
HMI                          ETH
 |                            |
 |--- action ---------------> |
 |                            | Aktion ausführen
 |                            | TX-Guard aktiv
 |                            | state-lite kurz unterdrücken
 |                            | analog kurz unterdrücken
 |                            |
 |                            | delayed forceFull
 |--- state-lite -----------> |
 |                            | parse + merge + UI
 | <--------- ack ----------- |
 |                            |
 |--- analog ---------------> |
 |                            | parse + merge + UI
 | <--------- ack ----------- |
Eigenschaften
alte Frames werden verworfen
Queue wird bereinigt
erster sichtbarer Zustand nach Aktion ist konsistent
analog folgt kontrolliert erst danach
16.3 Historischer Problemfall ohne Guarding
HMI                          ETH
 |                            |
 |--- action ---------------> |
 |                            |
 |--- old state-lite ------> |
 |--- analog --------------> |
 |--- new state-lite ------> |
Typischer Effekt
veraltete Zustände erscheinen kurz im HMI
Flackern / Springen
stale / late ACKs
instabile Reaktionszeit
Status

Dieser Fall wurde durch folgende Mechanismen deutlich entschärft:

ACK-gesteuerter Versand
TX-Guard nach Aktionen
Suppression von state-lite
Suppression von analog
Queue-Cleanup / Drop veralteter Frames
16.4 Coalescing bei schnellen Änderungen
ETH intern:

change1
change2
change3
   ↓
   (Coalescing-Fenster)
   ↓
1x state-lite
Effekt
weniger UART-Last
weniger Render-Last im HMI
weniger unnötige Zwischenzustände
16.5 Periodic Refresh
ETH                          HMI
 |                            |
 |--- state-lite (periodic) ->|
 |                            | merge
 | <--------- ack ----------- |
Zweck
verhindert Drift
korrigiert verlorene Zwischenzustände
stellt konsistenten UI-Zustand sicher
16.6 Debug-Tab Verhalten
state-lite arrives
   ↓
UI Update (nur aktiver Tab)

Debug-Tab:
   throttled
Effekt
reduziert CPU-Last
verhindert, dass der Debug-Tab die restliche UI ausbremst
andere Tabs reagieren flüssiger
16.7 Bottleneck-Analyse
Aktueller Zustand

Typische Größenordnungen aus Logs:

state-lite: ACK meist ca. 143–151 ms
analog: ACK meist ca. 17–23 ms
Interpretation
große state-lite-Frames werden aktuell primär durch UART-Übertragung dominiert
das HMI-Rendering ist inzwischen oft kleiner als die reine Übertragungszeit
auf dem Debug-Tab kann die HMI-UI zusätzlich bremsen
Erwartung bei 230400 Baud
state-lite: grob Richtung 70–90 ms
analog: grob Richtung 9–12 ms
Schlussfolgerung
aktuell ist UART noch ein wesentlicher Engpass
mit höherer Baudrate verschiebt sich der Bottleneck zunehmend in Richtung HMI-Verarbeitung / Rendering
16.8 Gesamtverhalten (vereinfacht)
[Action]
   ↓
[TX-Guard]
   ↓
[state-lite]
   ↓
[ACK]
   ↓
[analog]
   ↓
[ACK]
17. Log → Diagramm Mapping

Dieser Abschnitt hilft dabei, echte Logs schnell dem erwarteten Ablauf zuzuordnen.

17.1 Normalfall
Typischer Log-Ausschnitt
[HMIUART] TX seq=... kind=state-lite ...
[HMIUART] ACK matched seq=... dtMs=143
[HMIUART] TX seq=... kind=analog ...
[HMIUART] ACK matched seq=... dtMs=18
Bedeutung

Das entspricht dem normalen Zyklus aus Abschnitt 16.1:

ETH sendet state-lite
HMI bestätigt
ETH sendet analog
HMI bestätigt
Bewertung
gesund
stabil
gewünschter Normalzustand
17.2 Lokale Aktion mit Guarding
Typischer Log-Ausschnitt
[HMI] action=m1WeicheSet
[HMIUART] reset local-cmd suppressAllTx ...
[HMIPUSH] suppressStateLite ...
[HMIPUSH] suppressAnalog ...
[HMIPUSH] forceFullDelayed ...
...
[HMIUART] TX seq=... kind=state-lite ...
[HMIUART] ACK matched seq=... dtMs=143
Bedeutung

Das entspricht Abschnitt 16.2:

lokale Aktion kommt an
ETH räumt auf
ETH wartet kurz
danach wird ein frischer Zustand gesendet
Bewertung
gewünschtes Verhalten nach Benutzeraktion
Schutz gegen alte / falsche Zwischenzustände
17.3 Late-after-drop
Typischer Log-Ausschnitt
[HMIUART] reset local-cmd drop inFlight kind=state-lite seq=...
[HMIUART] ACK late-after-drop seq=...
Bedeutung
ETH hat ein veraltetes in-flight-Frame bewusst verworfen
das ACK dieses Frames kommt trotzdem noch verspätet an
dieses ACK wird korrekt ignoriert
Bewertung
normal
unkritisch
Folge des Schutzmechanismus
17.4 ACK overdue
Typischer Log-Ausschnitt
[HMIUART] ACK overdue seq=... ageMs=300 ...
Bedeutung
ACK kam nicht im erwarteten kurzen Zeitfenster
das ist zunächst nur ein Warnsignal
das Frame kann trotzdem noch erfolgreich bestätigt werden
Bewertung
einzeln unkritisch
häufiges Auftreten ist ein Hinweis auf Engpass oder Lastspitze
17.5 ACK drop/reset
Typischer Log-Ausschnitt
[HMIUART] ACK drop/reset seq=... kind=state-lite ...
Bedeutung
ein Frame wurde endgültig als überholt / verloren behandelt
ETH setzt die Kette zurück
ein neueres Frame wird später gesendet
Bewertung
tolerierbar, wenn selten
problematisch, wenn gehäuft
war historisch ein Hauptsymptom vor Einführung von ACK-Gating und Guarding
17.6 DIRTY skip same-hash
Typischer Log-Ausschnitt
[HMIPUSH] DIRTY skip same-hash ...
Bedeutung
ETH hat eine Zustandsänderung geprüft
die resultierende Payload ist identisch zur letzten
deshalb wird kein unnötiges Frame gesendet
Bewertung
erwünscht
reduziert Last
Zeichen für funktionierende Deduplizierung
17.7 Queue replace kind=analog / kind=state-lite
Typischer Log-Ausschnitt
[HMIUART] QUEUE replace kind=analog ...
[HMIUART] QUEUE replace kind=state-lite ...
Bedeutung
in der Queue wurde ein älteres noch nicht gesendetes Frame durch ein neueres ersetzt
relevant vor allem für „latest state wins“
Bewertung
erwünscht
verhindert Queue-Wachstum
hält die Anzeige auf aktuellem Stand statt alte Zwischenzustände nachzuliefern
17.8 Praktische Faustregel zur Logbewertung
Gut
viele ACK matched
wenige oder keine ACK drop/reset
DIRTY skip same-hash tritt regelmäßig auf
lokale Aktionen führen nach kurzer Guard-Phase zu sauberem state-lite
Warnsignal
viele ACK overdue
wiederholte ACK drop/reset
häufige stale-/late-Muster ohne lokale Aktion
sichtbare Verzögerung trotz sauberer Logik
Wahrscheinliche Ursache je nach Muster
Logmuster	Wahrscheinliche Ursache
ACK matched state-lite ~143 ms stabil	Normalbetrieb bei 115200 Baud
viele ACK drop/reset state-lite	UART-/Timing-Engpass oder ungünstiges Timingfenster
late-after-drop direkt nach Aktion	normaler Nebeneffekt von aktivem Guarding
Debug-Tab träge, Logs aber sauber	HMI-UI-/Renderlast statt Transportproblem
Fazit (Timing)

Das Gesamtsystem arbeitet inzwischen:

ACK-gesteuert
deterministisch
fehlertolerant
robust gegen ungünstige Race Conditions nach Benutzeraktionen

Die Timing-Diagramme und das Log-Mapping helfen dabei, schnell zu unterscheiden, ob ein Problem eher in:

ETH-Transport
Queue-/ACK-Logik
Guarding
oder HMI-Rendering

liegt.