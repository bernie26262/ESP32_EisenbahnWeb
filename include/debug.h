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

// ---------- internal helpers ----------
#if EE_LOG_ENABLE_ERROR
  #define EE_LOGE(tag, ...) do { Serial.printf("[E][%s] " __VA_ARGS__, tag); Serial.println(); } while (0)
#else
  #define EE_LOGE(tag, ...) do {} while (0)
#endif

#if EE_LOG_ENABLE_WARN
  #define EE_LOGW(tag, ...) do { Serial.printf("[W][%s] " __VA_ARGS__, tag); Serial.println(); } while (0)
#else
  #define EE_LOGW(tag, ...) do {} while (0)
#endif

#if EE_LOG_ENABLE_INFO
  #define EE_LOGI(tag, ...) do { Serial.printf("[I][%s] " __VA_ARGS__, tag); Serial.println(); } while (0)
#else
  #define EE_LOGI(tag, ...) do {} while (0)
#endif

#if EE_LOG_ENABLE_DEBUG
  #define EE_LOGD(tag, ...) do { Serial.printf("[D][%s] " __VA_ARGS__, tag); Serial.println(); } while (0)
#else
  #define EE_LOGD(tag, ...) do {} while (0)
#endif

// ---------- category macros (DEBUG-level by default) ----------
#if EE_DEBUG_WS
  #define LOG_WS(...)    EE_LOGD("WS", __VA_ARGS__)
#else
  #define LOG_WS(...)    do {} while (0)
#endif

#if EE_DEBUG_WSLAT
  #define LOG_WSLAT(...) EE_LOGD("WSLAT", __VA_ARGS__)
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

// ---------- Backward compatibility (optional) ----------
// Wenn im Code noch DBG_* verwendet wird: an EE_LOGD hängen.
// (Und bleibt im Release aus, solange EE_LOG_ENABLE_DEBUG=0 ist.)
#define DBG_PRINT(x)    do { if (EE_LOG_ENABLE_DEBUG) Serial.print(x); } while (0)
#define DBG_PRINTLN(x)  do { if (EE_LOG_ENABLE_DEBUG) Serial.println(x); } while (0)
#define DBG_PRINTF(...) do { if (EE_LOG_ENABLE_DEBUG) Serial.printf(__VA_ARGS__); } while (0)

#ifndef DEBUG_WS_PUSH
  #define DEBUG_WS_PUSH EE_DEBUG_WS
#endif
#ifndef DEBUG_WS_SIZE
  #define DEBUG_WS_SIZE EE_DEBUG_WS
#endif
#ifndef DEBUG_AWS_HEAP
  #define DEBUG_AWS_HEAP EE_DEBUG_HEAP
#endif