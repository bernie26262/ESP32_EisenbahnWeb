# Log-Policy & Debug-Hygiene (ESP32-S3 EisenbahnWeb)

Stand: 2026-02-08  
Branch: `debug/regression-2026-02-03`  
Baseline Tag: `esp-ws-diag-instant-2026-02-07`

## Ziel

- **Release-Build ist ruhig**: keine Debug-Spam-Logs, keine unnötigen Serial-Writes.
- **Debug ist schaltbar**: compile-time über `platformio.ini` build_flags.
- **Einheitliche Log-Policy**:
  - Keine nackten `Serial.print*` / `Serial.printf` für Debug-Ausgaben im aktiven Code.
  - Logging nur über `include/debug.h` Macros oder klar definierte Guards `#if EE_DEBUG_*`.
- **Keine Funktionsänderungen**: insbesondere bleibt die „diag instant“-Kopplung unangetastet:
  - `if (wantDirty) g_diagDirty = true;` in `Web::pushStateIfDirty()` bleibt wie im stabilen Stand.

## Single Source of Truth: `include/debug.h`

### Level (Defaults)

`debug.h` definiert die Level-Schalter (Default für Release):

- `EE_LOG_ENABLE_ERROR` = 1
- `EE_LOG_ENABLE_WARN`  = 1
- `EE_LOG_ENABLE_INFO`  = 0
- `EE_LOG_ENABLE_DEBUG` = 0

Makros:

- `EE_LOGE(tag, fmt, ...)` — Error
- `EE_LOGW(tag, fmt, ...)` — Warning
- `EE_LOGI(tag, fmt, ...)` — Info
- `EE_LOGD(tag, fmt, ...)` — Debug

Hinweis: Diese Makros schreiben **selbst** einen Zeilenumbruch. Daher **keine `\n`** in Formatstrings verwenden.

### Kategorien (Defaults: aus)

Folgende Kategorien sind per Default aus und erzeugen im Release **keine Serial-Ausgaben**:

- `EE_DEBUG_WS`
- `EE_DEBUG_WSLAT`
- `EE_DEBUG_HEAP`
- `EE_DEBUG_I2C`
- `EE_DEBUG_DRDY`
- `EE_DEBUG_SAFETY`
- `EE_DEBUG_DIAG`

Dazugehörige Makros:

- `LOG_WS(...)`
- `LOG_WSLAT(...)`
- `LOG_HEAP(...)`
- `LOG_I2C(...)`
- `LOG_DRDY(...)`
- `LOG_SAFETY(...)`
- `LOG_DIAG(...)`

## platformio.ini

### Release-Env (`env:esp32-s3-eth`)

- Keine `EE_DEBUG_*` aktiv
- `_ASYNC_WEBSERVER_LOGLEVEL_` im Release auf `0` (Library-internal logs aus)
- WiFi/BT hard-off bleibt aktiv (`ARDUINO_WIFI_DISABLED`, `WIFI_DISABLED`)

### Sim/Debug-Env (`env:esp32-s3-eth-sim`)

- Erbt Release-Flags via `extends`
- Aktiviert optional `EE_LOG_ENABLE_INFO/DEBUG`
- Kategorien werden gezielt eingeschaltet (Beispiele unten)

## Beispiele: Debug gezielt aktivieren

### Nur WebSocket Events + Latenz

In `platformio.ini` (z.B. im sim-env build_flags):

- `-DEE_LOG_ENABLE_INFO=1`
- `-DEE_LOG_ENABLE_DEBUG=1`
- `-DEE_DEBUG_WS=1`
- `-DEE_DEBUG_WSLAT=1`

Erwartung:
- WS connect/subscribe/action sichtbar (`[D][WS] ...`)
- WSLAT sichtbar (`[D][WSLAT] ...`)
- Rest weiterhin ruhig

### Nur I2C Scan / Bring-up

- `-DEE_LOG_ENABLE_DEBUG=1`
- `-DEE_DEBUG_I2C=1`

## Code-Regeln

1. **Keine nackten Debug-Serials** im aktiven Codepfad:
   - statt `Serial.printf("[WS] ...")` → `LOG_WS("...")`
   - statt `Serial.printf("[WSLAT] ...")` → `LOG_WSLAT("...")`
   - statt Heap-Dumps → `LOG_HEAP(...)`
2. **Keine `\n`** in `LOG_*` / `EE_LOG*` Formatstrings (Makros fügen selbst `println()` an).
3. Guards in C++ ausschließlich als:
   - `#if EE_DEBUG_*` (nicht `#if defined(DEBUG_*)`)
4. Sicherheits-/Fehlerlogs:
   - echte Fehler als `EE_LOGE`, wichtige Zustandswechsel als `EE_LOGW`
   - Debug/Info nur bei Bedarf aktivieren

## Verifikation (Definition of Done)

### Release

- Build: `pio run -e esp32-s3-eth`
- Serial: minimal (nur WARN/ERROR, keine Debug-Spam-Logs)
- UI bleibt „instant“ (diag/state behavior unverändert)

### Debug

- Build mit gezielten Flags
- Nur aktivierte Kategorien erscheinen im Serial-Log