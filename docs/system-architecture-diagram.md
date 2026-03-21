Architecture Diagram – Elektrische Eisenbahn

Dieses Dokument enthält eine grafische Architekturübersicht der Anlage.

Mermaid-Blockdiagramm
flowchart TB
    Browser["Web Browser\nindex.htm / diag.htm"]


    ESP["ESP32-S3-ETH\nZentrale\n- Webserver\n- WebSocket\n- UI / Diagnose\n- Protokoll / Statusaggregation"]


    Mega1["Mega1 – Bahnhof\n- Weichensteuerung\n- Rückmelder\n- Weichenselbsttest\n- Relais"]


    Mega2["Mega2 – Schattenbahnhof / Safety\n- Blocksteuerung\n- Strommessung\n- Spannungsmessung\n- Safety / SSR / Not-Aus"]


    UI["Web-UI\n- Blockzustände\n- Weichen\n- Spannungen\n- Ströme\n- Diagnose"]


    I2C["I²C-Bus\nESP ↔ Mega1 ↔ Mega2"]


    M1IO["Mega1-Feldseite\n- Weichenantriebe\n- Weichenrückmelder\n- Bahnhofskontakte"]


    M2IO["Mega2-Feldseite\n- Blockkontakte\n- Stromsensoren\n- Trafospannungsmessung\n- SBHF-Gleise"]


    Safety["Safety-Kette\n- SSR Main Enable\n- SSR Trafo A\n- SSR Trafo B\n- Not-Aus / Kurzschluss"]


    Browser <-->|"WebSocket"| ESP
    ESP --> UI


    ESP <-->|"proto_common.h / SystemStatus / BlockStatus"| I2C
    I2C <-->|"Status / Befehle"| Mega1
    I2C <-->|"Status / Befehle"| Mega2


    Mega1 --> M1IO
    Mega2 --> M2IO
    Mega2 --> Safety
Lesart

Der ESP32-S3-ETH ist die Zentrale für Webserver, WebSocket und Statusaggregation.

Mega1 steuert den Bahnhof, insbesondere Weichen, Relais und den Weichenselbsttest.

Mega2 übernimmt Schattenbahnhof, Blocklogik, Analogmessung und Safety.

Die Kommunikation zwischen ESP und beiden Megas läuft über I²C.

Die Weboberfläche zeigt die aggregierten Zustände aus allen Systemen an.

Funktionspfade
1. Anzeige in der Web-UI

Feldsensoren → Mega1/Mega2 → I²C → ESP → WebSocket → Browser

2. Blockbelegung

Blockkontakt oder Stromsensor → Mega2 Blocklogik → BlockStatus → ESP → UI

3. Safety

Kurzschluss / Not-Aus / Fehler → Mega2 Safety → SSR-Abschaltung + Statusmeldung → ESP → UI

ASCII-Übersicht
Web Browser
    │
    │ WebSocket
    ▼
ESP32-S3-ETH
    │
    │ I²C
    ├───────────────► Mega1 (Bahnhof / Weichen / Selbsttest)
    │                    └── Weichen, Rückmelder, Bahnhofskontakte
    │
    └───────────────► Mega2 (SBHF / Blocklogik / Analog / Safety)
                         ├── Blockkontakte
                         ├── Stromsensoren
                         ├── Trafospannungsmessung
                         └── SSR / Not-Aus / Kurzschlusslogik