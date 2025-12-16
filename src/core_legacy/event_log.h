#pragma once
#include <Arduino.h>

struct UiEvent
{
    uint32_t ts;
    String   text;
};

void eventLogInit();
void eventLogAdd(const String& txt);
String eventLogAsText();
