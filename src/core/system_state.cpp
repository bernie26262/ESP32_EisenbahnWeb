#include "system_state.h"
#include "../hal/gpio.h"

unsigned long lastToggle = 0;
bool ledState = false;

void core_init() {
    hal_init();
}

void core_update() {
    unsigned long now = millis();
    if (now - lastToggle > 500) {
        lastToggle = now;
        ledState = !ledState;

        if (ledState) hal_ledOn();
        else hal_ledOff();
    }
}
