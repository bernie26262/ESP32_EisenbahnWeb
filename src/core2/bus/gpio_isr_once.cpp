#include "core2/bus/gpio_isr_once.h"

#if defined(ESP32)
#include "esp_err.h"

esp_err_t gpioIsrAddHandlerAutoInstall(gpio_num_t pin,
                                      gpio_isr_t handler,
                                      void* arg,
                                      gpio_int_type_t intr_type)
{
    // Set interrupt type first
    gpio_set_intr_type(pin, intr_type);

    // Try to add handler first (if ISR service already installed -> OK, no logs)
    esp_err_t e = gpio_isr_handler_add(pin, handler, arg);
    if (e == ESP_OK)
    {
        gpio_intr_enable(pin);
        return ESP_OK;
    }

    // If service isn't installed yet, add returns INVALID_STATE.
    if (e == ESP_ERR_INVALID_STATE)
    {
        const esp_err_t ei = gpio_install_isr_service(ESP_INTR_FLAG_IRAM);
        if (ei != ESP_OK && ei != ESP_ERR_INVALID_STATE)
            return ei;

        e = gpio_isr_handler_add(pin, handler, arg);
        if (e == ESP_OK)
        {
            gpio_intr_enable(pin);
            return ESP_OK;
        }
    }

    return e;
}

#endif