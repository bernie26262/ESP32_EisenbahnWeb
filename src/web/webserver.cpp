#include "webserver.h"

#include <ArduinoJson.h>
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

// ---------------------------------------------------------
// Heap debug (helps diagnose [AWS] _ack malloc failed)
// Enable by defining DEBUG_AWS_HEAP in platformio.ini build_flags.
// ---------------------------------------------------------
static void dbgHeap(const char* tag)
{
#if defined(ESP32)
    const uint32_t free8    = heap_caps_get_free_size(MALLOC_CAP_8BIT);
    const uint32_t largest8 = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
    Serial.printf("[HEAP] %s free8=%lu largest8=%lu\n", tag, (unsigned long)free8, (unsigned long)largest8);
#else
    (void)tag;
#endif
}

// ---------------------------------------------------------
// Globale Objekte
// ---------------------------------------------------------
static AsyncWebServer server(80);
static AsyncWebSocket ws("/ws");

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

struct DiagLease {
    bool active = false;
    uint32_t ownerId = 0;
    uint32_t sinceMs = 0;
    uint32_t expiresMs = 0;   // millis deadline
    char token[33] = {0};     // 32 hex + NUL
};
static DiagLease s_diag;

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
    if (!client) return false;
    if (!s_diag.active) return false;
    if (client->id() != s_diag.ownerId) return false;
    if (!token) return false;
    return (strncmp(token, s_diag.token, 32) == 0);
}

static void diagRevertToNormal(const char* reason) {
    // Option A: revert to normal operation. (Currently: release lease only; future: clear manual overrides.)
    (void)reason;
    s_diag = DiagLease{};
    // Trigger a fresh state push so all UIs see diagActive=false immediately.
    g_stateDirty = true;
}

static void diagLeaseTick() {
    if (!s_diag.active) return;
    const uint32_t now = (uint32_t)millis();
    if ((int32_t)(now - s_diag.expiresMs) >= 0) {
        Serial.println("[DIAG] lease timeout -> revert to normal");
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


// IMPORTANT: Dieses Symbol wird (derzeit) auch aus anderen Modulen referenziert.
volatile bool g_stateDirty = true;

// ---------------------------------------------------------
// WebSocket State JSON
// ---------------------------------------------------------
static String buildWsStateJson(bool includeAnalog)
{
    // NOTE: This payload grew over time (mega1 diag, startup, entry matrices, sim flags, ...).
    // Keep this generously sized to avoid ArduinoJson overflow (which would silently drop fields
    // and look like "random" UI state glitches).
    StaticJsonDocument<3072> doc;

    doc["type"] = "state";
    doc["full"] = includeAnalog;
    doc["ts"]   = (uint32_t)millis();

    doc["eth"]["connected"] = Net::EthManager::isConnected();
    doc["eth"]["ip"]        = Net::EthManager::localIP().toString();

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

    // ready: only when required checklists have their selftest-step done
    const bool m1Ok = (!m1Needs) || SystemRuntimeState::mega1SelftestDone();
    const bool m2Ok = (!m2Needs) || SystemRuntimeState::mega2SelftestDone();
    startup["ready"] = (m1Ok && m2Ok);

    // Optional Debug: BootId/Uptime sichtbar machen (sehr hilfreich fürs Verifizieren)
    const auto& m1dbg = SystemRuntimeState::mega1Status();
    const auto& m2dbg = SystemRuntimeState::mega2Status();
    startup["m1BootId"]   = (unsigned)m1dbg.bootId;
    startup["m2BootId"]   = (unsigned)m2dbg.bootId;
    startup["m1UptimeMs"] = (uint32_t)m1dbg.uptimeMs;
    startup["m2UptimeMs"] = (uint32_t)m2dbg.uptimeMs;

    const auto& m1s = SystemRuntimeState::mega1Status();
    JsonObject m1st = doc["mega1"]["status"].to<JsonObject>();
    m1st["ver"]   = m1s.version;
    m1st["size"]  = m1s.size;
    m1st["node"]  = m1s.nodeId;
    m1st["flags"] = m1s.flags;
    m1st["reserved"] = m1s.reserved;

    // Mega1 warning mask (normativ): low byte of SystemStatus.reserved
    doc["mega1"]["warningMask"] = (uint8_t)(m1s.reserved & 0xFFu);

    // Optional: rxAge als Debug (wenn du s_lastRxMsM1 nicht exposen willst, dann erstmal weglassen)
    // m1st["rxAgeMs"] = SystemRuntimeState::mega1RxAgeMs();

    // -----------------------------
    // Safety (ESP abgeleitet)
    // -----------------------------
    JsonObject s = doc["safety"].to<JsonObject>();

    const auto& m2 = SystemRuntimeState::mega2Status();

    s["lock"]        = SystemRuntimeState::safetyLock();
    s["blockReason"] = SystemRuntimeState::safetyBlockReason();

    // Fehlerdetails (für UI-Textmapping)
    s["errorType"]  = SystemRuntimeState::errorType;
    s["errorIndex"] = SystemRuntimeState::errorIndex;

    // Power-Status (aus Flags)
    s["powerOn"] = (m2.flags & SYS_POWER_ON) != 0;

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
        const auto& m2s = SystemRuntimeState::mega2Status();

        doc["mega2"]["flags"]             = m2s.flags;
        doc["mega2"]["blockOccupiedMask"] = m2s.blockOccupiedMask;


        // DRDY-fast: expose detailed blocks[] + a fast occupancy mask WITHOUT overriding legacy mask.
        {
            const BlockStatus* bs = SystemRuntimeState::mega2BlockStatus();
            // IMPORTANT: Use SystemStatus.blockOccupiedMask as single source of truth for occupancy.
            // BlockStatus[].besetzt may be derived/temporary and can mismatch the final occupiedMask.
            const uint16_t occFast = m2s.blockOccupiedMask;
            // Debug
            doc["mega2"]["blockOccupiedMaskFast"] = occFast;

            JsonObject b = doc["mega2"]["blocks"].to<JsonObject>();
            b["occupiedMask"] = occFast;

            JsonArray bst = b["status"].to<JsonArray>();
            for (uint8_t i = 0; i < M2_NUM_BLOCKS; i++)
            {
                JsonObject o = bst.createNestedObject();
                o["kontakt"]     = (uint8_t)bs[i].kontakt;
                o["stromEin"]    = (uint8_t)bs[i].stromEin;
                o["besetzt"]     = (uint8_t)((occFast & (uint16_t)(1u << i)) != 0);
                o["kurzschluss"] = (uint8_t)bs[i].kurzschluss;
                o["nothalt"]     = (uint8_t)bs[i].nothalt;
                o["stromRaw"]    = bs[i].stromRaw;
            }
        }     

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
        JsonArray entry = doc["mega2"]["entryAllowed"].to<JsonArray>();
        const uint16_t* ea = SystemRuntimeState::mega2EntryAllowed();
        for (uint8_t i = 0; i < 9; i++)
            entry.add(ea[i]);

        JsonArray entryPrev = doc["mega2"]["entryPreview"].to<JsonArray>();
        const uint16_t* ep = SystemRuntimeState::mega2EntryPreview();
        for (uint8_t i = 0; i < 9; i++)
            entryPrev.add(ep[i]);
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

        doc["mega1"]["hasDiag"] = true;
    }


    // Avoid heap fragmentation by reserving a reasonable buffer.
    // (WS payload can grow; adjust if overflow log appears.)
    String out;
    out.reserve(4096);
    
    // WS client counts + diag control status (used for safety banner + gating UX)
    {
        JsonObject wsC = doc.createNestedObject("wsClients");
        wsC["base"] = countSubBase();
        wsC["diag"] = countSubDiag();
    }
    {
        JsonObject d = doc.createNestedObject("diagCtrl");
        d["active"] = s_diag.active;
        d["ownerId"] = s_diag.active ? s_diag.ownerId : 0;
        d["sinceMs"] = s_diag.active ? s_diag.sinceMs : 0;
        const uint32_t nowMs = (uint32_t)millis();
        d["expiresInMs"] = s_diag.active
            ? (uint32_t)((s_diag.expiresMs > nowMs) ? (s_diag.expiresMs - nowMs) : 0)
            : 0;
    }

    if (doc.overflowed())
    {
        // If you ever see this, increase the document size above.
        Serial.println("[WS] buildWsStateJson: JSON document overflow (fields may be missing!)");
    }
    serializeJson(doc, out);

    

#if defined(DEBUG_WS_SIZE)
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
            Serial.printf("[WS] state json len=%lu overflow=%d\n",
                          (unsigned long)len, overflow ? 1 : 0);
        }
    }
#endif

    return out;
}

// ---------------------------------------------------------
// WS Analog JSON (small, periodic)
// ---------------------------------------------------------
static String buildWsAnalogJson()
{
    // Only a small payload -> keep this tight to reduce heap pressure.
    StaticJsonDocument<512> doc;

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
    serializeJson(doc, out);

#if defined(DEBUG_WS_SIZE)
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
            Serial.printf("[WS] analog json len=%lu overflow=%d\n",
                          (unsigned long)len, overflow ? 1 : 0);
        }
    }
#endif

    return out;
}

// ---------------------------------------------------------
// WS Diag JSON (read-only, only for diag subscribers)
// ---------------------------------------------------------
static String buildWsDiagJson()
{
    // Read-only diagnostics snapshot. Keep modest in size; we can extend later.
    StaticJsonDocument<2048> doc;

    doc["type"] = "diag";
    doc["ts"]   = (uint32_t)millis();

    // WS client counts + diag control status (same shape as in state)
    {
        JsonObject wsC = doc.createNestedObject("wsClients");
        wsC["base"] = countSubBase();
        wsC["diag"] = countSubDiag();
    }
    {
        JsonObject d = doc.createNestedObject("diagCtrl");
        d["active"] = s_diag.active;
        d["ownerId"] = s_diag.active ? s_diag.ownerId : 0;
        d["sinceMs"] = s_diag.active ? s_diag.sinceMs : 0;
        const uint32_t nowMs = (uint32_t)millis();
        d["expiresInMs"] = s_diag.active
            ? (uint32_t)((s_diag.expiresMs > nowMs) ? (s_diag.expiresMs - nowMs) : 0)
            : 0;
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
            doc["mega1"]["hasDiag"] = true;
       
            // Mega1 digitale Sensoren (S0..S10,S18,S19,S22,S23) – optional (requires Mega1 FW + ESP link support)
            if (SystemRuntimeState::mega1SensorsValid())
            {
                uint8_t sid[15], lvl[15], rise[15], fall[15];
                SystemRuntimeState::mega1GetSensors15(sid, lvl, rise, fall);

                JsonArray arr = doc["mega1"]["sensors"].to<JsonArray>();
                for (uint8_t i = 0; i < 15; ++i)
                {
                    JsonObject o = arr.createNestedObject();
                    o["sid"]   = sid[i];     // real S-number (with gaps)
                    o["level"] = lvl[i];     // electrical level (HIGH=1)
                    o["rise"]  = rise[i];    // rising count (uint8, wrap ok)
                    o["fall"]  = fall[i];    // falling count (uint8, wrap ok)
                }
                doc["mega1"]["sensorsSeq"]   = SystemRuntimeState::mega1SensorsSeq();
                doc["mega1"]["sensorsTsMs"]  = SystemRuntimeState::mega1SensorsLastUpdateMs();
                doc["mega1"]["sensorsAgeMs"] = (uint32_t)((uint32_t)millis() - SystemRuntimeState::mega1SensorsLastUpdateMs());
            }
    
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
        doc["mega2"]["analog"]["ageMs"] = SystemRuntimeState::mega2AnalogAgeMs();
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
                JsonObject o = arr.createNestedObject();
                o["sid"]   = sid[i];      // 11..16
                o["level"] = lvl[i];      // electrical level (HIGH=1)
                o["rise"]  = rise[i];     // rising count (uint16 wrap ok)
                o["fall"]  = fall[i];     // falling count (uint16 wrap ok)
            }
            doc["mega2"]["schaltSeq"]   = SystemRuntimeState::mega2SchaltgleiseSeq();
            doc["mega2"]["schaltTsMs"]  = SystemRuntimeState::mega2SchaltgleiseLastUpdateMs();
            doc["mega2"]["schaltAgeMs"] = (uint32_t)((uint32_t)millis() - SystemRuntimeState::mega2SchaltgleiseLastUpdateMs());
        }
    }

    String out;
    out.reserve(2048);
    serializeJson(doc, out);
    return out;
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
    Serial.printf("[WS] client connected id=%u\n", (unsigned)cid);
#if defined(DEBUG_AWS_HEAP)
    dbgHeap("ws connect");
#endif
    if (client) {
        auto *ci = upsertWsClient(cid);
        ci->lastSeenMs = (uint32_t)millis();
        // Default: base subscribed, diag not subscribed.
        ci->subBase = true;
        ci->subDiag = false;
        // Initial state/analog snapshot to the new client only (base).
        client->text(buildWsStateJson(true));
        client->text(buildWsAnalogJson());
    }
    return;
}

if (type == WS_EVT_DISCONNECT)
{
    const uint32_t cid = client ? client->id() : 0;
    Serial.printf("[WS] client disconnected id=%u\n", (unsigned)cid);
    eraseWsClient(cid);
    if (s_diag.active && cid && (cid == s_diag.ownerId)) {
        Serial.println("[DIAG] owner disconnected -> revert to normal");
        diagRevertToNormal("disconnect");
    }
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

    Serial.printf("[WS] action rx: %s\n", action);

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
            ci->subBase = subBase;
            ci->subDiag = subDiag;
            ci->lastSeenMs = (uint32_t)millis();
            Serial.printf("[WS] subscribe id=%u base=%d diag=%d\n", (unsigned)client->id(), subBase?1:0, subDiag?1:0);
            // Send a fresh base snapshot so the client is immediately consistent.
            if (subBase) {
                client->text(buildWsStateJson(true));
                client->text(buildWsAnalogJson());
            }
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
        StaticJsonDocument<256> reply;
        reply["type"] = "diagControl";
        if (!s_diag.active || (cid && cid == s_diag.ownerId)) {
            if (!s_diag.active) {
                s_diag.active = true;
                s_diag.ownerId = cid;
                s_diag.sinceMs = now;
                genToken32(s_diag.token);
            }
            constexpr uint32_t LEASE_MS = 10000; // 10s without heartbeat -> auto revert
            s_diag.expiresMs = now + LEASE_MS;
            reply["active"] = true;
            reply["ownerId"] = s_diag.ownerId;
            reply["isOwner"] = true;
            reply["token"] = s_diag.token;
            reply["expiresInMs"] = LEASE_MS;
            String out; serializeJson(reply, out);
            if (client) client->text(out);
            g_stateDirty = true;
        } else {
            reply["active"] = true;
            reply["ownerId"] = s_diag.ownerId;
            reply["isOwner"] = false;
            reply["error"] = "busy";
            String out; serializeJson(reply, out);
            if (client) client->text(out);
        }
        return;
    }
    if (!strcmp(action, "diagHeartbeat"))
    {
        const char* token = cmd["token"] | nullptr;
        if (isDiagOwner(client, token)) {
            constexpr uint32_t LEASE_MS = 10000;
            s_diag.expiresMs = (uint32_t)millis() + LEASE_MS;
        }
        return;
    }
    if (!strcmp(action, "diagExit"))
    {
        const char* token = cmd["token"] | nullptr;
        if (isDiagOwner(client, token)) {
            Serial.println("[DIAG] lease released by owner -> revert to normal");
            diagRevertToNormal("exit");
        }
        return;
    }

    // -------------------------------------------------
    // Safety gate: while diag lease is active, only the owner may send "write" actions.
    // This prevents accidental conflicts (e.g. Torben drives while Bernhard diagnoses).
    // -------------------------------------------------
    auto isProtectedAction = [&](const char* a) -> bool {
        return (!strcmp(a,"powerOff") || !strcmp(a,"m1PowerSet") || !strcmp(a,"m1SelftestStart") || !strcmp(a,"m1SetMode") || !strcmp(a,"m1TurnoutSet") || !strcmp(a,"sbhfSelftestRetry"));
    };
    if (s_diag.active && isProtectedAction(action)) {
        const char* token = cmd["token"] | nullptr;
        if (!isDiagOwner(client, token)) {
            StaticJsonDocument<192> err;
            err["type"] = "error";
            err["code"] = "DIAG_ACTIVE";
            err["ownerId"] = s_diag.ownerId;
            err["msg"] = "diagnose active: write actions allowed only for diag owner";
            String out; serializeJson(err, out);
            if (client) client->text(out);
            return;
        }
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
        Serial.printf("[SIM] setBypassSbhfSelftest(enable=%s) -> now=%s\n",
                      en ? "true" : "false",
                      SystemRuntimeState::bypassSbhfSelftest() ? "true" : "false");
        g_stateDirty = true;
#else
        Serial.println("[SIM] setBypassSbhfSelftest ignored (not a sim build)");
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
        g_stateDirty = true;
        return;
    }

    if (!strcmp(action, "markMega2ChecklistDone"))
    {
        SystemRuntimeState::markMega2ChecklistDone();
        g_stateDirty = true;
        return;
    }

    if (!strcmp(action, "safetyAck"))
    {
        Mega2Link::safetyAck();
        g_stateDirty = true;
        return;
    }

    if (!strcmp(action, "nothalt"))
    {
        Mega2Link::nothalt();
        g_stateDirty = true;
        return;
    }

    if (!strcmp(action, "powerOn"))
    {
        Mega2Link::powerOn();
        g_stateDirty = true;
        return;
    }

    if (!strcmp(action, "powerOff"))
    {
        Mega2Link::powerOff();
        g_stateDirty = true;
        return;
    }

    if (!strcmp(action, "powerToggle"))
    {
        if (((SystemRuntimeState::mega2Status().flags & SYS_POWER_ON) != 0))
            Mega2Link::powerOff();
        else
            Mega2Link::powerOn();

        g_stateDirty = true;
        return;
    }

    // -------------------------------------------------
    // Mega1 Commands
    // -------------------------------------------------
    if (!strcmp(action, "m1SetMode"))
    {
        const uint8_t mode = (uint8_t)(cmd["mode"] | 0);
        const bool ok = Mega1Link::queueSetMode(mode);
        if (!ok) Serial.println("[WS] m1SetMode rejected (args/queue full)");
        g_stateDirty = true;
        return;
    }

    if (!strcmp(action, "m1TurnoutSet"))
    {
        const uint8_t idxW = (uint8_t)(cmd["idx"] | 0);
        const bool gerade = (bool)(cmd["gerade"] | 0);
        const bool ok = Mega1Link::queueTurnoutSet(idxW, gerade);
        if (!ok) Serial.println("[WS] m1TurnoutSet rejected (args/queue full)");
        g_stateDirty = true;
        return;
    }

    if (!strcmp(action, "m1PowerSet"))
    {
        const int bhf_i = cmd["bhf"] | -1;
        if (bhf_i < 0 || bhf_i > 3) {
            Serial.printf("[WS] m1PowerSet reject: bhf=%d out of range\n", bhf_i);
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

        Serial.printf("[WS] m1PowerSet bhf=%u on=%s\n", bhf, on ? "true" : "false");

        const bool ok = Mega1Link::queueBhfPowerSet(bhf, on);
        if (!ok) Serial.println("[WS] m1PowerSet rejected (args/queue full)");
        g_stateDirty = true;
        return;
    }

    if (!strcmp(action, "m1SelftestStart"))
    {
        const bool ok = Mega1Link::queueStartSelftest();
        if (!ok) Serial.println("[WS] m1SelftestStart rejected (queue full)");
        g_stateDirty = true;
        return;
    }

    if (!strcmp(action, "pollNow"))
    {
        Serial.println("[WS] -> Mega2Link::requestPollNow()");
        Mega2Link::requestPollNow();
        g_stateDirty = true;
        return;
    }

    // SBHF selftest retry (explicit command, NOT mapped to safetyAck)
    if (!strcmp(action, "sbhfSelftestRetry"))
    {
        Serial.println("[WS] -> SBHF Selftest Retry");
        Mega2Link::sbhfSelftestRetry();
        g_stateDirty = true;
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
        Serial.println("[WEB] LittleFS mount FAILED!");
        return;
    }

    ws.onEvent(onWsEvent);
    server.addHandler(&ws);

    server.serveStatic("/", LittleFS, "/")
        .setDefaultFile("index.htm")
        .setCacheControl("no-store, no-cache, must-revalidate, max-age=0");

    server.begin();

#if defined(DEBUG_AWS_HEAP)
    dbgHeap("web.begin");
#endif

    Serial.println("[WEB] HTTP server started");
}

// ---------------------------------------------------------
// Web::loop
// ---------------------------------------------------------
void Web::loop()
{
#if defined(DEBUG_AWS_HEAP)
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
// ---------------------------------------------------------
void Web::pushStateIfDirty()
{
    // WS policy:
    // - On-change push, but throttled to avoid bursts that can fragment heap.
    // - Ground-truth full push every WS_FULL_MS even without changes.
    //   (Client can recover from missed frames / reconnects.)
    static uint32_t s_lastSendMs = 0;
    static uint32_t s_nextFullMs = 0;

    const uint32_t now = (uint32_t)millis();

    // No clients => nothing to send (also avoids allocating JSON Strings).
    if (countSubBase() == 0)
    {
        // Still clear dirty if nothing is connected to prevent "burst" right after connect.
        // The CONNECT handler sends a full state anyway.
        g_stateDirty = false;
        return;
    }

    constexpr uint32_t WS_MIN_SEND_MS = 120;   // throttle on-change frames
    constexpr uint32_t WS_FULL_MS     = 5000;  // ground-truth interval (start value)

    const bool wantFull  = (s_nextFullMs == 0) || ((int32_t)(now - s_nextFullMs) >= 0);
    const bool wantDirty = g_stateDirty;

    // Nothing to do.
    if (!wantFull && !wantDirty)
        return;

    // Throttle bursts (but do NOT delay the periodic ground-truth indefinitely).
    if (!wantFull && (now - s_lastSendMs) < WS_MIN_SEND_MS)
        return;

    // Full (ground truth) includes analog, on-change does not.
    // Full (ground truth) includes analog, on-change does not.
    const bool includeAnalog = wantFull;
#if defined(DEBUG_WS_PUSH)
    Serial.printf("[WS] push state full=%d dirty=%d clients=%u\n", includeAnalog?1:0, wantDirty?1:0, (unsigned)ws.count());
#endif
    const String payload = buildWsStateJson(includeAnalog);
#if defined(DEBUG_WS_PUSH)
    Serial.printf("[WS] push state full=%d dirty=%d len=%u\n",
                  includeAnalog ? 1 : 0, wantDirty ? 1 : 0, (unsigned)payload.length());
#endif
    wsTextToBase(payload);

    s_lastSendMs = now;
    s_nextFullMs = now + WS_FULL_MS;
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
// Policy:
//  - on-change push (throttled to DIAG_MIN_MS)
//  - periodic full/ground-truth every DIAG_FULL_MS
//  - only when there is at least one diag-subscribed client
// ---------------------------------------------------------
void Web::pushDiagIfNeeded()
{
    if (countSubDiag() == 0)
        return;

    static bool     s_diagDirty = true;     // first diag client should get a frame quickly
    static uint32_t s_lastSendMs = 0;
    static uint32_t s_nextFullMs = 0;
    static bool     s_lastLeaseActive = false;

    const uint32_t now = (uint32_t)millis();

    // Variant A (start): couple to base dirty (later we can refine -> Variant B via dedicated hooks)
    if (g_stateDirty)
        s_diagDirty = true;

    // Also treat lease state changes as "diag change" (so banner/owner/timeout updates show up)
    if (s_diag.active != s_lastLeaseActive) {
        s_lastLeaseActive = s_diag.active;
        s_diagDirty = true;
    }

    constexpr uint32_t DIAG_MIN_MS  = 250;   // throttle on-change frames
    constexpr uint32_t DIAG_FULL_MS = 1000;  // periodic ground-truth

    const bool wantFull  = (s_nextFullMs == 0) || ((int32_t)(now - s_nextFullMs) >= 0);
    const bool wantDirty = s_diagDirty;

    if (!wantFull && !wantDirty)
        return;

    // Throttle bursts; but don't delay periodic full indefinitely.
    if (!wantFull && (now - s_lastSendMs) < DIAG_MIN_MS)
        return;

    const String payload = buildWsDiagJson();
    wsTextToDiag(payload);

    s_lastSendMs = now;
    if (wantFull) s_nextFullMs = now + DIAG_FULL_MS;
    s_diagDirty = false;
}