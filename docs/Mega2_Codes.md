# Mega2 Codes: Flags, Errors, Warnings, Masks (Stand 2026-01-24)

Diese Datei dokumentiert die verwendeten Bitmasks/Enums im Mega2-Projekt.

## 1) SystemStatus (I2C SystemStatus v3)

### 1.1 SystemStatusFlags (uint16_t flags)
- `SYS_OK` = `0x0000`
- `SYS_NOTAUS_ACTIVE` = `0x0001`  (bit0)
- `SYS_POWER_ON` = `0x0002`       (bit1)
- `SYS_ERROR_PRESENT` = `0x0004`  (bit2)
- `SYS_CONTROLLER_RESET` = `0x0008` (bit3)
- `SYS_WARNING_PRESENT` = `0x0010`  (bit4)

### 1.2 SafetyErrorType (SystemStatus.safetyErrorType)
Aus `include/safety_error.h`:
- `SAFETY_ERR_NONE` = 0
- `SAFETY_ERR_NOTAUS` = 1
- `SAFETY_ERR_BLOCK_SHORT` = 2
- `SAFETY_ERR_SBH_WEICHE` = 3
- `SAFETY_ERR_SSR_STUCK` = 4
- `SAFETY_ERR_DOUBLE_OCCUPANCY` = 5
- `SAFETY_ERR_CONTROLLER_FAULT` = 6

`SystemStatus.safetyErrorIndex`:
- Index (Block/Weiche/0) je nach ErrorType

### 1.3 blockOccupiedMask (uint16_t)
- Bit0 = Block 1
- ...
- Bit8 = Block 9

### 1.4 SBHF Felder (kompakt)
- `sbhfState` = interner SBHF-Automat (siehe SBhfState unten)
- `sbhfOccupiedMask` = 3 Bits Belegung (Gleis1..3) + Meta-Bits:
  - Bit0..2: SBHF-Gleis 1..3 belegt
  - Bit7 (`0x80`): Selftest läuft (META, ohne Protokoll-Bump)

### 1.5 reserved (uint16_t) – Variant A
Kodierung: `reserved = (allowedMask << 8) | warningMask`

- `allowedMask` (high byte): erlaubte SBHF-Gleise (bit0..2)
- `warningMask` (low byte): SBHF Warnungen (siehe SbhfWarning)

---

## 2) SBHF: Automatenzustände (SBhfState)
Aus `include/ShadowYardController.h`:
- `Idle` = 0
- `PrepareExit` = 1
- `SettingWeichen` = 2
- `WaitBlock6` = 3
- `ExitRunning` = 4
- `Error` = 5

---

## 3) SBHF: Warnungen (SbhfWarning, uint8_t warningMask)
Aus `include/ShadowYardController.h`:

- `SBHF_WARN_NONE` = `0x00`
- `SBHF_WARN_RESTRICTED` = `0x01`  
  Betrieb eingeschränkt (allowedMask != 0b111)

Weichenfehler (Defect):
- `SBHF_WARN_W12_DEFECT` = `0x02`
- `SBHF_WARN_W13_DEFECT` = `0x04`
- `SBHF_WARN_W14_DEFECT` = `0x08`
- `SBHF_WARN_W15_DEFECT` = `0x10`

Hinweis:
- Diese Warnbits gelten nur im Kontext `warningMask` (SBHF).
- Der Wert `0x02` kann in anderen *unabhängigen* Masks ebenfalls vorkommen (z.B. SSR-Mask, Analog-Flags), ist dort aber ein anderes Feld.

---

## 4) DRDY Pending Mask (Mega2PendingMaskPayload.mask, uint16_t)
Aus `include/proto_common.h`:

- `M2_PEND_SAFETY` = `0x0001`
- `M2_PEND_ENTRY` = `0x0002`
- `M2_PEND_ENTRY_PREV` = `0x0004`
- `M2_PEND_BLOCKS` = `0x0008`
- `M2_PEND_SHADOW` = `0x0010`
- `M2_PEND_TURNOUTS` = `0x0020`

`M2_PEND_ALL_DIGITAL` = OR über alle oben (ohne Analog)

---

## 5) Mega2SafetyStatus (I2C Payload)
Aus `include/proto_common.h`:

### 5.1 ssrMask (uint8_t)
- Bit0 (`0x01`) = SSR_MAIN_ENABLE
- Bit1 (`0x02`) = SSR_TRAFO_A
- Bit2 (`0x04`) = SSR_TRAFO_B

### 5.2 SafetyBlockReason (uint8_t blockReason)
Aus `include/proto_common.h`:
- `SAFETY_BLOCK_NONE` = 0
- `SAFETY_BLOCK_BOOT` = 1
- `SAFETY_BLOCK_NOTAUS` = 2 (Alias `SAFETY_BLOCK_EMERGENCY`)
- `SAFETY_BLOCK_SHORT` = 3
- `SAFETY_BLOCK_SSR_STUCK` = 4

---

## 6) Mega2AnalogPayload.flags (uint8_t)
Aus `src/Mega2I2C.cpp` Kommentar:
- Bit1 (`0x02`) = Voltages invalid (solange Spannungsmessung noch nicht sauber/verdrahtet ist)
(weitere Bits aktuell nicht definiert)
---

## 7) Mega2 I2C Command IDs (uint8_t)
Aus `include/proto_common.h`:

- `M2_CMD_SET_NOTAUS` = `0x10`  ([cmd, 0/1])
- `M2_CMD_SET_SSR` = `0x11`  ([cmd, ssrIndex, 0/1])
- `M2_CMD_ACK_ERROR` = `0x12`  ([cmd, mask])
- `M2_CMD_POWER_ON` = `0x13`  (explizit: Leistung EIN)
- `M2_CMD_SBH_SELFTEST_RETRY` = `0x14`  ([cmd] -> 0/1 (start SBHF selftest again))
- `M2_CMD_GET_SAFETY_STATUS` = `0x20`  (-> Mega2SafetyStatus)
- `M2_CMD_GET_BLOCK_STATUS` = `0x21`  (-> BlockStatus[M2_NUM_BLOCKS])
- `M2_CMD_GET_SHADOW_STATUS` = `0x22`  (-> ShadowYardStatus)
- `M2_CMD_GET_ENTRY_MATRIX` = `0x23`  (-> uint16_t[M2_NUM_BLOCKS] (FROM->TO))
- `M2_CMD_GET_ENTRY_PREVIEW_MATRIX` = `0x24`  (-> uint16_t[M2_NUM_BLOCKS] (preview))
- `M2_CMD_GET_ANALOG` = `0x25`  (-> Mega2AnalogPayload (fixed point))
- `M2_CMD_GET_PENDING_MASK` = `0x26` (-> Mega2PendingMaskPayload)
- `M2_CMD_GET_TURNOUTS` = `0x27` (-> Mega2TurnoutsPayload)
- `M2_CMD_GET_DIAG_SENSORS` = `0x28` (-> Mega2DiagSensorsPayload (kontakt+schalt, read-only))

## 7) I2C Payload-Strukturen (proto_common.h)

Die folgenden Strukturen werden über I2C (Wire) zwischen ESP (Master) und Mega2 (Slave) übertragen.

### 7.1 Mega2AnalogPayload (CMD_GET_M2_ANALOG / M2_CMD_GET_ANALOG = 0x25)
Fixed-point / “Wire-safe” (packed). Größe laut `static_assert`: **24 bytes**.

Felder:
- `seq` (uint8): Zähler, inkrementiert pro Response (Debug/De-Glitch)
- `flags` (uint8): reserviert (aktuell 0)
- `vA10` (uint16): Trafo A Spannung in **0.1 V** Schritten (V * 10)
- `vB10` (uint16): Trafo B Spannung in **0.1 V** Schritten (V * 10)
- `i_mA[M2_NUM_BLOCKS]` (uint16[9]): Strom pro Block **in mA** (B1..B9)

Hinweis: Analogwerte sind absichtlich **nicht** Teil der DRDY pending-mask (Rauschen).

### 7.2 Mega2SafetyStatus (CMD_GET_M2_SAFETY / M2_CMD_GET_SAFETY_STATUS = 0x20)
Kompakter globaler Safety-Status (typisch **4 bytes**; nicht `packed`).

Felder:
- `notausActive` (uint8): 0/1
- `ssrMask` (uint8): Bit0=MAIN, Bit1=TRAFO_A, Bit2=TRAFO_B
- `errorFlags` (uint8): globale Fehlerflags (Safety/I2C/Kurzschluss …)
- `blockReason` (uint8): siehe `SafetyBlockReason`

### 7.3 BlockStatus[M2_NUM_BLOCKS] (CMD_GET_M2_BLOCKS / M2_CMD_GET_BLOCK_STATUS = 0x21)
Pro Block ein `BlockStatus` (B1..B9).

Bitfelder (in einem uint8_t):
- `kontakt` (1): Kontaktgleis aktiv
- `stromEin` (1): Stromrelais EIN
- `besetzt` (1): logisch berechnet
- `kurzschluss` (1): Stromfehler
- `nothalt` (1): Safety wirkt auf Block
- `reserved` (3)

Zusatz:
- `stromRaw` (uint16): ADC-Wert Stromsensor

Hinweis zur Größe: wegen Bitfeld + Alignment ist die Strukturgröße **compiler-/plattformabhängig**; auf AVR-GCC ist sie typischerweise **4 bytes** pro Block.

### 7.4 ShadowYardStatus (CMD_GET_M2_SBH / M2_CMD_GET_SHADOW_STATUS = 0x22)
Logischer Überblick SBHF (typisch **8 bytes**; nicht `packed`).

Felder:
- `gleisBesetztMask` (uint8): Bit0..2 = SBHF-Gleis 1..3 belegt
- `kontaktMask` (uint8): Kontaktgleise SBHF
- `stromMask` (uint8): Strom EIN pro Gleis
- `einfahrGleis` (uint8): 0..2 oder 0xFF
- `ausfahrGleis` (uint8): 0..2 oder 0xFF
- `modus` (uint8): 0=seriell, 1=zufall
- `state` (uint8): interner Automat (Anzeige)

### 7.5 Mega2PendingMaskPayload (CMD_GET_M2_PENDING_MASK = 0x26)
`packed`, Größe **4 bytes**.

Felder:
- `seq` (uint8): Zähler pro Response
- `rsv0` (uint8): reserviert
- `mask` (uint16): OR-Maske aus `M2_PEND_*`

### 7.6 Mega2TurnoutsPayload (CMD_GET_M2_TURNOUTS = 0x27)
`packed`, Größe **4 bytes**.

Felder:
- `sollMask` (uint16): gewünschte Weichenstellungen (Bit-Maske)
- `istMask` (uint16): gemessene Weichenstellungen (Bit-Maske)

## 8) Canonical Command Enum (Mega2Command)
Neben den Legacy-Namen `M2_CMD_*` existiert die kanonische Enum `Mega2Command`:

- `CMD_GET_M2_SAFETY` = `0x20`
- `CMD_GET_M2_BLOCKS` = `0x21`
- `CMD_GET_M2_SBH` = `0x22`
- `CMD_GET_M2_ENTRY` = `0x23`
- `CMD_GET_M2_ENTRY_PREVIEW` = `0x24`
- `CMD_GET_M2_ANALOG` = `0x25`
- `CMD_GET_M2_PENDING_MASK` = `0x26`
- `CMD_GET_M2_TURNOUTS` = `0x27`
- `CMD_GET_M2_DIAG_SENSORS` = `0x28`
