# Protokollübersicht – Mega2 ↔ ESP32

## Transport
- I2C
- ESP ist Master
- Mega2 ist Slave

---

## Status (Mega2 → ESP)

Struktur: `SystemStatus`

Wichtige Felder:
- `flags`
- `safetyErrorType`
- `safetyErrorIndex`

---

## Commands (ESP → Mega2)

| Command | Bedeutung |
|------|---------|
| ACK | Fehler / Boot quittieren |
| NOTAUS | Sofortige Abschaltung |
| POWER_ON | Leistung einschalten (nur wenn erlaubt) |

---

## Designregel

Mega2 prüft **jede Aktion** selbst.
ESP darf nur anfordern, nie erzwingen.
