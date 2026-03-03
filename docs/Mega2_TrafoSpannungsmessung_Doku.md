# Mega2 – Trafo-Spannungsmessung (A9/A10) – RMS-Algorithmus & Publishing

Stand: 2026-03-01

## Ziel
- Zwei Trafospannungen (oben/unten) als **stabile RMS-Werte** erfassen (50 Hz).
- **Effizient** (Mega2560), kein Blocking in `loop()`.
- **Robust gegen kurze Störungen/Spikes** (Relais, Fahrtrichtungswechsel).
- Ergebnis als **ADC-domain Vrms** (Volt am ADC-Pin) + später Skalierung auf Trafo-Vrms.

---

## Hardware-Annahme (Kurz)
- Hochohmiger Teiler + AC-Kopplung + Bias (2.5 V).
- ADC sieht typischerweise (bei dir gemessen):
  - ~0.54 Vrms @ ~12.4 Vrms Trafo
  - ~0.83 Vrms @ ~18.8 Vrms Trafo
  - ~1.21 Vrms @ ~27.7 Vrms Trafo

=> typischer Maximalwert am ADC: **~1.25 Vrms**.

---

## Empfohlener Algorithmus (effizient + spike-resistent)
### 1) Zeitbasiertes Sampling (500 Hz)
- Sampling-Intervall: **2000 µs**
- Vorteil: unabhängig von Loop-Geschwindigkeit (solange nicht dauerhaft blockiert).

### 2) RMS aus Peak-to-Peak pro Fenster
Für (nahezu) sinusförmiges Signal gilt:

- Peak-to-peak in Counts: `vpp = max - min`
- Amplitude (Peak): `A = vpp / 2`
- Sinus-RMS: `Vrms ≈ A / sqrt(2)`

Umrechnung Counts→Volt:
`V = counts * 5 / 1023`

Damit:
`Vrms_adc = ((max-min)/2) * (5/1023) / sqrt(2)`

**Fensterlänge:** 200 ms (10 Perioden @ 50 Hz) → sehr stabil.

### 3) Ausreißer-Filter (Median über die letzten 5 Fenster)
- Jede 200 ms kommt ein Fensterwert.
- Kurze Spikes verschieben ggf. einmalig `min` oder `max` → ein Fensterwert ist „zu groß“.
- Der **Median** über 5 Fenster verwirft solche Einzel-Ausreißer zuverlässig.

### 4) Glättung für ruhige Anzeige (EMA)
- EMA über Median: `filtered = 0.8*old + 0.2*median`
- Ergebnis wirkt ruhig, reagiert aber noch gut genug.

### 5) Harte Plausibilitätsgrenze
- Fensterwert > 3.0 Vrms (ADC-domain) wird als **invalid** behandelt.
  (Bei deiner Hardware ist das weit außerhalb des realen Bereichs.)

---

## Publishing (ESP/I²C/UI)
Empfohlen: **5 Hz** Publishing (alle 200 ms).  
Das passt zu einem 200 ms RMS-Fenster: pro Publish ist ein frischer RMS-Wert vorhanden.

---

## Skalierung ADC-domain → Trafo-Vrms
Aus deinen Messpunkten:

- TUnten: Mittel **~22.80**
- TOben: Mittel **~22.74**

=> Grob: `V_trafo ≈ Vrms_adc * 22.77`

Das ist bereits sehr konsistent (nur ~±0.2%).  
Empfehlung: 1 Faktor pro Kanal (Oben/Unten) hinterlegen und später fein kalibrieren.

---

## Threshold „Trafo an“
Im Sensor ist `powerThreshold` in **ADC-Vrms**.
Bei dir ist „aus“ praktisch 0, und „klein an“ beginnt deutlich über ~0.05 Vrms.

Empfehlung Startwert: **0.10 Vrms** (ADC-domain).
Danach nach Wunsch tunen.

---

## Loop-Timing Debug
Für 500 Hz Sampling ist wichtig, ob die Loop regelmäßig >2 ms blockiert.
Daher gibt es optional:
- `MEGA2_DEBUG_LOOP_TICK=1`
- Log: `[LOOP] hz=... maxGapUs=...` (1×/s)

Ziel: `maxGapUs` möglichst selten deutlich über 2000 µs.

---

## Dateien/Änderungen
- `SensorTrafoAC.*`: neue RMS-Logik (500 Hz, 200 ms Fenster, Median5, EMA)
- `main.cpp`: `g_trafo*.update(nowMs, nowUs)` + publish Intervall 200 ms
- `Mega2Debug.*`: optionaler Loop-Timing Tick (1×/s)

