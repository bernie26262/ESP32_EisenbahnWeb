#pragma once
#include <Arduino.h>

/*
  Elektrische Eisenbahn — Log Policy (ESP)
  ---------------------------------------
  Ziele:
  - Release: "ruhig" -> keine Debug-Spam-Logs, keine unnötigen Serial-Writes
  - Debug: gezielt aktivierbar per build_flags (-D...)
  - Keine nackten Serial.printf im Code: nur über diese Macros
*/

// ---------- Level defaults (Release) ----------
#ifndef EE_LOG_ENABLE_ERROR
  #define EE_LOG_ENABLE_ERROR 1
#endif
#ifndef EE_LOG_ENABLE_WARN
  #define EE_LOG_ENABLE_WARN 1
#endif
#ifndef EE_LOG_ENABLE_INFO
  #define EE_LOG_ENABLE_INFO 0
#endif
#ifndef EE_LOG_ENABLE_DEBUG
  #define EE_LOG_ENABLE_DEBUG 0
#endif

// ---------- Category defaults (off) ----------
#ifndef EE_DEBUG_WS
  #define EE_DEBUG_WS 0
#endif
#ifndef EE_DEBUG_WSLAT
  #define EE_DEBUG_WSLAT 0
#endif
#ifndef EE_DEBUG_HEAP
  #define EE_DEBUG_HEAP 0
#endif
#ifndef EE_DEBUG_I2C
  #define EE_DEBUG_I2C 0
#endif
#ifndef EE_DEBUG_DRDY
  #define EE_DEBUG_DRDY 0
#endif
#ifndef EE_DEBUG_SAFETY
  #define EE_DEBUG_SAFETY 0
#endif
#ifndef EE_DEBUG_DIAG
  #define EE_DEBUG_DIAG 0
#endif
#ifndef EE_DEBUG_REACT
  #define EE_DEBUG_REACT 0
#endif
#ifndef EE_DEBUG_HTTP
  #define EE_DEBUG_HTTP 0
#endif
#ifndef EE_DEBUG_HMILAT
  #define EE_DEBUG_HMILAT 0
#endif


#ifndef EE_LOG_ONLY_WHEN_SERIAL_CONNECTED
  // Default fuer alle Environments: haeufige Serial-Logs nicht in den USB-CDC-Puffer
  // schreiben, solange kein Monitor verbunden ist. Das verhindert Kaltstart-Bremsen
  // durch Debug-Ausgaben ohne lesenden Host. Bei Bedarf explizit mit
  // -DEE_LOG_ONLY_WHEN_SERIAL_CONNECTED=0 uebersteuerbar.
  #define EE_LOG_ONLY_WHEN_SERIAL_CONNECTED 1
#endif

static inline bool eeLogSerialReady() {
#if EE_LOG_ONLY_WHEN_SERIAL_CONNECTED
  // Testmodus: keine Serial-Ausgaben erzeugen, solange kein Monitor liest.
  // availableForWrite() ist hier absichtlich robuster als nur `if (Serial)`,
  // weil der Monitor in dieser Env mit DTR/RTS=0 geöffnet wird.
  return Serial.availableForWrite() > 64;
#else
  return true;
#endif
}

#define EE_LOG_PRINTF_LINE(prefix, fmt, ...) \
  do { \
    if (eeLogSerialReady()) { \
      Serial.printf(prefix fmt, ##__VA_ARGS__); \
      Serial.println(); \
    } \
  } while (0)

// ---------- internal helpers ----------
#if EE_LOG_ENABLE_ERROR
  #define EE_LOGE(tag, fmt, ...) EE_LOG_PRINTF_LINE("[E][%s] ", fmt, tag, ##__VA_ARGS__)
#else
  #define EE_LOGE(tag, fmt, ...) do {} while (0)
#endif

#if EE_LOG_ENABLE_WARN
  #define EE_LOGW(tag, fmt, ...) EE_LOG_PRINTF_LINE("[W][%s] ", fmt, tag, ##__VA_ARGS__)
#else
  #define EE_LOGW(tag, fmt, ...) do {} while (0)
#endif

#if EE_LOG_ENABLE_INFO
  #define EE_LOGI(tag, fmt, ...) EE_LOG_PRINTF_LINE("[I][%s] ", fmt, tag, ##__VA_ARGS__)
#else
  #define EE_LOGI(tag, fmt, ...) do {} while (0)
#endif

#if EE_LOG_ENABLE_DEBUG
  #define EE_LOGD(tag, fmt, ...) EE_LOG_PRINTF_LINE("[D][%s] ", fmt, tag, ##__VA_ARGS__)
#else
  #define EE_LOGD(tag, fmt, ...) do {} while (0)
#endif

// ---------- category macros (DEBUG-level by default) ----------
#if EE_DEBUG_WS
  #define LOG_WS(...)    EE_LOGD("WS", __VA_ARGS__)
#else
  #define LOG_WS(...)    do {} while (0)
#endif

#if EE_DEBUG_WSLAT
  #define LOG_WSLAT(fmt, ...) EE_LOG_PRINTF_LINE("[WS] ", fmt, ##__VA_ARGS__)
#else
  #define LOG_WSLAT(...) do {} while (0)
#endif

#if EE_DEBUG_HEAP
  #define LOG_HEAP(...)  EE_LOGD("HEAP", __VA_ARGS__)
#else
  #define LOG_HEAP(...)  do {} while (0)
#endif

#if EE_DEBUG_I2C
  #define LOG_I2C(...)   EE_LOGD("I2C", __VA_ARGS__)
#else
  #define LOG_I2C(...)   do {} while (0)
#endif

#if EE_DEBUG_DRDY
  #define LOG_DRDY(...)  EE_LOGD("DRDY", __VA_ARGS__)
#else
  #define LOG_DRDY(...)  do {} while (0)
#endif

#if EE_DEBUG_SAFETY
  #define LOG_SAFETY(...) EE_LOGD("SAFETY", __VA_ARGS__)
#else
  #define LOG_SAFETY(...) do {} while (0)
#endif

#if EE_DEBUG_DIAG
  #define LOG_DIAG(...)  EE_LOGD("DIAG", __VA_ARGS__)
#else
  #define LOG_DIAG(...)  do {} while (0)
#endif

#if EE_DEBUG_REACT
  #define LOG_REACT(fmt, ...) EE_LOG_PRINTF_LINE("[REACT] ", fmt, ##__VA_ARGS__)
#else
  #define LOG_REACT(...) do {} while (0)
#endif

#if EE_DEBUG_HTTP
  #define LOG_HTTP(fmt, ...) EE_LOG_PRINTF_LINE("[HTTP] ", fmt, ##__VA_ARGS__)
#else
  #define LOG_HTTP(...) do {} while (0)
#endif

#if EE_DEBUG_HMILAT
  #define LOG_HMILAT(fmt, ...) EE_LOG_PRINTF_LINE("[HMILAT] ", fmt, ##__VA_ARGS__)
#else
  #define LOG_HMILAT(...) do {} while (0)
#endif

// ---------- Backward compatibility (optional) ----------
// Wenn im Code noch DBG_* verwendet wird: an EE_LOGD hängen.
// (Und bleibt im Release aus, solange EE_LOG_ENABLE_DEBUG=0 ist.)
#define DBG_PRINT(x)    do { if (EE_LOG_ENABLE_DEBUG && eeLogSerialReady()) Serial.print(x); } while (0)
#define DBG_PRINTLN(x)  do { if (EE_LOG_ENABLE_DEBUG && eeLogSerialReady()) Serial.println(x); } while (0)
#define DBG_PRINTF(...) do { if (EE_LOG_ENABLE_DEBUG && eeLogSerialReady()) Serial.printf(__VA_ARGS__); } while (0)

// ---------- Compatibility aliases ----------
// Manche Stellen nutzen LOG_I/LOG_E printf-artig (fmt, ...), inkl. "[TAG]" im Formatstring.
// EE_LOGI/EE_LOGE erwarten (tag, fmt, ...). Wir verwenden deshalb einen festen Tag.
#ifndef LOG_I
  #define LOG_I(fmt, ...) EE_LOGI("LOG", fmt, ##__VA_ARGS__)
#endif
#ifndef LOG_E
  #define LOG_E(fmt, ...) EE_LOGE("LOG", fmt, ##__VA_ARGS__)
#endif


#ifndef DEBUG_WS_PUSH
  #define DEBUG_WS_PUSH EE_DEBUG_WS
#endif
#ifndef DEBUG_WS_SIZE
  #define DEBUG_WS_SIZE EE_DEBUG_WS
#endif
#ifndef DEBUG_AWS_HEAP
  #define DEBUG_AWS_HEAP EE_DEBUG_HEAP
#endif