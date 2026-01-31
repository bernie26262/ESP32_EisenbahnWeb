# Mega2 – Coverage-Matrix Sensor-Polling (Definiert ↔ gelesen ↔ Export ↔ UI)

Stand: basierend auf dem ZIP *Mega2.fuerPins.zip* und dem ESP-WS-State.

## A) Polling-/Update-Mechanik (Scheduler)

| Komponente | Was wird gelesen/aktualisiert? | Wo? | Frequenz | Ergebnis/State | Export/WS-State (ESP → Browser) |
|---|---|---:|---:|---|---|
| Schaltgleise | S11..S16 (flankenbasiert) | `sbhfHandleSchaltgleise()` (aus `loop()`) | jedes `loop()` | Events/Trigger | sichtbar indirekt über Shadow/SBHF Zustände |
| BlockController | Kontakt/Belegung + Entscheidungen | `BlockController::update(now)` | ~20 ms | `occupiedMask`, per Block Status | `mega2.blocks.occupiedMask`, `mega2.blocks.status[]` |
| SBHF/Shadow | Shadow-Yard Zustände | Shadow/SBHF update | ~10–20 ms | `shadow.*Mask`, `selftestFlags` | `mega2.shadow.*`, `mega2.sbhf.*` |
| Weichen (SBHF) | Rückmeldung/State W12..W15 | `w12..w15.update(now)` / Shadow | ~10 ms | Weichen-State | `mega2.turnouts.sollMask`, `mega2.turnouts.istMask` |
| Payload/Export | Build/Transfer nach ESP (I2C) | Payload-Tick | z. B. 100 ms | WS-State Updates | `type=state` WS Payload |

---

## B) Digitale Inputs: Kontakt-/Belegt-Sensoren (Block-Sensorik)

Kontakt-Sensoren: `k_block1..6`, `k_nothalt`, `k_sbhf1..3`, `k_bhf2a/b`, `k_bhf4a/b`

| Gruppe | Aktiv-Level | Wird gelesen in | Frequenz | Export/WS-State (Browser) |
|---|---|---:|---:|---|
| Block-Kontakte | typ. LOW=aktiv (PULLUP) | `Block::update()` via `SensorKontakt::raw()` | ~20 ms | `mega2.blocks.occupiedMask`, `mega2.blocks.status[i].kontakt` (falls befüllt) |
| SBHF-Kontakte | typ. LOW=aktiv (PULLUP) | `Block::update()` + Shadow/SBHF | ~20 ms | `mega2.sbhf.occupiedMaskRaw`, `mega2.sbhf.occupiedMask` |

**Bewertung:** Digitalinputs sind zyklisch erfasst (kein „definiert aber nie gelesen“).

---

## C) Digitale Inputs: Schaltgleise S11..S16 (Pulse)

| Sensor | Typ | Wird gelesen in | Frequenz | Export/WS-State (Browser) |
|---|---|---|---:|---|
| S11..S16 | Flanken (HIGH→LOW) | `PulseSensor::fellEdge()` | jedes `loop()` | indirekt via `mega2.shadow.*` / SBHF Aktionen |

---

## D) Analog/Stromsensoren (Fix aktiv, sobald getestet)

SensorStrom-Objekte: `strom1..6`, `stromSbhf1..3` (ADC)

| Objektgruppe | Wird gelesen in | Frequenz | Export/WS-State (Browser) |
|---|---|---:|---|
| Stromsensoren ADC | `SensorStrom::update()` (analogRead + Filter) | z. B. 20 ms | `mega2.blocks.status[i].stromRaw` (Filter/Rohwert je nach Implementierung) |

> Hinweis: Vor Fix wurden die `update()`-Aufrufe nicht zyklisch getriggert → Werte konnten “stehen”.  
> Nach Fix werden sie im `loop()` über `STROM_UPDATE_MS` aktualisiert.

---

## E) Export/Status-Struktur (Initialisierung)

| Element | Problem | Wirkung | Fix | Export/WS-State (Browser) |
|---|---|---|---|---|
| `blocks.status[]` | Felder nicht initialisiert | Zufallswerte möglich | `memset(...)` vor dem Loop | `mega2.blocks.status[]` |

---

## F) Wichtige WS-State Felder (bereits sichtbar)

| Thema | Export/WS-State Pfad |
|---|---|
| Mega2 online | `mega2.online` |
| Mega2 Flags | `mega2.flags` |
| Allowed/WarningMask | `mega2.allowedMask`, `mega2.warningMask` |
| SBHF | `mega2.sbhf.*` (z. B. `selftestRunning`, `selftestDone`, `occupiedMaskRaw`, `restricted`) |
| Shadow | `mega2.shadow.*` (z. B. `selftestFlags`, `kontaktMask`, `stromMask`, `gleisBesetztMask`) |
| Turnouts | `mega2.turnouts.sollMask`, `mega2.turnouts.istMask` |

