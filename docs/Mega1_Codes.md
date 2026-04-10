# Mega1 Codes: Flags, Errors, Warnings, Masks (Stand 2026-04-10)

Diese Datei dokumentiert die verwendeten Bitmasks/Enums sowie die relevanten I2C Command IDs & Payloads für **Mega1 (Weichen/Bahnhof)**.
Analog zu `Mega2_Codes.md`.

---

## 1) SystemStatus (I2C SystemStatus v3)

Mega1 liefert seinen “Global Status” als `SystemStatus` (v3, packed, **26 bytes**).

### 1.1 SystemStatusFlags (uint16_t flags)
- `SYS_OK` = `0x0000`
- `SYS_NOTAUS_ACTIVE` = `0x0001`  (bit0)
- `SYS_POWER_ON` = `0x0002`       (bit1)
- `SYS_ERROR_PRESENT` = `0x0004`  (bit2)
- `SYS_CONTROLLER_RESET` = `0x0008` (bit3)
- `SYS_WARNING_PRESENT` = `0x0010`  (bit4)

### 1.2 NodeId (SystemStatus.nodeId)
- `NODE_NONE`  = 0
- `NODE_MEGA1` = 1
- `NODE_MEGA2` = 2

### 1.3 SystemStatus Struktur (packed, 26 bytes)
Felder:
- `version` (uint8) = 3
- `nodeId` (uint8) = `NODE_MEGA1`
- `size` (uint16) = 26
- `uptimeMs` (uint32)
- `bootId` (uint16)
- `flags` (uint16)
- `safetyErrorType` (uint8)
- `safetyErrorIndex` (uint8)
- `blockOccupiedMask` (uint16)  (für Mega1 i.d.R. 0)
- `sbhfState` (uint8)           (für Mega1 i.d.R. 0)
- `sbhfOccupiedMask` (uint8)    (für Mega1 i.d.R. 0)
- `sbhfCurrentGleis` (uint8)
- `_pad0` (uint8)
- `turnoutSollMask` (uint16)
- `turnoutIstMask` (uint16)
- `reserved` (uint16)

Hinweis: Obwohl Felder “SBHF” heißen, wird das Format systemweit vereinheitlicht genutzt.

---

## 2) Mega1 I2C Address

- `I2C_ADDR_MEGA1` = `0x10`

---

## 3) DRDY / Pending Mask (uint16_t)

### 3.1 DRDY Semantik (Mega1 -> ESP)
- DRDY idle = HIGH (open-drain high-Z)
- DRDY active = LOW
- DRDY bleibt LOW solange `pendingMask != 0`
- Clear-on-read: nach erfolgreichem Read wird das jeweilige Pending-Bit gelöscht; wenn alle Bits gelöscht sind, geht DRDY wieder HIGH.

### 3.2 Pending Bits (pendingMask)
- `M1_PEND_STATUS` = `0x0001`
- `M1_PEND_DIAG`   = `0x0002`

---

## 4) Mega1 I2C Command IDs (uint8_t)

Aus `I2CProtocol.h`:

### 4.1 Read / Snapshot
- `CMD_GET_STATUS`        = `0x01`
- `CMD_GET_DIAG`          = `0xD1`  (Master schreibt 1 Byte CMD, danach Read <=32B)
- `CMD_GET_PENDING_MASK`  = `0xE0`  (read-only -> uint16_t pendingMask)

### 4.2 Commands (Master -> Mega1)
- `CMD_SET_MODE`         = `0x02`  payload: `[cmd, mode]`
- `CMD_SET_WEICHE`       = `0x03`  payload: `[cmd, idx, gerade(0/1)]`
- `CMD_RELEASE_BHF`      = `0x04`
- `CMD_ACK_ERROR`        = `0x05`
- `CMD_SET_BHF_POWER`    = `0x06`  payload: `[cmd, bhf(0..3), on(0/1)]`
- `CMD_START_SELFTEST`   = `0x07`  payload: `[cmd]`

ACK Verhalten (ESP-Seite erwartet 1 Byte):
- `ack = 1` -> OK
- `ack = 0` -> FAIL
- `ack = 2` -> BUSY (optional)

---

## 5) Error Flags (Mega1StatusPayload.errorFlags / bzw. Mega1 intern)
- `ERR_WEICHE` = `0x01`

---

## 6) Weichen: Indizes & Bitmasks

Aus `pins_mega1.h`:
- `NUM_WEICHEN` = 12  (Weiche 0..11)

In Diagnose/Status Bitmasks gilt:
- Bit `i` repräsentiert Weiche `i` (0..11)

### 6.1 Richtung / Stellung (types.h)
- `GERADE`   = 0
- `ABBIEGEN` = 1

### 6.2 Modus (Modus.h)
- `MANUELL`   = 0
- `AUTOMATIK` = 1

---

## 7) Bahnhöfe (BHF) / PowerMask

Aus `pins_mega1.h`:
- `BHF_COUNT` = 4  (Bahnhof 0..3)

PowerMask Bits (Mega1DiagV1.powerMask):
- Bit `i` (0..3): `1 = Stromgleis AN (Signal grün)`, `0 = AUS (Signal rot)`

---

## 8) Mega1DiagV1 (CMD_GET_DIAG = 0xD1)

`Mega1DiagV1` ist `packed` und **<= 32 bytes** (static_assert).
Felder:

- `version` (uint8) = 1
- `flags` (uint8): bit0 = valid
- `seq` (uint8): monotonic counter (wrap ok)
- `mode` (uint8): 0=MANUELL, 1=AUTOMATIK
- `warnings` (uint16): bitfield (aktuell frei/0)

Weichen-Bitmasks (Bit i = Weiche i 0..11):
- `weicheIstGeradeBits` (uint16): Rückmelder sagt “gerade”
- `weicheSlowActiveBits` (uint16): Reduktions-Relais aktiv (pinRed LOW)
- `weicheSollGeradeBits` (uint16): letzter Sollzustand “gerade”

- `powerMask` (uint8): Bit i (0..3) = Bahnhof Stromgleis AN
- `uptime16` (uint16): uptime/100ms (wrap ok)

Startup/Selbsttest:
- `selftestFlags` (uint8)
  - bit0: running
  - bit1: done
  - bit2: hasFail (Quick-Flag)
- `selftestFailMask` (uint16): Bit i = FAIL bei Weiche i (0..11)
- `selftestCurrentIdx` (uint8): 0..11, 0xFF = none


Digitale Sensoren (neu, Diagnose):
- `sensorActiveMask` (uint32):
  - Bit i = 1 bedeutet: Sensor Si ist **logisch aktiv**
  - Konvention: Sensoren sind `INPUT_PULLUP` verdrahtet ⇒ **LOW = aktiv**
  - Damit ist `sensorActiveMask` i.d.R. die invertierte elektrische Pegellogik.

- `sensorRiseMask` (uint32):
  - Bit i = 1 bedeutet: seit dem letzten erfolgreichen DIAG-Read wurde eine
    **logische Rising Edge (0→1, wurde aktiv)** erkannt.

- `sensorFallMask` (uint32):
  - Bit i = 1 bedeutet: seit dem letzten erfolgreichen DIAG-Read wurde eine
    **logische Falling Edge (1→0, wurde inaktiv)** erkannt.

Sticky-Verhalten:
`sensorRiseMask` und `sensorFallMask` sind „sticky since last DIAG read“ und werden nach
einem erfolgreichen `CMD_GET_DIAG` Read zurückgesetzt.

Hinweis zur Anlagen-Nummerierung / Gaps:
Auf Mega1 werden aktuell nur folgende Sensoren ausgewertet: `S0..S10, S18, S19, S22, S23`.
Nicht genutzte Bits (z.B. S11..S17, S20..S21) bleiben 0.

---

## 9) Mega1StatusPayload (Legacy/optional)

Hinweis: Es existiert zusätzlich ein “klassischer” Mega1-Statuspayload `Mega1StatusPayload` (nicht packed), typisch **36 bytes**.
Er wird aktuell in der Core2-ESP Implementierung nicht als “Global Status” verwendet (dort wird `SystemStatus` genutzt),
ist aber für Debug/Altpfad dokumentiert.

Felder (Auszug):
- `bootId` (uint16)
- `kontaktBits` (uint16)
- `weichenBits / weichenIstBits / weichenOkBits` (uint16)
- `modus` (uint8), `activeRoute` (int8), `errorFlags` (uint8)
- `fsCounter[NUM_STW_FS]` (aktuell NUM_STW_FS=6)
- diverse last* Debug Bytes
- `bhfOccupied[4]`, `bhfPower[4]`, `bhfTimerRunning[4]`
- `lastBhfEvent` (uint8)

Wichtiger Hinweis:
- `kontaktBits` ist der ältere Statuspfad und aktuell nur **16 Bit** breit.
- Für die Diagnose-Seite `/diag.htm` werden die Sensorsignale maßgeblich über
  `sensorActiveMask`, `sensorRiseMask` und `sensorFallMask` transportiert.

---

## 10) Fahrstraßen

Aus `Fahrstrassen_defs.h`:
- `NUM_STW_FS` = 6  (Index 0..5)

Hinweis: Die konkreten Schrittdefinitionen (SensorIndex/ResetSensors/Steps) liegen i.d.R. in Implementierung/Arrays,
die IDs werden typischerweise als Array-Index verwendet.

Aktueller Stand fachlich:
- `FS0`: Zusatzregel bei S0: wenn W0 IST gerade, dann W1 gerade
- `FS1`: Odd/Even
- `FS2`: bei S4 zusätzlich W0 abbiegen
- `FS3`: bei S7 zusätzlich W0 abbiegen
- `FS4`: W9 abhängig vom Zählerstand
- `FS5`: neuer Trigger S18 → W0 gerade
