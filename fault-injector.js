/**
 * fault-injector.js — I²C Fault Injection Engine
 *
 * Provides 5 categories of electrical/protocol faults that real I²C
 * buses encounter in production hardware. The injector is armed before
 * a transaction and fires automatically at the right moment.
 *
 * Fault types:
 *  SDA_GLITCH      – Brief corruption of SDA mid-bit (EMI spike simulation)
 *  CLOCK_STRETCH   – Slave holds SCL low, stalling the master
 *  NACK_STORM      – Every ACK window returns NACK (unresponsive device)
 *  BUS_STUCK_LOW   – SDA permanently pulled to 0 (hung slave)
 *  PARTIAL_BYTE    – Transaction cut off after N bits (power cut / reset)
 */

'use strict';

class FaultInjector {
  constructor() {
    this._armed    = null;   // { type, params } or null
    this._fired    = false;  // true once the fault has triggered
    this._bitCount = 0;      // running bit count within current transaction
    this.onFault   = null;   // callback(type, description) for logging
  }

  /* ─────────────────────────────── PUBLIC API ────────────────────── */

  /**
   * Arm the injector with a fault type.
   * @param {string} type   - One of the 5 fault type keys
   * @param {object} params - Optional parameters (e.g. { afterBit: 4, stretchMs: 200 })
   */
  arm(type, params = {}) {
    this._armed    = { type, params };
    this._fired    = false;
    this._bitCount = 0;
  }

  /** Disarm and reset. Safe to call at any time. */
  disarm() {
    this._armed    = null;
    this._fired    = false;
    this._bitCount = 0;
  }

  get isArmed()  { return this._armed !== null; }
  get hasFired() { return this._fired; }
  get type()     { return this._armed ? this._armed.type : null; }

  /* ─────────────────────────────── HOOKS (called by I2CMaster) ────── */

  /**
   * Hook: called once at the start of every new transaction.
   * Resets per-transaction counters.
   */
  onTransactionStart() {
    this._fired    = false;
    this._bitCount = 0;
  }

  /**
   * Hook: called before each bit is driven onto SDA.
   * Returns { corrupt: bool, bitOverride: 0|1|null }
   * If corrupt=true the master should briefly flip SDA then restore it.
   * @param {number} bitIndex - 0-based bit index within this byte (7=MSB)
   * @param {number} byteIndex - byte number within the transaction
   * @returns {{ glitch: bool, abort: bool }}
   */
  checkBit(bitIndex, byteIndex) {
    if (!this._armed || this._fired) return { glitch: false, abort: false };
    this._bitCount++;

    const { type, params } = this._armed;

    if (type === 'SDA_GLITCH') {
      // Fire glitch on the configured bit (default: 3rd bit of first byte)
      const triggerBit = params.afterBit !== undefined ? params.afterBit : 3;
      if (this._bitCount === triggerBit + 1) {
        this._fired = true;
        this._notify('SDA_GLITCH', `SDA glitch injected at bit ${this._bitCount} — simulating EMI spike`);
        return { glitch: true, abort: false };
      }
    }

    if (type === 'PARTIAL_BYTE') {
      const cutAt = params.afterBit !== undefined ? params.afterBit : 4;
      if (this._bitCount > cutAt) {
        if (!this._fired) {
          this._fired = true;
          this._notify('PARTIAL_BYTE', `Partial byte fault — transaction cut at bit ${cutAt} (simulates power loss / reset)`);
        }
        return { glitch: false, abort: true };
      }
    }

    return { glitch: false, abort: false };
  }

  /**
   * Hook: called during every ACK window.
   * Returns true to force NACK regardless of slave state.
   */
  checkAck() {
    if (!this._armed) return false;
    if (this._armed.type === 'NACK_STORM') {
      if (!this._fired) {
        this._fired = true;
        this._notify('NACK_STORM', 'NACK Storm injected — slave appears unresponsive on all ACK windows');
      }
      return true; // override: force NACK
    }
    return false;
  }

  /**
   * Hook: called on every clock tick.
   * Returns extra milliseconds to hold SCL low (clock stretching).
   */
  checkClockStretch() {
    if (!this._armed || this._fired) return 0;
    if (this._armed.type === 'CLOCK_STRETCH') {
      this._fired = true;
      const ms = this._armed.params.stretchMs !== undefined ? this._armed.params.stretchMs : 300;
      this._notify('CLOCK_STRETCH', `Clock stretch injected — SCL held low for ${ms}ms (slave slow to respond)`);
      return ms;
    }
    return 0;
  }

  /**
   * Hook: called continuously while BUS_STUCK_LOW is active.
   * Returns true → caller must force SDA = 0 immediately.
   */
  checkBusStuck() {
    if (!this._armed) return false;
    if (this._armed.type === 'BUS_STUCK_LOW') {
      if (!this._fired) {
        this._fired = true;
        this._notify('BUS_STUCK_LOW', 'Bus Stuck LOW injected — SDA pulled to ground (hung slave scenario)');
      }
      return true;
    }
    return false;
  }

  /* ─────────────────────────────── PRIVATE ───────────────────────── */
  _notify(type, description) {
    if (this.onFault) this.onFault(type, description);
  }
}

/* ─── Fault type metadata (used by UI to build the selector) ──────────────── */
const FAULT_TYPES = [
  {
    id:          'SDA_GLITCH',
    label:       'SDA Glitch',
    icon:        '⚡',
    description: 'Briefly corrupts SDA mid-bit, simulating an EMI spike or crosstalk.',
    params: [
      { key: 'afterBit', label: 'Trigger after bit #', type: 'number', min: 0, max: 31, default: 3 }
    ],
    severity: 'warn',
  },
  {
    id:          'CLOCK_STRETCH',
    label:       'Clock Stretch',
    icon:        '⏱',
    description: 'Slave holds SCL low for a configurable duration, stalling the master.',
    params: [
      { key: 'stretchMs', label: 'Stretch duration (ms)', type: 'number', min: 50, max: 2000, default: 300 }
    ],
    severity: 'warn',
  },
  {
    id:          'NACK_STORM',
    label:       'NACK Storm',
    icon:        '🚫',
    description: 'Forces NACK on every ACK window — simulates an unresponsive or crashed device.',
    params: [],
    severity: 'error',
  },
  {
    id:          'BUS_STUCK_LOW',
    label:       'Bus Stuck LOW',
    icon:        '🔴',
    description: 'SDA permanently pulled to GND. Requires master bus recovery (9 SCL pulses). Simulates a hung slave.',
    params: [],
    severity: 'error',
  },
  {
    id:          'PARTIAL_BYTE',
    label:       'Partial Byte',
    icon:        '✂',
    description: 'Aborts the transaction mid-byte. Simulates power cut or MCU reset during transmission.',
    params: [
      { key: 'afterBit', label: 'Cut after bit #', type: 'number', min: 1, max: 7, default: 4 }
    ],
    severity: 'error',
  },
];
