# I2C-Protocol-Simulator


> **Full Software Engineering Project — Browser-Based I²C Protocol Simulator with Logic Analyzer, Device Library, Timing Verification, and Fault Injection Engine**

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [How to Run](#how-to-run)
3. [Architecture & Design](#architecture--design)
4. [Core Components](#core-components)
5. [I²C Protocol Fundamentals (Viva Q&A)](#i²c-protocol-fundamentals)
6. [Handshaking — Mode 1 Input/Output Mapping](#handshaking--mode-1-inputoutput-mapping)
7. [Demo Scenarios for Practical](#demo-scenarios-for-practical)
8. [Device Library Reference](#device-library-reference)
9. [Fault Injection Engine](#fault-injection-engine)
10. [Timing Violation Checker](#timing-violation-checker)
11. [Software Engineering Concepts Used](#software-engineering-concepts-used)
12. [Viva Questions & Answers](#viva-questions--answers)
13. [File Structure](#file-structure)

---

## Project Overview

This is a **zero-dependency, client-side** I²C protocol simulator that runs entirely in the browser. No server, no installation — just open `index.html`.

### What it Does
- **Simulates I²C bus communication** — Master controller communicates with up to 8 slave devices
- **Real-time waveform visualization** — SCL/SDA signals rendered on HTML5 Canvas like a logic analyzer
- **Protocol decode** — Every byte on the bus is decoded and annotated (START, STOP, ACK, NACK, Address, Data)
- **Timing verification** — Checks all 7 I²C timing parameters against NXP UM10204 specification
- **Fault injection** — 5 industrial fault types to simulate real hardware failures
- **Bus scanner** — Probes all 112 valid addresses (equivalent to Linux `i2cdetect`)
- **8 realistic I²C devices** — EEPROM, RTC, OLED, IMU, Barometer, GPIO, DAC, ADC

### Key Technical Achievements
| Feature | Implementation |
|---------|---------------|
| Open-drain bus emulation | Wired-AND using `Math.min()` on driver arrays |
| Bit-level protocol engine | 5-tick per bit timing (Q1-Q5 clock phases) |
| Real-time canvas rendering | `requestAnimationFrame` loop with dirty-flag optimization |
| Spec-compliant timing checker | NXP UM10204 Rev 7 Standard + Fast mode thresholds |
| Fault injection | 5 hook points in master state machine |
| Device register maps | 256-byte register arrays with BCD/binary decoders |

---

## How to Run

```
1. Open index.html in any modern browser (Chrome, Edge, Firefox)
2. No installation, no server, no dependencies required
3. Everything runs client-side in JavaScript
```

### Quick Start
1. Click **Transmit** — runs a default WRITE transaction to EEPROM
2. Click **Scan Bus** — discovers all devices on the virtual bus
3. Use **Demo Scenarios** panel — 10 pre-configured demonstrations

---

## Architecture & Design

### Design Pattern: Observer + Event-Driven
```
┌─────────────┐    events     ┌──────────────┐    samples    ┌──────────────┐
│  app.js     │──────────────▶│  engine.js   │─────────────▶│  renderer.js │
│  Controller │◀──────────────│  I2CMaster   │              │  Canvas      │
│             │   callbacks   │  VirtualBus  │              │              │
├─────────────┤               ├──────────────┤              ├──────────────┤
│ UI bindings │               │ Bit-level TX │              │ Waveform draw│
│ Transaction │               │ Open-drain   │              │ Annotations  │
│ State mgmt  │               │ State machine│              │ Violations   │
└──────┬──────┘               └──────┬───────┘              └──────────────┘
       │                             │
       ▼                             ▼
┌─────────────┐               ┌──────────────┐
│ devices.js  │               │timing-checker│
│ 8 I²C slaves│               │ NXP UM10204  │
│ Register map│               │ 7 parameters │
└─────────────┘               └──────────────┘
       │
       ▼
┌──────────────┐
│fault-injector│
│ 5 fault types│
│ Hook-based   │
└──────────────┘
```

### Class Hierarchy
```
I2CSlave (base)
  ├── EEPROM      (AT24C256, 0x50)
  ├── RTC         (DS3231,   0x68)
  ├── OLED        (SSD1306,  0x3C)
  ├── MPU6050     (MPU-6050, 0x69)
  ├── BMP280      (BMP280,   0x76)
  ├── PCF8574     (PCF8574,  0x20)
  ├── MCP4725     (MCP4725,  0x60)
  └── ADS1115     (ADS1115,  0x48)
```

---

## Core Components

### 1. VirtualBus (`engine.js`)
- Emulates **open-drain wired-AND** bus topology
- Multiple drivers (master + slaves) share SCL and SDA lines
- `bus.SCL = Math.min(...drivers)` — any device pulling LOW wins
- Maintains sample history (600 samples) for waveform rendering
- Tracks annotations and timing violations per sample

### 2. I2CMaster (`engine.js`)
- Full **state machine**: IDLE → START → ADDRESS → ACK_CHECK → DATA_TRANSFER → STOP
- **5-tick per bit** timing: Q1(SDA setup) → Q2(hold) → Q3(SCL high) → Q4(sample) → Q5(SCL low)
- Implements both WRITE and READ transactions with repeated START
- Supports pause/resume/abort during active transactions
- Integrates fault injection hooks at every critical point

### 3. I2CSlave (`engine.js`)
- Base class with 256-byte register file
- Address matching: `matches(addrByte)` compares 7-bit address
- ACK/NACK via open-drain: `bus.setSlaveAck(slotId, 0)` pulls SDA low
- Subclasses override `decode(reg, value)` for human-readable register interpretation

### 4. WaveformRenderer (`renderer.js`)
- HTML5 Canvas-based logic analyzer display
- Real-time rendering via `requestAnimationFrame`
- Draws: SCL (purple), SDA (blue), annotations, timing violations, bit labels
- Zoom in/out (0.3× to 12×), PNG export

### 5. TimingChecker (`timing-checker.js`)
- Validates 7 I²C timing parameters per NXP UM10204 Rev 7
- Supports Standard Mode (100 kHz) and Fast Mode (400 kHz)
- Edge detection algorithm: O(n) sweep of SCL/SDA histories
- Reports violations with measured vs. spec values in nanoseconds

### 6. FaultInjector (`fault-injector.js`)
- 5 fault types with hook-based injection
- Arm → Transmit → Auto-fire pattern
- Each fault fires at the correct point in the protocol state machine

---

## I²C Protocol Fundamentals

### What is I²C?
**Inter-Integrated Circuit** (I²C) is a synchronous, multi-master, multi-slave serial communication bus invented by Philips (now NXP) in 1982. Uses only **2 wires**:
- **SCL** — Serial Clock (driven by master)
- **SDA** — Serial Data (bidirectional, shared)

### Key Protocol Rules

| Rule | Description |
|------|-------------|
| **Open-drain** | Lines are pulled HIGH by resistors; devices can only pull LOW |
| **7-bit addressing** | 128 possible addresses (0x00-0x7F), 112 usable |
| **MSB first** | Most significant bit transmitted first |
| **8 bits + ACK** | Every byte followed by a 9th clock for ACK/NACK |
| **START condition** | SDA falls while SCL is HIGH |
| **STOP condition** | SDA rises while SCL is HIGH |
| **ACK = SDA LOW** | Receiver pulls SDA LOW on 9th clock to acknowledge |
| **NACK = SDA HIGH** | SDA stays HIGH — no device, error, or end of read |

### I²C Transaction Sequence (WRITE)
```
      ┌──────┐  ┌──────────────┐  ┌───┐  ┌──────────┐  ┌───┐  ┌──────────┐  ┌───┐  ┌──────┐
SDA:  │START │  │ Address + W  │  │ACK│  │ Register │  │ACK│  │   Data   │  │ACK│  │ STOP │
      └──────┘  └──────────────┘  └───┘  └──────────┘  └───┘  └──────────┘  └───┘  └──────┘
SCL:  ▔▔▔╲___   _╱▔╲_╱▔╲_╱▔╲_   _╱▔╲   _╱▔╲_╱▔╲_╱   _╱▔╲   _╱▔╲_╱▔╲_╱   _╱▔╲   ___╱▔▔▔
```

### I²C Transaction Sequence (READ)
```
START → Address+W → ACK → Register → ACK → Repeated START → Address+R → ACK → Data → NACK → STOP
```
The Repeated START switches from write (register pointer) to read (data) without releasing the bus.

---

## Handshaking — Mode 1 Input/Output Mapping

### How I²C Handshaking Maps to 8255 PPI Mode 1

#### Mode 1 INPUT (Peripheral → CPU)

| Step | 8255 PPI Mode 1 | I²C Equivalent |
|------|-----------------|----------------|
| 1 | Peripheral places data on port | Slave device has data in registers |
| 2 | STB (Strobe) goes LOW | Master generates START condition |
| 3 | Data is latched | Address byte selects the device |
| 4 | IBF (Input Buffer Full) becomes HIGH | Slave sends ACK (SDA LOW on 9th clock) |
| 5 | Interrupt generated (INTR) | Master reads data bytes from slave |

**Signal Mapping:**

| 8255 Signal | Function | I²C Signal | Function |
|-------------|----------|------------|----------|
| STB (Strobe) | Peripheral signals data ready | START | Master initiates transfer |
| IBF (Input Buffer Full) | Buffer has data | ACK | Slave confirms receipt/ready |
| INTR (Interrupt) | CPU notified to read | Data Phase | Bytes transferred to master |

#### Mode 1 OUTPUT (CPU → Peripheral)

| Step | 8255 PPI Mode 1 | I²C Equivalent |
|------|-----------------|----------------|
| 1 | CPU writes data | Master prepares data bytes |
| 2 | OBF (Output Buffer Full) goes LOW | START + Address byte sent |
| 3 | Peripheral reads data | Data bytes clocked on SDA |
| 4 | ACK generated | Slave pulls SDA LOW on 9th clock |
| 5 | Interrupt occurs (INTR) | STOP condition — transfer complete |

**Signal Mapping:**

| 8255 Signal | Function | I²C Signal | Function |
|-------------|----------|------------|----------|
| OBF (Output Buffer Full) | Data in output buffer | START+ADDR | Bus claimed, target selected |
| ACK (Acknowledge) | Peripheral confirms read | ACK bit | SDA=0 on 9th SCL pulse |
| INTR (Interrupt) | Transfer complete notification | STOP | SDA rises while SCL HIGH |

---

## Demo Scenarios for Practical

### Available Demos (click "▶ Run Demo" in sidebar)

| # | Demo | What it Shows |
|---|------|--------------|
| 1 | **Input Handshaking** | READ from EEPROM — maps STB→IBF→INTR to START→ACK→Data |
| 2 | **Output Handshaking** | WRITE to EEPROM — maps OBF→ACK→INTR to START→Data→STOP |
| 3 | **Write-Read-Verify** | Write 0xCA 0xFE, read back, verify match |
| 4 | **RTC Register Decode** | Read 7 BCD time registers from DS3231 |
| 5 | **Bus Scan** | Discover all devices (i2cdetect equivalent) |
| 6 | **NACK Error** | Address non-existent device — error handling |
| 7 | **SDA Glitch** | EMI fault injection — data corruption |
| 8 | **Clock Stretch** | Slave holds SCL LOW — timeout testing |
| 9 | **GPIO Control** | Write pin patterns to PCF8574 expander |
| 10 | **Fast Mode** | 400 kHz timing — tighter spec thresholds |

### Recommended Demo Order for Presentation
1. **Demo 5** (Bus Scan) — "Here's device discovery, like Linux i2cdetect"
2. **Demo 2** (Output Handshaking) — "Master writes data with ACK handshaking"
3. **Demo 1** (Input Handshaking) — "Master reads data — peripheral provides it"
4. **Demo 4** (RTC Decode) — "Register-level decoding of real device"
5. **Demo 7** (SDA Glitch) — "Fault injection — simulating EMI"
6. **Demo 6** (NACK Error) — "What happens when device doesn't respond"

---

## Device Library Reference

| Device | Address | Type | Key Registers | Real-World Use |
|--------|---------|------|--------------|----------------|
| AT24C256 EEPROM | 0x50 | Memory | Canary(0x00), ASCII data | Firmware storage, calibration |
| DS3231 RTC | 0x68 | Clock | Sec(0x00)-Year(0x06), Temp(0x11) | Timekeeping, data logging |
| SSD1306 OLED | 0x3C | Display | Cmd(0x00), Contrast(0x81) | Small displays, wearables |
| MPU-6050 IMU | 0x69 | Sensor | WHO_AM_I(0x75), Accel(0x3B-0x40) | Motion sensing, drones |
| BMP280 Baro | 0x76 | Sensor | ChipID(0xD0), Press(0xF7-0xF9) | Weather stations, altimeters |
| PCF8574 GPIO | 0x20 | I/O | Port byte (direct R/W) | LED control, button input |
| MCP4725 DAC | 0x60 | Analog | DAC(0x01-0x02) | Voltage generation |
| ADS1115 ADC | 0x48 | Analog | Conv(0x00-0x01), Config(0x02-0x03) | Voltage measurement |

---

## Fault Injection Engine

| Fault Type | What it Simulates | How it Works | Real Cause |
|-----------|-------------------|-------------|------------|
| ⚡ SDA Glitch | EMI spike | Flips SDA mid-bit for 1 half-period | Crosstalk, RF interference |
| ⏱ Clock Stretch | Slow slave | Holds SCL LOW for N ms | EEPROM page write, ADC conversion |
| 🚫 NACK Storm | Dead device | Forces NACK on all ACK windows | Device crash, power loss |
| 🔴 Bus Stuck LOW | Hung slave | Forces SDA=0 permanently | Slave state machine locked |
| ✂ Partial Byte | Power cut | Aborts after N bits | Brown-out, watchdog reset |

### Recovery Methods (Real Hardware)
- **SDA Glitch**: Master retries transaction (up to 3x per spec)
- **Clock Stretch**: Master timeout → bus recovery
- **NACK Storm**: Master aborts → reset slave → retry
- **Bus Stuck LOW**: 9 SCL pulses (bus recovery sequence per §3.1.16)
- **Partial Byte**: Power cycle the hung device

---

## Timing Violation Checker

### Parameters Checked (NXP UM10204 Rev 7)

| Parameter | Symbol | Standard (100kHz) | Fast (400kHz) | Severity |
|-----------|--------|-------------------|---------------|----------|
| SCL Low Period | t_LOW | ≥ 4700 ns | ≥ 1300 ns | Error |
| SCL High Period | t_HIGH | ≥ 4000 ns | ≥ 600 ns | Error |
| SDA Setup Time | t_SU;DAT | ≥ 250 ns | ≥ 100 ns | Warning |
| SDA Hold Time | t_HD;DAT | ≥ 300 ns | ≥ 0 ns | Warning |
| START Hold | t_HD;STA | ≥ 4000 ns | ≥ 600 ns | Error |
| Repeated START Setup | t_SU;STA | ≥ 4700 ns | ≥ 600 ns | Warning |
| STOP Setup | t_SU;STO | ≥ 4000 ns | ≥ 600 ns | Error |

---

## Software Engineering Concepts Used

### Design Patterns
| Pattern | Where Used | Purpose |
|---------|-----------|---------|
| **Observer** | `master.onLog`, `onSample`, `onDecodeChip` | Decouples engine from UI |
| **Strategy** | `FaultInjector` hook system | Different fault behaviors swapped at runtime |
| **Registry** | `DEVICE_REGISTRY` array | Plugin-style device registration |
| **Template Method** | `I2CSlave.decode()` | Base class defines interface, subclasses implement |
| **State Machine** | `I2CMaster` states | Formal protocol state transitions |
| **Facade** | `app.js` controller | Single entry point wiring all subsystems |

### Software Engineering Principles
| Principle | Implementation |
|-----------|---------------|
| **Separation of Concerns** | Engine (protocol) / Renderer (display) / Controller (UI) |
| **Single Responsibility** | Each file handles one concern |
| **Open/Closed** | Add new devices without modifying existing code |
| **Dependency Inversion** | Engine callbacks, not direct UI calls |
| **DRY** | Shared `I2CSlave` base, `FAULT_TYPES` metadata drives UI |

### Testing Strategy
| Test Type | How It's Done |
|-----------|--------------|
| **Protocol Correctness** | Bus scan verifies ACK/NACK for all addresses |
| **Timing Compliance** | TimingChecker validates against I²C spec |
| **Error Handling** | Fault injection — 5 failure modes tested |
| **Device Behavior** | Register read/write with decode verification |
| **UI Responsiveness** | Pause/resume mid-transaction |

---

## Viva Questions & Answers

### Q1: What is I²C and why use only 2 wires?
**A:** I²C (Inter-Integrated Circuit) is a synchronous serial protocol using SCL (clock) and SDA (data). Two wires reduce PCB routing complexity — you can connect 100+ devices with just 2 traces + pull-up resistors. Open-drain bus allows multi-device sharing without bus contention.

### Q2: Explain the START and STOP conditions.
**A:** START = SDA falls while SCL is HIGH (signals beginning of transaction). STOP = SDA rises while SCL is HIGH (releases the bus). These are the only times SDA is allowed to change while SCL is HIGH — during normal data transfer, SDA changes only when SCL is LOW.

### Q3: What is the ACK/NACK mechanism?
**A:** After every 8 data bits, the master generates a 9th clock pulse. During this pulse, the **receiver** pulls SDA LOW (ACK) to confirm it received the byte. If SDA stays HIGH (NACK), it means: no device at address, device busy, or end of read.

### Q4: How does addressing work?
**A:** The first byte after START contains the 7-bit slave address (bits 7-1) and R/W bit (bit 0). R/W=0 means write, R/W=1 means read. So address 0x50 becomes 0xA0 for write, 0xA1 for read.

### Q5: What is clock stretching?
**A:** A slave can hold SCL LOW to pause the master when it needs more time (e.g., EEPROM during page write). The master must wait until SCL goes HIGH before proceeding. Our simulator injects this as a fault to test timeout handling.

### Q6: How does your open-drain bus simulation work?
**A:** Each driver (master, slaves) writes to an array slot. The bus value is `Math.min(...allDrivers)` — if ANY device pulls LOW (0), the bus is LOW. When a device releases (writes 1), the bus only goes HIGH if ALL devices have released. This exactly models wired-AND behavior with pull-up resistors.

### Q7: What are the 7 timing parameters you check?
**A:** t_LOW (SCL low period), t_HIGH (SCL high period), t_SU;DAT (SDA setup before SCL↑), t_HD;DAT (SDA hold after SCL↓), t_HD;STA (START hold), t_SU;STA (repeated START setup), t_SU;STO (STOP setup). All from NXP UM10204.

### Q8: Explain the fault injection architecture.
**A:** The `FaultInjector` class has 4 hook methods called by `I2CMaster` at critical points: `checkBit()` before each bit, `checkAck()` at ACK windows, `checkClockStretch()` at each tick, `checkBusStuck()` continuously. You arm a fault type, then the hooks fire automatically at the right moment. This is the **Strategy pattern** — different fault behaviors are injected without changing the master code.

### Q9: How does the repeated START work in READ transactions?
**A:** A READ needs two phases: (1) WRITE the register address, then (2) READ the data. Instead of STOP+START between them (which would release the bus and let another master steal it), we use a **repeated START** — SDA goes high, SCL goes high, then SDA goes low again. This keeps the bus locked.

### Q10: What design patterns did you use?
**A:** Observer (callbacks for engine→UI), Strategy (fault injection), Registry (device library), Template Method (I2CSlave.decode), State Machine (master protocol states), Facade (app.js wiring).

### Q11: How does the bus scanner work?
**A:** It probes each address 0x03–0x77 by sending an address byte and checking the 9th bit. If SDA=0 (ACK), a device exists. If SDA=1 (NACK), no device. Reserved addresses (0x00-0x07, 0x78-0x7F) are skipped per I²C spec.

### Q12: What is the difference between Standard and Fast mode?
**A:** Standard mode runs at 100 kHz with relaxed timing (t_LOW ≥ 4700ns). Fast mode runs at 400 kHz with tighter timing (t_LOW ≥ 1300ns). Our timing checker automatically switches thresholds when you change clock frequency.

### Q13: How does your simulator handle the 8255 handshaking concept?
**A:** We map 8255 Mode 1 signals to I²C equivalents: STB→START, IBF→ACK, INTR→Data transfer, OBF→Address byte. The demos show this mapping explicitly with step-by-step commentary in the terminal log. Both protocols share the concept of: signal initiation → data latch → acknowledgment → completion notification.

### Q14: What happens during a Bus Stuck LOW fault?
**A:** A slave holds SDA to ground permanently (hung state machine). The master can't drive SDA high due to open-drain physics. No STOP condition possible. Recovery requires 9 SCL pulses to clock out the stuck slave, then a power cycle. Our simulator shows the flat SDA=0 waveform.

### Q15: How is the waveform rendered?
**A:** `requestAnimationFrame` loop checks a dirty flag. When set, it redraws the full canvas: background grid, SCL signal (purple), SDA signal (blue), START/STOP annotations, timing violation diamonds, and bit labels at SCL rising edges. Canvas resolution auto-adjusts to container size via `ResizeObserver`.

---

## File Structure

```
FSE_PROJECT/
├── index.html          → HTML shell, all panels, modals, DOM structure
├── style.css           → Dark IDE theme, 580+ lines of polished CSS
├── engine.js           → VirtualBus + I2CMaster + I2CSlave (393 lines)
├── devices.js          → 8 device subclasses + DEVICE_REGISTRY (340 lines)
├── timing-checker.js   → NXP UM10204 timing analyzer (302 lines)
├── fault-injector.js   → 5 fault types + FAULT_TYPES metadata (201 lines)
├── demos.js            → 10 demo scenarios for practical demonstration
├── renderer.js         → Canvas waveform renderer (279 lines)
├── app.js              → Application controller (709 lines)
├── user_guide.md       → Detailed user guide with workflows
└── README.md           → This file — viva prep + documentation
```

### Script Load Order (Critical)
```
engine.js → devices.js → timing-checker.js → fault-injector.js → demos.js → renderer.js → app.js
```
Each file depends on the previous ones. `engine.js` must load first (defines base classes).

---

## Credits & References

- **I²C Specification**: NXP UM10204 Rev 7 (2021)
- **Device Datasheets**: AT24C256, DS3231, SSD1306, MPU-6050, BMP280, PCF8574, MCP4725, ADS1115
- **Timing Parameters**: Tables 10 & 11 of UM10204
- **Bus Recovery**: Section 3.1.16 of I²C specification

---

*Built for FSE Project Demonstration — May 2026*
