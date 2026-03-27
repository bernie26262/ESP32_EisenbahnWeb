#include "webserver.h"
#include "debug.h"

#include <ArduinoJson.h>
#include <stdint.h>
#include <AsyncWebServer_ESP32_SC_W5500.h>
#include <AsyncTCP.h>
#if defined(ESP32)
  #include "esp_heap_caps.h"
#endif
#include "network/eth_manager.h"
#include "core2/state/system_runtime_state.h"
#include "core2/mega/mega2_link.h"
#include "core2/mega/mega1_link.h"

#include <LittleFS.h>

#ifndef EE_DEBUG_DIAG_WRITE
#define EE_DEBUG_DIAG_WRITE 0
#endif
#if EE_DEBUG_DIAG_WRITE
  #define EE_DIAGW(fmt, ...) EE_LOGI("DIAGW", fmt, ##__VA_ARGS__)
#else
  #define EE_DIAGW(...) do{}while(0)
#endif


// Exported by mega1_link.cpp (read-only relays snapshot for diag WS)
extern bool mega1Link_getRelaysRO(uint8_t* outSeq,
                                  uint32_t* outAgeMs,
                                  uint16_t* outWeicheGMask,
                                  uint16_t* outWeicheAMask,
                                  uint16_t* outWeicheRedMask,
                                  uint8_t*  outBhfPowerMask);

// ---------------------------------------------------------
// Test switch: minimize DIAG JSON to isolate crash cause
// Enable via build flag: -DEE_TEST_DIAGJSON_MINIMAL=1
// ---------------------------------------------------------
#ifndef EE_TEST_DIAGJSON_MINIMAL
#define EE_TEST_DIAGJSON_MINIMAL 0
#endif


// ---------------------------------------------------------
// ArduinoJson overflow warning (throttled)
// ---------------------------------------------------------
static void warnJsonOverflowThrottled(const char* tag, const JsonDocument& doc)
{
    if (!doc.overflowed()) return;
    static uint32_t s_lastWarnMs = 0;
    const uint32_t now = (uint32_t)millis();
    if ((uint32_t)(now - s_lastWarnMs) < 5000) return; // max 1x/5s
    s_lastWarnMs = now;
    EE_LOGW("AJ", "JsonDocument overflow in %s (allocation failed / fields may be dropped)", tag);
}


// ---------------------------------------------------------
// Heap debug (helps diagnose [AWS] _ack malloc failed)
// Enable heap debug via -DEE_DEBUG_HEAP=1 (and -DEE_LOG_ENABLE_DEBUG=1) in platformio.ini build_flags.
// ---------------------------------------------------------
static void dbgHeap(const char* tag)
{
#if defined(ESP32)
    const uint32_t free8    = heap_caps_get_free_size(MALLOC_CAP_8BIT);
    const uint32_t largest8 = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
    LOG_HEAP("%s free8=%lu largest8=%lu", tag, (unsigned long)free8, (unsigned long)largest8);
#else
    (void)tag;
#endif
}

// ---------------------------------------------------------
// Globale Objekte
// ---------------------------------------------------------
static AsyncWebServer server(80);
static AsyncWebSocket ws("/ws");

// IMPORTANT: Diese Symbole werden (derzeit) auch aus anderen Modulen referenziert.
volatile bool g_stateDirty = true;
volatile bool g_hmiStateDirty = true;

// Diag hat eine eigene Dirty-Quelle: diag-only Clients sollen NICHT an stateDirty gekoppelt sein.
volatile bool g_diagDirty  = true;

static bool s_loggedSkipBeforeFull = false;

// ---------------------------------------------------------
// WS stage markers (Crash-Bisection)
// Enable via -DEE_DEBUG_WS_STAGE=1
// ---------------------------------------------------------
#if EE_DEBUG_WS_STAGE
volatile uint32_t g_wsStage = 0;
static inline void wsStage(uint32_t s) { g_wsStage = s; }
#define WS_STAGE(n) wsStage((n))
#else
#define WS_STAGE(n) do{}while(0)
#endif

// Optional: heap integrity checks (very cheap, good signal for UB)
// Enable via -DEE_DEBUG_HEAP_INTEGRITY=1
static inline void wsHeapCheck(const char* tag) {
#if defined(ESP32) && EE_DEBUG_HEAP_INTEGRITY
    const bool ok = heap_caps_check_integrity_all(true);
    if (!ok) EE_LOGE("HEAP", "integrity FAILED at %s (wsStage=%lu)", tag, (unsigned long)g_wsStage);
#else
    (void)tag;
#endif
}

// ---------------------------------------------------------
// WS Client Subscriptions + Diag-Control Lease (exclusive writer)
// ---------------------------------------------------------
struct WsClientInfo {
    uint32_t id = 0;
    bool used = false;
    bool subBase = true;   // default: base on
    bool subDiag = false;  // default: diag off
    uint32_t lastSeenMs = 0;
};

static constexpr uint8_t MAX_WS_CLIENTS = 8;
static WsClientInfo s_wsClients[MAX_WS_CLIENTS];

static WsClientInfo* findWsClient(uint32_t id) {
    for (auto &c : s_wsClients) if (c.used && c.id == id) return &c;
    return nullptr;
}
static WsClientInfo* upsertWsClient(uint32_t id) {
    if (auto *c = findWsClient(id)) return c;
    for (auto &c : s_wsClients) {
        if (!c.used) { c.used = true; c.id = id; c.subBase = true; c.subDiag = false; c.lastSeenMs = (uint32_t)millis(); return &c; }
    }
    // No slot -> reuse first (should be rare)
    s_wsClients[0] = WsClientInfo{};
    s_wsClients[0].used = true; s_wsClients[0].id = id;
    s_wsClients[0].lastSeenMs = (uint32_t)millis();
    return &s_wsClients[0];
}
static void eraseWsClient(uint32_t id) {
    for (auto &c : s_wsClients) {
        if (c.used && c.id == id) { c = WsClientInfo{}; return; }
    }
}
static uint8_t countSubBase() {
    uint8_t n=0; for (auto &c: s_wsClients) if (c.used && c.subBase) n++; return n;
}
static uint8_t countSubDiag() {
    uint8_t n=0; for (auto &c: s_wsClients) if (c.used && c.subDiag) n++; return n;
}
static uint8_t countWsTotal() {
    uint8_t n=0; for (auto &c: s_wsClients) if (c.used) n++; return n;
}

// Exported helper for link-layer gating: only read diag-only payloads when at least one diag WS subscriber exists.
bool webserverHasDiagSubscribers()
{
    return countSubDiag() > 0;
}

struct DiagLease {
    bool active = false;
    uint32_t ownerId = 0;
    uint32_t sinceMs = 0;
    uint32_t expiresMs = 0;   // millis deadline
    char token[33] = {0};     // 32 hex + NUL
    uint32_t lastHbMs = 0;    // last accepted heartbeat (millis)
};
static DiagLease s_diag;

static const char* hmiDiagOwnerTag()
{
    // HMI itself will not take over diag control.
    // For HMI-v1 we only distinguish between "web" and "none".
    return s_diag.active ? "web" : "none";
}

static void genToken32(char out[33]) {
#if defined(ESP32)
    uint32_t r[4] = { (uint32_t)esp_random(), (uint32_t)esp_random(), (uint32_t)esp_random(), (uint32_t)esp_random() };
#else
    uint32_t r[4] = { (uint32_t)random(), (uint32_t)random(), (uint32_t)random(), (uint32_t)random() };
#endif
    // Achtung: Arduino core definiert bereits ein Makro "HEX" (Print.h: #define HEX 16)
    // Daher NICHT "HEX" als Bezeichner verwenden.
    static const char* HEXCHARS = "0123456789abcdef";
    int k = 0;
    for (int i = 0; i < 4; i++) {
        // 32-bit Wort -> 8 Hex-Zeichen (MSB zuerst)
        for (int shift = 28; shift >= 0; shift -= 4) {
            uint8_t v = (uint8_t)((r[i] >> shift) & 0x0F);
            out[k++] = HEXCHARS[v];
        }
    }
    out[32] = 0;
}

static bool isDiagOwner(AsyncWebSocketClient* client, const char* token) {
    (void)client;                  // clientId nicht mehr zur Autorisierung nutzen
    if (!s_diag.active) return false;
    if (!token) return false;

    // Token is a 32-hex string. Require exact length to avoid partial matches.
    if (strlen(token) != 32) return false;
    if (strlen(s_diag.token) != 32) return false;

    return (strncmp(token, s_diag.token, 32) == 0);
}

static void diagRevertToNormal(const char* reason) {
    // Option A: revert to normal operation. (Currently: release lease only; future: clear manual overrides.)
    (void)reason;
    s_diag = DiagLease{};
    // Safety/comfort: leaving diag should restore Mega1 AUTOMATIK immediately.
    // (We intentionally do NOT restore a previous mode.)
    const bool ok = Mega1Link::queueSetMode(1 /*AUTOMATIK*/);
    // Safety/comfort: leaving diag should restore Mega2 AUTOMATIK immediately.
    const bool ok2 = Mega2Link::queueSetRunMode(0 /*AUTOMATIK*/);
    if (!ok2) {
        EE_LOGW("DIAG", "diagRevertToNormal: failed to queue Mega2 AUTOMATIK (offline/queue full?)");
    }
    if (!ok) {
        EE_LOGW("DIAG", "diagRevertToNormal: failed to queue Mega1 AUTOMATIK (offline/queue full?)");
    }

    // Trigger a fresh state push so all UIs see diagActive=false immediately.
    markStateDirtyAll();
    g_diagDirty  = true;
}

static void diagLeaseTick() {
    if (!s_diag.active) return;
    const uint32_t now = (uint32_t)millis();
    if ((int32_t)(now - s_diag.expiresMs) >= 0) {
        EE_LOGW("DIAG", "lease timeout -> revert to normal");
        diagRevertToNormal("timeout");
    }
}

static void wsTextToBase(const String& payload) {
    for (auto &c : s_wsClients) {
        if (!c.used || !c.subBase) continue;
        ws.text(c.id, payload);
    }
}

static void wsTextToDiag(const String& payload) {
    for (auto &c : s_wsClients) {
        if (!c.used || !c.subDiag) continue;
        ws.text(c.id, payload);
    }
}




// ---------------------------------------------------------
// WebSocket State JSON
// ---------------------------------------------------------
static String buildWsStateJson(bool includeAnalog)
{
    WS_STAGE(10); wsHeapCheck("state:enter");
    // NOTE: This payload grew over time (mega1 diag, startup, entry matrices, sim flags, ...).
    // Keep this generously sized to avoid ArduinoJson overflow (which would silently drop fields
    // and look like "random" UI state glitches).
    JsonDocument doc;

    doc["type"] = "state";
    doc["full"] = includeAnalog;
    WS_STAGE(20);

    // 'ts' ist volatil: im Delta würde das immer "Änderung" simulieren.
    // Daher nur im Full pushen.
    if (includeAnalog) {
        doc["ts"] = (uint32_t)millis();
    }

    doc["eth"]["connected"] = Net::EthManager::isConnected();
    doc["eth"]["ip"]        = Net::EthManager::localIP().toString();
    WS_STAGE(30);

    // Simulation flags (UI/Debug)
#if defined(EE_SIM_NO_HW)
    doc["sim"]["noHwBuild"] = true;
#else
    doc["sim"]["noHwBuild"] = false;
#endif
    doc["sim"]["bypassSbhfSelftest"] = SystemRuntimeState::bypassSbhfSelftest();

    // Mega2 online: use link-layer flag (matches [M2LINK] online=1 in Serial)
    const bool m2online = Mega2Link::mega2Online();
    const bool m1online = SystemRuntimeState::mega1Online();

    doc["mega2"]["online"] = m2online;
    doc["mega1"]["online"] = m1online;
    WS_STAGE(40);

    // --- Compatibility + Debug (damit WebUI sicher etwas findet) ---
    doc["mega1Online"] = m1online;  // Legacy: falls script.js das so erwartet

    // -----------------------------
    // Startup checklist / boot detection (ESP)
    // -----------------------------
    const bool m1Needs = SystemRuntimeState::mega1NeedsStartupChecklist();
    const bool m2Needs = SystemRuntimeState::mega2NeedsStartupChecklist();
    const bool startupNeeds = (m1Needs || m2Needs);

    // "ready" bedeutet erstmal: aus ESP-Sicht keine offenen Boot-Checklist-Punkte.
    // (Spaeter ersetzen wir das durch "Selftests PASS".)
    JsonObject startup = doc["startup"].to<JsonObject>();
    startup["m1Needs"] = m1Needs;
    startup["m2Needs"] = m2Needs;
    startup["m2SelftestDone"] = SystemRuntimeState::mega2SelftestDone();
    startup["m1SelftestDone"] = SystemRuntimeState::mega1SelftestDone();
    WS_STAGE(50);

    // ready: only when required checklists have their selftest-step done
    const bool m1Ok = (!m1Needs) || SystemRuntimeState::mega1SelftestDone();
    const bool m2Ok = (!m2Needs) || SystemRuntimeState::mega2SelftestDone();
    startup["ready"] = (m1Ok && m2Ok);

    // Optional Debug: BootId/Uptime sichtbar machen (sehr hilfreich fürs Verifizieren)
    // ABER: uptimeMs ist volatil -> nur im Full pushen, sonst triggert es Delta-Spam.
    if (includeAnalog) {
        const auto& m1dbg = SystemRuntimeState::mega1Status();
        const auto& m2dbg = SystemRuntimeState::mega2Status();
        startup["m1BootId"]   = (unsigned)m1dbg.bootId;
        startup["m2BootId"]   = (unsigned)m2dbg.bootId;
        startup["m1UptimeMs"] = (uint32_t)m1dbg.uptimeMs;
        startup["m2UptimeMs"] = (uint32_t)m2dbg.uptimeMs;
    }

    const auto& m1s = SystemRuntimeState::mega1Status();
    JsonObject m1st = doc["mega1"]["status"].to<JsonObject>();
    m1st["ver"]   = m1s.version;
    m1st["size"]  = m1s.size;
    m1st["node"]  = m1s.nodeId;
    m1st["flags"] = m1s.flags;
    m1st["reserved"] = m1s.reserved;

    // Mega1 warning mask (normativ): low byte of SystemStatus.reserved
    doc["mega1"]["warningMask"] = (uint8_t)(m1s.reserved & 0xFFu);
    WS_STAGE(60);

    // Optional: rxAge als Debug (wenn du s_lastRxMsM1 nicht exposen willst, dann erstmal weglassen)
    // m1st["rxAgeMs"] = SystemRuntimeState::mega1RxAgeMs();

    // -----------------------------
    // Safety (ESP abgeleitet)
    // -----------------------------
    JsonObject s = doc["safety"].to<JsonObject>();

    const auto& m2 = SystemRuntimeState::mega2Status();
    WS_STAGE(70);

    s["lock"]        = SystemRuntimeState::safetyLock();
    s["blockReason"] = SystemRuntimeState::safetyBlockReason();

    // Fehlerdetails (für UI-Textmapping)
    s["errorType"]  = SystemRuntimeState::errorType;
    s["errorIndex"] = SystemRuntimeState::errorIndex;

    // Power-Status (UI-semantisch): SYS_POWER_ON ist ein Logik-Flag
    // aus Mega2SystemStatus und bedeutet direkt "Leistung EIN".
    const bool powerOn = (m2.flags & SYS_POWER_ON) != 0;
    s["powerOn"] = powerOn;

    // NOTAUS-Status (aus Flags)
    const bool notausActive = (m2.flags & SYS_NOTAUS_ACTIVE) != 0;
    s["notausActive"] = notausActive;

    // Klartext (ESP-seitig)
    s["text"] = SystemRuntimeState::safetyErrorText(
        SystemRuntimeState::errorType,
        SystemRuntimeState::errorIndex
    );

    // Optional: UI kann das direkt nutzen, statt lock/reason zu heuristiken
    bool ackReq = (SystemRuntimeState::safetyLock() &&
                   (notausActive || (SystemRuntimeState::safetyBlockReason() != 0)));

    // Gate "Systemstart – Quittierung erforderlich" until startup checklist is done.
    // Startup-Checklist Overlay soll zuerst laufen; erst danach kommt die Systemstart-Quittierung.
    // (NOTAUS bleibt immer ackRequired, unabhängig vom Startup.)
    if (startupNeeds && !notausActive && (SystemRuntimeState::safetyBlockReason() == 1))
    {
        ackReq = false;
        // Optional: Text unterdrücken, damit UI nicht verwirrt (kannst du auch weglassen)
        s["text"] = "";
    }

    s["ackRequired"] = ackReq;

    // -----------------------------
    // Mega2 Details (nur wenn online)
    // -----------------------------
    if (m2online)
    {
        WS_STAGE(100);
        const auto& m2s = SystemRuntimeState::mega2Status();

        doc["mega2"]["flags"]             = m2s.flags;
        doc["mega2"]["blockOccupiedMask"] = m2s.blockOccupiedMask;
        WS_STAGE(110);


        // DRDY-fast: expose detailed blocks[] + a fast occupancy mask WITHOUT overriding legacy mask.
        {
            WS_STAGE(120);
            const BlockStatus* bs = SystemRuntimeState::mega2BlockStatus();
            // IMPORTANT: Use SystemStatus.blockOccupiedMask as single source of truth for occupancy.
            // BlockStatus[].besetzt may be derived/temporary and can mismatch the final occupiedMask.
            const uint16_t occFast = m2s.blockOccupiedMask;
            // Debug
            doc["mega2"]["blockOccupiedMaskFast"] = occFast;

            JsonObject b = doc["mega2"]["blocks"].to<JsonObject>();
            b["occupiedMask"] = occFast;

            JsonArray bst = b["status"].to<JsonArray>();
            // TEST ONLY: no bs==NULL guard here. If crash returns, bs was NULL and was the cause.
            b["valid"] = true;
            for (uint8_t i = 0; i < M2_NUM_BLOCKS; i++)
            {
                JsonObject o = bst.add<JsonObject>();
                o["kontakt"]     = (uint8_t)bs[i].kontakt;
                o["stromEin"]    = (uint8_t)bs[i].stromEin;
                o["besetzt"]     = (uint8_t)((occFast & (uint16_t)(1u << i)) != 0);
                o["kurzschluss"] = (uint8_t)bs[i].kurzschluss;
                o["nothalt"]     = (uint8_t)bs[i].nothalt;
                o["stromRaw"]    = bs[i].stromRaw;
            }
        }    
        WS_STAGE(130); 

        // reserved = (allowedMask<<8) | warningMask
        const uint8_t allowedMask = (uint8_t)((m2s.reserved >> 8) & 0xFF);
        const uint8_t warningMask = (uint8_t)(m2s.reserved & 0xFF);

        // expose masks explicitly for WebUI (warnings + Einschränkungen)
        doc["mega2"]["allowedMask"] = allowedMask;
        doc["mega2"]["warningMask"] = warningMask;

        JsonObject sbhf = doc["mega2"]["sbhf"].to<JsonObject>();
        sbhf["state"] = m2s.sbhfState;
        // Also expose flat fields for backward compatibility / diagnostics.
        // IMPORTANT: sbhfOccupiedMask includes META bits (e.g. 0x80 selftestRunning).
        doc["mega2"]["sbhfState"]        = m2s.sbhfState;
        doc["mega2"]["sbhfOccupiedMask"] = m2s.sbhfOccupiedMask;

        // sbhfOccupiedMask carries occupancy in bits 0..2 (G1..G3).
        // We additionally encode runtime META flags in higher bits to avoid
        // a SystemStatus protocol bump.
        // Bit7 (0x80): SBHF selftest running.
        const uint16_t occRaw = m2s.sbhfOccupiedMask;
        const bool selftestRunning = (occRaw & 0x80u) != 0;
        const uint8_t occ = (uint8_t)(occRaw & 0x07u);

        sbhf["occupiedMask"]    = occ;
        sbhf["occupiedMaskRaw"] = occRaw; // debug/diagnostics
        sbhf["selftestRunning"] = selftestRunning;

        // UI compatibility: provide both naming variants.
        sbhf["currentGleis"] = m2s.sbhfCurrentGleis;
        sbhf["currentTrack"] = m2s.sbhfCurrentGleis;

        // Masks (source: reserved field in SystemStatus)
        sbhf["allowedMask"]  = allowedMask;
        sbhf["warningMask"]  = warningMask;

        const bool restricted =
            ((warningMask & 0x01) != 0) ||
            (allowedMask != 0x07 && allowedMask != 0x00);

        sbhf["restricted"] = restricted;

        // ShadowYardStatus (DRDY-fast, detaillierter SBHF-Status)
        const ShadowYardStatus& sh = SystemRuntimeState::mega2ShadowStatus();
        JsonObject shj = doc["mega2"]["shadow"].to<JsonObject>();
        shj["gleisBesetztMask"] = sh.gleisBesetztMask;
        shj["kontaktMask"]      = sh.kontaktMask;
        shj["stromMask"]        = sh.stromMask;
        shj["einfahrGleis"]     = sh.einfahrGleis;
        shj["ausfahrGleis"]     = sh.ausfahrGleis;
        shj["modus"]            = sh.modus;
        shj["state"]            = sh.state;
        
        // Startup-Checklist Flags (Mega2): prefer ShadowYardStatus.selftestFlags.
        // Fallback to META bits in sbhfOccupiedMask (0x80 running, 0x40 done).
        const uint8_t stf = sh.selftestFlags;
        const bool stRunning = ((stf & 0x01) != 0) || ((m2s.sbhfOccupiedMask & 0x80) != 0);
        const bool stDone    = ((stf & 0x02) != 0) || ((m2s.sbhfOccupiedMask & 0x40) != 0);
        sbhf["selftestRunning"] = stRunning;
        sbhf["selftestDone"]    = stDone;

        // optional: diagnostics
        shj["selftestFlags"] = stf;


        JsonObject t = doc["mega2"]["turnouts"].to<JsonObject>();
        // DRDY-fast: prefer dedicated Turnouts payload (CMD 0x27). Fallback to SystemStatus if not yet available.
        const auto& tt = SystemRuntimeState::mega2Turnouts();
        const uint32_t ttAge = SystemRuntimeState::mega2TurnoutsAgeMs();
        const bool ttValid = (ttAge != 0xFFFFFFFFu);
        t["sollMask"] = ttValid ? tt.sollMask : m2s.turnoutSollMask;
        t["istMask"]  = ttValid ? tt.istMask  : m2s.turnoutIstMask;

        // Blocks already populated above (occupiedMask + status[]) from DRDY-fast cache.
        // Mega2 Analog (Trafo + Blockströme)
        // IMPORTANT: Analog is streamed separately every 500ms; we include it only
        // in ground-truth full states (every few seconds) to keep payload small.
         
        if (includeAnalog)
        {
            WS_STAGE(160);
            // Mega2 Analog (Trafo + Blockströme) – only for ground-truth "full" state
            const auto& an = SystemRuntimeState::mega2Analog();
            JsonObject a = doc["mega2"]["analog"].to<JsonObject>();
            a["seq"] = an.seq;
            a["flags"] = an.flags;
            a["tsMs"]  = SystemRuntimeState::mega2AnalogLastUpdateMs();
            a["ageMs"] = SystemRuntimeState::mega2AnalogAgeMs();
            a["hz"]    = SystemRuntimeState::mega2AnalogHz();
            a["vA10"] = an.vA10;
            a["vB10"] = an.vB10;
            JsonArray ia = a["i_mA"].to<JsonArray>();
            for (uint8_t i = 0; i < M2_NUM_BLOCKS; ++i) ia.add(an.i_mA[i]);
        }

        // Step 3.5: Entry-Matrix (FROM->TO)
        WS_STAGE(170);
        // TEST ONLY: no ea==NULL guard here. If crash returns, ea was NULL and was the cause.
        JsonArray entry = doc["mega2"]["entryAllowed"].to<JsonArray>();
        const uint16_t* ea = SystemRuntimeState::mega2EntryAllowed();
        doc["mega2"]["entryAllowedValid"] = true;
        for (uint8_t i = 0; i < 9; i++)
            entry.add(ea[i]);
 
        WS_STAGE(180);

        // TEST ONLY: no ep==NULL guard here. If crash returns, ep was NULL and was the cause.
        JsonArray entryPrev = doc["mega2"]["entryPreview"].to<JsonArray>();
        const uint16_t* ep = SystemRuntimeState::mega2EntryPreview();
        doc["mega2"]["entryPreviewValid"] = true;
        for (uint8_t i = 0; i < 9; i++)
            entryPrev.add(ep[i]);
        WS_STAGE(190);
    }

    // -----------------------------
    // Mega1 Details (nur wenn online)
    // -----------------------------
    doc["mega1"]["hasDiag"] = false;

    if (m1online)
    {
        const auto& m1d = SystemRuntimeState::mega1Diag();

        JsonObject d  = doc["mega1"]["diag"].to<JsonObject>();
        d["mode"]      = m1d.mode;
        d["powerMask"] = m1d.powerMask;

        // NOTE: Mega1DiagV1 field names (v1)
        d["weicheIstBits"]  = m1d.weicheIstGeradeBits;
        d["weicheSollBits"] = m1d.weicheSollGeradeBits;
        d["weicheSlowSelectedBits"] = m1d.weicheSlowSelectedBits;
        
        // Mega1 Selftest (Startup-Checklist)
        d["selftestRunning"]    = ((m1d.selftestFlags & 0x01u) != 0);
        d["selftestDone"]       = ((m1d.selftestFlags & 0x02u) != 0);
        d["selftestFailMask"]   = (uint16_t)m1d.selftestFailMask;
        d["selftestCurrentIdx"] = (uint8_t)m1d.selftestCurrentIdx;

        // NOTE: Mega1 relays are diagnose-only -> emitted in WS type:"diag" only (buildWsDiagJson()).

        doc["mega1"]["hasDiag"] = true;
    }


    // Avoid heap fragmentation by reserving a reasonable buffer.
    // (WS payload can grow; adjust if overflow log appears.)
    String out;
    out.reserve(4096);
    
    // WS client counts + diag control status (used for safety banner + gating UX)
    {
        JsonObject wsC = doc["wsClients"].to<JsonObject>();
        wsC["base"] = countSubBase();
        wsC["diag"] = countSubDiag();
    }
    {
        JsonObject d = doc["diagCtrl"].to<JsonObject>();
        d["active"] = s_diag.active;
        d["ownerId"] = s_diag.active ? s_diag.ownerId : 0;
        d["sinceMs"] = s_diag.active ? s_diag.sinceMs : 0;
        const uint32_t nowMs = (uint32_t)millis();
        d["expiresInMs"] = s_diag.active
            ? (uint32_t)((s_diag.expiresMs > nowMs) ? (s_diag.expiresMs - nowMs) : 0)
            : 0;
    }

    warnJsonOverflowThrottled("buildWsStateJson", doc);
    WS_STAGE(900); wsHeapCheck("state:pre-serialize");
    serializeJson(doc, out);
    WS_STAGE(910); wsHeapCheck("state:post-serialize");

    

#if EE_DEBUG_WS
    // Throttled debug: payload size + overflow
    {
        static uint32_t s_lastLogMs = 0;
        static uint32_t s_lastLen   = 0;
        const uint32_t now = (uint32_t)millis();
        const uint32_t len = (uint32_t)out.length();
        const bool overflow = doc.overflowed();

        const bool timeOk = (now - s_lastLogMs) >= 5000;
        const uint32_t diff = (len > s_lastLen) ? (len - s_lastLen) : (s_lastLen - len);
        const bool changed = diff >= 256;

        if (overflow || timeOk || changed)
        {
            s_lastLogMs = now;
            s_lastLen   = len;
            LOG_WS("state json len=%lu overflow=%d", (unsigned long)len, overflow ? 1 : 0);
        }
    }
#endif

    WS_STAGE(999);
    return out;
}

static String buildMega1DefectList()
{
    const auto& m1d = SystemRuntimeState::mega1Diag();
    const uint16_t fm = (uint16_t)m1d.selftestFailMask & 0x0FFFu;

    String out;
    out.reserve(48);

    for (uint8_t i = 0; i < 12; ++i)
    {
        if ((fm & (1u << i)) == 0u)
            continue;

        if (!out.isEmpty())
            out += ' ';

        out += 'W';
        out += String(i + 1);
    }

    return out;
}

static String buildMega2DefectList(uint8_t warningMask)
{
    String out;
    out.reserve(24);

    struct Entry { uint8_t bit; const char* name; };
    static const Entry kMap[] = {
        { 0x02u, "W12" },
        { 0x04u, "W13" },
        { 0x08u, "W14" },
        { 0x10u, "W15" },
    };

    for (const auto& e : kMap)
    {
        if ((warningMask & e.bit) == 0u)
            continue;

        if (!out.isEmpty())
            out += ' ';

        out += e.name;
    }

    return out;
}

static String buildWsStateLiteJson()
{
    JsonDocument doc;

    doc["type"] = "state-lite";

    const bool ethConnected = Net::EthManager::isConnected();
    const bool m2online = Mega2Link::mega2Online();
    const bool m1online = SystemRuntimeState::mega1Online();

    const bool m1Needs = SystemRuntimeState::mega1NeedsStartupChecklist();
    const bool m2Needs = SystemRuntimeState::mega2NeedsStartupChecklist();
    const bool m1SelftestDone = SystemRuntimeState::mega1SelftestDone();
    const bool m2SelftestDone = SystemRuntimeState::mega2SelftestDone();
    const bool startupReady = ((!m1Needs) || m1SelftestDone) && ((!m2Needs) || m2SelftestDone);
    const bool startupChecklistActive = (m1Needs || m2Needs);

    const auto& m1diag = SystemRuntimeState::mega1Diag();
    const auto& m2shadow = SystemRuntimeState::mega2ShadowStatus();
    const bool m1SelftestRunning = ((m1diag.selftestFlags & 0x01u) != 0u);
    const bool m2SelftestRunning = ((m2shadow.selftestFlags & 0x01u) != 0u);

    const auto& m1s = SystemRuntimeState::mega1Status();
    const uint8_t m1WarningMask = (uint8_t)(m1s.reserved & 0xFFu);
    const bool m1WarningPresent = ((m1s.flags & SYS_WARNING_PRESENT) != 0u);
    const uint16_t m1FailMask = (uint16_t)m1diag.selftestFailMask & 0x0FFFu;

    // ⚠️ aktuell: kein reserved-Feld im ShadowYardStatus vorhanden
    // → minimal: nur Selftest-Status verwenden
    const uint8_t m2WarningMask = 0;
    const bool m2WarningPresent = ((m2shadow.selftestFlags & 0x02u) != 0u);

    const bool warningPresent = m1WarningPresent || m2WarningPresent;

    const auto& m2 = SystemRuntimeState::mega2Status();
    const bool safetyLock = SystemRuntimeState::safetyLock();
    const bool powerOn = (m2.flags & SYS_POWER_ON) != 0;
    const bool notausActive = (m2.flags & SYS_NOTAUS_ACTIVE) != 0;

    bool ackRequired = (safetyLock &&
                        (notausActive || (SystemRuntimeState::safetyBlockReason() != 0)));
    if ((m1Needs || m2Needs) && !notausActive && (SystemRuntimeState::safetyBlockReason() == 1))
    {
        ackRequired = false;
    }

    bool modeAuto = false;
    if (m1online)
    {
        modeAuto = (SystemRuntimeState::mega1Diag().mode == 1u);
    }

    JsonObject eth = doc["eth"].to<JsonObject>();
    eth["connected"] = ethConnected;
    eth["ip"] = Net::EthManager::localIP().toString();

    JsonObject mega1 = doc["mega1"].to<JsonObject>();
    mega1["online"] = m1online;
    mega1["modeAuto"] = modeAuto;
    mega1["warningMask"] = m1WarningMask;
    mega1["bahnhofMask"] = (uint8_t)m1diag.powerMask;
    mega1["selftestRetryAvailable"] =
        m1online &&
        (!m1SelftestRunning) &&
        (m1FailMask != 0u);
    mega1["defectList"] = buildMega1DefectList();

    JsonObject mega2 = doc["mega2"].to<JsonObject>();
    mega2["online"] = m2online;
    mega2["warningMask"] = m2WarningMask;
    mega2["selftestRetryAvailable"] =
        m2online &&
        (!m2SelftestRunning) &&
        (m2WarningPresent);
    mega2["defectList"] = buildMega2DefectList(m2WarningMask);

    JsonObject summary = doc["summary"].to<JsonObject>();
    summary["warningPresent"] = warningPresent;
    summary["emergencyPresent"] = notausActive;

    JsonObject startup = doc["startup"].to<JsonObject>();
    startup["ready"] = startupReady;
    startup["checklistActive"] = startupChecklistActive;
    startup["m1Needs"] = m1Needs;
    startup["m2Needs"] = m2Needs;
    startup["m1SelftestDone"] = m1SelftestDone;
    startup["m2SelftestDone"] = m2SelftestDone;
    startup["m1SelftestRunning"] = m1SelftestRunning;
    startup["m2SelftestRunning"] = m2SelftestRunning;

    JsonObject safety = doc["safety"].to<JsonObject>();
    safety["lock"] = safetyLock;
    safety["ackRequired"] = ackRequired;
    safety["notausActive"] = notausActive;
    safety["powerOn"] = powerOn;

    const bool writeLockedByDiag = s_diag.active;

    JsonObject actions = doc["actions"].to<JsonObject>();
    actions["canWrite"] = !writeLockedByDiag;
    actions["canAck"]      = (!writeLockedByDiag) && ackRequired && m2online;
    actions["canPowerOn"]  = (!writeLockedByDiag) && ethConnected && m1online && m2online
                          && startupReady && (!powerOn) && (!notausActive) && (!safetyLock);
    actions["canPowerOff"] = (!writeLockedByDiag) && ethConnected && m1online && m2online
                          && powerOn;
    actions["canAuto"]     = (!writeLockedByDiag) && ethConnected && m1online && m2online
                          && startupReady && (!safetyLock) && (!notausActive) && (!modeAuto);
    actions["canManual"]   = (!writeLockedByDiag) && ethConnected && m1online && m2online
                          && startupReady && (!safetyLock) && (!notausActive) && modeAuto;
    actions["canStartM1Selftest"] = (!writeLockedByDiag) && m1online && m1Needs && (!m1SelftestDone) && (!m1SelftestRunning);
    actions["canStartM2Selftest"] = (!writeLockedByDiag) && m2online && m2Needs && (!m2SelftestDone) && (!m2SelftestRunning);
    actions["canM1Selftest"] = actions["canStartM1Selftest"];
    actions["canM2Selftest"] = actions["canStartM2Selftest"];

    // Entspricht der WebUI-Overlay-Logik:
    // Quittieren erst wenn alle benötigten Schritte erledigt sind.
    const bool allChecklistDone =
        ((!m1Needs) || m1SelftestDone) &&
        ((!m2Needs) || m2SelftestDone);
    actions["canStartupConfirm"] =
        (!writeLockedByDiag) &&
        startupChecklistActive &&
        m2online &&
        allChecklistDone;
 
    JsonObject wsC = doc["wsClients"].to<JsonObject>();
    wsC["base"] = countSubBase();
    wsC["diag"] = countSubDiag();
    wsC["total"] = countWsTotal();

    JsonObject diag = doc["diag"].to<JsonObject>();
    diag["active"] = s_diag.active;
    diag["owner"] = hmiDiagOwnerTag();

    String out;
    out.reserve(1024);
    warnJsonOverflowThrottled("buildWsStateLiteJson", doc);
    serializeJson(doc, out);
    return out;
}

static String buildWsAnalogJson();

// --------------------------------------------------------
// HMI Wrapper (macht HMI-State extern verfügbar)
// --------------------------------------------------------
String buildWsStateJsonForHmi()
{
    return buildWsStateLiteJson();
}

String buildWsAnalogJsonForHmi()
{
    return buildWsAnalogJson();
}

// ---------------------------------------------------------
// WS Analog JSON (small, periodic)
// ---------------------------------------------------------
static String buildWsAnalogJson()
{
    // Only a small payload -> keep this tight to reduce heap pressure.
    JsonDocument doc;

    doc["type"] = "analog";
    doc["ts"]   = (uint32_t)millis();

    const auto& an = SystemRuntimeState::mega2Analog();

    JsonObject a = doc["analog"].to<JsonObject>();
    a["seq"]   = an.seq;
    a["flags"] = an.flags;
    a["tsMs"]  = SystemRuntimeState::mega2AnalogLastUpdateMs();
    a["ageMs"] = SystemRuntimeState::mega2AnalogAgeMs();
    a["hz"]    = SystemRuntimeState::mega2AnalogHz();
    a["vA10"]  = an.vA10;
    a["vB10"]  = an.vB10;

    JsonArray ia = a["i_mA"].to<JsonArray>();
    for (uint8_t i = 0; i < M2_NUM_BLOCKS; i++)
        ia.add(an.i_mA[i]);

    String out;
    out.reserve(512);
    warnJsonOverflowThrottled("buildWsAnalogJson", doc);
    serializeJson(doc, out);

#if EE_DEBUG_WS
    // Throttled debug: payload size + overflow
    {
        static uint32_t s_lastLogMs = 0;
        static uint32_t s_lastLen   = 0;
        const uint32_t now = (uint32_t)millis();
        const uint32_t len = (uint32_t)out.length();
        const bool overflow = doc.overflowed();

        const bool timeOk = (now - s_lastLogMs) >= 5000;
        const uint32_t diff = (len > s_lastLen) ? (len - s_lastLen) : (s_lastLen - len);
        const bool changed = diff >= 256;

        if (overflow || timeOk || changed)
        {
            s_lastLogMs = now;
            s_lastLen   = len;
            LOG_WS("analog json len=%lu overflow=%d", (unsigned long)len, overflow ? 1 : 0);
        }
    }
#endif

    return out;
}

// ---------------------------------------------------------
// WS Diag JSON (read-only, only for diag subscribers)
// ---------------------------------------------------------
static String buildWsDiagJson(bool full)
{

#if EE_TEST_DIAGJSON_MINIMAL
    StaticJsonDocument<128> doc;
    doc["type"]  = "diag";
    if (full) doc["ts"] = (uint32_t)millis();
    doc["valid"] = true;
    String out;
    serializeJson(doc, out);
    return out;
#else

    // Read-only diagnostics snapshot. Keep modest in size; we can extend later.
    JsonDocument doc;

    doc["type"] = "diag";
    if (full) {
        doc["ts"] = (uint32_t)millis();
    }

    // WS client counts only in FULL (volatile)
    if (full)
    {
        JsonObject wsC = doc["wsClients"].to<JsonObject>();
        wsC["base"] = countSubBase();
        wsC["diag"] = countSubDiag();
    }

    // diag control: stable fields always; volatile countdown only in FULL
    {
        JsonObject d = doc["diagCtrl"].to<JsonObject>();
        d["active"]  = s_diag.active;
        d["ownerId"] = s_diag.active ? s_diag.ownerId : 0;
        d["sinceMs"] = s_diag.active ? s_diag.sinceMs : 0;

        if (full)
        {
            const uint32_t nowMs = (uint32_t)millis();
            d["expiresInMs"] = s_diag.active
                ? (uint32_t)((s_diag.expiresMs > nowMs) ? (s_diag.expiresMs - nowMs) : 0)
                : 0;
        }
    }

    const bool m2online = Mega2Link::mega2Online();
    const bool m1online = SystemRuntimeState::mega1Online();
    doc["mega2"]["online"] = m2online;
    doc["mega1"]["online"] = m1online;

    // Mega1: status + diag snapshot (same fields as state, but compact)
    {
        const auto& m1s = SystemRuntimeState::mega1Status();
        JsonObject m1st = doc["mega1"]["status"].to<JsonObject>();
        m1st["ver"]   = m1s.version;
        m1st["size"]  = m1s.size;
        m1st["node"]  = m1s.nodeId;
        m1st["flags"] = m1s.flags;
        m1st["reserved"] = m1s.reserved;

        doc["mega1"]["warningMask"] = (uint8_t)(m1s.reserved & 0xFFu);

        // In deinem State wird mega1.hasDiag nur gesetzt, wenn online.
        doc["mega1"]["hasDiag"] = false;
        if (m1online)
        {
            const auto& m1d = SystemRuntimeState::mega1Diag();
            JsonObject d  = doc["mega1"]["diag"].to<JsonObject>();
            d["mode"]      = m1d.mode;
            d["powerMask"] = m1d.powerMask;
            d["weicheIstBits"]  = m1d.weicheIstGeradeBits;
            d["weicheSollBits"] = m1d.weicheSollGeradeBits;
            d["weicheSlowSelectedBits"] = m1d.weicheSlowSelectedBits;
            d["selftestRunning"]    = ((m1d.selftestFlags & 0x01u) != 0);
            d["selftestDone"]       = ((m1d.selftestFlags & 0x02u) != 0);
            d["selftestFailMask"]   = (uint16_t)m1d.selftestFailMask;
            d["selftestCurrentIdx"] = (uint8_t)m1d.selftestCurrentIdx;
            
            // -------------------------------------------------
            // Mega1: Digitale Sensoren (S0..S23) – aus Masken
            // Wir zeigen bewusst nur die "real genutzten" Sensoren:
            // S0..S10, S18, S19, S22, S23 (15 Stück, mit Gap).
            // level = logischer Aktivzustand (1=aktiv, i.d.R. physisch LOW)
            // rise/fall = sticky edge flags (1=seit letztem DIAG-Read gesehen)
            // -------------------------------------------------
            static const uint8_t M1_SENS_SID[15] = {
                0,1,2,3,4,5,6,7,8,9,10,18,19,22,23
            };
            JsonArray arr = doc["mega1"]["sensors"].to<JsonArray>();
            for (uint8_t i = 0; i < 15; ++i)
            {
                const uint8_t sid = M1_SENS_SID[i];
                const uint32_t bit = (1UL << sid);
                JsonObject o = arr.add<JsonObject>();
                o["sid"]   = sid; // reale Anlagen-Nummer (mit Lücken)
                o["level"] = ((m1d.sensorActiveMask & bit) != 0) ? 1 : 0; // logischer Aktivzustand
                o["rise"]  = ((m1d.sensorRiseMask   & bit) != 0) ? 1 : 0;
                o["fall"]  = ((m1d.sensorFallMask   & bit) != 0) ? 1 : 0;
            }
            // optional: raw masks fürs Debugging
            doc["mega1"]["sensorActiveMask"] = m1d.sensorActiveMask;
            doc["mega1"]["sensorRiseMask"]   = m1d.sensorRiseMask;
            doc["mega1"]["sensorFallMask"]   = m1d.sensorFallMask;

            // Mega1 Relais / Outputs (read-only, CMD_GET_RELAYS 0xD2)
            {
                uint8_t  rSeq = 0;
                uint32_t rAge = 0;
                uint16_t gMask = 0, aMask = 0, redMask = 0;
                uint8_t  bhfMask = 0;

                if (mega1Link_getRelaysRO(&rSeq, &rAge, &gMask, &aMask, &redMask, &bhfMask))
                {
                    JsonObject r = doc["mega1"]["relays"].to<JsonObject>();
                    r["seq"] = rSeq;
                    if (full) r["ageMs"] = rAge;
                    r["weicheGMask"]   = gMask;
                    r["weicheAMask"]   = aMask;
                    r["weicheRedMask"] = redMask;
                    r["bhfPowerMask"]  = bhfMask;
                }
            }

            doc["mega1"]["hasDiag"] = true;
    
        }
    }

    // Mega2: masks + minimal analog meta (seq) – Hz/age kommt im nächsten ToDo
    if (m2online)
    {
        const auto& m2s = SystemRuntimeState::mega2Status();
        doc["mega2"]["flags"] = m2s.flags;
        const uint8_t allowedMask = (uint8_t)((m2s.reserved >> 8) & 0xFF);
        const uint8_t warningMask = (uint8_t)(m2s.reserved & 0xFF);
        doc["mega2"]["allowedMask"] = allowedMask;
        doc["mega2"]["warningMask"] = warningMask;

        const auto& an = SystemRuntimeState::mega2Analog();
        doc["mega2"]["analog"]["seq"] = an.seq;
        doc["mega2"]["analog"]["tsMs"]  = SystemRuntimeState::mega2AnalogLastUpdateMs();
        if (full) doc["mega2"]["analog"]["ageMs"] = SystemRuntimeState::mega2AnalogAgeMs();
        doc["mega2"]["analog"]["hz"]    = SystemRuntimeState::mega2AnalogHz();
        
        // Mega2 Schaltgleise S11..S16 (level + rise/fall counters) – only if provided by Mega2 FW + ESP link
        if (SystemRuntimeState::mega2SchaltgleiseValid())
        {
            uint8_t sid[6], lvl[6];
            uint16_t rise[6], fall[6];
            SystemRuntimeState::mega2GetSchaltgleise6(sid, lvl, rise, fall);

            JsonArray arr = doc["mega2"]["schaltgleise"].to<JsonArray>();
            for (uint8_t i = 0; i < 6; ++i)
            {
                JsonObject o = arr.add<JsonObject>();
                o["sid"]   = sid[i];      // 11..16
                o["level"] = lvl[i];      // electrical level (HIGH=1)
                o["rise"]  = rise[i];     // rising count (uint16 wrap ok)
                o["fall"]  = fall[i];     // falling count (uint16 wrap ok)
            }
            doc["mega2"]["schaltSeq"]   = SystemRuntimeState::mega2SchaltgleiseSeq();
            doc["mega2"]["schaltTsMs"]  = SystemRuntimeState::mega2SchaltgleiseLastUpdateMs();
            doc["mega2"]["schaltAgeMs"] = (uint32_t)((uint32_t)millis() - SystemRuntimeState::mega2SchaltgleiseLastUpdateMs());
        }

        // Mega2 Diag Sensors (Kontaktgleise + Schaltgleise) – compact level mask + counters
        if (SystemRuntimeState::mega2DiagSensorsValid())
        {
            const auto& p = SystemRuntimeState::mega2DiagSensors();
            JsonObject ds = doc["mega2"]["diagSensors"].to<JsonObject>();
            ds["seq"] = p.seq;

            // Kontakte
            ds["kontaktLevelMask"] = p.kontaktLevelMask;

            // packed 4-bit counters (UI nutzt getNibble4()) – 14 Kontakte => typ. 7 Bytes
            JsonArray kr = ds["kontaktRise4"].to<JsonArray>();
            JsonArray kf = ds["kontaktFall4"].to<JsonArray>();
            for (uint8_t i=0; i<sizeof(p.kontaktRise4); i++){
                kr.add(p.kontaktRise4[i]);
                kf.add(p.kontaktFall4[i]);
            }

            // Schaltgleise
            ds["schaltLevelMask"]  = p.schaltLevelMask;
            JsonArray r = ds["schaltRise"].to<JsonArray>();
            JsonArray f = ds["schaltFall"].to<JsonArray>();
            for (uint8_t i=0;i<M2_DIAG_NUM_SCHALT;i++){
            r.add(p.schaltRise[i]);
                f.add(p.schaltFall[i]);
            }

            if (full) ds["ageMs"] = SystemRuntimeState::mega2DiagSensorsAgeMs();
        }

        // Mega2 Diag Relays (pin levels, active-low semantics)
        if (SystemRuntimeState::mega2DiagRelaysValid())
        {
            const auto& p = SystemRuntimeState::mega2DiagRelays();
            JsonObject rr = doc["mega2"]["relays"].to<JsonObject>();
            rr["seq"] = p.seq;
            rr["levelMask"] = p.levelMask;
            if (full) rr["ageMs"] = SystemRuntimeState::mega2DiagRelaysAgeMs();
        }
    }

    String out;
    out.reserve(2048);
    warnJsonOverflowThrottled("buildWsDiagJson", doc);
    serializeJson(doc, out);
    return out;
#endif
}



// ---------------------------------------------------------
// WS Event Handler
// ---------------------------------------------------------
static void onWsEvent(AsyncWebSocket* server,
                      AsyncWebSocketClient* client,
                      AwsEventType type,
                      void* arg,
                      uint8_t* data,
                      size_t len)
{
if (type == WS_EVT_CONNECT)
{
    const uint32_t cid = client ? client->id() : 0;
    LOG_WS("client connected id=%u", (unsigned)cid);
#if EE_DEBUG_HEAP
    dbgHeap("ws connect");
#endif
    if (client) {
        auto *ci = upsertWsClient(cid);
        ci->lastSeenMs = (uint32_t)millis();

        // IMPORTANT:
        // Beim CONNECT NICHT sofort große Payloads senden.
        // Subscription wird explizit durch action:"subscribe" gesetzt.
        ci->subBase = false;
        ci->subDiag = false;
    }
    return;
}

if (type == WS_EVT_DISCONNECT)
{
    const uint32_t cid = client ? client->id() : 0;
    LOG_WS("client disconnected id=%u", (unsigned)cid);
    eraseWsClient(cid);
//    if (s_diag.active && cid && (cid == s_diag.ownerId)) {
//        EE_LOGW("DIAG", "owner disconnected -> revert to normal");
//       diagRevertToNormal("disconnect");
//    }
    return;
}

if (type != WS_EVT_DATA)
    return;

    AwsFrameInfo* info = (AwsFrameInfo*)arg;
    if (!info->final || info->index != 0 || info->len != len)
        return;

    JsonDocument cmd;
    if (deserializeJson(cmd, data, len))
        return;

    const char* action = cmd["action"];
    if (!action)
        return;

    LOG_WS("action rx: %s", action);

    // Update lastSeen for this client (used for diag lease + presence)
    if (client) {
        if (auto *ci = upsertWsClient(client->id())) ci->lastSeenMs = (uint32_t)millis();
    }

    // -------------------------------------------------
    // Subscription: client declares what it wants to receive
    // action:"subscribe", base:true/false, diag:true/false
    // -------------------------------------------------
    if (!strcmp(action, "subscribe"))
    {
    bool subBase = true;
    bool subDiag = false;
    if (!cmd["base"].isNull()) subBase = cmd["base"].as<bool>();
    if (!cmd["diag"].isNull()) subDiag = cmd["diag"].as<bool>();

    if (client) {
        auto *ci = upsertWsClient(client->id());

        const bool oldBase = ci->subBase;
        const bool oldDiag = ci->subDiag;

        ci->subBase = subBase;
        ci->subDiag = subDiag;
        ci->lastSeenMs = (uint32_t)millis();

        LOG_WS("subscribe id=%u base=%d diag=%d",
               (unsigned)client->id(), subBase?1:0, subDiag?1:0);

        // Snapshot NUR wenn base gerade aktiviert wurde (false -> true).
        // So vermeiden wir Doppel-Sends bei reconnect/mehrfach-subscribe.
        if (subBase && !oldBase) {
            client->text(buildWsStateJson(true));
            // Analog NICHT hier sofort senden (siehe unten: wird periodisch gepusht)
            //client->text(buildWsAnalogJson());
        }

        (void)oldDiag; // aktuell nicht genutzt, aber bewusst gelesen
    }
    return;
}

    // -------------------------------------------------
    // Diag-Control (exclusive writer) : enter/exit/heartbeat
    // Option A on loss: revert to normal operation.
    // -------------------------------------------------
    if (!strcmp(action, "diagEnter"))
    {
        const uint32_t now = (uint32_t)millis();
        const uint32_t cid = client ? client->id() : 0;
        // NOTE: Use a String here to avoid JsonVariant->const char* edge cases.
        String tokIn;
        if (!cmd["token"].isNull()) {
            tokIn = cmd["token"].as<String>();
        }
        const char* tokenIn = (tokIn.length() > 0) ? tokIn.c_str() : nullptr;

        JsonDocument reply;
        reply["type"] = "diagControl";

        constexpr uint32_t LEASE_MS = 180000;
        constexpr uint32_t HB_DEAD_MS = 35000; // NEW: if no valid heartbeat for 35s -> release ghost lease

        // NEW: Ghost-lease protection. If the current lease has not been refreshed by a valid heartbeat
        // for a while, consider it dead and release it so a new owner can enter.
        if (s_diag.active && s_diag.lastHbMs != 0) {
            const uint32_t hbAge = (uint32_t)(now - s_diag.lastHbMs);
            if (hbAge > HB_DEAD_MS) {
                EE_LOGW("DIAG", "lease hb-dead (age=%lu ms) -> revert to normal",
                        (unsigned long)hbAge);
                diagRevertToNormal("hb-dead");
            }
        }

        const bool canResumeByToken =
            (s_diag.active && tokenIn && (strncmp(tokenIn, s_diag.token, 32) == 0));

        if (!s_diag.active || canResumeByToken)
        {
            if (!s_diag.active)
            {
                s_diag.active  = true;
                s_diag.ownerId = cid;
                s_diag.sinceMs = now;
                genToken32(s_diag.token);
                s_diag.lastHbMs = now;
                
            }
            else
            {   
                // Resume: owner rebind to current WS client id
                if (cid) s_diag.ownerId = cid;
                s_diag.lastHbMs = now; // NEW (treat resume as liveness)
            }

            s_diag.expiresMs = now + LEASE_MS;

            // Entering diag: force Mega1 into MANUELL to avoid any automatic actions during diagnosis.
            // This is intentionally unconditional (no "restore previous mode").
            const bool okMode = Mega1Link::queueSetMode(0 /*MANUELL*/);
            // Entering diag: force Mega2 into DIAG_TEST to pause automation while diagnosing.
            const bool okM2 = Mega2Link::queueSetRunMode(1 /*DIAG_TEST*/);
            if (!okM2) {
                EE_LOGW("DIAG", "diagEnter: failed to queue Mega2 DIAG_TEST (offline/queue full?)");
            }
            if (!okMode) {
                EE_LOGW("DIAG", "diagEnter: failed to queue Mega1 MANUELL (offline/queue full?)");
            }


            reply["active"] = true;
            reply["ownerId"] = s_diag.ownerId;
            reply["isOwner"] = true;
            reply["token"] = s_diag.token;
            reply["expiresInMs"] = (int32_t)(s_diag.expiresMs - now);

            String out;
            warnJsonOverflowThrottled("onWsMessage/diagEnter", reply);
            serializeJson(reply, out);
            if (client) client->text(out);

            markStateDirtyAll();
            g_diagDirty  = true;
        }
        else
        {
            reply["active"] = true;
            reply["ownerId"] = s_diag.ownerId;
            reply["isOwner"] = false;
            reply["error"] = "busy";
            reply["expiresInMs"] = (int32_t)(s_diag.expiresMs - now);

            String out;
            warnJsonOverflowThrottled("onWsMessage/diagEnterBusy", reply);
            serializeJson(reply, out);
            if (client) client->text(out);
        }
        return;
    }
    if (!strcmp(action, "diagHeartbeat")) {
        // NOTE: Use a String here to avoid JsonVariant->const char* edge cases.
        // We have seen cases where the browser clearly sent a token, but cmd["token"] evaluated to NULL.
        String tokIn;
        if (!cmd["token"].isNull()) {
            tokIn = cmd["token"].as<String>();
        }
        const char* token = (tokIn.length() > 0) ? tokIn.c_str() : nullptr;

        EE_LOGI("DIAG", "HB tokenIn=%s (len=%u) stored=%s active=%d ownerId=%u",
            token ? token : "NULL",
            (unsigned)tokIn.length(),
            s_diag.token,
            s_diag.active ? 1 : 0,
            (unsigned)s_diag.ownerId);

        if (isDiagOwner(client, token)) {
            constexpr uint32_t LEASE_MS = 180000;
            const uint32_t now = (uint32_t)millis();
            s_diag.expiresMs = now + LEASE_MS;
            s_diag.lastHbMs  = now;
            if (client) s_diag.ownerId = client->id();   // rebind
            markStateDirtyAll();
            g_diagDirty  = true;
        } else {
            // Help debugging: distinguish "missing token" vs "mismatch/inactive"
            EE_LOGW("DIAG", "HB REJECTED (%s)",
                    (!s_diag.active ? "lease inactive" : (!token ? "missing token" : "token mismatch")));

            JsonDocument err;
            err["type"]   = "error";
            err["code"]   = "DIAG_HB_REJECT";
            err["active"] = s_diag.active;
            err["ownerId"] = s_diag.ownerId;
            err["tokenIn"] = token ? token : "";
            err["tokenExpected"] = s_diag.token;
            if (!s_diag.active) {
                err["msg"] = "diagHeartbeat rejected (lease inactive)";
            } else if (!token) {
                err["msg"] = "diagHeartbeat rejected (missing token)";
            } else {
                err["msg"] = "diagHeartbeat rejected (token mismatch)";
            }
            String out;
            warnJsonOverflowThrottled("onWsMessage/DIAG_HB_REJECT", err);
            serializeJson(err, out);
            if (client) client->text(out);
        }
       return;
    }

    if (!strcmp(action, "diagExit"))
    {
        // NOTE: Use a String here to avoid JsonVariant->const char* edge cases.
        String tokIn;
        if (!cmd["token"].isNull()) {
            tokIn = cmd["token"].as<String>();
        }
        const char* token = (tokIn.length() > 0) ? tokIn.c_str() : nullptr;
        if (isDiagOwner(client, token)) {
            EE_LOGI("DIAG", "lease released by owner -> revert to normal");
            diagRevertToNormal("exit");
        }
        return;
    }

    // -------------------------------------------------
    // Safety gate: while diag lease is active, only the owner may send "write" actions.
    // This prevents accidental conflicts (e.g. Torben drives while Bernhard diagnoses).
    // -------------------------------------------------
    auto isProtectedAction = [&](const char* a) -> bool {
        return (!strcmp(a,"powerOff")
             || !strcmp(a,"powerOn")
             || !strcmp(a,"m1PowerSet")
             || !strcmp(a,"m1SelftestStart")
             || !strcmp(a,"m1SetMode")
             || !strcmp(a,"setAuto")
             || !strcmp(a,"setManual")
             || !strcmp(a,"m1TurnoutSet")
             || !strcmp(a,"m1DiagRelaySet")
             || !strcmp(a,"m2DiagRelaySet")
             || !strcmp(a,"m2DiagRelayPulse")
             || !strcmp(a,"sbhfSelftestRetry")
             || !strcmp(a,"sbhfSelftestStartup"));
    };
    if (s_diag.active && isProtectedAction(action)) {

    // NOTE: Use a String here to avoid JsonVariant->const char* edge cases.
    // We have seen cases where the browser clearly sent a token, but cmd["token"] evaluated to NULL.
    String tokIn;
    if (!cmd["token"].isNull()) {
        tokIn = cmd["token"].as<String>();
    }
    const char* token = (tokIn.length() > 0) ? tokIn.c_str() : nullptr;

    EE_LOGI("DIAG", "WR-GATE action=%s cid=%u tokenIn=%s (len=%u) stored=%s active=%d ownerId=%u",
        action,
        (unsigned)(client ? client->id() : 0),
        token ? token : "NULL",
        (unsigned)tokIn.length(),
        s_diag.token,
        s_diag.active ? 1 : 0,
        (unsigned)s_diag.ownerId
    );

    if (!isDiagOwner(client, token)) {
        JsonDocument err;
        err["type"] = "error";
        err["code"] = "DIAG_ACTIVE";
        err["ownerId"] = s_diag.ownerId;
        err["msg"] = "diagnose active: write actions allowed only for diag owner";

        // Debug fields (same spirit as DIAG_HB_REJECT)
        err["action"] = action;
        err["clientId"] = (uint32_t)(client ? client->id() : 0);
        err["active"] = s_diag.active ? 1 : 0;
        err["tokenIn"] = token ? token : "";
        err["tokenInLen"] = (uint32_t)tokIn.length();
        err["tokenExpected"] = s_diag.token;
        err["tokenExpectedLen"] = (uint32_t)strlen(s_diag.token);

        String out;
        warnJsonOverflowThrottled("onWsMessage/DIAG_ACTIVE", err);
        serializeJson(err, out);
        if (client) client->text(out);
        return;
        }
    }

    // --- Marker: must show up whenever m1DiagRelaySet is received and passed the gate block ---
    if (!strcmp(action, "m1DiagRelaySet")) {
        EE_LOGW("DIAG", "AFTER WR-GATE: reached handler dispatch for m1DiagRelaySet");
    }


    // -------------------------------------------------
    // Simulation helpers (only enabled in sim builds)
    // -------------------------------------------------
    if (!strcmp(action, "setBypassSbhfSelftest"))
    {
#if defined(EE_SIM_NO_HW)
       // robust bool parse: true/false, 0/1, "true"/"false"
        bool en = false;
        JsonVariant vEn = cmd["enable"];
        if (vEn.is<bool>()) {
            en = vEn.as<bool>();
        } else if (vEn.is<int>()) {
            en = (vEn.as<int>() != 0);
        } else if (vEn.is<const char*>()) {
            const char* s = vEn.as<const char*>();
            if (s) en = (!strcasecmp(s, "true") || !strcasecmp(s, "on") || !strcmp(s, "1"));
        }

        SystemRuntimeState::setBypassSbhfSelftest(en);
        LOG_WS("[SIM] setBypassSbhfSelftest(enable=%s) -> now=%s",
                en ? "true" : "false",
                SystemRuntimeState::bypassSbhfSelftest() ? "true" : "false");
        markStateDirtyAll();
#else
        LOG_WS("[SIM] setBypassSbhfSelftest ignored (not a sim build)");
#endif
        return;
    }



    // -------------------------------------------------
    // Startup-Checklist: explicit "done" markers
    // (Checklist disappears ONLY through these actions)
    // -------------------------------------------------
    if (!strcmp(action, "markMega1ChecklistDone"))
    {
        SystemRuntimeState::markMega1ChecklistDone();
        markStateDirtyAll();
        return;
    }

    if (!strcmp(action, "markMega2ChecklistDone"))
    {
        SystemRuntimeState::markMega2ChecklistDone();
        markStateDirtyAll();
        return;
    }

    if (!strcmp(action, "safetyAck"))
    {
        Mega2Link::safetyAck();
        markStateDirtyAll();
        return;
    }

    if (!strcmp(action, "nothalt"))
    {
        Mega2Link::nothalt();
        markStateDirtyAll();
        return;
    }

    if (!strcmp(action, "powerOn"))
    {
        EE_LOGI("WS", "action powerOn received");
        Mega2Link::powerOn();
        markStateDirtyAll();
        return;
    }

    if (!strcmp(action, "powerOff"))
    {
        EE_LOGI("WS", "action powerOff received");
        Mega2Link::powerOff();
        markStateDirtyAll();
        return;
    }

    if (!strcmp(action, "powerToggle"))
    {
        //Legacy: toggle logical power state.
        const bool logicalPowerOn = ((SystemRuntimeState::mega2Status().flags & SYS_POWER_ON) != 0);
        if (logicalPowerOn) Mega2Link::powerOff();
        else                Mega2Link::powerOn();

        markStateDirtyAll();
        return;
    }

    // -------------------------------------------------
    // Mega2 DIAG Relay Commands (bit-indexed, active-low)
    // -------------------------------------------------
    if (!strcmp(action, "m2DiagRelaySet"))
    {
        String tokIn;
        if (!cmd["token"].isNull()) tokIn = cmd["token"].as<String>();
        const char* token = (tokIn.length() > 0) ? tokIn.c_str() : nullptr;
        const bool tokOk = (token != nullptr);
        const uint32_t ownerId = client ? (uint32_t)client->id() : 0;
        EE_DIAGW("WS rx m2RelaySet owner=%u tok=%s", (unsigned)ownerId, tokOk?"ok":"null");
        if (!isDiagOwner(client, token)) {
            EE_DIAGW("WS rx m2RelaySet denied owner=%u tok=%s", (unsigned)ownerId, tokOk?"ok":"null");
            return;
        }

        const int bit_i = cmd["bit"] | -1;
        if (bit_i < 0 || bit_i > 31) return;
        const uint8_t bit = (uint8_t)bit_i;

        bool on = false;
        JsonVariant vVal = cmd["on"];
        if (vVal.is<bool>()) on = vVal.as<bool>();
        else if (vVal.is<int>()) on = (vVal.as<int>() != 0);
        else if (vVal.is<const char*>()) {
            const char* s = vVal.as<const char*>();
            if (s) on = (!strcasecmp(s, "true") || !strcasecmp(s, "on") || !strcmp(s, "1"));
        }

        EE_DIAGW("WS enq m2RelaySet bit=%u on=%u", (unsigned)bit, (unsigned)(on?1:0));
        const bool ok = Mega2Link::queueDiagRelaySet(bit, on);
        EE_DIAGW("WS enq m2RelaySet bit=%u -> %s", (unsigned)bit, ok?"OK":"DROP");
        if (!ok) LOG_WS("m2DiagRelaySet rejected (queue?)");

        if (client) {
            JsonDocument okj;
            okj["type"]   = "ok";
            okj["action"] = "m2DiagRelaySet";
            okj["bit"]    = bit;
            okj["on"]     = on ? 1 : 0;
            okj["queued"] = ok ? 1 : 0;
            String out;
            serializeJson(okj, out);
            client->text(out);
        }
        markStateDirtyAll();
        g_diagDirty  = true;
        return;
    }

    if (!strcmp(action, "m2DiagRelayPulse"))
    {
        String tokIn;
        if (!cmd["token"].isNull()) tokIn = cmd["token"].as<String>();
        const char* token = (tokIn.length() > 0) ? tokIn.c_str() : nullptr;
        const bool tokOk = (token != nullptr);
        const uint32_t ownerId = client ? (uint32_t)client->id() : 0;
        EE_DIAGW("WS rx m2RelayPulse owner=%u tok=%s", (unsigned)ownerId, tokOk?"ok":"null");
        if (!isDiagOwner(client, token)) {
            EE_DIAGW("WS rx m2RelayPulse denied owner=%u tok=%s", (unsigned)ownerId, tokOk?"ok":"null");
            return;
        }

        const int bit_i = cmd["bit"] | -1;
        if (bit_i < 0 || bit_i > 7) return;
        const uint8_t bit = (uint8_t)bit_i;

        const int ms_i = cmd["ms"] | 500;
        uint16_t ms = (uint16_t)ms_i;
        if (ms < 50) ms = 50;
        if (ms > 2000) ms = 2000;

        EE_DIAGW("WS enq m2RelayPulse bit=%u ms=%u", (unsigned)bit, (unsigned)ms);
        const bool ok = Mega2Link::queueDiagRelayPulse(bit, ms);
        EE_DIAGW("WS enq m2RelayPulse bit=%u -> %s", (unsigned)bit, ok?"OK":"DROP");
        if (!ok) LOG_WS("m2DiagRelayPulse rejected (queue?)");

        if (client) {
            JsonDocument okj;
            okj["type"]   = "ok";
            okj["action"] = "m2DiagRelayPulse";
            okj["bit"]    = bit;
            okj["ms"]     = ms;
            okj["queued"] = ok ? 1 : 0;
            String out;
            serializeJson(okj, out);
            client->text(out);
        }
        markStateDirtyAll();
        g_diagDirty  = true;
        return;
    }

    // -------------------------------------------------
    // Mega1 Commands
    // -------------------------------------------------
    EE_LOGW("DIAG", "M1CMD dispatch action='%s' cid=%u", action, (unsigned)(client ? client->id() : 0));

    if (!strcmp(action, "m1DiagRelaySet"))
    {
        EE_LOGW("DIAG", "ENTER m1DiagRelaySet");

        // Serial-sure visibility of parsed args
        const String relayS = cmd["relay"].as<String>();   // <-- robust copy (fixes relay=NULL)
        const int idx_i = cmd["idx"] | -1;
        EE_LOGW("DIAG", "m1DiagRelaySet args: relay='%s' idx=%d valType=%s",
            relayS.c_str(),
            idx_i,
            cmd["val"].isNull() ? "NULL" : (cmd["val"].is<bool>() ? "bool" : (cmd["val"].is<int>() ? "int" : (cmd["val"].is<const char*>() ? "str" : "other")))
        );

        const int idx_i2 = cmd["idx"] | -1;
        if (relayS.length() == 0 || idx_i2 < 0) {
            EE_LOGW("DIAG", "m1DiagRelaySet reject: missing relay/idx (relay='%s' idx=%d)",
                relayS.c_str(), idx_i2);
            return;
        }
        const uint8_t idx = (uint8_t)idx_i2;

        // robust bool parse for "val"
        bool val = false;
        JsonVariant vVal = cmd["val"];
        if (vVal.is<bool>()) {
            val = vVal.as<bool>();
        } else if (vVal.is<int>()) {
            val = (vVal.as<int>() != 0);
        } else if (vVal.is<const char*>()) {
            const char* s = vVal.as<const char*>();
            if (s) val = (!strcasecmp(s,"true") || !strcasecmp(s,"on") || !strcmp(s,"1"));
        }

        bool ok = false;

        // ---- power (BHF) ----
        if (relayS == "power")
        {
            if (idx > 3) {
                EE_LOGW("DIAG", "m1DiagRelaySet reject: power idx=%u out of range", (unsigned)idx);
                return;
            }
            EE_LOGW("DIAG", "m1DiagRelaySet(power): idx=%u val=%d -> queueBhfPowerSet()",
                (unsigned)idx, val ? 1 : 0);
            ok = Mega1Link::queueBhfPowerSet(idx, val);
            EE_LOGW("DIAG", "m1DiagRelaySet(power): queue result ok=%d", ok ? 1 : 0);
            if (!ok) EE_LOGW("DIAG", "m1DiagRelaySet(power) rejected (queue full?)");

            // ACK back to browser so we can see handler execution immediately
            if (client) {
                JsonDocument okj;
                okj["type"]   = "ok";
                okj["action"] = "m1DiagRelaySet";
                okj["relay"]  = relayS;
                okj["idx"]    = idx;
                okj["val"]    = val;
                okj["queued"] = ok ? 1 : 0;
                String out;
                serializeJson(okj, out);
                client->text(out);
            }
            markStateDirtyAll();
            g_diagDirty  = true;
            return;
        }

        // ---- weiche coils: treat as PULSE command ----
        // UI currently sends ON then after 0.5s OFF.
        // We MUST NOT enqueue an "OFF" that could trigger a second coil action.
        // Therefore: only act on val==true; ignore val==false.
        if (relayS == "weicheG" || relayS == "weicheA")
        {
            if (idx > 11) {
                EE_LOGW("DIAG", "m1DiagRelaySet reject: weiche idx=%u out of range", (unsigned)idx);
                return;
            }
            if (!val) {
                // ignore auto-OFF from UI (coil safety is handled inside Mega1)
                return;
            }
            const bool gerade = (relayS == "weicheG");
            EE_LOGW("DIAG", "m1DiagRelaySet(%s): idx=%u val=%d -> queueTurnoutSet()",
                relayS.c_str(), (unsigned)idx, val ? 1 : 0);
            ok = Mega1Link::queueTurnoutSet(idx, gerade);
            EE_LOGW("DIAG", "m1DiagRelaySet(%s): queue result ok=%d", relayS.c_str(), ok ? 1 : 0);
            if (!ok) EE_LOGW("DIAG", "m1DiagRelaySet(weiche) rejected (queue full?)");

            if (client) {
                JsonDocument okj;
                okj["type"]   = "ok";
                okj["action"] = "m1DiagRelaySet";
                okj["relay"]  = relayS;
                okj["idx"]    = idx;
                okj["val"]    = val;
                okj["queued"] = ok ? 1 : 0;
                String out;
                serializeJson(okj, out);
                client->text(out);
            
            }
            markStateDirtyAll();
            g_diagDirty  = true;
            return;
        }

        // ---- reduction relays: not implemented yet (next step) ----
        if (relayS == "weicheRED")
        {
            JsonDocument err;
            err["type"] = "error";
            err["code"] = "M1_RED_UNSUPPORTED";
            err["msg"]  = "weicheRED switching not implemented yet (read-only only)";
            String out;
            warnJsonOverflowThrottled("m1DiagRelaySet/weicheRED", err);
            serializeJson(err, out);
            if (client) client->text(out);
            return;
        }

        EE_LOGW("DIAG", "m1DiagRelaySet reject: unknown relay='%s'", relayS.c_str());
        return;
    }
if (!strcmp(action, "m1SetMode") || !strcmp(action, "setAuto") || !strcmp(action, "setManual"))
    
    {
        uint8_t mode = 0;

        if (!strcmp(action, "setAuto")) {
            mode = 1u;
        } else if (!strcmp(action, "setManual")) {
            mode = 0u;
        } else {
            const int modeIn = cmd["mode"] | -1;
            if (modeIn != 0 && modeIn != 1) {
                LOG_WS("m1SetMode rejected (invalid mode)");
                return;
            }
            mode = (uint8_t)modeIn;
        }

        const bool ok = Mega1Link::queueSetMode(mode);
        if (!ok) {
            LOG_WS("mode action rejected (queue full)");
        }
        markStateDirtyAll();
        return;
    }

    if (!strcmp(action, "m1TurnoutSet"))
    {
        const uint8_t idxW = (uint8_t)(cmd["idx"] | 0);
       
        // robust bool parse: true/false, 0/1, "true"/"false"
        bool gerade = false;
        JsonVariant vGerade = cmd["gerade"];
        if (vGerade.is<bool>()) {
            gerade = vGerade.as<bool>();
        } else if (vGerade.is<int>()) {
            gerade = (vGerade.as<int>() != 0);
        } else if (vGerade.is<const char*>()) {
            const char* s = vGerade.as<const char*>();
            if (s) gerade = (!strcasecmp(s, "true") || !strcasecmp(s, "on") || !strcmp(s, "1"));
        }

        LOG_WS("m1TurnoutSet idx=%u gerade=%s", idxW, gerade ? "true" : "false");

        const bool ok = Mega1Link::queueTurnoutSet(idxW, gerade);
        if (!ok) LOG_WS("m1TurnoutSet rejected (args/queue full)");
        markStateDirtyAll();
        return;
    }

    if (!strcmp(action, "m1PowerSet"))
    {
        const int bhf_i = cmd["bhf"] | -1;
        if (bhf_i < 0 || bhf_i > 3) {
            LOG_WS("m1PowerSet reject: bhf=%d out of range", bhf_i);
            return;
        }
        const uint8_t bhf = (uint8_t)bhf_i;

        // robust bool parse: true/false, 0/1, "true"/"false"
        bool on = false;
        JsonVariant vOn = cmd["on"];
        if (vOn.is<bool>()) {
            on = vOn.as<bool>();
        } else if (vOn.is<int>()) {
            on = (vOn.as<int>() != 0);
        } else if (vOn.is<const char*>()) {
            const char* s = vOn.as<const char*>();
            if (s) on = (!strcasecmp(s, "true") || !strcasecmp(s, "on") || !strcmp(s, "1"));
        }

        LOG_WS("m1PowerSet bhf=%u on=%s", bhf, on ? "true" : "false");

        const bool ok = Mega1Link::queueBhfPowerSet(bhf, on);
        if (!ok) LOG_WS("m1PowerSet rejected (args/queue full)");
        markStateDirtyAll();
        return;
    }

    if (!strcmp(action, "m1SelftestStart"))
    {
        const bool ok = Mega1Link::queueStartSelftest();
        if (!ok) LOG_WS("m1SelftestStart rejected (queue full)");
        markStateDirtyAll();
        return;
    }

    if (!strcmp(action, "pollNow"))
    {
        LOG_WS("-> Mega2Link::requestPollNow()");
        Mega2Link::requestPollNow();
        markStateDirtyAll();
        return;
    }

    // SBHF selftest retry (explicit command, NOT mapped to safetyAck)
    if (!strcmp(action, "sbhfSelftestRetry"))
    {
        LOG_WS("-> SBHF Selftest Retry");
        Mega2Link::sbhfSelftestRetry();
        markStateDirtyAll();
        return;
    }
    
    if (!strcmp(action, "sbhfSelftestStartup"))
    {
        LOG_WS("-> SBHF Selftest Startup");
        Mega2Link::sbhfSelftestStartup();
        markStateDirtyAll();
        return;
    }

    if (!strcmp(action, "markMega1ChecklistDone")) {
        LOG_WS("-> markMega1ChecklistDone");
        SystemRuntimeState::markMega1ChecklistDone();
        markStateDirtyAll();
        return;
    }

    if (!strcmp(action, "markMega2ChecklistDone")) {
        LOG_WS("-> markMega2ChecklistDone");
        SystemRuntimeState::markMega2ChecklistDone();
        markStateDirtyAll();
        return;
    }
}

// ---------------------------------------------------------
// Web::begin
// ---------------------------------------------------------
void Web::begin()
{
    if (!LittleFS.begin(true))
    {
        EE_LOGE("WEB", "LittleFS mount FAILED!");
        return;
    }

    ws.onEvent(onWsEvent);
    server.addHandler(&ws);

    server.serveStatic("/", LittleFS, "/")
        .setDefaultFile("index.htm")
        .setCacheControl("no-store, no-cache, must-revalidate, max-age=0");
    
    
    // -------------------------------------------------
    // HTTP fallback for releasing diag lease (works even if WS is already gone).
    // Used by diag.htm via fetch(..., {keepalive:true}) on pagehide/beforeunload.
    // Token is passed as query parameter: /diag-exit?token=...
    // -------------------------------------------------
    server.on("/diag-exit", HTTP_POST, [](AsyncWebServerRequest* req) {
        String tok;
        const char* token = nullptr;

        if (req->hasParam("token")) {
            tok = req->getParam("token")->value();
            token = tok.c_str();
        }

        EE_LOGI("DIAG", "HTTP /diag-exit tokenIn=%s (len=%d) stored=%s active=%d ownerId=%u",
            token ? token : "NULL",
            token ? (int)strlen(token) : 0,
            s_diag.token,
            s_diag.active ? 1 : 0,
            (unsigned)s_diag.ownerId);

        if (isDiagOwner(nullptr, token)) {
            EE_LOGI("DIAG", "lease released via HTTP -> revert to normal");
            diagRevertToNormal("http");
            req->send(200, "application/json", "{\"ok\":true}");
        } else {
            EE_LOGW("DIAG", "HTTP /diag-exit rejected (token mismatch or inactive)");
            req->send(403, "application/json", "{\"ok\":false}");
        }
    });

    server.begin();

#if EE_DEBUG_HEAP
    dbgHeap("web.begin");
#endif

    EE_LOGI("WEB", "HTTP server started");
}

// ---------------------------------------------------------
// Web::loop
// ---------------------------------------------------------
void Web::loop()
{
#if EE_DEBUG_HEAP
    static uint32_t s_lastHeapMs = 0;
    const uint32_t nowMs = (uint32_t)millis();
    if ((uint32_t)(nowMs - s_lastHeapMs) >= 10000u)
    {
        s_lastHeapMs = nowMs;
        dbgHeap("loop");
    }
#endif
    ws.cleanupClients();
    diagLeaseTick();
    // Digital state: on-change (throttled) + periodic ground-truth full push.
    Web::pushStateIfDirty();

    // Analog stream: small periodic payload (every 500ms).
    Web::pushAnalogTick();
    
    // Diag stream: only if diag clients subscribed (on-change throttled + periodic full)
    Web::pushDiagIfNeeded();
}

// ---------------------------------------------------------
// Web::pushStateIfDirty (laut webserver.h)
// Policy (DoD):
//  - delta push: nur wenn g_stateDirty == true UND der Delta-Payload sich wirklich geändert hat
//  - full push: alle 8s (ground truth), unabhängig von dirty
//  - kein Push im Idle dazwischen
// ---------------------------------------------------------
void Web::pushStateIfDirty()
{
    static uint32_t s_lastSendMs = 0;
    static uint32_t s_nextFullMs = 0;
    static uint32_t s_dirtySinceMs = 0;

    // Dedupe für Delta: wenn dirty permanent gesetzt wird, aber Payload gleich bleibt -> nicht senden.
    static uint32_t s_lastDeltaHash = 0;
    static bool     s_hasDeltaHash  = false;

    const uint32_t now = (uint32_t)millis();

    // No clients => nothing to send (also avoids allocating JSON Strings).
    if (countSubBase() == 0)
    {
        // Wenn nur Diag-Clients da sind, trotzdem Diag anstoßen.
        if (countSubDiag() > 0 && g_stateDirty) {
            g_diagDirty = true;
        }

        // Wichtig: Dirty löschen, sonst Burst direkt nach Connect.
        g_stateDirty = false;
        return;
    }

    constexpr uint32_t WS_MIN_SEND_MS = 30;   // throttle delta bursts
    constexpr uint32_t WS_FULL_MS     = 8000;  // DoD: ground-truth full push alle 8s

    const bool wantFull  = (s_nextFullMs == 0) || ((int32_t)(now - s_nextFullMs) >= 0);
    const bool wantDirty = g_stateDirty;
    if (wantDirty && s_dirtySinceMs == 0) s_dirtySinceMs = now;
    if (!wantDirty) s_dirtySinceMs = 0;

    // Wenn State dirty ist, soll auch Diag "instant" werden (Diag-Seite rendert Sensor-Tabellen aus diag).
    if (wantDirty) {
        g_diagDirty = true;
    }

    // Idle: weder full noch dirty -> nichts tun.
    if (!wantFull && !wantDirty)
        return;

    // ---------------------------------------------------------
    // NEU: Full schlägt Delta (verhindert Delta kurz vor fälligem Full)
    // Wenn Full in Kürze sowieso kommt, sparen wir das Delta komplett.
    // Dirty bleibt stehen und wird vom Full "abgeräumt".
    // ---------------------------------------------------------
    if (!wantFull && wantDirty && s_nextFullMs != 0)
    {
        const int32_t msToFull = (int32_t)(s_nextFullMs - now);
        if (msToFull >= 0 && msToFull <= 12)
        {
#if EE_DEBUG_WS
        if (!s_loggedSkipBeforeFull) {
            LOG_WS("skip state delta (full due in %ldms)", (long)msToFull);
            s_loggedSkipBeforeFull = true;
        }
#endif
        return;
        }
    }

    // Throttle: nur Delta-Frames drosseln, Full darf nie "weg-gedrosselt" werden.
    if (!wantFull && (uint32_t)(now - s_lastSendMs) < WS_MIN_SEND_MS)
        return;

    // FULL: immer senden (ground truth)
    if (wantFull)
    {
#if EE_DEBUG_WS
        LOG_WS("push state full=1 dirty=%d clients=%u",
                      wantDirty ? 1 : 0, (unsigned)ws.count());
#endif
        const String payload = buildWsStateJson(true);
        wsTextToBase(payload);

        s_lastSendMs = now;
        s_nextFullMs = now + WS_FULL_MS;

        // Full deckt alles ab -> dirty gilt als abgearbeitet.
        g_stateDirty = false;

        // Optional: Delta-dedupe Reset (wir wollen nach Full nicht "alte" Delta-Hashes blocken)
        // s_hasDeltaHash = false;

        // NEU: Skip-Log wieder freigeben für den nächsten Full-Zyklus
        s_loggedSkipBeforeFull = false;

        return;
    }

    // DELTA: nur senden, wenn Payload wirklich anders ist als zuletzt gesendetes Delta
    // (damit g_stateDirty-Spam aus anderen Modulen nicht zu WS-Flood führt)
    const String delta = buildWsStateJson(false);

    // FNV-1a 32-bit hash (schnell, ausreichend als Dedupe)
    uint32_t h = 2166136261u;
    for (size_t i = 0; i < delta.length(); ++i) {
        h ^= (uint8_t)delta[i];
        h *= 16777619u;
    }

    if (s_hasDeltaHash && h == s_lastDeltaHash)
    {
#if EE_DEBUG_WS
        LOG_WS("skip state delta (no semantic change) len=%u", (unsigned)delta.length());
#endif
        // Wichtig: dirty löschen, sonst versucht es sofort wieder.
        g_stateDirty = false;
        return;
    }

#if EE_DEBUG_WS
    LOG_WS("push state full=0 dirty=1 clients=%u hash=%08lx len=%u",
              (unsigned)ws.count(), (unsigned long)h, (unsigned)delta.length());
#endif
    LOG_WSLAT("delta latency=%ums len=%u",
              (unsigned)(now - s_dirtySinceMs),
              (unsigned)delta.length());
    wsTextToBase(delta);

    s_lastSendMs   = now;
    s_lastDeltaHash = h;
    s_hasDeltaHash  = true;

    // Delta abgearbeitet
    g_stateDirty = false;
}


// ---------------------------------------------------------
// Web::pushAnalogTick
// ---------------------------------------------------------
void Web::pushAnalogTick()
{
    // Small periodic analog payload (independent from g_stateDirty).
    // Keep this lightweight to avoid heap pressure.
    static uint32_t s_lastAnalogMs = 0;
    const uint32_t now = (uint32_t)millis();

    // No clients => nothing to send (also avoids allocating JSON Strings).
    if (countSubBase() == 0)
        return;

    constexpr uint32_t WS_ANALOG_MS = 500;
    if ((uint32_t)(now - s_lastAnalogMs) < WS_ANALOG_MS)
        return;
    s_lastAnalogMs = now;

    wsTextToBase(buildWsAnalogJson());
}

// ---------------------------------------------------------
// Web::pushDiagIfNeeded
// Policy (DoD):
//  - delta push: nur wenn g_diagDirty == true UND Payload wirklich geändert
//  - full push: alle 4s
//  - nur wenn mind. ein Client diag subscribed hat
// ---------------------------------------------------------
void Web::pushDiagIfNeeded()
{
    if (countSubDiag() == 0)
        return;

    static uint32_t s_lastSendMs = 0;
    static uint32_t s_nextFullMs = 0;

    // Dedupe für Delta
    static uint32_t s_lastDeltaHash = 0;
    static bool     s_hasDeltaHash  = false;

    const uint32_t now = (uint32_t)millis();

    constexpr uint32_t DIAG_MIN_MS  = 80;   // delta throttle
    constexpr uint32_t DIAG_FULL_MS = 4000;  // DoD: full alle 4s

    const bool wantFull  = (s_nextFullMs == 0) || ((int32_t)(now - s_nextFullMs) >= 0);
    const bool wantDirty = g_diagDirty;

    if (!wantFull && !wantDirty)
        return;

    if (!wantFull && (uint32_t)(now - s_lastSendMs) < DIAG_MIN_MS)
        return;

    // FULL: immer senden
    if (wantFull)
    {
        const String payload = buildWsDiagJson(true);
        wsTextToDiag(payload);

        s_lastSendMs = now;
        s_nextFullMs = now + DIAG_FULL_MS;

        g_diagDirty = false;
        s_hasDeltaHash = false;
        return;
    }

    // DELTA: nur senden, wenn wirklich geändert
    const String delta = buildWsDiagJson(false);

    uint32_t h = 2166136261u;
    for (size_t i = 0; i < delta.length(); ++i) {
        h ^= (uint8_t)delta[i];
        h *= 16777619u;
    }

    if (s_hasDeltaHash && h == s_lastDeltaHash)
    {
        g_diagDirty = false;
        return;
    }

    wsTextToDiag(delta);

    s_lastSendMs    = now;
    s_lastDeltaHash = h;
    s_hasDeltaHash  = true;

    g_diagDirty = false;
}