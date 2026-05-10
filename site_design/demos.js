/**
 * demos.js — Pre-configured Demo Scenarios for Practical Demonstration
 * 
 * Each demo uses actual devices from the Device Library (EEPROM, RTC, OLED,
 * IMU, Barometer, GPIO, DAC, ADC) with real-world use cases.
 */

'use strict';

const DEMO_SCENARIOS = [
  // ───────────────────────────────────────────────────────────────
  //  DEMO 1: OLED Display — "Hello World" (from lecture slides)
  // ───────────────────────────────────────────────────────────────
  {
    id: 'demo-oled-hello',
    title: '1. OLED Display — Send Command',
    icon: '🖥',
    category: 'Device Communication',
    description: 'Arduino (Master) sends a display command to SSD1306 OLED at 0x3C. Shows the full I²C conversation: START → Address → ACK → Command → ACK → STOP.',
    steps: [
      '1. Master wants to control the OLED display',
      '2. Sends START signal on SDA line',
      '3. Calls OLED by its address 0x3C',
      '4. OLED replies "Yes, I\'m listening!" (ACK)',
      '5. Master sends command: set contrast to 0xCF',
      '6. OLED acknowledges the command',
      '7. Master sends STOP — conversation ends'
    ],
    config: { address: '3C', mode: 'WRITE', register: '81', data: 'CF', speed: 3, freq: 100000, devices: ['eeprom', 'oled'] },
    commentary: [
      { level: 'info',  msg: '━━━ DEMO: OLED Display Command (SSD1306 @ 0x3C) ━━━' },
      { level: 'info',  msg: 'Scenario: Arduino wants to set OLED contrast to 0xCF (81%)' },
      { level: 'info',  msg: 'Step 1: Master sends START — claims the I²C bus' },
      { level: 'info',  msg: 'Step 2: Address byte 0x78 (0x3C << 1 | W) — selects the OLED' },
      { level: 'info',  msg: 'Step 3: OLED pulls SDA LOW on 9th clock — ACK, it\'s listening' },
      { level: 'info',  msg: 'Step 4: Register 0x81 = Contrast Control command' },
      { level: 'info',  msg: 'Step 5: Data 0xCF = contrast value (81% brightness)' },
      { level: 'info',  msg: 'Step 6: STOP — conversation ends, bus released' },
    ]
  },

  // ───────────────────────────────────────────────────────────────
  //  DEMO 2: EEPROM — Write and Store Data
  // ───────────────────────────────────────────────────────────────
  {
    id: 'demo-eeprom-write',
    title: '2. EEPROM — Write Data to Memory',
    icon: '💾',
    category: 'Device Communication',
    description: 'Write 4 bytes (0xDE 0xAD 0xBE 0xEF) to AT24C256 EEPROM at address 0x50. Demonstrates non-volatile data storage over I²C — like saving settings or calibration data.',
    steps: [
      '1. Master addresses EEPROM at 0x50 (WRITE mode)',
      '2. Sends register address 0x00 (where to store)',
      '3. Sends 4 data bytes: 0xDE 0xAD 0xBE 0xEF',
      '4. Each byte gets an ACK from EEPROM',
      '5. STOP — data is now stored in non-volatile memory'
    ],
    config: { address: '50', mode: 'WRITE', register: '00', data: 'DE AD BE EF', speed: 3, freq: 100000, devices: ['eeprom', 'oled'] },
    commentary: [
      { level: 'info',  msg: '━━━ DEMO: EEPROM Write (AT24C256 @ 0x50) ━━━' },
      { level: 'info',  msg: 'Scenario: Storing 4 bytes in non-volatile memory' },
      { level: 'info',  msg: 'Real use: saving Wi-Fi credentials, sensor calibration, device ID' },
      { level: 'info',  msg: 'Watch the decode bar: START → 0xA0 W → ACK → REG:0x00 → ACK → data bytes → STOP' },
    ]
  },

  // ───────────────────────────────────────────────────────────────
  //  DEMO 3: EEPROM — Read Data Back
  // ───────────────────────────────────────────────────────────────
  {
    id: 'demo-eeprom-read',
    title: '3. EEPROM — Read Data Back',
    icon: '💾',
    category: 'Device Communication',
    description: 'Read 4 bytes from EEPROM to verify stored data. Uses Repeated START to switch from write (register pointer) to read (data) without releasing the bus.',
    steps: [
      '1. Master addresses EEPROM at 0x50 (WRITE mode) to set register pointer',
      '2. Sends register address 0x00',
      '3. Repeated START (Sr) — switches to READ without releasing bus',
      '4. Reads 4 bytes, each acknowledged by Master',
      '5. Last byte gets NACK (signals end of read)',
      '6. STOP — bus released'
    ],
    config: { address: '50', mode: 'READ', register: '00', data: '4', speed: 3, freq: 100000, devices: ['eeprom', 'oled'] },
    commentary: [
      { level: 'info',  msg: '━━━ DEMO: EEPROM Read-Back (AT24C256 @ 0x50) ━━━' },
      { level: 'info',  msg: 'Scenario: Reading back stored data to verify integrity' },
      { level: 'info',  msg: 'Key concept: Repeated START — master sends register address (write), then reads data without releasing bus' },
      { level: 'info',  msg: 'Watch: Address byte changes from 0xA0 (write) to 0xA1 (read) after Sr' },
    ]
  },

  // ───────────────────────────────────────────────────────────────
  //  DEMO 4: RTC — Read Time Registers
  // ───────────────────────────────────────────────────────────────
  {
    id: 'demo-rtc-time',
    title: '4. RTC — Read Current Time',
    icon: '🕐',
    category: 'Device Communication',
    description: 'Read all 7 time/date registers from DS3231 RTC. Shows BCD-encoded time decoding — seconds, minutes, hours, day, date, month, year.',
    steps: [
      '1. Address DS3231 at 0x68, set register pointer to 0x00',
      '2. Repeated START — switch to READ mode',
      '3. Read 7 consecutive bytes (register auto-increments)',
      '4. Terminal decodes BCD: Seconds, Minutes, Hours, Day, Date, Month, Year',
      '5. Last byte NACK → STOP'
    ],
    config: { address: '68', mode: 'READ', register: '00', data: '7', speed: 4, freq: 100000, devices: ['eeprom', 'rtc', 'oled'] },
    commentary: [
      { level: 'info',  msg: '━━━ DEMO: RTC Time Read (DS3231 @ 0x68) ━━━' },
      { level: 'info',  msg: 'Scenario: Reading current time from a real-time clock chip' },
      { level: 'info',  msg: 'DS3231 stores time in BCD (Binary Coded Decimal) format' },
      { level: 'info',  msg: 'Watch terminal: each byte is decoded → Seconds: 55, Minutes: 41, Hours: 09...' },
    ]
  },

  // ───────────────────────────────────────────────────────────────
  //  DEMO 5: GPIO — Toggle LED Pins
  // ───────────────────────────────────────────────────────────────
  {
    id: 'demo-gpio-leds',
    title: '5. GPIO Expander — Toggle LED Pins',
    icon: '🔌',
    category: 'Device Communication',
    description: 'Write pin patterns to PCF8574 GPIO Expander at 0x20. Each bit controls one physical pin — like toggling LEDs or reading switches over I²C.',
    steps: [
      '1. Address PCF8574 at 0x20 (WRITE)',
      '2. Write 0xAA = alternating pattern (10101010)',
      '3. Terminal decodes: P7=1 P6=0 P5=1 P4=0 P3=1 P2=0 P1=1 P0=0',
      '4. In real hardware: 4 LEDs ON, 4 LEDs OFF'
    ],
    config: { address: '20', mode: 'WRITE', register: '00', data: 'AA', speed: 4, freq: 100000, devices: ['eeprom', 'oled', 'gpio_exp'] },
    commentary: [
      { level: 'info',  msg: '━━━ DEMO: GPIO Pin Control (PCF8574 @ 0x20) ━━━' },
      { level: 'info',  msg: 'Scenario: Toggling 8 LEDs connected to a GPIO expander via I²C' },
      { level: 'info',  msg: 'Writing 0xAA = 10101010 → alternating pin pattern' },
      { level: 'info',  msg: 'PCF8574 is register-less — the data byte IS the port state' },
    ]
  },

  // ───────────────────────────────────────────────────────────────
  //  DEMO 6: Bus Scan — Discover All Devices
  // ───────────────────────────────────────────────────────────────
  {
    id: 'demo-bus-scan',
    title: '6. Bus Scan — Device Discovery',
    icon: '🔍',
    category: 'Diagnostics',
    description: 'Scan the entire I²C bus (0x03–0x77) to find all connected devices. Equivalent to Linux "i2cdetect -y 1". Green = device found (ACK), Grey = empty (NACK).',
    steps: [
      '1. Probes every valid address (0x03 to 0x77)',
      '2. Sends address byte, checks for ACK on 9th clock',
      '3. ACK = device present, NACK = no device',
      '4. Results shown in 16-column hex grid',
      '5. Summary lists all found devices'
    ],
    config: { scan: true, devices: ['eeprom', 'rtc', 'oled', 'gpio_exp', 'dac'] },
    commentary: [
      { level: 'info',  msg: '━━━ DEMO: I²C Bus Scan (Device Discovery) ━━━' },
      { level: 'info',  msg: 'Equivalent to Linux command: i2cdetect -y 1' },
      { level: 'info',  msg: 'Green cells = device responded with ACK at that address' },
    ]
  },

  // ───────────────────────────────────────────────────────────────
  //  DEMO 7: NACK — Device Not Found
  // ───────────────────────────────────────────────────────────────
  {
    id: 'demo-nack-error',
    title: '7. NACK — Addressing Missing Device',
    icon: '🚫',
    category: 'Error Handling',
    description: 'Try to communicate with a device at 0x55 (no device exists). Shows what NACK looks like on the waveform and how the master handles the error gracefully.',
    steps: [
      '1. Master sends START + address 0x55',
      '2. No device at 0x55 → nobody pulls SDA LOW',
      '3. SDA stays HIGH on 9th clock = NACK',
      '4. Master detects NACK, sends STOP to release bus',
      '5. Error logged: "device not found or not responding"'
    ],
    config: { address: '55', mode: 'WRITE', register: '00', data: 'FF', speed: 3, freq: 100000, devices: ['eeprom', 'oled'] },
    commentary: [
      { level: 'info',  msg: '━━━ DEMO: NACK Error — No Device at 0x55 ━━━' },
      { level: 'info',  msg: 'Scenario: Master tries to talk to a device that doesn\'t exist' },
      { level: 'info',  msg: 'Watch the waveform: SDA stays HIGH during the 9th clock (ACK window)' },
      { level: 'info',  msg: 'Master detects NACK and sends STOP — proper error recovery' },
    ]
  },

  // ───────────────────────────────────────────────────────────────
  //  DEMO 8: Fault Injection — SDA Glitch (EMI)
  // ───────────────────────────────────────────────────────────────
  {
    id: 'demo-fault-glitch',
    title: '8. Fault Injection — SDA Glitch',
    icon: '⚡',
    category: 'Fault Testing',
    description: 'Inject an EMI spike on SDA during a write to EEPROM. Shows data corruption on the waveform and timing violation detection.',
    steps: [
      '1. Fault injector armed: SDA Glitch at bit 3',
      '2. Master starts writing to EEPROM',
      '3. At bit 3, SDA briefly flips to opposite value',
      '4. Glitch visible on waveform as a narrow spike',
      '5. Timing checker flags t_SU;DAT violation'
    ],
    config: { address: '50', mode: 'WRITE', register: '00', data: 'A5', speed: 2, freq: 100000, devices: ['eeprom', 'oled'], fault: { type: 'SDA_GLITCH', params: { afterBit: 3 } } },
    commentary: [
      { level: 'info',  msg: '━━━ DEMO: SDA Glitch Fault Injection ━━━' },
      { level: 'info',  msg: 'Scenario: EMI spike corrupts SDA during EEPROM write' },
      { level: 'info',  msg: 'Real cause: nearby motors, RF noise, poor grounding on PCB' },
      { level: 'info',  msg: 'Watch for the glitch spike on SDA and the yellow ⚠ timing violation marker' },
    ]
  },

  // ───────────────────────────────────────────────────────────────
  //  DEMO 9: Fault Injection — Clock Stretching
  // ───────────────────────────────────────────────────────────────
  {
    id: 'demo-clock-stretch',
    title: '9. Fault Injection — Clock Stretch',
    icon: '⏱',
    category: 'Fault Testing',
    description: 'EEPROM holds SCL LOW for 500ms to pause the master (simulating slow page-write). Shows how clock stretching works and triggers timing violations.',
    steps: [
      '1. Fault injector armed: Clock Stretch 500ms',
      '2. Master starts writing to EEPROM',
      '3. EEPROM holds SCL LOW — master must wait',
      '4. After 500ms, SCL releases and transaction resumes',
      '5. Timing checker flags TIMING_SCL_LOW violation'
    ],
    config: { address: '50', mode: 'WRITE', register: '00', data: 'FF', speed: 3, freq: 100000, devices: ['eeprom', 'oled'], fault: { type: 'CLOCK_STRETCH', params: { stretchMs: 500 } } },
    commentary: [
      { level: 'info',  msg: '━━━ DEMO: Clock Stretching (500ms) ━━━' },
      { level: 'info',  msg: 'Scenario: EEPROM is busy with internal page-write, holds SCL LOW' },
      { level: 'info',  msg: 'Real scenario: AT24C256 has a 5ms page-write cycle — bus must wait' },
      { level: 'info',  msg: 'Watch: SCL stays LOW for an abnormally long time, then resumes' },
    ]
  },

  // ───────────────────────────────────────────────────────────────
  //  DEMO 10: IMU — Read Sensor Data
  // ───────────────────────────────────────────────────────────────
  {
    id: 'demo-imu-read',
    title: '10. IMU — Read Accelerometer Data',
    icon: '📐',
    category: 'Device Communication',
    description: 'Read accelerometer X/Y/Z data from MPU-6050 IMU at 0x69. Shows multi-byte sensor read with register-level decode of raw acceleration values.',
    steps: [
      '1. Address MPU-6050 at 0x69, register 0x3B (ACCEL_XOUT_H)',
      '2. Repeated START → switch to READ',
      '3. Read 6 bytes: X_H, X_L, Y_H, Y_L, Z_H, Z_L',
      '4. Terminal decodes: high/low bytes of each axis',
      '5. Real use: motion detection, tilt sensing, step counting'
    ],
    config: { address: '69', mode: 'READ', register: '3B', data: '6', speed: 4, freq: 100000, devices: ['eeprom', 'oled', 'imu'] },
    commentary: [
      { level: 'info',  msg: '━━━ DEMO: IMU Accelerometer Read (MPU-6050 @ 0x69) ━━━' },
      { level: 'info',  msg: 'Scenario: Reading 3-axis acceleration data from a motion sensor' },
      { level: 'info',  msg: 'Register 0x3B = ACCEL_XOUT_H — start of 6-byte burst read' },
      { level: 'info',  msg: 'Used in: drones, fitness trackers, game controllers, image stabilization' },
    ]
  },
];

/**
 * Run a demo scenario by ID.
 * Sets up config, logs commentary, then executes the transaction.
 */
async function runDemo(demoId) {
  if (_running || _scanning) {
    log('warn', 'Cannot start demo — transaction in progress');
    return;
  }

  const demo = DEMO_SCENARIOS.find(d => d.id === demoId);
  if (!demo) { log('error', `Demo not found: ${demoId}`); return; }

  // Reset first
  resetAll();
  await sleep(200);

  // Configure devices
  if (demo.config.devices) {
    activeDeviceIds = new Set(demo.config.devices);
    rebuildSlaves();
    buildDeviceLibraryPanel();
    buildActiveDeviceCards();
  }

  // Log commentary
  demo.commentary.forEach(c => {
    log(c.level, c.msg);
  });

  // Special case: bus scan
  if (demo.config.scan) {
    await sleep(300);
    openScanModal();
    startBusScan();
    return;
  }

  // Set configuration
  if (demo.config.address) document.getElementById('addr-input').value = demo.config.address;
  if (demo.config.register) document.getElementById('reg-input').value = demo.config.register;
  if (demo.config.data) document.getElementById('data-input').value = demo.config.data;
  if (demo.config.mode) setMode(demo.config.mode);
  if (demo.config.freq) setFreq(demo.config.freq);
  if (demo.config.speed) setSpeed(demo.config.speed);

  // Arm fault if specified
  if (demo.config.fault) {
    faultInjector.arm(demo.config.fault.type, demo.config.fault.params);
    document.getElementById('fault-status').textContent = `⚡ Armed: ${demo.config.fault.type}`;
    document.getElementById('fault-status').className = 'fault-status fault-status--armed';
    document.getElementById('btn-arm-fault').disabled = true;
    document.getElementById('btn-disarm-fault').disabled = false;
    const ft = FAULT_TYPES.find(f => f.id === demo.config.fault.type);
    if (ft) {
      document.getElementById('fault-type-select').value = demo.config.fault.type;
      log('warn', `Fault armed: ${ft.icon} ${ft.label}`);
    }
  }

  // Wait a beat then start
  await sleep(400);
  startTransaction();
}

/**
 * Build the demo panel in the sidebar
 */
function buildDemoPanel() {
  const container = document.getElementById('demo-scenarios-list');
  if (!container) return;
  container.innerHTML = '';

  const categories = [...new Set(DEMO_SCENARIOS.map(d => d.category))];
  
  categories.forEach(cat => {
    const catHeader = document.createElement('div');
    catHeader.className = 'demo-category-header';
    catHeader.textContent = cat;
    container.appendChild(catHeader);

    DEMO_SCENARIOS.filter(d => d.category === cat).forEach(demo => {
      const card = document.createElement('div');
      card.className = 'demo-card';
      card.id = demo.id;
      card.innerHTML = `
        <div class="demo-card__header">
          <span class="demo-card__icon">${demo.icon}</span>
          <span class="demo-card__title">${demo.title}</span>
        </div>
        <p class="demo-card__desc">${demo.description}</p>
        <button class="exec-btn exec-btn--demo" onclick="runDemo('${demo.id}')">
          ▶ Run Demo
        </button>`;
      container.appendChild(card);
    });
  });
}
