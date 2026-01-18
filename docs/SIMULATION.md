# Simulation ohne Hardware (ESP32 WebUI)

## Zweck
Im Hardware-losen Testbetrieb (keine SBHF-Weichen / keine Rückmelder) entsteht beim SBHF-Weichentest zwangsläufig ein Fehler.
Damit trotzdem die Darstellung und Logik der Mega1-Warnings getestet werden kann, kann der **Startup-Checklist Step „SBHF Selftest“** im Sim-Build übersprungen werden.

Wichtig: Es wird **nur** der Startup-Checklist-Step beeinflusst (UI/Checklist). Safety-/Warnlogik bleibt unverändert.

---

## Build-Umgebung

### Realbetrieb
- PlatformIO Env: `esp32-s3-eth`

### Simulation ohne Hardware
- PlatformIO Env: `esp32-s3-eth-sim`
- Dieses Env setzt: `-DEE_SIM_NO_HW=1`

---

## Bedienung (im Startup-Overlay)

Im Sim-Build erscheint im Startup-Overlay (Mega2/SBHF Abschnitt) ein zusätzlicher Toggle-Button:

- **„SBHF Selftest überspringen (SIM)”**
- **„SBHF Selftest-Step wieder aktivieren (SIM)”**

Damit wird der Startup-Checklist-Step für Mega2 wie folgt behandelt:

- `startup.m2Needs` wird **false**
- `startup.m2SelftestDone` wird **true**

Dadurch kann das Startup-Overlay anschließend normal mit ACK abgeschlossen werden, und Mega1-Warnings können getestet werden.

---

## Debug / Verifikation im Browser (optional)
In der Browser-Konsole kann der aktuelle Zustand geprüft werden:

```js
window.lastStateMsg?.sim
window.lastStateMsg?.startup
