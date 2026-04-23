# Safety-Architektur – Modellbahn Steuerung

## Ziel
Diese Architektur stellt sicher, dass **alle sicherheitsrelevanten Entscheidungen**
zentral und deterministisch auf **Mega2** getroffen werden.
Der ESP32 dient ausschließlich der Anzeige, Bedienung und Kommunikation
(WebUI), führt jedoch **keine eigene Safety-Logik** aus.

---

## Rollen der Komponenten

### Mega2 (Safety-Master)
- Verantwortlich für:
  - Not-Aus
  - Safety-Lock
  - Fehlererkennung (z. B. Kurzschluss, Weichenfehler)
  - SSR-Steuerung (Trafo A / B)
- Erzeugt:
  - `SystemStatus.flags`
  - `blockReason`
  - `errorCause / errorIndex / errorDetailCode`
- Ist **Single Source of Truth** für Safety

👉 Mega2 entscheidet **immer**, ob Leistung erlaubt ist.

---

### ESP32 (Visualisierung & Bedienung)
- Keine eigene Safety-Logik
- Aufgaben:
  - I2C-Polling von Mega2
  - Ableitung eines **reinen UI-Zustands**
  - WebSocket-State an Browser senden
  - Benutzeraktionen (ACK, PowerOn, Not-Aus) an Mega2 weiterleiten
- Enthält:
  - `SystemRuntimeState` (abgeleiteter Zustand)

👉 ESP32 darf **niemals** selbst Safety aufheben.

---

### WebUI (Browser)
- Reine Darstellung  Eingabe
- Zeigt:
  - Safety-Zustand
  - Klartextmeldungen
  - Overlay bei Sperre mit Ursache, Wirkung und Maßnahme
- Sendet:
  - `safetyAck`
  - `powerOn`
  - `nothalt`

👉 UI ist **zustandslos**, alles kommt vom ESP.

---

## Datenfluss (vereinfacht)

Mega2  
→ (I2C, SystemStatus V4 / 28 Byte)  
ESP32 `SystemRuntimeState`  
→ (WebSocket JSON mit `safety.errorCause`, `safety.errorIndex`, `safety.errorDetailCode`)  
Browser UI

---

## Grundprinzipien

- **Fail-Safe Default**
  - Nach Boot: Safety gesperrt
- **Keine doppelte Logik**
  - Safety-Entscheidungen nur auf Mega2
- **Klare Trennung**
  - Mega2 = Logik
  - ESP = Darstellung
  - UI = Bedienung

---

## Erweiterbarkeit

- Mega1 kann später:
  - Block- & Sensorstatus liefern
  - **ohne** Einfluss auf Safety
- Protokoll (`proto_common.h`) ist erweiterbar,
  bleibt aber semantisch identisch auf allen Boards