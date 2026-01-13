# Protokoll: Mega2 ↔ ESP ↔ WebUI (Elektrische Eisenbahn)

Stand: 2026-01-13  
Zweck: **stabiler UI-/Firmware-Contract**, damit Rendering und Safety-/SBHF-Logik nicht auseinanderlaufen.  
Prinzip: **UI zeigt Selftest nur, wenn Protokoll es explizit sagt** (kein “aus Zahlen raten”, kein Klick-Phantomzustand).

---

## 0. Begriffe

- **Mega2**: Schattenbahnhof-Blocksteuerung inkl. Safety-/SBHF-Logik.
- **ESP**: Zentrale WebUI + WebSocket-State, holt Status von Mega2 (I²C) und publiziert JSON per WS.
- **WebUI**: Browser-Frontend (state-driven). Darf State **normalisieren** (flat→nested), aber keine Semantik erfinden.

---

## 1. Mega2 → ESP: SystemStatus Payload (I²C / Proto)

### 1.1 SBHF State-Machine: `sbhfState`

- Quelle in Mega2: `sbhfState = (uint8_t)g_sbhf.state()`
- Semantik: Zustand der **SBHF State-Machine**, **nicht** Selftest.

Enum (Mega2 `ShadowYardController.h`):

| Wert | Name |
|---:|---|
| 0 | `Idle` |
| 1 | `PrepareExit` |
| 2 | `SettingWeichen` |
| 3 | `WaitBlock6` |
| 4 | `ExitRunning` |
| 5 | `Error` |

**Wichtig:** Selftest ist **kein** SBHF-State.

---

### 1.2 SBHF Occupancy + META: `sbhfOccupiedMask`

- Bits **0..2**: Belegung Gleis 1..3
- META-Bits (ohne Protokoll-Bump):
  - **0x80**: **SBHF Selftest läuft** (gesetzt, wenn `g_sbhf.isSelftestActive()` true)

➡️ **Single Source of Truth für „Selftest läuft“ ist ausschließlich Bit 0x80.**

---

### 1.3 Warnungen / Restriction: `warningMask` + `allowedMask`

In Mega2 wird `warningMask` als Bitmaske geführt, z.B.:

| Bit | Bedeutung |
|---:|---|
| 0x01 | `SBHF_WARN_RESTRICTED` |
| 0x02 | `SBHF_WARN_W12_DEFECT` |
| 0x04 | `SBHF_WARN_W13_DEFECT` |
| 0x08 | `SBHF_WARN_W14_DEFECT` |
| 0x10 | `SBHF_WARN_W15_DEFECT` |

`allowedMask` beschreibt, welche SBHF-Gleise im eingeschränkten Betrieb erlaubt sind (Bit pro Gleis).

---

## 2. ESP → WebUI: WebSocket State Contract

### 2.1 Nachrichtentypen

- `type: "state"`: kompletter Systemzustand (regelmäßig gesendet)
- `type: "action"` (WebUI → ESP): User-Aktion (ACK, Power, Nothalt, Mode, Mega1 Buttons, …)

---

### 2.2 Pflichtfelder (Minimum)

Im `state`-JSON:

**Top-Level**
- `eth.connected`, `eth.ip` (optional)
- `safety.lock`, `safety.blockReason`, `safety.errorType`, `safety.errorIndex`, `safety.powerOn` (je nach Implementierung)

**Mega2**
- `mega2.online`, `mega2.flags`
- `mega2.allowedMask`, `mega2.warningMask`
- `mega2.blockOccupiedMask`
- `mega2.turnouts.sollMask`, `mega2.turnouts.istMask` (wenn genutzt)
- `mega2.blocks.occupiedMask` (wenn genutzt)

**Mega2 SBHF (nested)**
- `mega2.sbhf.state` (aus `sbhfState`)
- `mega2.sbhf.occupiedMaskRaw` (aus `sbhfOccupiedMask`, inkl. META)
- `mega2.sbhf.occupiedMask` (nur Bits 0..2)
- `mega2.sbhf.selftestRunning` (aus `occupiedMaskRaw & 0x80`)
- `mega2.sbhf.allowedMask`, `mega2.sbhf.warningMask`
- `mega2.sbhf.restricted` (UI Convenience)

**Kompatibilität (flat zusätzlich)**
- `mega2.sbhfState` (gleich `mega2.sbhf.state`)
- `mega2.sbhfOccupiedMask` (gleich `mega2.sbhf.occupiedMaskRaw`)

➡️ Diese flat Felder verhindern „nested vs flat“-Regressions im UI-Normalizer.

---

### 2.3 UI Normalisierung (flat → nested)

Die WebUI darf für Abwärtskompatibilität normalisieren:

- Wenn `mega2.sbhf` fehlt:
  - `mega2.sbhf.state = mega2.sbhfState`
  - `mega2.sbhf.occupiedMaskRaw = mega2.sbhfOccupiedMask`
  - `mega2.sbhf.selftestRunning = (occupiedMaskRaw & 0x80) != 0`

**Regel:** UI darf *nur* normalisieren, nicht semantisch interpretieren.

---

## 3. WebUI Overlay-/ACK-Contract (Anti-Regressions)

### 3.1 ACK senden

- UI sendet ACK nur über **eine** Aktion:  
  `wsSend({ action: "safetyAck" })`
- UI darf **kein** zweites/legacy `sendWsAction("ack")` aufrufen.
- UI-Log: „ACK gesendet.“ (neutral)

---

### 3.2 Selftest Overlay (zustandsgetrieben)

Wenn `safety.lock == true`:

1) Wenn `safety.blockReason == 2` (SBHF-Weichenfehler) **und** `mega2.sbhf.selftestRunning == true`  
   → Overlay: **„SBHF Weichentest läuft“**, `ackRequired=false`

2) Sonst: Standard-Safety-Overlay (`getSafetyOverlayTexts(safety)`), `ackRequired=true`

**Wichtig:** Selftest Overlay erscheint **nur** wenn das Protokoll es explizit meldet (`0x80`).

---

### 3.3 Stuck-Guard

- Wenn `safety.lock` wieder `false` wird: Overlay muss schließen.
- UI darf nicht in einem “ACK pending aber lock=false” Zustand hängen bleiben.

---

## 4. Commands (WebUI → ESP → Mega2) – relevanter Auszug

- `action: "safetyAck"`: Safety ACK / Quittierung (führt bei SBHF-Weichenfehler zur Selftest-Logik auf Mega2)
- Optional (wenn implementiert): `M2_CMD_SBH_SELFTEST_RETRY` (UI-triggered retry), Start asynchron im loop-Kontext

---

## 5. Quick-Tests (Regression Checklist)

1) **Systemstart, kein Fehler**  
   - ACK darf **kein** Selftest-Overlay erzeugen.

2) **SBHF-Weichenfehler (W12/W13)**  
   - Overlay zeigt Fehler (ACK erforderlich).  
   - Nach ACK: sobald `selftestRunning==true` → Overlay „Weichentest läuft“.  
   - Nach Ende: `lock=false` → Overlay weg, Warnungen ggf. aktiv.

3) **Nothalt / Reverse-Entry**  
   - Overlay „Nothalt“ (ACK ggf. blockiert, je Safety-Regel).

4) **UI Robustheit**  
   - Kein JS-Error bei ACK (kein `sendWsAction`).
   - `window.lastStateMsg` gesetzt, Debug-Ausgaben möglich.

---

## 6. Änderungs-/Versionshinweis

Dieses Dokument beschreibt den Contract nach der Stabilisierung:
- ESP publiziert `mega2.sbhfOccupiedMask` + `mega2.sbhfState` auch **flat**.
- WebUI nutzt `selftestRunning` im Lock-Zweig zur Overlay-Umschaltung.
