# Log-Policy & Debug-Hygiene (ESP32-S3 EisenbahnWeb)

Stand: 2026-02-09  
Branch: `debug/regression-2026-02-03`

---

## Ziel

- **Release-Build ist ruhig**: keine Debug-Spam-Logs, keine unnötigen `Serial`-Writes.
- **Debug ist schaltbar**: compile-time über `platformio.ini` (`EE_*` Flags).
- **Einheitliche Log-Policy**:
  - Keine nackten `Serial.print*` / `Serial.printf` für Debug-Ausgaben im aktiven Code.
  - Logging ausschließlich über `include/debug.h` Makros oder klar definierte Guards `#if EE_DEBUG_*`.
- **Keine Funktionsänderungen**: insbesondere bleibt die „diag instant“-Kopplung unangetastet.

---

## Single Source of Truth: `include/debug.h`

Alle Log-Level, Kategorien und Defaults werden **zentral** in `include/debug.h` definiert.  
Andere Dateien **definieren keine eigenen Debug-Flags**.

### Log-Level (Release-Defaults)

| Level | Macro | Release | Bedeutung |
|------|------|---------|-----------|
| ERROR | `EE_LOGE` | an | Echter Fehlerzustand |
| WARN  | `EE_LOGW` | an | Kritischer / ungewöhnlicher Zustand |
| INFO  | `EE_LOGI` | aus | Normale Betriebsinfos |
| DEBUG | `EE_LOGD` | aus | Detail- / Entwicklerinfos |

**Wichtig:**  
`EE_LOG*` / `LOG_*` fügen **selbst** den Zeilenumbruch hinzu → **keine `\n` in Formatstrings verwenden**.

---

### Debug-Kategorien (Release-Defaults: aus)

| Kategorie | Flag | Zweck |
|---------|------|-------|
| WS | `EE_DEBUG_WS` | WebSocket Events (connect / subscribe / action) |
| WSLAT | `EE_DEBUG_WSLAT` | Latenzen beim State/Diag Push |
| I2C | `EE_DEBUG_I2C` | I²C Scan & Detail-Reads |
| HEAP | `EE_DEBUG_HEAP` | Heap- / Speicherdiagnose |
| DRDY | `EE_DEBUG_DRDY` | DataReady / Interrupt-Signale |
| SAFETY | `EE_DEBUG_SAFETY` | Sicherheitslogik |
| DIAG | `EE_DEBUG_DIAG` | Diagnose-Modus |

Makros:  
`LOG_WS`, `LOG_WSLAT`, `LOG_I2C`, `LOG_HEAP`, `LOG_DRDY`, `LOG_SAFETY`, `LOG_DIAG`

---

## Bedeutung der Log-Level (Klartext)

### ERROR (`EE_LOGE`)
**Was heißt das?**  
Ein **echter Fehler**, der den Betrieb verhindert oder unzulässig macht.

- **Immer sichtbar**, auch im Release
- Sollte selten auftreten

**Beispiele:**
- Ethernet-Initialisierung schlägt fehl
- `ETH.config(Fallback)` fehlgeschlagen
- LittleFS nicht mountbar

**Leitlinie:**  
> System kann so nicht sinnvoll weiterlaufen → **ERROR**

---

### WARN (`EE_LOGW`)
**Was heißt das?**  
Ein **kritischer oder sicherheitsrelevanter Zustand**, der noch keinen Abbruch erzwingt.

- **Im Release sichtbar**
- System läuft weiter, aber mit Einschränkungen

**Beispiele:**
- DHCP fehlgeschlagen → Fallback-IP
- Ethernet Link down / up
- Not-Halt aktiviert oder aufgehoben
- Ablauf eines Diagnose-Leases

**Leitlinie:**  
> Aufmerksamkeit nötig, aber kein sofortiger Abbruch → **WARN**

---

### INFO (`EE_LOGI`)
**Was heißt das?**  
Normale Betriebsinformationen zum Verständnis des Systemzustands.

- **Im Release standardmäßig aus**
- Bei Bedarf aktivierbar (`EE_LOG_ENABLE_INFO`)

**Beispiele:**
- Boot-Banner
- Ethernet erfolgreich gestartet
- IP-/Gateway-Informationen
- Setup abgeschlossen

**Leitlinie:**  
> Gut zu wissen, aber nicht nötig für den Betrieb → **INFO**

---

### DEBUG (`EE_LOGD`)
**Was heißt das?**  
Detail- und Diagnoseinformationen für Entwickler.

- **Im Release immer aus**
- Kann sehr häufig auftreten

**Beispiele:**
- WebSocket connect / subscribe / action
- WSLAT Messungen
- I²C Scan & Detail-Reads
- Heap-Status

**Leitlinie:**  
> Nur für Entwicklung und Fehlersuche → **DEBUG**

---

## Zusammenspiel von Leveln und Kategorien

Es gilt eine **zweistufige Filterung**:

### 1) Level (global)
Steuert **ob** Logs eines Levels grundsätzlich ausgegeben werden dürfen:

- `EE_LOG_ENABLE_INFO`
- `EE_LOG_ENABLE_DEBUG`

### 2) Kategorien (thematisch)
Steuern **welche Themen** Debug-Logs erzeugen dürfen.

**Beispiel:**
```ini
-DEE_LOG_ENABLE_DEBUG=1
-DEE_DEBUG_WS=1
→ Debug-Ausgaben nur für WebSockets.

1-seitige Kurzfassung (Spickzettel)

Release: nur ERROR und WARN

INFO / DEBUG: nur bei Bedarf aktivieren

Level = Wichtigkeit

Kategorien = Themen

Keine nackten Serial.print* im aktiven Code

Keine \n in LOG_* / EE_LOG* Strings

Typische Debug-Aktivierungen:

WS debuggen: EE_LOG_ENABLE_DEBUG=1 + EE_DEBUG_WS=1

Latenzen debuggen: EE_DEBUG_WSLAT=1

I²C Bring-up: EE_DEBUG_I2C=1

Tabelle: Wann benutze ich welches Level?
Situation	Level	Begründung
System startet nicht / kann nicht weiterlaufen	ERROR	Betrieb unmöglich
Abweichung / Fallback / sicherheitsrelevant	WARN	Aufmerksamkeit nötig
Normale Status- oder Startinfo	INFO	Verständnis, kein Zwang
Detail zur Fehlersuche	DEBUG	Nur für Entwickler
Verifikation (Definition of Done)
Release

Build: pio run -e esp32-s3-eth

Serial: nur ERROR / WARN

UI / Diag bleibt instant

Debug

Build mit gezielten EE_DEBUG_*

Nur aktivierte Kategorien erscheinen

Verbindliche Code-Regeln

Keine nackten Debug-Serial.print* im aktiven Code

Guards ausschließlich #if EE_DEBUG_*

LOG_* / EE_LOG* ohne \n

ERROR/WARN = Betrieb & Sicherheit

INFO/DEBUG = Entwicklung