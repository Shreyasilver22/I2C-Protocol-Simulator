/**
 * app.js — Application Controller v3.1
 * New in v3.1: Fault Injection Engine
 */

'use strict';

/* ═══════════════════════════ GLOBALS ════════════════════════════ */
let bus, master, slaves = [], renderer, timingChecker, faultInjector;
let mode = 'WRITE';
let clockHz = 100000;
let speedMultiplier = 5;
let logCount = 0;
let terminalVisible = true;
let _paused = false;
let _running = false;
let _scanning = false;

// Active device IDs (subset of DEVICE_REGISTRY that are on the bus)
let activeDeviceIds = new Set(['eeprom', 'rtc', 'oled']);

/* ═══════════════════════════ INIT ═══════════════════════════════ */
function init() {
  bus = new VirtualBus(600);
  bus.reset();

  rebuildSlaves();

  master = new I2CMaster(bus, slaves, { clockHz });
  master.onStateChange = (s) => { setMasterState(s); };
  master.onLog         = (level, msg) => log(level, msg);
  master.onSample      = () => { renderer.markDirty(); updateBusStatus(); };
  master.onDecodeChip  = (type, label) => addDecodeChip(type, label);

  timingChecker = new TimingChecker(clockHz);

  faultInjector = new FaultInjector();
  faultInjector.onFault = (type, desc) => {
    log('error', `[FAULT] ${type}: ${desc}`);
    bus.timingViolations.push({ index: Math.max(0, bus.sclHistory.length - 1), type, message: desc, severity: 'error' });
    renderer.markDirty();
  };
  master.faultInjector = faultInjector;

  renderer = new WaveformRenderer('waveformCanvas');
  renderer.attach(bus);

  setupCanvasTooltip();
  buildDeviceLibraryPanel();
  buildActiveDeviceCards();
  buildFaultPanel();
  buildDemoPanel();

  log('info', 'I²C Protocol Simulator v3.0 — Industrial Edition');
  log('info', 'Virtual bus online — open-drain topology, 4.7 kΩ pull-ups');
  log('success', `Active devices: ${slaves.map(s => s.name + ' @0x' + s.address.toString(16).toUpperCase()).join(', ')}`);
}

/** Rebuild slave array from activeDeviceIds */
function rebuildSlaves() {
  slaves = [];
  DEVICE_REGISTRY.forEach((entry, i) => {
    if (activeDeviceIds.has(entry.id)) {
      const dev = new entry.cls(bus);
      dev.slotId = i + 1; // stable slot IDs
      slaves.push(dev);
    }
  });
  if (master) master.slaves = slaves;
}

/* ═══════════════════════════ DEVICE LIBRARY PANEL ═══════════════ */
function buildDeviceLibraryPanel() {
  const container = document.getElementById('device-library-list');
  if (!container) return;
  container.innerHTML = '';

  DEVICE_REGISTRY.forEach(entry => {
    const isActive = activeDeviceIds.has(entry.id);
    const meta = (new entry.cls({ setMasterSCL(){}, setMasterSDA(){}, setSlaveAck(){}, releaseSlaveAck(){}, sample(){} })).meta;
    const row = document.createElement('div');
    row.className = 'lib-row' + (isActive ? ' lib-row--active' : '');
    row.id = `lib-row-${entry.id}`;
    row.innerHTML = `
      <span class="lib-icon">${meta.icon}</span>
      <div class="lib-info">
        <span class="lib-name">${entry.name}</span>
        <span class="lib-addr">0x${entry.address.toString(16).toUpperCase().padStart(2,'0')} · ${meta.infoTag}</span>
      </div>
      <button class="lib-toggle ${isActive ? 'lib-toggle--on' : ''}" 
              id="lib-btn-${entry.id}"
              onclick="toggleDevice('${entry.id}')"
              title="${isActive ? 'Remove from bus' : 'Add to bus'}">
        ${isActive ? 'ON' : 'OFF'}
      </button>`;
    container.appendChild(row);
  });
}

function toggleDevice(id) {
  if (_running || _scanning) { log('warn', 'Cannot change devices during active transaction'); return; }
  if (activeDeviceIds.has(id)) {
    if (activeDeviceIds.size <= 1) { log('warn', 'At least one device must remain on the bus'); return; }
    activeDeviceIds.delete(id);
  } else {
    // Check for address conflict
    const entry = DEVICE_REGISTRY.find(e => e.id === id);
    const conflict = slaves.find(s => s.address === entry.address);
    if (conflict) {
      log('error', `Address conflict: 0x${entry.address.toString(16).toUpperCase()} already used by ${conflict.name}`);
      return;
    }
    activeDeviceIds.add(id);
  }
  rebuildSlaves();
  buildDeviceLibraryPanel();
  buildActiveDeviceCards();
  log('info', `Bus updated — ${slaves.length} device(s) active`);
}

/* ═══════════════════════════ ACTIVE DEVICE CARDS ════════════════ */
function buildActiveDeviceCards() {
  const container = document.getElementById('panel-devices-body');
  if (!container) return;
  container.innerHTML = `
    <div class="device-card device-card--master" id="device-master">
      <div class="device-card__header">
        <div class="device-card__dot device-card__dot--master"></div>
        <span class="device-card__name">Master Controller</span>
        <span class="device-card__type">M1</span>
      </div>
      <div class="device-card__detail">
        <span class="device-info-tag">INITIATOR</span>
        <span class="device-state" id="master-state">IDLE</span>
      </div>
    </div>`;

  slaves.forEach(s => {
    const meta = s.meta || { infoTag: 'I²C Slave', icon: '🔲' };
    const addrHex = s.address.toString(16).toUpperCase().padStart(2,'0');
    const card = document.createElement('div');
    card.className = 'device-card';
    card.id = `device-0x${s.address.toString(16)}`;
    card.style.cursor = 'pointer';
    card.title = `Click to target ${s.name}`;
    card.innerHTML = `
      <div class="device-card__header">
        <div class="device-card__dot device-card__dot--slave"></div>
        <span class="device-card__name">${s.name}</span>
        <span class="device-card__type">0x${addrHex}</span>
      </div>
      <div class="device-card__detail">
        <span class="device-info-tag">${meta.infoTag}</span>
        <span class="device-state" id="slave-state-0x${s.address.toString(16)}">LISTENING</span>
      </div>`;
    card.addEventListener('click', () => {
      document.getElementById('addr-input').value = addrHex;
      log('info', `Target → ${s.name} (0x${addrHex})`);
    });
    container.appendChild(card);
  });
}

/* ═══════════════════════════ UI BINDINGS ════════════════════════ */
function setMode(m) {
  mode = m;
  document.getElementById('btn-write').classList.toggle('toggle-btn--active', m === 'WRITE');
  document.getElementById('btn-read').classList.toggle('toggle-btn--active', m === 'READ');
  document.getElementById('btn-write').setAttribute('aria-checked', m === 'WRITE');
  document.getElementById('btn-read').setAttribute('aria-checked', m === 'READ');
  document.getElementById('data-group').style.display = m === 'WRITE' ? '' : 'none';
  log('info', `Mode → ${m}`);
}

function setFreq(hz) {
  clockHz = hz;
  master.clockHz = hz;
  if (timingChecker) timingChecker.setClockHz(hz);
  document.getElementById('btn-std').classList.toggle('toggle-btn--active', hz === 100000);
  document.getElementById('btn-fast').classList.toggle('toggle-btn--active', hz === 400000);
  document.getElementById('btn-std').setAttribute('aria-checked', hz === 100000);
  document.getElementById('btn-fast').setAttribute('aria-checked', hz === 400000);
  document.getElementById('clock-freq-badge').textContent = hz === 100000 ? '100 kHz STD' : '400 kHz FAST';
  log('info', `Clock → ${hz >= 1000 ? (hz/1000).toFixed(0)+'kHz' : hz+'Hz'}`);
}

function setSpeed(val) {
  speedMultiplier = parseInt(val);
  document.getElementById('speed-value').textContent = `${speedMultiplier}x`;
  if (master) master.clockInterval = Math.max(1, Math.round(80 / speedMultiplier));
}

function zoomIn()  { renderer.zoomIn(); }
function zoomOut() { renderer.zoomOut(); }

/* ═══════════════════════════ TRANSACTION ════════════════════════ */
async function startTransaction() {
  if (_running || _scanning) return;

  const addrRaw = document.getElementById('addr-input').value.trim();
  const regRaw  = document.getElementById('reg-input').value.trim();
  const dataRaw = document.getElementById('data-input').value.trim();

  const addr7   = parseInt(addrRaw, 16);
  const regAddr = parseInt(regRaw, 16);

  if (isNaN(addr7) || addr7 < 0 || addr7 > 0x7F) {
    log('error', `Invalid address: "${addrRaw}" — must be 00–7F`); return;
  }

  let dataBytes = [];
  if (mode === 'WRITE') {
    const parts = dataRaw.split(/[\s,]+/).filter(Boolean);
    dataBytes = parts.map(p => parseInt(p, 16));
    if (dataBytes.some(isNaN)) {
      log('error', `Invalid data bytes: "${dataRaw}" — use hex e.g. A5 3F`); return;
    }
  }
  const numRead = mode === 'READ' ? Math.max(1, parseInt(dataRaw) || 1) : 0;

  _running = true;
  setButtons(true);
  clearDecodeBar();
  hideOverlay();
  master.clockInterval = Math.max(1, Math.round(80 / speedMultiplier));

  // Reset fault injector per-transaction counters
  if (faultInjector && faultInjector.isArmed) {
    faultInjector.onTransactionStart();
    log('warn', `[FAULT] Armed: ${faultInjector.type} — will fire during this transaction`);
  }

  try {
    if (mode === 'WRITE') {
      await master.runWrite(addr7, regAddr, dataBytes);
    } else {
      const result = await master.runRead(addr7, regAddr, numRead || 1);
      if (result) log('success', `Read: [${result.map(b=>'0x'+b.toString(16).toUpperCase().padStart(2,'0')).join(', ')}]`);
    }
    updateDeviceHighlight(addr7, 'ack');
    runTimingCheck();
  } catch (e) {
    if (e.message !== 'ABORT') log('error', `Transaction error: ${e.message}`);
    else log('warn', 'Transaction aborted');
  }

  _running = false;
  _paused = false;
  setButtons(false);
  setBusStatus('idle');
}

function pauseTransaction() {
  if (!_running) return;
  _paused = !_paused;
  if (_paused) { master.pause(); setBusStatus('paused'); }
  else         { master.resume(); setBusStatus('busy'); }
  document.getElementById('btn-pause').innerHTML = _paused
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> Resume`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause`;
  log('info', _paused ? 'Paused' : 'Resumed');
}

function resetAll() {
  if (master) master.abort();
  _scanning = false;
  setTimeout(() => {
    bus.reset();
    renderer.markDirty();
    clearDecodeBar();
    showOverlay();
    setMasterState('IDLE');
    slaves.forEach(s => { s.state = 'LISTENING'; });
    buildActiveDeviceCards();
    setBusStatus('idle');
    _running = false; _paused = false;
    setButtons(false);
    clearTimingPanel();
    if (faultInjector && faultInjector.isArmed) disarmFault();
    log('info', 'Simulation reset — bus cleared');
  }, 100);
}

function setButtons(running) {
  document.getElementById('btn-start').disabled = running || _scanning;
  document.getElementById('btn-pause').disabled = !running;
  document.getElementById('btn-scan').disabled  = running || _scanning;
  document.getElementById('btn-pause').innerHTML =
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause`;
}

/* ═══════════════════════════ BUS SCANNER ════════════════════════
   Sweeps I²C addresses 0x03–0x77 (reserved ranges excluded).
   For each address sends a write-0-byte probe; ACK = device found.
   Results rendered in the scan modal grid.
   ════════════════════════════════════════════════════════════════ */
async function startBusScan() {
  if (_running || _scanning) return;
  _scanning = true;
  document.getElementById('btn-scan').disabled = true;
  document.getElementById('btn-start').disabled = true;

  openScanModal();
  const grid = document.getElementById('scan-grid');
  grid.innerHTML = '';

  // Reserved addresses per I²C spec
  const RESERVED = new Set([0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x78,0x79,0x7A,0x7B,0x7C,0x7D,0x7E,0x7F]);
  const found = [];

  log('info', 'Bus Scan started — probing 0x03 to 0x77…');

  // Save current speed and set to max for fast scan
  const savedInterval = master.clockInterval;
  master.clockInterval = 1;

  for (let addr = 0x03; addr <= 0x77; addr++) {
    if (_scanning === false) break; // aborted

    const cell = document.createElement('div');
    cell.className = 'scan-cell scan-cell--probing';
    const addrHex = addr.toString(16).toUpperCase().padStart(2,'0');
    cell.textContent = addrHex;
    cell.id = `scan-cell-${addrHex}`;
    grid.appendChild(cell);

    if (RESERVED.has(addr)) {
      cell.className = 'scan-cell scan-cell--reserved';
      cell.title = 'Reserved address';
      await sleep(2);
      continue;
    }

    // Probe: send address byte, check for ACK
    const slave = slaves.find(s => s.address === addr);
    try {
      bus.reset();
      bus.setMasterSDA(1); bus.setMasterSCL(1); bus.sample();
      // START
      bus.setMasterSDA(0); bus.sample();
      bus.setMasterSCL(0); bus.sample();
      // Address byte (write)
      const addrByte = (addr << 1);
      for (let i = 7; i >= 0; i--) {
        const b = (addrByte >> i) & 1;
        bus.setMasterSDA(b);
        bus.setMasterSCL(0); bus.sample();
        bus.setMasterSCL(1); bus.sample();
        bus.setMasterSCL(0); bus.sample();
      }
      // ACK window
      bus.setMasterSDA(1);
      if (slave) slave.ack();
      bus.setMasterSCL(0); bus.sample();
      bus.setMasterSCL(1); bus.sample();
      const ack = bus.SDA; // 0 = ACK
      bus.setMasterSCL(0);
      if (slave) slave.releaseAck();
      bus.sample();
      // STOP
      bus.setMasterSDA(0); bus.sample();
      bus.setMasterSCL(1); bus.sample();
      bus.setMasterSDA(1); bus.sample();

      if (ack === 0) {
        cell.className = 'scan-cell scan-cell--found';
        cell.title = slave ? slave.name : `Unknown device @ 0x${addrHex}`;
        if (slave) cell.title += ` (${slave.meta?.infoTag || ''})`;
        found.push({ addr, name: slave ? slave.name : 'Unknown' });
        log('success', `  0x${addrHex} → ACK ← ${slave ? slave.name : 'unknown device'}`);
      } else {
        cell.className = 'scan-cell scan-cell--empty';
        cell.title = `No device at 0x${addrHex}`;
      }
    } catch (e) {
      cell.className = 'scan-cell scan-cell--empty';
    }

    renderer.markDirty();
    await sleep(8); // allow UI to breathe
  }

  master.clockInterval = savedInterval;
  bus.reset();
  renderer.markDirty();

  // Summary
  document.getElementById('scan-summary').textContent =
    found.length === 0
      ? 'No devices found on bus.'
      : `Found ${found.length} device(s): ${found.map(f => `0x${f.addr.toString(16).toUpperCase()} ${f.name}`).join(', ')}`;

  log('info', `Bus scan complete — ${found.length} device(s) found`);
  _scanning = false;
  document.getElementById('btn-scan').disabled = false;
  document.getElementById('btn-start').disabled = false;
}

function abortScan() {
  _scanning = false;
  closeScanModal();
  bus.reset();
  renderer.markDirty();
  log('warn', 'Bus scan aborted');
}

function openScanModal() {
  document.getElementById('scan-modal').classList.add('modal--open');
  document.getElementById('scan-summary').textContent = 'Scanning…';
}

function closeScanModal() {
  document.getElementById('scan-modal').classList.remove('modal--open');
  _scanning = false;
}

/* ═══════════════════════════ TIMING CHECKER ═════════════════════ */
function runTimingCheck() {
  if (!timingChecker || bus.sclHistory.length < 4) return;
  const violations = timingChecker.analyze(bus.sclHistory, bus.sdaHistory);
  updateTimingPanel(violations);

  if (violations.length === 0) {
    log('success', `Timing check: ✔ No violations (${timingChecker._mode} mode, ${clockHz/1000}kHz)`);
  } else {
    violations.forEach(v => {
      log(v.severity === 'error' ? 'error' : 'warn', `[TIMING] ${v.message}`);
    });
    log('warn', `Timing check: ${timingChecker.summarize()}`);
  }

  // Mark violation positions on waveform as annotations
  violations.forEach(v => {
    bus.timingViolations.push({ index: Math.min(v.sampleIndex, bus.sclHistory.length - 1), ...v });
  });
  renderer.markDirty();
}

function updateTimingPanel(violations) {
  const panel = document.getElementById('timing-violations-list');
  if (!panel) return;
  panel.innerHTML = '';

  const badge = document.getElementById('timing-badge');
  if (violations.length === 0) {
    badge.textContent = '✔';
    badge.className = 'timing-badge timing-badge--ok';
    const ok = document.createElement('div');
    ok.className = 'timing-ok';
    ok.textContent = '✔ All timing within spec';
    panel.appendChild(ok);
    return;
  }

  badge.textContent = violations.length;
  badge.className = 'timing-badge timing-badge--error';

  violations.forEach(v => {
    const row = document.createElement('div');
    row.className = `timing-violation timing-violation--${v.severity}`;
    row.innerHTML = `
      <span class="tv-type">${v.type.replace('TIMING_','')}</span>
      <span class="tv-msg">${escapeHtml(v.message)}</span>`;
    panel.appendChild(row);
  });
}

function clearTimingPanel() {
  const panel = document.getElementById('timing-violations-list');
  if (panel) panel.innerHTML = '<div class="timing-ok">Run a transaction to check timing.</div>';
  const badge = document.getElementById('timing-badge');
  if (badge) { badge.textContent = '—'; badge.className = 'timing-badge'; }
}

/* ═══════════════════════════ STATUS / UI UPDATES ════════════════ */
function setBusStatus(state) {
  const dot  = document.querySelector('.status-dot');
  const text = document.getElementById('bus-status-text');
  if (!dot || !text) return;
  dot.className = 'status-dot';
  const map = {
    idle:   ['status-dot--idle',  'Bus Idle'],
    busy:   ['status-dot--busy',  'Transaction Active'],
    paused: ['status-dot--busy',  'Paused'],
    scan:   ['status-dot--busy',  'Scanning…'],
    ack:    ['status-dot--ack',   'ACK Received'],
    nack:   ['status-dot--nack',  'NACK — No Device'],
  };
  const [cls, lbl] = map[state] || map.idle;
  dot.classList.add(cls);
  text.textContent = lbl;
}

function updateBusStatus() {
  if (master.state !== 'IDLE') setBusStatus('busy');
}

function setMasterState(s) {
  const el = document.getElementById('master-state');
  if (el) {
    el.textContent = s;
    el.className = 'device-state' + (s !== 'IDLE' ? ' device-state--active' : '');
  }
}

function updateDeviceHighlight(addr7, result) {
  slaves.forEach(s => {
    const card = document.getElementById(`device-0x${s.address.toString(16)}`);
    if (!card) return;
    card.classList.remove('device-card--active', 'device-card--ack', 'device-card--nack');
    const stateEl = document.getElementById(`slave-state-0x${s.address.toString(16)}`);
    if (stateEl) { stateEl.textContent = 'LISTENING'; stateEl.className = 'device-state'; }
  });
  if (addr7 === null || addr7 === undefined) return;
  const slave = slaves.find(s => s.address === addr7);
  if (!slave) return;
  const card = document.getElementById(`device-0x${addr7.toString(16)}`);
  if (!card) return;
  const stateEl = document.getElementById(`slave-state-0x${addr7.toString(16)}`);
  if (result === 'ack') {
    card.classList.add('device-card--ack');
    if (stateEl) { stateEl.textContent = 'ACK'; stateEl.className = 'device-state device-state--ack'; }
  } else {
    card.classList.add('device-card--active');
    if (stateEl) { stateEl.textContent = 'SELECTED'; stateEl.className = 'device-state device-state--active'; }
  }
  setTimeout(() => {
    card.classList.remove('device-card--active', 'device-card--ack', 'device-card--nack');
    if (stateEl) { stateEl.textContent = 'LISTENING'; stateEl.className = 'device-state'; }
  }, 3000);
}

/* ═══════════════════════════ DECODE BAR ═════════════════════════ */
function addDecodeChip(type, label) {
  const track = document.getElementById('decode-track');
  const chip = document.createElement('span');
  chip.className = `decode-chip decode-chip--${type}`;
  chip.textContent = label;
  track.appendChild(chip);
  track.scrollLeft = track.scrollWidth;

  const badges = document.getElementById('decode-badges');
  const badge = document.createElement('span');
  badge.className = `decode-badge decode-chip--${type}`;
  badge.textContent = label;
  badges.appendChild(badge);
  if (badges.children.length > 6) badges.removeChild(badges.firstChild);
}

function clearDecodeBar() {
  document.getElementById('decode-track').innerHTML = '';
  document.getElementById('decode-badges').innerHTML = '';
}

/* ═══════════════════════════ TERMINAL LOG ═══════════════════════ */
function log(level, msg) {
  const output = document.getElementById('terminal-output');
  const ts = new Date().toTimeString().slice(0, 8);
  const tagMap = { info:'INFO', success:'PASS', warn:'WARN', error:'FAIL', proto:'I²C' };
  const entry = document.createElement('div');
  entry.className = `log-entry log-entry--${level}`;
  entry.innerHTML = `
    <span class="log-entry__ts">${ts}</span>
    <span class="log-entry__tag">${tagMap[level] || 'LOG'}</span>
    <span class="log-entry__msg">${escapeHtml(msg)}</span>`;
  output.appendChild(entry);
  output.scrollTop = output.scrollHeight;
  logCount++;
  document.getElementById('log-count').textContent = `${logCount} event${logCount !== 1 ? 's' : ''}`;
}

function clearLog() {
  document.getElementById('terminal-output').innerHTML = '';
  logCount = 0;
  document.getElementById('log-count').textContent = '0 events';
}

function toggleTerminal() {
  terminalVisible = !terminalVisible;
  document.getElementById('terminal-panel').classList.toggle('collapsed', !terminalVisible);
  const arrow = document.getElementById('terminal-arrow');
  arrow.setAttribute('d', terminalVisible ? 'M18 15 12 9 6 15' : 'M6 9l6 6 6-6');
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ═══════════════════════════ CANVAS HELPERS ═════════════════════ */
function hideOverlay() { document.getElementById('canvas-overlay').classList.add('hidden'); }
function showOverlay() { document.getElementById('canvas-overlay').classList.remove('hidden'); }

function setupCanvasTooltip() {
  const canvas = document.getElementById('waveformCanvas');
  const tooltip = document.getElementById('canvas-tooltip');
  canvas.addEventListener('mousemove', (e) => {
    if (!bus || bus.sclHistory.length < 2) { tooltip.style.display = 'none'; return; }
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const N = bus.sclHistory.length;
    const stepX = (canvas.width - 20) / Math.max(N - 1, 1) * renderer._zoom;
    const idx = Math.round((x - 10) / stepX);
    if (idx < 0 || idx >= N) { tooltip.style.display = 'none'; return; }
    const scl = bus.sclHistory[idx];
    const sda = bus.sdaHistory[idx];
    const ann = bus.annotations.find(a => a.index === idx);
    const vio = bus.timingViolations.find(a => a.index === idx);
    let tip = `[${idx}] SCL=${scl}  SDA=${sda}`;
    if (ann) tip += `  ← ${ann.label}`;
    if (vio) tip += `  ⚠ ${vio.type}`;
    tooltip.style.display = 'block';
    tooltip.style.left = (e.clientX + 12) + 'px';
    tooltip.style.top  = (e.clientY - 24) + 'px';
    tooltip.textContent = tip;
  });
  canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
}

/* ═══════════════════════════ EXPORT ═════════════════════════════ */
function exportWaveform() {
  const canvas = document.getElementById('waveformCanvas');
  const link = document.createElement('a');
  link.download = `i2c_waveform_${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
  log('info', 'Waveform exported as PNG');
}

/* ═══════════════════════════ FAULT INJECTION UI ════════════════════
   Builds the panel from FAULT_TYPES metadata so adding a new fault
   type in fault-injector.js automatically appears in the UI.
   ════════════════════════════════════════════════════════════════════ */
function buildFaultPanel() {
  const sel = document.getElementById('fault-type-select');
  const paramsDiv = document.getElementById('fault-params');
  if (!sel || !paramsDiv) return;

  // Populate selector
  sel.innerHTML = '<option value="">-- Select fault type --</option>';
  FAULT_TYPES.forEach(ft => {
    const opt = document.createElement('option');
    opt.value = ft.id;
    opt.textContent = `${ft.icon} ${ft.label}`;
    sel.appendChild(opt);
  });

  // When selection changes, render parameter inputs + description
  sel.addEventListener('change', () => {
    paramsDiv.innerHTML = '';
    const ft = FAULT_TYPES.find(f => f.id === sel.value);
    if (!ft) return;

    // Description box
    const desc = document.createElement('p');
    desc.className = 'fault-desc';
    desc.textContent = ft.description;
    paramsDiv.appendChild(desc);

    // Parameter inputs
    ft.params.forEach(p => {
      const grp = document.createElement('div');
      grp.className = 'form-group';
      grp.innerHTML = `
        <label class="form-label" for="fault-param-${p.key}">${p.label}</label>
        <input type="number" id="fault-param-${p.key}" class="form-input"
               value="${p.default}" min="${p.min}" max="${p.max}" />`;
      paramsDiv.appendChild(grp);
    });
  });
}

function armFault() {
  const sel = document.getElementById('fault-type-select');
  if (!sel.value) { log('warn', 'Select a fault type first'); return; }
  const ft = FAULT_TYPES.find(f => f.id === sel.value);
  if (!ft) return;

  const params = {};
  ft.params.forEach(p => {
    const el = document.getElementById(`fault-param-${p.key}`);
    if (el) params[p.key] = parseInt(el.value);
  });

  faultInjector.arm(sel.value, params);
  document.getElementById('fault-status').textContent = `⚡ Armed: ${ft.icon} ${ft.label}`;
  document.getElementById('fault-status').className = 'fault-status fault-status--armed';
  document.getElementById('btn-arm-fault').disabled = true;
  document.getElementById('btn-disarm-fault').disabled = false;
  log('warn', `Fault injector armed: ${ft.label} ${JSON.stringify(params)}`);
}

function disarmFault() {
  faultInjector.disarm();
  document.getElementById('fault-status').textContent = 'Disarmed';
  document.getElementById('fault-status').className = 'fault-status';
  document.getElementById('btn-arm-fault').disabled = false;
  document.getElementById('btn-disarm-fault').disabled = true;
  log('info', 'Fault injector disarmed');
}

/* ═══════════════════════════ START APP ══════════════════════════ */
window.addEventListener('DOMContentLoaded', () => {
  init();
  setMode('WRITE');
  setSpeed(5);
  clearTimingPanel();
});

