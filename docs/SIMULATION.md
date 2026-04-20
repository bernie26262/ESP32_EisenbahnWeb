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

- `startup.m2SelftestDone` wird für die Startup-Checklist als **erledigt** behandelt
- `startup.m2Needs` bleibt dabei ein **Startup-Latch** und wird erst mit der expliziten Startup-Quittierung geschlossen

Wichtig: Seit dem Overlay-/Boot-Fix gilt systemweit folgende Semantik:

- `startup.m1SelftestDone` / `startup.m2SelftestDone` beschreiben den **technischen Schrittstatus** des Selbsttests
- `startup.m1Needs` / `startup.m2Needs` beschreiben, ob der jeweilige **Startup-Checklist-Schritt für den aktuellen Mega-Boot noch offen** ist
- die Startup-Checklist bleibt sichtbar, bis sie explizit quittiert wurde
- ein ETH-Reboot rekonstruiert eine noch offene Startup-Checklist korrekt erneut

Dadurch kann das Startup-Overlay anschließend normal mit ACK abgeschlossen werden, und Mega1-Warnings können getestet werden.

---

## Debug / Verifikation im Browser (optional)
In der Browser-Konsole kann der aktuelle Zustand geprüft werden:

```js
window.lastStateMsg?.sim
window.lastStateMsg?.startup
