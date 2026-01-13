# Protokoll: Mega2 ↔ ESP ↔ WebUI

Stand: 2026-01-13

## 1) Mega2 → ESP: Status-Payload (I2C / Proto)

### 1.1 ShadowYard / SBHF

**sbhfState**  
Quelle: `ShadowYardController::state()` wird unverändert als `uint8_t` übertragen:
- `out.sbhfState = static_cast<uint8_t>(g_sbhf.state());`

Enum (Mega2, `include/ShadowYardController.h`):
- 0: Idle
- 1: PrepareExit
- 2: SettingWeichen
- 3: WaitBlock6
- 4: ExitRunning
- 5: Error

**sbhfOccupiedMask**  
Bits 0..2: Belegung der SBHF-Gleise (Gleis 1..3)  
Meta-Bits:
- 0x80: Selftest läuft (Quelle: `Mega2Status.cpp` → `if (g_sbhf.isSelftestActive()) out.sbhfOccupiedMask |= 0x80;`)

### 1.2 SBHF Warnungen (warningMask)
Definiert in `include/ShadowYardController.h`:
- 0x01: SBHF_WARN_RESTRICTED
- 0x02: SBHF_WARN_W12_DEFECT
- 0x04: SBHF_WARN_W13_DEFECT
- 0x08: SBHF_WARN_W14_DEFECT
- 0x10: SBHF_WARN_W15_DEFECT

### 1.3 SBHF Allowed-Mask (allowedMask)
Bedeutung: erlaubte Einfahrgleise im eingeschränkten Betrieb (Bit pro Gleis).

---

## 2) ESP → WebUI: WebSocket State Contract

### 2.1 Pflichtfelder
- `safety.lock`, `safety.blockReason`, `safety.errorType`, `safety.errorIndex`
- `mega2.flags`, `mega2.allowedMask`, `mega2.warningMask`
- **`mega2.sbhfOccupiedMask`** (inkl. Meta-Bit 0x80) oder nested `mega2.sbhf.occupiedMaskRaw`

### 2.2 UI Normalisierung (flat → nested)
Die UI darf den State umformen, aber nicht “erfinden”:

- `mega2.sbhf.state = mega2.sbhfState`
- `mega2.sbhf.occupiedMaskRaw = mega2.sbhfOccupiedMask`
- `mega2.sbhf.selftestRunning = (mega2.sbhf.occupiedMaskRaw & 0x80) != 0`

---

## 3) Overlay-/ACK-Regeln (Anti-Regressions)
- ACK-Klick sendet nur ACK und loggt „ACK gesendet“ (kein Selftest behaupten).
- Selftest-Overlay darf nur erscheinen, wenn `selftestRunning==true` im WS-State.
- Wenn `safety.lock==false` → Overlay muss schließen.
