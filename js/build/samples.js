// Starter projects for the Build Explorer.
const LD = (extra = '') => `/* Linker script: where every piece of the program goes in memory */
ENTRY(Reset_Handler)

_Min_Stack_Size = 0x400;           /* space reserved for the stack */

MEMORY
{
  FLASH (rx)  : ORIGIN = 0x08000000, LENGTH = 512K   /* program lives here (non-volatile) */
  RAM   (xrw) : ORIGIN = 0x20000000, LENGTH = 128K   /* variables live here */
}

_estack = ORIGIN(RAM) + LENGTH(RAM);   /* initial stack pointer: top of RAM */

SECTIONS
{
  .isr_vector :            /* interrupt vector table must be first in Flash */
  {
    . = ALIGN(4);
    KEEP(*(.isr_vector))
    . = ALIGN(4);
  } >FLASH

  .text :                  /* code */
  {
    . = ALIGN(4);
    *(.text)
    *(.text*)
    . = ALIGN(4);
    _etext = .;
  } >FLASH

  .rodata :                /* constants and string literals */
  {
    . = ALIGN(4);
    *(.rodata)
    *(.rodata*)
    . = ALIGN(4);
  } >FLASH
${extra}
  _sidata = LOADADDR(.data);   /* where .data's initial values are stored in Flash */

  .data :                  /* initialised variables: live in RAM, initial values are copied from Flash */
  {
    . = ALIGN(4);
    _sdata = .;
    *(.data)
    *(.data*)
    . = ALIGN(4);
    _edata = .;
  } >RAM AT> FLASH

  .bss :                   /* zero-initialised variables: RAM only, cleared at start-up */
  {
    . = ALIGN(4);
    _sbss = .;
    *(.bss)
    *(.bss*)
    *(COMMON)
    . = ALIGN(4);
    _ebss = .;
  } >RAM

  ._user_heap_stack :      /* check that the stack still fits */
  {
    . = ALIGN(8);
    . = . + _Min_Stack_Size;
    . = ALIGN(8);
  } >RAM
}
`;

const INIT_ARRAY = `
  .init_array :            /* C++ static constructors */
  {
    . = ALIGN(4);
    __init_array_start = .;
    KEEP(*(.init_array*))
    __init_array_end = .;
    . = ALIGN(4);
  } >FLASH
`;

export const SAMPLES = {
  c: {
    label: 'C: LED blink (STM32-style)',
    active: 'main.c',
    files: {
      'startup.c': `#include <stdint.h>

extern uint32_t _estack;                       /* defined by the linker script */
extern uint32_t _sidata, _sdata, _edata;      /* .data: load address in Flash, start/end in RAM */
extern uint32_t _sbss, _ebss;                 /* .bss start/end in RAM */
extern int main(void);

void Reset_Handler(void);
void NMI_Handler(void)       { while (1) { } }
void HardFault_Handler(void) { while (1) { } }
void SysTick_Handler(void);

/* The vector table: first word = initial stack pointer, then the handlers. */
__attribute__((section(".isr_vector"), used))
void (* const g_vectors[])(void) = {
  (void (*)(void))&_estack,
  Reset_Handler,
  NMI_Handler,
  HardFault_Handler,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  SysTick_Handler,
};

void Reset_Handler(void)
{
  uint32_t *src = &_sidata;
  uint32_t *dst = &_sdata;
  while (dst < &_edata) { *dst++ = *src++; }   /* copy .data from Flash to RAM */
  for (dst = &_sbss; dst < &_ebss; dst++) { *dst = 0; }   /* clear .bss */
  main();
  while (1) { }
}
`,
      'led.h': `#ifndef LED_H
#define LED_H
#include <stdint.h>

#define LED_COUNT 3

typedef struct {
  uint8_t  pin;
  uint8_t  active_low;
  uint16_t blink_ms;
} led_config_t;

void led_init(const led_config_t *cfg);
void led_toggle(uint8_t index);
#endif
`,
      'led.c': `#include "led.h"

static uint8_t led_state[LED_COUNT];          /* zero-initialised: goes to .bss */
static led_config_t active_cfg;

#define GPIOA_ODR (*(volatile uint32_t *)0x40020014)

void led_init(const led_config_t *cfg)
{
  active_cfg = *cfg;
  for (uint8_t i = 0; i < LED_COUNT; i++) {
    led_state[i] = 0;
  }
}

void led_toggle(uint8_t index)
{
  led_state[index] ^= 1;
  if (led_state[index]) {
    GPIOA_ODR |= (1u << active_cfg.pin);
  } else {
    GPIOA_ODR &= ~(1u << active_cfg.pin);
  }
}
`,
      'main.c': `#include <stdint.h>
#include "led.h"

uint32_t tick_count;                           /* no initial value        -> .bss    */
uint32_t sys_clock_hz = 16000000;              /* non-zero initial value  -> .data   */
const char banner[] = "Embedded Software Notes";   /* const                  -> .rodata */
const uint16_t sine_table[8] = { 0, 707, 1000, 707, 0, 64829, 64536, 64829 };
static uint8_t rx_buffer[256];                 /* static, no value        -> .bss    */
const led_config_t default_led = { 5, 0, 500 };

void SysTick_Handler(void)
{
  tick_count++;
}

static void delay_ticks(uint32_t n)
{
  uint32_t start = tick_count;
  while ((tick_count - start) < n) { }
}

int main(void)
{
  led_init(&default_led);
  rx_buffer[0] = (uint8_t)banner[0];
  for (;;) {
    led_toggle(0);
    delay_ticks(default_led.blink_ms);
  }
  return 0;
}
`,
      'link.ld': LD(),
    },
    options: { opt: 'Os', defines: '', functionSections: true, dataSections: true, gc: false },
  },
  cpp: {
    label: 'C++: class, vtable, global object',
    active: 'led.cpp',
    files: {
      'startup.cpp': `#include <stdint.h>

extern "C" {
extern uint32_t _estack, _sidata, _sdata, _edata, _sbss, _ebss;
extern void (*__init_array_start[])(void);
extern void (*__init_array_end[])(void);
}
extern int main(void);

extern "C" void Reset_Handler(void);
extern "C" void Default_Handler(void) { while (1) { } }

extern "C" {
__attribute__((section(".isr_vector"), used))
void (* const g_vectors[])(void) = {
  (void (*)(void))&_estack,
  Reset_Handler,
  Default_Handler,
  Default_Handler,
};

void Reset_Handler(void)
{
  uint32_t *src = &_sidata;
  uint32_t *dst = &_sdata;
  while (dst < &_edata) { *dst++ = *src++; }
  for (dst = &_sbss; dst < &_ebss; dst++) { *dst = 0; }
  for (void (**f)(void) = __init_array_start; f < __init_array_end; f++) { (*f)(); }   /* run C++ constructors */
  main();
  while (1) { }
}
}
`,
      'led.hpp': `#pragma once
#include <stdint.h>

namespace board {

class Device {
 public:
  Device(uint8_t id) : id_(id) { ++count; }
  virtual ~Device() {}
  virtual void update() = 0;
  uint8_t id() const { return id_; }
  static uint32_t count;
 protected:
  uint8_t id_;
};

class Led : public Device {
 public:
  Led(uint8_t pin, uint16_t period_ms);
  void update() override;
  void toggle();
 private:
  uint8_t pin_;
  bool on_;
  uint16_t period_ms_;
};

}  // namespace board
`,
      'led.cpp': `#include "led.hpp"

namespace board {

uint32_t Device::count = 0;                    /* static member -> .bss */

Led::Led(uint8_t pin, uint16_t period_ms)
    : Device(pin), pin_(pin), on_(false), period_ms_(period_ms) {}

void Led::toggle()
{
  on_ = !on_;
  *(volatile uint32_t *)0x40020014 ^= (1u << pin_);
}

void Led::update()
{
  toggle();
}

}  // namespace board

board::Led status_led(5, 500);                 /* global object with a constructor -> .bss + .init_array */
`,
      'main.cpp': `#include <stdint.h>
#include "led.hpp"

static const uint8_t pattern[] = { 1, 0, 1, 1, 0, 0, 1, 0 };   /* const -> .rodata */
uint32_t cycles = 100;                                       /* initialised -> .data */

extern board::Led status_led;

int main()
{
  for (;;) {
    status_led.update();
    cycles += pattern[cycles & 7];
  }
}
`,
      'link.ld': LD(INIT_ARRAY),
    },
    options: { opt: 'Os', defines: '', functionSections: true, dataSections: true, gc: false },
  },
};
