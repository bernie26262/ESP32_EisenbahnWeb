# WebUI Console Toggles (diag.htm + index.htm)

Ziel: **Normalbetrieb = Konsole ruhig**.  
Verbose-Logs sind **opt-in** und werden nur aktiv, wenn **Debug UND Timing** eingeschaltet sind.

---

## diag.htm (diag.js)

### Keys
- localStorage:
  - `EE_DIAG_DEBUG`  = `"0"` / `"1"`
  - `EE_DIAG_TIMING` = `"0"` / `"1"`
- URL Query:
  - `?diagdebug=1`
  - `?diagtiming=1`

### Regel
- Verbose-Konsole nur wenn: `EE_DIAG_DEBUG==1` **UND** `EE_DIAG_TIMING==1`

### Schnell in der Browser-Konsole
```js
diagDebug(1);   // setzt EE_DIAG_DEBUG=1 und lädt neu
diagTiming(1);  // setzt EE_DIAG_TIMING=1 und lädt neu
// zum Ausschalten:
diagDebug(0);
diagTiming(0);
index.htm (script.js)
Keys

localStorage:

EE_UI_DEBUG = "0" / "1"

EE_UI_TIMING = "0" / "1"

URL Query:

?uidebug=1

?uitiming=1

Regel

Verbose-Konsole nur wenn: EE_UI_DEBUG==1 UND EE_UI_TIMING==1

Schnell in der Browser-Konsole
uiDebug(1);   // setzt EE_UI_DEBUG=1 und lädt neu
uiTiming(1);  // setzt EE_UI_TIMING=1 und lädt neu
// zum Ausschalten:
uiDebug(0);
uiTiming(0);
Empfehlung

Für Debug-Sessions:

uidebug=1&uitiming=1 (oder per uiDebug/uiTiming)

danach wieder aus, um Performance + „Snappiness“ nicht zu beeinflussen.