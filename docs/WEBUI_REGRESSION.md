# WebUI Regression Checklist (Phase 2)

Ziel: Verhindern, dass bereits gelöste UI-Invarianten (ACK/Overlay/SBHF) durch Refactor/Änderungen wieder kaputt gehen.

## UI-Invarianten (dürfen nie gebrochen werden)
1) Overlay ist rein zustandsgetrieben: Es darf nur vom WS-State bestimmt werden (kein "Click setzt Selftest-Text").
2) `window.lastStateMsg` wird bei jedem WS-State-Paket gesetzt, bevor gerendert wird.
3) Wenn `safety.lock === false` → Overlay muss geschlossen sein (keine Sackgasse möglich).
4) "Selftest läuft" darf nur erscheinen, wenn WS-State das explizit signalisiert.
5) Mega2 links ist Info-only (keine interaktiven Buttons; nur Pills/Badges/Info-Row).

## Testfälle (manuell, 2–3 Minuten)
> Vor jedem Merge/Commit, der `script.js` oder `style.css` betrifft.

### T1 – Systemstart ohne Fehler + ACK
- Start: System hochfahren, keine Warnings/Fehler erwartet.
- Erwartung UI:
  - Overlay: ggf. Info/Startzustand, aber kein Selftest-Text.
  - Klick ACK: UI-Log nur "ACK gesendet" (kein "Selbsttest läuft").
  - Overlay darf nicht hängen bleiben.
  - Nach nächstem WS-State: Overlay zu, Systemstatus normal.

### T2 – SBHF Weichenfehler W12 + ACK → Selftest-Overlay
- Trigger: SBHF Weichenfehler (z.B. W12).
- Erwartung UI:
  - Overlay: Weichenfehler-Text korrekt.
  - Klick ACK: Overlay wechselt auf "Weichentest aktiv – bitte warten".
  - Nach Ende: Overlay verschwindet automatisch.
  - Danach: Systemstatus zeigt Warning aktiv (erwartet).

### T3 – Nothalt Falschfahrt
- Trigger: Falschfahrt → Nothalt (Safety Lock).
- Erwartung UI:
  - Overlay: "! Sicherheitsquittierung Nothalt ausgelöst" korrekt.
  - ACK ohne Fehlerbehebung: Overlay bleibt quittierbar/erklärt blockiert, aber UI hängt nie.
  - Sobald `safety.lock` false wird: Overlay schließt.

### T4 – "Stuck-Guard" / Overlay muss immer freikommen
- Beobachtung:
  - Egal welche Reihenfolge von Klicks: Sobald `safety.lock` false, muss Overlay zu sein.
  - Kein Zustand, in dem Overlay dauerhaft bleibt ohne Lock.

### T5 – Rendering-Sanity (Mega1/Mega2)
- Mega1: Bahnhöfe/Weichen als Buttons (interaktiv).
- Mega2: SBHF/Blöcke/Weichen als Info-Pills/Badges (nicht interaktiv).
- Keine Konsolen-Fehler im Normalbetrieb.

## Build/Deploy Hinweis
- Nach UI-Änderungen: LittleFS Upload (UploadFS) + Hard Reload (Ctrl+F5).
- Versionsstring im `index.htm` für css/js muss bei Änderungen hochgezogen werden.
