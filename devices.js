/**
 * devices.js — Extensible I²C Device Library
 * 
 * Contains 8 industrial-grade slave devices with:
 *  - Accurate 7-bit I²C addresses
 *  - 256-byte register maps (seeded with realistic defaults)
 *  - decode(reg, value) → human-readable field interpretation
 *  - Device metadata for the UI (name, category, icon, info tag)
 *
 * Adding a new device: extend I2CSlave, add to DEVICE_REGISTRY.
 */

'use strict';

/* ═══════════════════════ BASE SLAVE (from engine.js) ════════════════════════
   Devices extend I2CSlave which is defined in engine.js.
   This file only defines subclasses and the registry.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─────────────────────── 1. AT24C256 EEPROM ───────────────────────────────
   Address: 0x50 (A2=A1=A0=0)
   Real part: Atmel AT24C256 — 256-kbit (32KB) I²C EEPROM
   Used in: MCU firmware storage, calibration data, ID chips
   ─────────────────────────────────────────────────────────────────────────── */
class EEPROM extends I2CSlave {
  constructor(bus) {
    super(0x50, 'AT24C256 EEPROM', bus, 1);
    // Pre-load with a recognisable pattern: 0xA5 canary + ASCII "I2C-SIM\0"
    this.registers.set([0xA5, 0x49, 0x32, 0x43, 0x2D, 0x53, 0x49, 0x4D, 0x00]);
  }

  decode(reg, value) {
    if (reg === 0x00) return `Canary byte — 0x${value.toString(16).toUpperCase().padStart(2,'0')} (${value === 0xA5 ? '✔ valid' : '✘ corrupt'})`;
    if (reg >= 0x01 && reg <= 0x08) {
      const c = value >= 0x20 && value < 0x7F ? String.fromCharCode(value) : '.';
      return `ASCII '${c}' (0x${value.toString(16).toUpperCase().padStart(2,'0')})`;
    }
    return `Raw byte — 0x${value.toString(16).toUpperCase().padStart(2,'0')}`;
  }

  get meta() {
    return { category: 'Memory', infoTag: '32 KB NVM', icon: '💾' };
  }
}

/* ─────────────────────── 2. DS3231 RTC ────────────────────────────────────
   Address: 0x68
   Real part: Maxim DS3231 — High-accuracy I²C RTC with TCXO and crystal
   Registers: Seconds(0x00), Minutes(0x01), Hours(0x02), Day(0x03),
              Date(0x04), Month(0x05), Year(0x06), Alarm1/2, Control, Status
   ─────────────────────────────────────────────────────────────────────────── */
class RTC extends I2CSlave {
  constructor(bus) {
    super(0x68, 'DS3231 RTC', bus, 2);
    // Seed with: 09:41:55, Tuesday, 22 April 2025
    this.registers[0x00] = 0x55; // seconds  55 BCD
    this.registers[0x01] = 0x41; // minutes  41 BCD
    this.registers[0x02] = 0x09; // hours    09 BCD (24h)
    this.registers[0x03] = 0x03; // day-of-week: Tuesday
    this.registers[0x04] = 0x22; // date     22 BCD
    this.registers[0x05] = 0x04; // month    04 BCD
    this.registers[0x06] = 0x25; // year     25 BCD (2025)
    this.registers[0x0E] = 0x1C; // control: BBSQW on, RS2=RS1=1 (1Hz)
    this.registers[0x0F] = 0x00; // status
    this.registers[0x11] = 0x32; // temp MSB: +50°C (0x32 = 50)
    this.registers[0x12] = 0x00; // temp LSB fractional
  }

  _bcdToStr(bcd) {
    return `${((bcd >> 4) & 0x0F) * 10 + (bcd & 0x0F)}`;
  }

  decode(reg, value) {
    const map = {
      0x00: () => `Seconds: ${this._bcdToStr(value & 0x7F)} BCD`,
      0x01: () => `Minutes: ${this._bcdToStr(value & 0x7F)} BCD`,
      0x02: () => `Hours: ${this._bcdToStr(value & 0x3F)} BCD (${(value & 0x40) ? '12h' : '24h'} mode)`,
      0x03: () => `Day-of-Week: ${['','Mon','Tue','Wed','Thu','Fri','Sat','Sun'][value & 0x07] || '?'}`,
      0x04: () => `Date: ${this._bcdToStr(value & 0x3F)}`,
      0x05: () => `Month: ${this._bcdToStr(value & 0x1F)}${(value & 0x80) ? ' [century]' : ''}`,
      0x06: () => `Year: 20${this._bcdToStr(value)}`,
      0x0E: () => `Control: EOSC=${(value>>7)&1} BBSQW=${(value>>6)&1} RS=${(value>>3)&3}`,
      0x0F: () => `Status: OSF=${(value>>7)&1} BSY=${(value>>2)&1} A2F=${(value>>1)&1} A1F=${value&1}`,
      0x11: () => `Temp MSB: ${value > 127 ? value - 256 : value}°C`,
      0x12: () => `Temp frac: ${((value >> 6) * 0.25).toFixed(2)}°C`,
    };
    return map[reg] ? map[reg]() : `Reserved (0x${value.toString(16).toUpperCase().padStart(2,'0')})`;
  }

  get meta() {
    return { category: 'Timekeeping', infoTag: 'Real-Time Clock', icon: '🕐' };
  }
}

/* ─────────────────────── 3. SSD1306 OLED ──────────────────────────────────
   Address: 0x3C (SA0=0) or 0x3D (SA0=1)
   Real part: Solomon Systech SSD1306 — 128×64 OLED controller
   Protocol: Co byte (0x00=cmd stream, 0x40=data stream), then payload
   ─────────────────────────────────────────────────────────────────────────── */
class OLED extends I2CSlave {
  constructor(bus) {
    super(0x3C, 'SSD1306 OLED', bus, 3);
    // Control register 0x00=cmd, 0x40=data; typical init sequence
    this.registers[0x00] = 0x00; // control byte (command mode)
    this.registers[0xAE] = 0x00; // display off command
    this.registers[0xA8] = 0x3F; // mux ratio 63 (64MUX)
    this.registers[0xD3] = 0x00; // display offset 0
    this.registers[0x40] = 0x00; // display start line 0
    this.registers[0xA1] = 0x00; // segment remap
    this.registers[0xC8] = 0x00; // COM scan direction
    this.registers[0x81] = 0xCF; // contrast 0xCF
  }

  decode(reg, value) {
    const cmdMap = {
      0xAE: `Display OFF command`,
      0xAF: `Display ON command`,
      0xA8: `Set MUX ratio → ${value} rows`,
      0xD3: `Display offset → ${value} rows`,
      0x81: `Contrast → ${value}/255 (${((value/255)*100).toFixed(0)}%)`,
      0xA1: `Segment remap → ${value === 0xA0 ? 'Normal' : 'Mirrored'}`,
      0x8D: `Charge pump → ${value === 0x14 ? 'ENABLED' : 'DISABLED'}`,
      0x00: `Control byte → ${value === 0x00 ? 'CMD stream' : value === 0x40 ? 'DATA stream' : `0x${value.toString(16).toUpperCase()}`}`,
    };
    return cmdMap[reg] || `SSD1306 reg 0x${reg.toString(16).toUpperCase().padStart(2,'0')} = 0x${value.toString(16).toUpperCase().padStart(2,'0')}`;
  }

  get meta() {
    return { category: 'Display', infoTag: '128×64 OLED', icon: '🖥' };
  }
}

/* ─────────────────────── 4. MPU-6050 IMU ──────────────────────────────────
   Address: 0x68 (AD0=0) — conflicts with DS3231; use 0x69 (AD0=1) here
   Real part: InvenSense MPU-6050 — 6-axis (accel+gyro) IMU
   Key regs: WHO_AM_I(0x75), PWR_MGMT_1(0x6B), ACCEL_XOUT_H(0x3B)..
   ─────────────────────────────────────────────────────────────────────────── */
class MPU6050 extends I2CSlave {
  constructor(bus) {
    super(0x69, 'MPU-6050 IMU', bus, 4);
    this.registers[0x75] = 0x69; // WHO_AM_I — fixed ID 0x68 (or 0x69 w/ AD0=1)
    this.registers[0x6B] = 0x00; // PWR_MGMT_1 — device awake, internal 8MHz osc
    this.registers[0x1B] = 0x00; // GYRO_CONFIG: ±250 °/s range
    this.registers[0x1C] = 0x00; // ACCEL_CONFIG: ±2g range
    // Simulated sensor data — X=0.1g, Y=0.05g, Z=1.0g (standing still)
    const ax = Math.round(0.10 * 16384); // ±2g → 16384 LSB/g
    const ay = Math.round(0.05 * 16384);
    const az = Math.round(1.00 * 16384);
    this.registers[0x3B] = (ax >> 8) & 0xFF; this.registers[0x3C] = ax & 0xFF;
    this.registers[0x3D] = (ay >> 8) & 0xFF; this.registers[0x3E] = ay & 0xFF;
    this.registers[0x3F] = (az >> 8) & 0xFF; this.registers[0x40] = az & 0xFF;
    // Temp: (reg / 340 + 36.53) → seed 40°C → reg = (40-36.53)*340 = 1180
    const t = 1180;
    this.registers[0x41] = (t >> 8) & 0xFF; this.registers[0x42] = t & 0xFF;
  }

  decode(reg, value) {
    const map = {
      0x75: () => `WHO_AM_I → 0x${value.toString(16).toUpperCase()} ${value === 0x68 || value === 0x69 ? '✔ MPU-6050' : '✘ unexpected'}`,
      0x6B: () => `PWR_MGMT_1 → SLEEP=${(value>>6)&1} CYCLE=${(value>>5)&1} TEMP_DIS=${(value>>3)&1} CLKSEL=${value&7}`,
      0x1B: () => `GYRO_CONFIG → FS_SEL=${(value>>3)&3} → ±${[250,500,1000,2000][(value>>3)&3]}°/s`,
      0x1C: () => `ACCEL_CONFIG → AFS_SEL=${(value>>3)&3} → ±${[2,4,8,16][(value>>3)&3]}g`,
      0x3B: () => `ACCEL_XOUT_H → high byte of X accel`,
      0x3C: () => `ACCEL_XOUT_L → X accel raw[7:0]`,
      0x3D: () => `ACCEL_YOUT_H`,
      0x3F: () => `ACCEL_ZOUT_H`,
      0x41: () => `TEMP_OUT_H → high byte`,
      0x42: () => `TEMP_OUT_L → low byte`,
    };
    return map[reg] ? map[reg]() : `MPU-6050 reg 0x${reg.toString(16).toUpperCase().padStart(2,'0')} = 0x${value.toString(16).toUpperCase().padStart(2,'0')}`;
  }

  get meta() {
    return { category: 'Sensor', infoTag: '6-Axis IMU', icon: '📐' };
  }
}

/* ─────────────────────── 5. BMP280 Pressure Sensor ────────────────────────
   Address: 0x76 (SDO=GND) or 0x77 (SDO=VDD)
   Real part: Bosch BMP280 — pressure + temperature sensor
   Key regs: ID(0xD0), RESET(0xE0), STATUS(0xF3), CTRL_MEAS(0xF4),
             CONFIG(0xF5), PRESS_MSB(0xF7..0xF9), TEMP_MSB(0xFA..0xFC),
             Trimming params: 0x88..0x9F
   ─────────────────────────────────────────────────────────────────────────── */
class BMP280 extends I2CSlave {
  constructor(bus) {
    super(0x76, 'BMP280 Baro', bus, 5);
    this.registers[0xD0] = 0x60; // chip_id = 0x60 (BMP280)
    this.registers[0xF3] = 0x00; // status: not measuring
    this.registers[0xF4] = 0xB7; // ctrl_meas: osrs_t=4, osrs_p=4, mode=normal
    this.registers[0xF5] = 0x10; // config: t_sb=0.5ms, filter=off, spi3w=off
    // Simulated raw press ~1013 hPa, temp ~25°C (arbitrary uncompensated ADC)
    this.registers[0xF7] = 0x65; // press_msb
    this.registers[0xF8] = 0x24; // press_lsb
    this.registers[0xF9] = 0x00; // press_xlsb
    this.registers[0xFA] = 0x7E; // temp_msb
    this.registers[0xFB] = 0xA0; // temp_lsb
    this.registers[0xFC] = 0x00; // temp_xlsb
    // Seed trimming params (realistic values)
    this.registers[0x88] = 0x70; this.registers[0x89] = 0x6B; // T1=27504
    this.registers[0x8A] = 0x43; this.registers[0x8B] = 0x67; // T2=26435
    this.registers[0x8C] = 0x18; this.registers[0x8D] = 0xFC; // T3=-32760? keep simple
  }

  decode(reg, value) {
    const map = {
      0xD0: () => `Chip ID → 0x${value.toString(16).toUpperCase()} ${value === 0x60 ? '✔ BMP280' : value === 0x58 ? '✔ BME280' : '✘ unknown'}`,
      0xF3: () => `Status → measuring=${(value>>3)&1} im_update=${value&1}`,
      0xF4: () => {
        const osrsT = (value >> 5) & 7, osrsP = (value >> 2) & 7, mode = value & 3;
        const ovStr = ['skipped','×1','×2','×4','×8','×16'];
        return `ctrl_meas → osrs_t=${ovStr[osrsT]||osrsT} osrs_p=${ovStr[osrsP]||osrsP} mode=${['sleep','forced','forced','normal'][mode]}`;
      },
      0xF5: () => `Config → t_sb=${(value>>5)&7} filter=${(value>>2)&7} spi3w=${value&1}`,
      0xF7: () => `Press MSB[19:12] → 0x${value.toString(16).toUpperCase().padStart(2,'0')}`,
      0xF8: () => `Press LSB[11:4]  → 0x${value.toString(16).toUpperCase().padStart(2,'0')}`,
      0xFA: () => `Temp MSB[19:12]  → 0x${value.toString(16).toUpperCase().padStart(2,'0')}`,
      0xFB: () => `Temp LSB[11:4]   → 0x${value.toString(16).toUpperCase().padStart(2,'0')}`,
    };
    if (reg >= 0x88 && reg <= 0x9F) return `Trim param T/P cal[${reg - 0x88}] → 0x${value.toString(16).toUpperCase().padStart(2,'0')}`;
    return map[reg] ? map[reg]() : `BMP280 reg 0x${reg.toString(16).toUpperCase().padStart(2,'0')} = 0x${value.toString(16).toUpperCase().padStart(2,'0')}`;
  }

  get meta() {
    return { category: 'Sensor', infoTag: 'Barometer', icon: '🌡' };
  }
}

/* ─────────────────────── 6. PCF8574 GPIO Expander ─────────────────────────
   Address: 0x20 (A2=A1=A0=0) up to 0x27
   Real part: NXP PCF8574 — 8-bit I²C I/O expander
   Single byte read/write: byte = pin state P7..P0
   No register address — data byte IS the port state
   ─────────────────────────────────────────────────────────────────────────── */
class PCF8574 extends I2CSlave {
  constructor(bus) {
    super(0x20, 'PCF8574 GPIO', bus, 6);
    this.registers[0x00] = 0xFF; // all pins HIGH (quasi-bidirectional default)
  }

  decode(reg, value) {
    const pins = [];
    for (let i = 7; i >= 0; i--) pins.push(`P${i}=${(value >> i) & 1}`);
    return `Port byte → [${pins.join(' ')}]`;
  }

  get meta() {
    return { category: 'I/O', infoTag: '8-Bit Expander', icon: '🔌' };
  }
}

/* ─────────────────────── 7. MCP4725 DAC ───────────────────────────────────
   Address: 0x60 (A2=A1=A0=0)
   Real part: Microchip MCP4725 — 12-bit I²C DAC with EEPROM
   Write: [C2 C1 C0 PD1 PD0 _ D11 D10] [D9..D2] [D1 D0 _ _ _ _ _ _]
   Fast write: [C2 C1 PD1 PD0 D11 D10 D9 D8] [D7..D0]
   ─────────────────────────────────────────────────────────────────────────── */
class MCP4725 extends I2CSlave {
  constructor(bus) {
    super(0x60, 'MCP4725 DAC', bus, 7);
    // Output = 2048 → 1.65V (midscale on 3.3V ref)
    this.registers[0x00] = 0x40; // status: RDY=1, POR=0, PD=00, EEPROM PD=00
    this.registers[0x01] = 0x80; // DAC high: D11..D4 = 0x80 → DAC = 0x800 = 2048
    this.registers[0x02] = 0x00; // DAC low:  D3..D0 = 0
  }

  decode(reg, value) {
    const map = {
      0x00: () => `Status → RDY=${(value>>7)&1} POR=${(value>>6)&1} PD=${(value>>1)&3}`,
      0x01: () => {
        const dacHigh = value; // D11..D4
        return `DAC data[11:4] → 0x${dacHigh.toString(16).toUpperCase().padStart(2,'0')}`;
      },
      0x02: () => `DAC data[3:0]  → ${(value >> 4) & 0xF} (lower nibble)`,
    };
    return map[reg] ? map[reg]() : `MCP4725 byte → 0x${value.toString(16).toUpperCase().padStart(2,'0')}`;
  }

  get meta() {
    return { category: 'Analog', infoTag: '12-bit DAC', icon: '📉' };
  }
}

/* ─────────────────────── 8. ADS1115 ADC ───────────────────────────────────
   Address: 0x48 (ADDR=GND)
   Real part: TI ADS1115 — 16-bit 4-ch I²C ADC with PGA
   Registers: Conversion(0x00,2B), Config(0x01,2B), Lo/Hi thresh(0x02/0x03)
   Config byte 1: OS MUX[2:0] PGA[2:0] MODE
   ─────────────────────────────────────────────────────────────────────────── */
class ADS1115 extends I2CSlave {
  constructor(bus) {
    super(0x48, 'ADS1115 ADC', bus, 8);
    // Config: AIN0-AIN1 differential, PGA=±2.048V, single-shot, 128 SPS
    this.registers[0x00] = 0x7F; // conv MSB → ~16383 (near full-scale)
    this.registers[0x01] = 0xFF; // conv LSB
    this.registers[0x02] = 0x85; // config[15:8]: OS=1 MUX=000 PGA=010 MODE=1
    this.registers[0x03] = 0x83; // config[7:0]:  DR=100 COMP_MODE=0 COMP_POL=0 COMP_LAT=0 COMP_QUE=11
    this.registers[0x04] = 0x80; this.registers[0x05] = 0x00; // lo_thresh = -32768
    this.registers[0x06] = 0x7F; this.registers[0x07] = 0xFF; // hi_thresh = +32767
  }

  decode(reg, value) {
    const pgaV = [6.144, 4.096, 2.048, 1.024, 0.512, 0.256];
    const drSps = [8, 16, 32, 64, 128, 250, 475, 860];
    if (reg === 0x00) return `Conversion MSB → raw[15:8] = 0x${value.toString(16).toUpperCase().padStart(2,'0')}`;
    if (reg === 0x01) return `Conversion LSB → raw[7:0]  = 0x${value.toString(16).toUpperCase().padStart(2,'0')}`;
    if (reg === 0x02) {
      const muxNames = ['AIN0-AIN1','AIN0-AIN3','AIN1-AIN3','AIN2-AIN3','AIN0-GND','AIN1-GND','AIN2-GND','AIN3-GND'];
      const pga = (value >> 1) & 7;
      const mux = (value >> 4) & 7;
      return `Config[H] → OS=${(value>>7)&1} MUX=${muxNames[mux]} PGA=±${pgaV[pga]||'?'}V MODE=${value&1?'single':'cont'}`;
    }
    if (reg === 0x03) {
      const dr = (value >> 5) & 7;
      return `Config[L] → DR=${drSps[dr]||'?'}SPS COMP_QUE=${value&3===3?'disabled':value&3}`;
    }
    return `ADS1115 reg 0x${reg.toString(16).toUpperCase().padStart(2,'0')} = 0x${value.toString(16).toUpperCase().padStart(2,'0')}`;
  }

  get meta() {
    return { category: 'Analog', infoTag: '16-bit 4-ch ADC', icon: '📊' };
  }
}

/* ═══════════════════════ DEVICE REGISTRY ════════════════════════════════════
   Canonical list of all available devices.
   Each entry: { id, cls, address, name, meta }
   'active' is set at runtime by app.js
   ═══════════════════════════════════════════════════════════════════════════ */
const DEVICE_REGISTRY = [
  { id: 'eeprom',   cls: EEPROM,   address: 0x50, name: 'AT24C256 EEPROM' },
  { id: 'rtc',      cls: RTC,      address: 0x68, name: 'DS3231 RTC'       },
  { id: 'oled',     cls: OLED,     address: 0x3C, name: 'SSD1306 OLED'     },
  { id: 'imu',      cls: MPU6050,  address: 0x69, name: 'MPU-6050 IMU'     },
  { id: 'baro',     cls: BMP280,   address: 0x76, name: 'BMP280 Baro'      },
  { id: 'gpio_exp', cls: PCF8574,  address: 0x20, name: 'PCF8574 GPIO'     },
  { id: 'dac',      cls: MCP4725,  address: 0x60, name: 'MCP4725 DAC'      },
  { id: 'adc',      cls: ADS1115,  address: 0x48, name: 'ADS1115 ADC'      },
];
