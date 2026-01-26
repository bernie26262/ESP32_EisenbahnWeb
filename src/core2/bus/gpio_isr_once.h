#pragma once


#if defined(ESP32)
#include "driver/gpio.h"

// Add GPIO ISR handler; install ISR service ONLY if needed.
// Returns ESP_OK on success.
esp_err_t gpioIsrAddHandlerAutoInstall(gpio_num_t pin,
                                      gpio_isr_t handler,
                                      void* arg,
                                      gpio_int_type_t intr_type);

#endif