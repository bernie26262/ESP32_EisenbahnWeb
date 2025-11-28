#include "gpio.h"
#include "../config/pins.h"

void hal_init() {
    pinMode(LED_PIN, OUTPUT);
}

void hal_ledOn() {
    digitalWrite(LED_PIN, HIGH);
}

void hal_ledOff() {
    digitalWrite(LED_PIN, LOW);
}
