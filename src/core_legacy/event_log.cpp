#include "event_log.h"

static constexpr uint8_t MAX_EVENTS = 30;
static UiEvent events[MAX_EVENTS];
static uint8_t eventCount = 0;

void eventLogInit()
{
    eventCount = 0;
}

void eventLogAdd(const String& txt)
{
    if (eventCount < MAX_EVENTS)
    {
        events[eventCount++] = { millis(), txt };
    }
    else
    {
        // FIFO: nach oben schieben
        for (uint8_t i = 1; i < MAX_EVENTS; i++)
            events[i - 1] = events[i];

        events[MAX_EVENTS - 1] = { millis(), txt };
    }
}

String eventLogAsText()
{
    String out;
    for (uint8_t i = 0; i < eventCount; i++)
    {
        out += "[";
        out += String(events[i].ts / 1000);
        out += "s] ";
        out += events[i].text;
        out += "\n";
    }
    return out;
}
