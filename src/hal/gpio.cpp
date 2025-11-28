#include "gpio.h"
#include "../config/pins.h"

void hal_init() {
    pinMode(PIN_LED, OUTPUT);
    digitalWrite(PIN_LED, LOW);
}

void hal_ledOn() {
    digitalWrite(PIN_LED, HIGH);
}

void hal_ledOff() {
    digitalWrite(PIN_LED, LOW);
}
