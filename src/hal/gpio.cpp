#include "gpio.h"
#include "../config/pins.h"

#include "../config/pins.h"

void hal_init() {
    pinMode(PIN_STATUS_LED, OUTPUT);
}

void hal_ledOn() {
    digitalWrite(PIN_STATUS_LED, HIGH);
}

void hal_ledOff() {
    digitalWrite(PIN_STATUS_LED, LOW);
}
