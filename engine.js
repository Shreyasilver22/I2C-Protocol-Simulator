/**
 * engine.js — I²C Hardware Emulation Engine (v3.0)
 * VirtualBus (open-drain wired-AND), Master state machine, Slave base class.
 *
 * Slave device subclasses are defined in devices.js and loaded after this file.
 */

'use strict';

/* ═══════════════════════ UTILITIES ══════════════════════════ */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ═══════════════════════ VIRTUAL BUS ════════════════════════ */
class VirtualBus {
  constructor(maxSamples = 600) {
    this._scl = [];
    this._sda = [];
    this.sclHistory = [];
    this.sdaHistory = [];
    this.maxSamples = maxSamples;
    this.annotations = []; // [{index, type, label}]
    this.timingViolations = []; // [{sampleIndex, type, message, severity}]
  }

  // Open-drain wired-AND: line is LOW if any driver pulls low
  // Filter out undefined holes from sparse arrays (e.g. when slave at slotId=2
  // ACKs but slotId=1 is unset because that device didn't respond)
  get SCL() { const v = this._scl.filter(x => x !== undefined); return v.length === 0 ? 1 : Math.min(...v); }
  get SDA() { const v = this._sda.filter(x => x !== undefined); return v.length === 0 ? 1 : Math.min(...v); }

  setMasterSCL(val) { this._scl[0] = val; }
  setMasterSDA(val) { this._sda[0] = val; }
  setSlaveAck(id, val) { this._sda[id] = val; }
  releaseSlaveAck(id) { delete this._sda[id]; this._sda = this._sda.filter(_ => true); }

  sample(annotation) {
    const idx = this.sclHistory.length;
    this.sclHistory.push(this.SCL);
    this.sdaHistory.push(this.SDA);
    if (annotation) this.annotations.push({ index: idx, ...annotation });
    if (this.sclHistory.length > this.maxSamples) {
      this.sclHistory.shift();
      this.sdaHistory.shift();
      const trim = (arr) => arr
        .map(a => ({ ...a, index: a.index - 1 }))
        .filter(a => a.index >= 0);
      this.annotations = trim(this.annotations);
      this.timingViolations = trim(this.timingViolations);
    }
  }

  /** Register a timing violation at the current sample index */
  addTimingViolation(violation) {
    const idx = Math.max(0, this.sclHistory.length - 1);
    this.timingViolations.push({ ...violation, index: idx });
  }

  reset() {
    this._scl = []; this._sda = [];
    this.sclHistory = []; this.sdaHistory = [];
    this.annotations = [];
    this.timingViolations = [];
    this.setMasterSCL(1); this.setMasterSDA(1);
    this.sample();
  }
}

/* ═══════════════════════ SLAVE BASE CLASS ════════════════════════
   Subclasses are in devices.js. This base provides the I²C mechanics.
   Each device subclass must implement:
     - decode(reg, value) → string   (register interpretation)
     - get meta() → {category, infoTag, icon}
   ════════════════════════════════════════════════════════════════ */
class I2CSlave {
  constructor(address, name, bus, slotId) {
    this.address = address;
    this.name = name;
    this.bus = bus;
    this.slotId = slotId;
    this.registers = new Uint8Array(256);
    this.state = 'LISTENING';
  }

  matches(addrByte) {
    const addr7 = addrByte >> 1;
    return addr7 === this.address;
  }

  async ack() {
    this.state = 'ACK';
    this.bus.setSlaveAck(this.slotId, 0);
  }

  releaseAck() {
    this.bus.releaseSlaveAck(this.slotId);
    this.state = 'LISTENING';
  }

  readRegister(reg)      { return this.registers[reg & 0xFF]; }
  writeRegister(reg, val){ this.registers[reg & 0xFF] = val & 0xFF; }

  /** Drive a bit onto SDA (used during master READ — slave sends data) */
  driveBit(bit) { this.bus.setSlaveAck(this.slotId, bit); }
  /** Release SDA after master has sampled */
  releaseDrive() { this.bus.releaseSlaveAck(this.slotId); }

  // Default decode — subclasses override with richer output
  decode(reg, value) {
    return `reg 0x${reg.toString(16).toUpperCase().padStart(2,'0')} = 0x${value.toString(16).toUpperCase().padStart(2,'0')}`;
  }

  get meta() {
    return { category: 'Generic', infoTag: 'I²C Slave', icon: '🔲' };
  }
}

/* ═══════════════════════ I2C MASTER ════════════════════════ */
class I2CMaster {
  constructor(bus, slaves, options = {}) {
    this.bus = bus;
    this.slaves = slaves;
    this.clockHz = options.clockHz || 100000;
    this.state = 'IDLE';
    this._paused = false;
    this._aborted = false;
    this.clockInterval = 16; // ms per tick, overridden by speed slider
    this.faultInjector = null; // set by app.js after construction
    this.onStateChange = null;
    this.onLog = null;
    this.onSample = null;
    this.onAnnotation = null;
    this.onDecodeChip = null;
  }

  get halfPeriodMs() {
    return (1 / this.clockHz) * 500;
  }

  _setState(s) {
    this.state = s;
    if (this.onStateChange) this.onStateChange(s);
  }

  _log(level, msg) { if (this.onLog) this.onLog(level, msg); }

  async _tick(annotation) {
    if (this._aborted) throw new Error('ABORT');
    while (this._paused && !this._aborted) await sleep(50);
    if (this._aborted) throw new Error('ABORT');

    // ── Fault: BUS_STUCK_LOW ──
    if (this.faultInjector && this.faultInjector.checkBusStuck()) {
      this.bus.setMasterSDA(0); // force SDA to ground
    }

    // ── Fault: CLOCK_STRETCH (fires once per transaction) ──
    const stretch = this.faultInjector ? this.faultInjector.checkClockStretch() : 0;
    if (stretch > 0) {
      this.bus.setMasterSCL(0); // hold SCL low
      this.bus.sample({ type: 'fault', label: 'STRETCH' });
      if (this.onSample) this.onSample();
      await sleep(stretch);
    }

    this.bus.sample(annotation);
    if (this.onSample) this.onSample();
    await sleep(this.clockInterval || 4);
  }

  // ── Low-level bit operations ──

  async _start() {
    this.bus.setMasterSDA(1);
    this.bus.setMasterSCL(1);
    await this._tick();
    await this._tick();
    await this._tick(); // 3 ticks bus free or repeated start setup (t_SU;STA)
    this.bus.setMasterSDA(0);
    await this._tick({ type: 'start', label: 'S' });
    await this._tick();
    await this._tick(); // 3 ticks start hold (t_HD;STA)
    this.bus.setMasterSCL(0);
    await this._tick();
    this._log('proto', 'START condition generated');
    if (this.onDecodeChip) this.onDecodeChip('start', 'START');
  }

  async _stop() {
    this.bus.setMasterSDA(0);
    this.bus.setMasterSCL(0);
    await this._tick();
    this.bus.setMasterSCL(1);
    await this._tick();
    await this._tick();
    await this._tick(); // 3 ticks stop setup (t_SU;STO)
    this.bus.setMasterSDA(1);
    await this._tick({ type: 'stop', label: 'P' });
    await this._tick(); // bus free
    this._log('proto', 'STOP condition generated');
    if (this.onDecodeChip) this.onDecodeChip('stop', 'STOP');
  }

  async _writeBit(bit, bitIndex, byteIndex) {
    // ── Fault: SDA_GLITCH / PARTIAL_BYTE ──
    if (this.faultInjector) {
      const { glitch, abort } = this.faultInjector.checkBit(bitIndex ?? 0, byteIndex ?? 0);
      if (abort) throw new Error('ABORT');
      if (glitch) {
        // Drive the opposite value briefly, then restore
        this.bus.setMasterSDA(bit ^ 1);
        await this._tick({ type: 'fault', label: 'GLITCH' }); // Q1
        this.bus.setMasterSDA(bit); // restore correct bit
        await this._tick(); // Q2
        this.bus.setMasterSCL(1);
        await this._tick(); // Q3
        await this._tick(); // Q4
        this.bus.setMasterSCL(0);
        await this._tick(); // Q5
        return;
      }
    }
    this.bus.setMasterSDA(bit);
    await this._tick(); // Q1 (SDA settles, SCL is low)
    await this._tick(); // Q2
    this.bus.setMasterSCL(1);
    await this._tick(); // Q3 (SCL high)
    await this._tick(); // Q4
    this.bus.setMasterSCL(0);
    await this._tick(); // Q5 (SCL goes low, hold SDA)
  }

  async _readBit() {
    this.bus.setMasterSDA(1);
    await this._tick(); // Q1
    await this._tick(); // Q2
    this.bus.setMasterSCL(1);
    await this._tick(); // Q3
    const bit = this.bus.SDA;
    await this._tick(); // Q4
    this.bus.setMasterSCL(0);
    await this._tick(); // Q5
    return bit;
  }

  async _writeByte(byte, annotation, byteIndex = 0) {
    const bits = [];
    for (let i = 7; i >= 0; i--) {
      const b = (byte >> i) & 1;
      bits.push(b);
      await this._writeBit(b, 7 - i, byteIndex);
    }
    if (annotation && this.onAnnotation) this.onAnnotation(annotation.type, annotation.label);
    return bits;
  }

  async _readAck(slave) {
    this.bus.setMasterSDA(1);
    // ── Fault: NACK_STORM — skip slave.ack() so SDA stays HIGH ──
    const forceNack = this.faultInjector && this.faultInjector.checkAck();
    if (!forceNack && slave) slave.ack();
    await this._tick(); // Q1
    await this._tick(); // Q2
    this.bus.setMasterSCL(1);
    await this._tick(); // Q3
    const ack = this.bus.SDA;
    await this._tick(); // Q4
    this.bus.setMasterSCL(0);
    if (slave) slave.releaseAck();
    await this._tick(); // Q5
    if (forceNack) return false; // always NACK when storm active
    return ack === 0;
  }

  async _sendAck()  { await this._writeBit(0); }
  async _sendNack() { await this._writeBit(1); }

  // ── High-level WRITE transaction ──

  async runWrite(addr7, regAddr, dataBytes) {
    this._aborted = false;
    this._paused = false;
    const addrByte = (addr7 << 1) | 0;

    this._setState('START');
    await this._start();

    this._setState('ADDRESS');
    const slave = this.slaves.find(s => s.address === addr7);
    this._log('info', `Addressing 0x${addr7.toString(16).toUpperCase().padStart(2,'0')} (WRITE) — ${slave ? slave.name : 'Unknown device'}`);
    await this._writeByte(addrByte);
    if (this.onDecodeChip) this.onDecodeChip('addr', `0x${addrByte.toString(16).toUpperCase().padStart(2,'0')} W`);

    this._setState('ACK_CHECK');
    const acked = await this._readAck(slave);
    if (!acked) {
      this._log('error', `NACK from 0x${addr7.toString(16).toUpperCase()} — device not found or not responding`);
      if (this.onDecodeChip) this.onDecodeChip('nack', 'NACK');
      await this._stop();
      this._setState('IDLE');
      return false;
    }
    this._log('success', `ACK received — ${slave ? slave.name : 'device'} responded`);
    if (this.onDecodeChip) this.onDecodeChip('ack', 'ACK');

    // Send register address
    this._setState('DATA_TRANSFER');
    await this._writeByte(regAddr);
    if (this.onDecodeChip) this.onDecodeChip('addr', `REG:0x${regAddr.toString(16).toUpperCase().padStart(2,'0')}`);
    await this._readAck(slave);
    if (this.onDecodeChip) this.onDecodeChip('ack', 'ACK');

    // Send data bytes with decoded field names
    for (let i = 0; i < dataBytes.length; i++) {
      const d = dataBytes[i];
      slave && slave.writeRegister(regAddr + i, d);
      const decoded = slave && slave.decode ? slave.decode(regAddr + i, d) : null;
      this._log('proto', `  TX[${i}] 0x${d.toString(16).toUpperCase().padStart(2,'0')} → reg 0x${(regAddr+i).toString(16).toUpperCase().padStart(2,'0')}${decoded ? ` ↳ ${decoded}` : ''}`);
      await this._writeByte(d);
      if (this.onDecodeChip) this.onDecodeChip('data', `0x${d.toString(16).toUpperCase().padStart(2,'0')}`);
      await this._readAck(slave);
      if (this.onDecodeChip) this.onDecodeChip('ack', 'ACK');
    }

    this._setState('STOP');
    await this._stop();
    this._log('success', `WRITE complete — ${dataBytes.length} byte(s) written to ${slave ? slave.name : `0x${addr7.toString(16).toUpperCase()}`}`);
    this._setState('IDLE');
    return true;
  }

  // ── High-level READ transaction ──

  async runRead(addr7, regAddr, numBytes) {
    this._aborted = false;
    this._paused = false;

    this._setState('START');
    await this._start();

    this._setState('ADDRESS');
    const addrWrite = (addr7 << 1) | 0;
    this._setState('ACK_CHECK');
    const slave = this.slaves.find(s => s.address === addr7);
    this._log('info', `Addressing 0x${addr7.toString(16).toUpperCase().padStart(2,'0')} (READ) — ${slave ? slave.name : 'Unknown device'}`);
    await this._writeByte(addrWrite);
    if (this.onDecodeChip) this.onDecodeChip('addr', `0x${addrWrite.toString(16).toUpperCase().padStart(2,'0')} W`);
    const acked1 = await this._readAck(slave);
    if (!acked1) {
      this._log('error', `NACK — 0x${addr7.toString(16).toUpperCase()} not found`);
      if (this.onDecodeChip) this.onDecodeChip('nack', 'NACK');
      await this._stop(); this._setState('IDLE'); return null;
    }
    if (this.onDecodeChip) this.onDecodeChip('ack', 'ACK');

    await this._writeByte(regAddr);
    if (this.onDecodeChip) this.onDecodeChip('addr', `REG:0x${regAddr.toString(16).toUpperCase().padStart(2,'0')}`);
    await this._readAck(slave);
    if (this.onDecodeChip) this.onDecodeChip('ack', 'ACK');

    // Repeated START
    this._setState('START');
    await this._start();
    this._log('proto', 'Repeated START — switching to READ mode');

    const addrRead = (addr7 << 1) | 1;
    await this._writeByte(addrRead);
    if (this.onDecodeChip) this.onDecodeChip('addr', `0x${addrRead.toString(16).toUpperCase().padStart(2,'0')} R`);
    await this._readAck(slave);
    if (this.onDecodeChip) this.onDecodeChip('ack', 'ACK');

    this._setState('DATA_TRANSFER');
    const result = [];
    for (let i = 0; i < numBytes; i++) {
      const regActual = regAddr + i;
      const regValue = slave ? slave.readRegister(regActual) : 0xFF;
      let byte = 0;
      for (let bit = 7; bit >= 0; bit--) {
        // Slave drives each data bit onto SDA before master reads
        if (slave) slave.driveBit((regValue >> bit) & 1);
        const b = await this._readBit();
        if (slave) slave.releaseDrive();
        byte |= (b << bit);
      }
      const isLast = (i === numBytes - 1);
      if (isLast) await this._sendNack(); else await this._sendAck();
      result.push(byte);
      const decoded = slave && slave.decode ? slave.decode(regActual, byte) : null;
      this._log('proto', `  RX[${i}] 0x${byte.toString(16).toUpperCase().padStart(2,'0')} ← reg 0x${regActual.toString(16).toUpperCase().padStart(2,'0')}${decoded ? ` ↳ ${decoded}` : ''}`);
      if (this.onDecodeChip) this.onDecodeChip('data', `0x${byte.toString(16).toUpperCase().padStart(2,'0')}`);
      if (this.onDecodeChip) this.onDecodeChip(isLast ? 'nack' : 'ack', isLast ? 'NACK' : 'ACK');
    }

    this._setState('STOP');
    await this._stop();
    this._log('success', `READ complete — ${result.map(b=>'0x'+b.toString(16).toUpperCase().padStart(2,'0')).join(', ')}`);
    this._setState('IDLE');
    return result;
  }

  pause()  { this._paused = true; }
  resume() { this._paused = false; }
  abort()  { this._aborted = true; this._paused = false; }
}
