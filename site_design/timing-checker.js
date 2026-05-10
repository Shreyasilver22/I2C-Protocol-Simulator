/**
 * timing-checker.js — I²C Timing Violation Detector
 *
 * Analyses the VirtualBus sample history and flags violations of the
 * official I²C specification (UM10204 Rev 7, NXP, 2021).
 *
 * Timing is derived from the simulated sample rate (1 sample = 1 half-period
 * of the selected clock frequency). All thresholds are stored in samples for
 * the current mode (Standard / Fast).
 *
 * Violation types reported:
 *  TIMING_SCL_LOW   — SCL low period shorter than t_LOW
 *  TIMING_SCL_HIGH  — SCL high period shorter than t_HIGH
 *  TIMING_SDA_SETUP — SDA changes too close to SCL rising edge (t_SU;DAT)
 *  TIMING_SDA_HOLD  — SDA released too quickly after SCL falling edge (t_HD;DAT)
 *  TIMING_START_HOLD— START hold time too short (t_HD;STA)
 *  TIMING_START_SETUP — Setup time before repeated START (t_SU;STA)
 *  TIMING_STOP_SETUP  — STOP setup time too short (t_SU;STO)
 */

'use strict';

/* ── I²C Spec Timing Parameters (nanoseconds) ─────────────────────────────
   Source: NXP UM10204 Rev 7, Table 10 (Standard) and Table 11 (Fast).
   ────────────────────────────────────────────────────────────────────────── */
const I2C_TIMING_SPEC = {
  standard: {         // 100 kHz — Standard Mode
    t_LOW:   4700,    // SCL low period min (ns)
    t_HIGH:  4000,    // SCL high period min (ns)
    t_SU_DAT: 250,    // SDA setup time before SCL ↑ (ns)
    t_HD_DAT: 300,    // SDA hold time after SCL ↓ (ns)  [min; max=3450ns]
    t_HD_STA: 4000,   // START hold time (ns)
    t_SU_STA: 4700,   // Repeated START setup time (ns)
    t_SU_STO: 4000,   // STOP setup time (ns)
    t_BUF:   4700,    // Bus free time between STOP and START (ns)
  },
  fast: {             // 400 kHz — Fast Mode
    t_LOW:   1300,    // ns
    t_HIGH:   600,    // ns
    t_SU_DAT: 100,    // ns
    t_HD_DAT:   0,    // ns (no minimum in FM)
    t_HD_STA:  600,   // ns
    t_SU_STA:  600,   // ns
    t_SU_STO:  600,   // ns
    t_BUF:   1300,    // ns
  },
};

class TimingChecker {
  /**
   * @param {number} clockHz  - Simulated clock frequency (100000 or 400000)
   * @param {number} samplesPerHalfPeriod - Samples emitted per half-period
   *        In the engine each _tick() emits 1 sample; _writeBit takes 5 ticks
   *        so 1 sample = full period ns / 5.
   */
  constructor(clockHz = 100000, samplesPerHalfPeriod = 1) {
    this.clockHz = clockHz;
    this.samplesPerHalfPeriod = samplesPerHalfPeriod;
    this.violations = [];
    this._mode = clockHz <= 100000 ? 'standard' : 'fast';
    // ns per sample derived from ticks-per-period (5)
    this._nsPerSample = (1 / clockHz) * 1e9 / 5; // 2000ns for 100kHz, 500ns for 400kHz
  }

  /** Convert minimum nanoseconds to sample count */
  _nsToSamples(ns) {
    return Math.max(1, Math.ceil(ns / this._nsPerSample));
  }

  /**
   * Run all checks against the supplied history arrays.
   * @param {number[]} sclH - SCL sample history (0/1 per sample)
   * @param {number[]} sdaH - SDA sample history (0/1 per sample)
   * @returns {ViolationReport[]} Array of found violations
   */
  analyze(sclH, sdaH) {
    this.violations = [];
    const spec = I2C_TIMING_SPEC[this._mode];
    const N = Math.min(sclH.length, sdaH.length);
    if (N < 4) return [];

    // Pre-compute edge lists for O(n) analysis
    const sclRising  = []; // indices where SCL 0→1
    const sclFalling = []; // indices where SCL 1→0
    const sdaRising  = []; // indices where SDA 0→1
    const sdaFalling = []; // indices where SDA 1→0

    for (let i = 1; i < N; i++) {
      if (sclH[i - 1] === 0 && sclH[i] === 1) sclRising.push(i);
      if (sclH[i - 1] === 1 && sclH[i] === 0) sclFalling.push(i);
      if (sdaH[i - 1] === 0 && sdaH[i] === 1) sdaRising.push(i);
      if (sdaH[i - 1] === 1 && sdaH[i] === 0) sdaFalling.push(i);
    }

    this._checkSCLLow(sclH, sclRising, sclFalling, spec);
    this._checkSCLHigh(sclH, sclRising, sclFalling, spec);
    this._checkSDASetup(sclRising, sdaRising, sdaFalling, spec);
    this._checkSDAHold(sclFalling, sdaRising, sdaFalling, spec);
    this._checkStartHoldAndSetup(sclH, sdaH, sclFalling, sdaFalling, spec);
    this._checkStopSetup(sclH, sdaH, sclRising, sdaRising, spec);

    return this.violations;
  }

  /** Check SCL low period (t_LOW) */
  _checkSCLLow(sclH, sclRising, sclFalling, spec) {
    const minSamples = this._nsToSamples(spec.t_LOW);
    for (let fi = 0; fi < sclFalling.length; fi++) {
      const fallAt = sclFalling[fi];
      // Find next rising edge after this falling edge
      const nextRise = sclRising.find(r => r > fallAt);
      if (nextRise === undefined) continue;
      const lowDuration = nextRise - fallAt; // samples
      if (lowDuration < minSamples) {
        const actualNs = Math.round(lowDuration * this._nsPerSample);
        this._addViolation({
          type: 'TIMING_SCL_LOW',
          sampleIndex: fallAt,
          message: `t_LOW violation: SCL low for ~${actualNs}ns (min ${spec.t_LOW}ns per ${this._mode} spec)`,
          severity: 'error',
        });
      }
    }
  }

  /** Check SCL high period (t_HIGH) */
  _checkSCLHigh(sclH, sclRising, sclFalling, spec) {
    const minSamples = this._nsToSamples(spec.t_HIGH);
    for (let ri = 0; ri < sclRising.length; ri++) {
      const riseAt = sclRising[ri];
      const nextFall = sclFalling.find(f => f > riseAt);
      if (nextFall === undefined) continue;
      const highDuration = nextFall - riseAt;
      if (highDuration < minSamples) {
        const actualNs = Math.round(highDuration * this._nsPerSample);
        this._addViolation({
          type: 'TIMING_SCL_HIGH',
          sampleIndex: riseAt,
          message: `t_HIGH violation: SCL high for ~${actualNs}ns (min ${spec.t_HIGH}ns)`,
          severity: 'error',
        });
      }
    }
  }

  /**
   * Check SDA setup time before SCL rising edge (t_SU;DAT).
   * SDA must be stable for ≥ t_SU;DAT ns before SCL goes high.
   */
  _checkSDASetup(sclRising, sdaRising, sdaFalling, spec) {
    if (spec.t_SU_DAT <= 0) return;
    const minSamples = this._nsToSamples(spec.t_SU_DAT);

    const allSdaEdges = [...sdaRising, ...sdaFalling].sort((a, b) => a - b);

    for (const riseAt of sclRising) {
      // Find the most recent SDA edge before this SCL rising edge
      let lastSdaEdge = -1;
      for (const e of allSdaEdges) {
        if (e >= riseAt) break;
        lastSdaEdge = e;
      }
      if (lastSdaEdge === -1) continue;
      const setup = riseAt - lastSdaEdge;
      if (setup < minSamples) {
        const actualNs = Math.round(setup * this._nsPerSample);
        this._addViolation({
          type: 'TIMING_SDA_SETUP',
          sampleIndex: riseAt,
          message: `t_SU;DAT violation: SDA changed only ~${actualNs}ns before SCL↑ (min ${spec.t_SU_DAT}ns)`,
          severity: 'warn',
        });
      }
    }
  }

  /**
   * Check SDA hold time after SCL falling edge (t_HD;DAT).
   * SDA must remain stable for ≥ t_HD;DAT ns after SCL falls.
   */
  _checkSDAHold(sclFalling, sdaRising, sdaFalling, spec) {
    if (spec.t_HD_DAT <= 0) return;
    const minSamples = this._nsToSamples(spec.t_HD_DAT);
    const allSdaEdges = [...sdaRising, ...sdaFalling].sort((a, b) => a - b);

    for (const fallAt of sclFalling) {
      // Find the next SDA edge after this SCL falling edge
      const nextSdaEdge = allSdaEdges.find(e => e > fallAt);
      if (nextSdaEdge === undefined) continue;
      const hold = nextSdaEdge - fallAt;
      if (hold < minSamples) {
        const actualNs = Math.round(hold * this._nsPerSample);
        this._addViolation({
          type: 'TIMING_SDA_HOLD',
          sampleIndex: fallAt,
          message: `t_HD;DAT violation: SDA changed only ~${actualNs}ns after SCL↓ (min ${spec.t_HD_DAT}ns)`,
          severity: 'warn',
        });
      }
    }
  }

  /**
   * Detect START conditions (SDA↓ while SCL=1) and check:
   *  t_HD;STA  — hold time after START (SCL must stay low long enough)
   *  t_SU;STA  — repeated START setup time
   */
  _checkStartHoldAndSetup(sclH, sdaH, sclFalling, sdaFalling, spec) {
    const minHold   = this._nsToSamples(spec.t_HD_STA);
    const minSetup  = this._nsToSamples(spec.t_SU_STA);
    let   lastStartAt = -1;

    for (const sdaFall of sdaFalling) {
      // START: SDA falls while SCL is HIGH
      if (sdaFall > 0 && sclH[sdaFall] === 1 && sclH[sdaFall - 1] === 1) {
        // Find how long before SCL falls after this START
        const nextSclFall = sclFalling.find(f => f > sdaFall);
        if (nextSclFall !== undefined) {
          const hold = nextSclFall - sdaFall;
          if (hold < minHold) {
            const actualNs = Math.round(hold * this._nsPerSample);
            this._addViolation({
              type: 'TIMING_START_HOLD',
              sampleIndex: sdaFall,
              message: `t_HD;STA violation: START hold time ~${actualNs}ns (min ${spec.t_HD_STA}ns)`,
              severity: 'error',
            });
          }
        }
        // Check repeated START setup from previous START
        if (lastStartAt !== -1) {
          const setupTime = sdaFall - lastStartAt;
          if (setupTime < minSetup) {
            const actualNs = Math.round(setupTime * this._nsPerSample);
            this._addViolation({
              type: 'TIMING_START_SETUP',
              sampleIndex: sdaFall,
              message: `t_SU;STA violation: repeated START setup ~${actualNs}ns (min ${spec.t_SU_STA}ns)`,
              severity: 'warn',
            });
          }
        }
        lastStartAt = sdaFall;
      }
    }
  }

  /**
   * Detect STOP conditions (SDA↑ while SCL=1) and check t_SU;STO.
   * The SCL must be high for ≥ t_SU;STO before SDA goes high.
   */
  _checkStopSetup(sclH, sdaH, sclRising, sdaRising, spec) {
    const minSetup = this._nsToSamples(spec.t_SU_STO);

    for (const sdaRise of sdaRising) {
      // STOP: SDA rises while SCL is HIGH
      if (sdaRise > 0 && sclH[sdaRise] === 1 && sclH[sdaRise - 1] === 1) {
        // Find the most recent SCL rising edge before this
        let lastSclRise = -1;
        for (const sr of sclRising) {
          if (sr >= sdaRise) break;
          lastSclRise = sr;
        }
        if (lastSclRise === -1) continue;
        const setup = sdaRise - lastSclRise;
        if (setup < minSetup) {
          const actualNs = Math.round(setup * this._nsPerSample);
          this._addViolation({
            type: 'TIMING_STOP_SETUP',
            sampleIndex: sdaRise,
            message: `t_SU;STO violation: STOP setup ~${actualNs}ns (min ${spec.t_SU_STO}ns)`,
            severity: 'error',
          });
        }
      }
    }
  }

  _addViolation(v) {
    this.violations.push(v);
  }

  /**
   * Update clock mode (call when user switches 100kHz ↔ 400kHz).
   */
  setClockHz(hz) {
    this.clockHz = hz;
    this._mode = hz <= 100000 ? 'standard' : 'fast';
    this._nsPerSample = (1 / hz) * 1e9 / 5;
  }

  /**
   * Returns a human-readable summary string.
   */
  summarize() {
    if (this.violations.length === 0) return '✔ No timing violations detected';
    const errors = this.violations.filter(v => v.severity === 'error').length;
    const warns  = this.violations.filter(v => v.severity === 'warn').length;
    return `${errors} error(s), ${warns} warning(s) — ${this.violations.length} total violation(s)`;
  }
}
