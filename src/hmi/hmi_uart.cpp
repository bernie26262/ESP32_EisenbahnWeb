#include "hmi_uart.h"
#include "../config/pins.h"
#include "../../include/debug.h"

#include <HardwareSerial.h>

namespace HMI
{
    namespace
    {
        struct TxFrame
        {
            String json;
            uint32_t seq;
            uint32_t createdMs;
            TxKind kind;
            bool dropped;
        };

        static HardwareSerial uart(1);
        static uint32_t lastSend = 0;
        static String rxLine;
        static uint32_t s_lastRateWarnMs = 0;

        static uint32_t s_nextSeq = 1;
        static uint32_t s_lastTxSeq = 0;
        static uint32_t s_lastAckSeq = 0;
        static uint32_t s_lastTxMs = 0;
        static bool s_waitAck = false;
        static uint32_t s_txSuppressUntilMs = 0;
        static bool s_ackTimeoutLogged = false;

        static constexpr uint32_t HMI_ACK_WARN_MS = 300;
        static constexpr uint32_t HMI_ACK_DROP_MS = 3000;
        static constexpr size_t HMI_QUEUE_CAP = 4;

        static TxFrame s_queue[HMI_QUEUE_CAP];
        static size_t s_qCount = 0;

        static TxFrame s_inFlight;
        static bool s_hasInFlight = false;

        static uint32_t s_lastDroppedSeq = 0;
        static uint32_t s_lastDroppedAtMs = 0;
        static TxKind s_lastDroppedKind = TxKind::Other;

        static uint32_t s_dropStateLite = 0;
        static uint32_t s_dropAnalog = 0;

        static const char* kindName(TxKind kind)
        {
            switch (kind)
            {
                case TxKind::StateLite: return "state-lite";
                case TxKind::Analog:    return "analog";
                default:                return "other";
            }
        }

        static int findQueuedByKind(TxKind kind)
        {
            for (size_t i = 0; i < s_qCount; ++i)
            {
                if (s_queue[i].kind == kind) return (int)i;
            }
            return -1;
        }

        static void eraseQueuedAt(size_t idx)
        {
            if (idx >= s_qCount) return;
            for (size_t i = idx + 1; i < s_qCount; ++i)
            {
                s_queue[i - 1] = s_queue[i];
            }
            --s_qCount;
        }

        static int findFirstQueuedStateLite()
        {
            for (size_t i = 0; i < s_qCount; ++i)
            {
                if (s_queue[i].kind == TxKind::StateLite) return (int)i;
            }
            return -1;
        }

        static size_t pickNextQueuedIndex()
        {
            // Bediengefühl priorisieren:
            // Wenn sowohl state-lite als auch analog anstehen,
            // zuerst state-lite senden.
            const int stateIdx = findFirstQueuedStateLite();
            if (stateIdx >= 0) return (size_t)stateIdx;
            return 0;
        }

        static bool writeFrame(const String& s)
        {
            const uint16_t len = s.length();

            uart.write(0xA5);
            uart.write(0x5A);
            uart.write((uint8_t)(len & 0xFF));
            uart.write((uint8_t)((len >> 8) & 0xFF));
            uart.write((const uint8_t*)s.c_str(), len);
            lastSend = millis();
            return true;
        }

        static void trySendNext()
        {
            if (s_hasInFlight) return;
            if (s_qCount == 0) return;

            const uint32_t now = millis();
            if (now - lastSend < 5)
            {
                return;
            }

            if ((int32_t)(now - s_txSuppressUntilMs) < 0)
            {
                return;
            }

            const size_t pickIdx = pickNextQueuedIndex();
            s_inFlight = s_queue[pickIdx];
            eraseQueuedAt(pickIdx);

            writeFrame(s_inFlight.json);
            s_lastTxSeq = s_inFlight.seq;
            s_lastTxMs = now;
            s_waitAck = (s_inFlight.seq != 0);
            s_ackTimeoutLogged = false;
            s_hasInFlight = (s_inFlight.seq != 0);
            s_inFlight.dropped = false;

            EE_LOGI("HMIUART",
                    "TX seq=%lu kind=%s len=%u q=%u",
                    (unsigned long)s_inFlight.seq,
                    kindName(s_inFlight.kind),
                    (unsigned)s_inFlight.json.length(),
                    (unsigned)s_qCount);
        }
    }

    void begin()
    {
        uart.begin(230400, SERIAL_8N1, PIN_HMI_UART_RX, PIN_HMI_UART_TX);
        rxLine.reserve(192);
    }

    void loop()
    {
        // RX wird über readLine() im main loop verarbeitet.
        if (s_waitAck)
        {
            const uint32_t now = millis();
            if (!s_ackTimeoutLogged && (uint32_t)(now - s_lastTxMs) >= HMI_ACK_WARN_MS)
            {
                s_ackTimeoutLogged = true;
                EE_LOGI("HMIUART",
                        "ACK overdue seq=%lu ageMs=%lu lastAck=%lu q=%u",
                        (unsigned long)s_lastTxSeq,
                        (unsigned long)(now - s_lastTxMs),
                        (unsigned long)s_lastAckSeq,
                        (unsigned)s_qCount);
            }

            if ((uint32_t)(now - s_lastTxMs) >= HMI_ACK_DROP_MS)
            {
                EE_LOGI("HMIUART",
                        "ACK drop/reset seq=%lu kind=%s ageMs=%lu q=%u",
                        (unsigned long)s_lastTxSeq,
                        kindName(s_inFlight.kind),
                        (unsigned long)(now - s_lastTxMs),
                        (unsigned)s_qCount);
                
                s_lastDroppedSeq = s_lastTxSeq;
                s_lastDroppedAtMs = now;
                s_lastDroppedKind = s_inFlight.kind;
                s_inFlight.dropped = true;

                s_waitAck = false;
                s_hasInFlight = false;
                s_inFlight = TxFrame{};
            }
        }

        trySendNext();
    }

    uint32_t nextTxSeq()
    {
        return s_nextSeq++;
    }

    bool sendJson(const String& s, uint32_t seq)
    {
        uint32_t now = millis();
        if (now - lastSend < 200)
        {
            if ((uint32_t)(now - s_lastRateWarnMs) >= 1000)
            {
                s_lastRateWarnMs = now;
                EE_LOGI("HMIUART",
                        "sendJson rate-limit dt=%lu len=%u",
                        (unsigned long)(now - lastSend),
                        (unsigned)s.length());
            }
            return false;
        }

        if (seq != 0 && s_waitAck)
        {
            EE_LOGI("HMIUART",
                    "TX while previous ACK pending prevSeq=%lu prevAgeMs=%lu newSeq=%lu",
                    (unsigned long)s_lastTxSeq,
                    (unsigned long)(now - s_lastTxMs),
                    (unsigned long)seq);
        }

        const bool ok = writeFrame(s);
        if (!ok) return false;

        if (seq != 0)
        {
            s_lastTxSeq = seq;
            s_lastTxMs = now;
            s_waitAck = true;
            s_ackTimeoutLogged = false;
            s_hasInFlight = true;
            s_inFlight.json = s;
            s_inFlight.seq = seq;
            s_inFlight.createdMs = now;
            s_inFlight.kind = TxKind::Other;
            EE_LOGI("HMIUART",
                    "TX seq=%lu len=%u",
                    (unsigned long)seq,
                    (unsigned)s.length());
        }

        return true;
    }

    bool enqueueJson(const String& s, TxKind kind, uint32_t seq)
    {
        TxFrame f;
        f.json = s;
        f.seq = seq;
        f.createdMs = millis();
        f.kind = kind;
        f.dropped = false;

        if (kind == TxKind::StateLite || kind == TxKind::Analog)
        {
            const int idx = findQueuedByKind(kind);
            if (idx >= 0)
            {
                if (kind == TxKind::StateLite) ++s_dropStateLite;
                if (kind == TxKind::Analog) ++s_dropAnalog;
                s_queue[(size_t)idx] = f;
                EE_LOGI("HMIUART",
                        "QUEUE replace kind=%s seq=%lu q=%u dropState=%lu dropAnalog=%lu",
                        kindName(kind),
                        (unsigned long)seq,
                        (unsigned)s_qCount,
                        (unsigned long)s_dropStateLite,
                        (unsigned long)s_dropAnalog);
                trySendNext();
                return true;
            }
        }

        if (s_qCount >= HMI_QUEUE_CAP)
        {
            int dropIdx = findQueuedByKind(TxKind::Analog);
            if (dropIdx >= 0)
            {
                ++s_dropAnalog;
                eraseQueuedAt((size_t)dropIdx);
            }
            else
            {
                dropIdx = findQueuedByKind(TxKind::StateLite);
                if (dropIdx >= 0)
                {
                    ++s_dropStateLite;
                    eraseQueuedAt((size_t)dropIdx);
                }
                else
                {
                    eraseQueuedAt(0);
                }
            }
        }

        if (s_qCount >= HMI_QUEUE_CAP)
        {
            EE_LOGI("HMIUART",
                    "QUEUE full reject kind=%s seq=%lu",
                    kindName(kind),
                    (unsigned long)seq);
            return false;
        }

        s_queue[s_qCount++] = f;
        EE_LOGI("HMIUART",
                "QUEUE add kind=%s seq=%lu q=%u waitAck=%d inFlight=%lu",
                kindName(kind),
                (unsigned long)seq,
                (unsigned)s_qCount,
                s_waitAck ? 1 : 0,
                (unsigned long)s_lastTxSeq);

        trySendNext();
        return true;
    }

    void noteAck(uint32_t seq)
    {
        const uint32_t now = millis();
        const uint32_t dt = (s_lastTxMs != 0) ? (uint32_t)(now - s_lastTxMs) : 0;

        if (seq > s_lastAckSeq + 1 && s_lastAckSeq != 0)
        {
            EE_LOGI("HMIUART",
                    "ACK jump lastAck=%lu ack=%lu",
                    (unsigned long)s_lastAckSeq,
                    (unsigned long)seq);
        }

        s_lastAckSeq = seq;

        if (!s_waitAck && seq == s_lastDroppedSeq)
        {
            EE_LOGI("HMIUART",
                    "ACK late-after-drop seq=%lu kind=%s ageSinceDropMs=%lu",
                    (unsigned long)seq,
                    kindName(s_lastDroppedKind),
                    (unsigned long)(now - s_lastDroppedAtMs));
            return;
        }

        if (!s_waitAck)
        {
            EE_LOGI("HMIUART", "ACK seq=%lu dtMs=%lu", (unsigned long)seq, (unsigned long)dt);
            return;
        }

        if (s_waitAck && seq == s_lastTxSeq)
        {
            s_waitAck = false;
            s_hasInFlight = false;
            s_inFlight = TxFrame{};
            EE_LOGI("HMIUART",
                    "ACK matched seq=%lu dtMs=%lu q=%u",
                    (unsigned long)seq,
                    (unsigned long)dt,
                    (unsigned)s_qCount);
            trySendNext();
            return;
        }

        if (seq < s_lastTxSeq)
        {
            EE_LOGI("HMIUART",
                    "ACK stale got=%lu expected=%lu dtMs=%lu",
                    (unsigned long)seq,
                    (unsigned long)s_lastTxSeq,
                    (unsigned long)dt);
            return;
        }

        EE_LOGI("HMIUART",
                "ACK mismatch got=%lu expected=%lu dtMs=%lu",
                (unsigned long)seq,
                (unsigned long)s_lastTxSeq,
                (unsigned long)dt);
    }

    bool readLine(String& outLine)
    {
        while (uart.available())
        {
            const char c = (char)uart.read();

            if (c == '\n')
            {
                outLine = rxLine;
                rxLine = "";
                return outLine.length() > 0;
            }

            if (c == '\r')
            {
                continue;
            }

            if (rxLine.length() < 180)
            {
                rxLine += c;
            }
        }

        return false;
    }

    size_t queuedCount()
    {
        return s_qCount;
    }

    bool hasAckPending()
    {
        return s_waitAck;
    }

    uint32_t inFlightSeq()
    {
        return s_waitAck ? s_lastTxSeq : 0;
    }

    void cancelInFlightStateLite(const char* reason)
    {
        if (!s_waitAck || !s_hasInFlight) return;
        if (s_inFlight.seq == 0) return;
        if (s_inFlight.kind != TxKind::StateLite) return;

        const uint32_t now = millis();
        s_lastDroppedSeq = s_inFlight.seq;
        s_lastDroppedAtMs = now;
        s_lastDroppedKind = s_inFlight.kind;

        EE_LOGI("HMIUART",
                "cancel inFlight kind=%s seq=%lu ageMs=%lu reason=%s",
                kindName(s_inFlight.kind),
                (unsigned long)s_inFlight.seq,
                (unsigned long)(now - s_lastTxMs),
                (reason && reason[0]) ? reason : "-");

        s_waitAck = false;
        s_hasInFlight = false;
        s_ackTimeoutLogged = false;
        s_inFlight = TxFrame{};
        trySendNext();
    }

    void resetTxAfterLocalCommand(unsigned long suppressMs, const char* reason)
    {
        const uint32_t now = millis();

        // 1) in-flight Frame verwerfen, egal welcher Typ
        if (s_waitAck && s_hasInFlight && s_inFlight.seq != 0)
        {
            s_lastDroppedSeq = s_inFlight.seq;
            s_lastDroppedAtMs = now;
            s_lastDroppedKind = s_inFlight.kind;

            EE_LOGI("HMIUART",
                    "reset local-cmd drop inFlight kind=%s seq=%lu ageMs=%lu reason=%s",
                    kindName(s_inFlight.kind),
                    (unsigned long)s_inFlight.seq,
                    (unsigned long)(now - s_lastTxMs),
                    (reason && reason[0]) ? reason : "-");

            s_waitAck = false;
            s_hasInFlight = false;
            s_ackTimeoutLogged = false;
            s_inFlight = TxFrame{};
        }

        // 2) Queue komplett leeren
        if (s_qCount > 0)
        {
            EE_LOGI("HMIUART",
                    "reset local-cmd clear queue q=%u reason=%s",
                    (unsigned)s_qCount,
                    (reason && reason[0]) ? reason : "-");
            s_qCount = 0;
        }

        // 3) Für eine kurze Zeit komplette TX-Ruhe
        s_txSuppressUntilMs = now + (uint32_t)suppressMs;
        EE_LOGI("HMIUART",
                "reset local-cmd suppressAllTx delayMs=%lu until=%lu",
                (unsigned long)suppressMs,
                (unsigned long)s_txSuppressUntilMs);
    }
}