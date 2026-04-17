#pragma once

namespace HmiPush
{
    void loop();
    void loopAnalog();
    void forceFull();
    void forceFullDelayed(unsigned long delayMs);
    void suppressStateLiteUntil(unsigned long delayMs);
    void suppressAnalogUntil(unsigned long delayMs);
}