#pragma once
#include <Arduino.h>
#include <stddef.h>

namespace HMI
{
    enum class TxKind : uint8_t
    {
        StateLite = 0,
        Analog = 1,
        Other = 2
    };

    void begin();
    void loop();
    bool sendJson(const String& s, uint32_t seq = 0);
    bool readLine(String& outLine);
    void noteAck(uint32_t seq);
    uint32_t nextTxSeq();

    bool enqueueJson(const String& s, TxKind kind, uint32_t seq = 0);
    size_t queuedCount();
    bool hasAckPending();
    uint32_t inFlightSeq();
    void cancelInFlightStateLite(const char* reason);
    void resetTxAfterLocalCommand(unsigned long suppressMs, const char* reason);
}