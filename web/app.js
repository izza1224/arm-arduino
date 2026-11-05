/**
 * App.js - Full Interactive Controller & Sequencer matching Image 1 & 2 Reference
 */

import { Robot3D } from './robot3d.js';

let robot3d = null;
let isHardwareConnected = false;
let esp32Url = localStorage.getItem('esp32_url') || 'http://armrobot.local';
let pollTimer = null;

// Joint Names & Styles
const JOINTS = ['base', 'siku', 'lengan', 'capit'];
const JOINT_NAMES = { base: 'Base', siku: 'Siku', lengan: 'Lengan atas', capit: 'Capit' };
const JOINT_IDX = { base: 0, siku: 1, lengan: 2, capit: 3 };
const JOINT_MAX = { base: 180, siku: 180, lengan: 180, capit: 120 };

// State
const state = {
  pos: { base: 0, siku: 0, lengan: 0, capit: 0 },
  tgt: { base: 0, siku: 0, lengan: 0, capit: 0 },
  conveyor: {
    running: false,
    speed: 70,
    reverse: false,
    holdSec: 5,
    holdTimer: 0,
    sensor: false
  },
  sequencer: {
    steps: [],
    speed: 35,
    loop: false,
    playing: false,
    currentStepIdx: -1,
    defaultDelay: 800
  }
};

// Simulation sequence playback timer
let simPlayTimer = null;

function startApp() {
  const container = document.getElementById('canvas3d');
  if (!container) return;

  robot3d = new Robot3D(container);

  // Hook sensor callback from 3D
  robot3d.onSensorChange = (detected) => {
    state.conveyor.sensor = detected;
    updateSensorUI(detected);
  };

  // Hook countdown timer tick from 3D auto-stop
  robot3d.onHoldTimerTick = (secRemaining) => {
    state.conveyor.holdTimer = secRemaining;
    updateConveyorStatusUI();
  };

  // Setup Event Listeners
  setupJointControls();
  setupConveyorControls();
  setupSequencerControls();
  setupConnectionControls();
  setupViewportTools();

  // Polling ESP32
  checkConnection();
  pollTimer = setInterval(pollESP32, 700);

  renderStepsList();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}

/* ========================================================
   1. LENGAN ROBOT CONTROLS (Image 1)
   ======================================================== */
function setupJointControls() {
  JOINTS.forEach((j) => {
    const slider = document.getElementById(`sl_${j}`);
    slider.addEventListener('input', (e) => {
      setJointAngle(j, parseInt(e.target.value));
    });
  });

  // Step delta buttons (-5, -1, +1, +5)
  document.querySelectorAll('.btn-step').forEach((btn) => {
    btn.addEventListener('click', () => {
      const j = btn.dataset.joint;
      const delta = parseInt(btn.dataset.delta);
      const cur = state.tgt[j];
      const max = JOINT_MAX[j];
      const next = Math.max(0, Math.min(max, cur + delta));
      setJointAngle(j, next);
    });
  });

  // Direct "+ Langkah" buttons from each card
  document.querySelectorAll('.btn-langkah').forEach((btn) => {
    btn.addEventListener('click', () => {
      const j = btn.dataset.joint;
      addStepDirect(JOINT_IDX[j], state.tgt[j]);
    });
  });

  // "Kembali ke posisi awal (0°)"
  document.getElementById('btn_home').addEventListener('click', () => {
    JOINTS.forEach((j) => setJointAngle(j, 0));
    if (isHardwareConnected) sendESP32Command('/home');
  });
}

function setJointAngle(joint, angle) {
  state.tgt[joint] = angle;
  const slider = document.getElementById(`sl_${joint}`);
  const valText = document.getElementById(`val_${joint}`);
  const tgtText = document.getElementById(`tgt_${joint}`);

  if (slider) slider.value = angle;
  if (valText) valText.textContent = `${angle}°`;
  if (tgtText) tgtText.textContent = `${angle}`;

  // Sync 3D
  robot3d.setTargetAngles(state.tgt.base, state.tgt.siku, state.tgt.lengan, state.tgt.capit);

  if (!isHardwareConnected) {
    state.pos[joint] = angle;
    robot3d.setActualAngles(state.tgt.base, state.tgt.siku, state.tgt.lengan, state.tgt.capit);
  } else {
    sendESP32Command(`/set?i=${JOINT_IDX[joint]}&a=${angle}`);
  }
}

/* ========================================================
   2. CONVEYOR CONTROLS (Image 2)
   ======================================================== */
function setupConveyorControls() {
  const btnRun = document.getElementById('btn_conv_run');
  const btnStop = document.getElementById('btn_conv_stop');
  const slSpd = document.getElementById('sl_conv_spd');
  const valSpd = document.getElementById('val_conv_spd');
  const chkRev = document.getElementById('chk_conv_rev');
  const btnMinus = document.getElementById('btn_hold_minus');
  const btnPlus = document.getElementById('btn_hold_plus');
  const valHold = document.getElementById('val_hold_sec');

  btnRun.addEventListener('click', () => {
    state.conveyor.running = true;
    robot3d.setConveyor(true, state.conveyor.speed, state.conveyor.reverse, state.conveyor.holdSec);
    updateConveyorStatusUI();
    if (isHardwareConnected) sendESP32Command('/kv?on=1');
  });

  btnStop.addEventListener('click', () => {
    state.conveyor.running = false;
    robot3d.setConveyor(false, state.conveyor.speed, state.conveyor.reverse, state.conveyor.holdSec);
    updateConveyorStatusUI();
    if (isHardwareConnected) sendESP32Command('/kv?on=0');
  });

  slSpd.addEventListener('input', (e) => {
    const spd = parseInt(e.target.value);
    state.conveyor.speed = spd;
    valSpd.textContent = `${spd}%`;
    robot3d.setConveyor(state.conveyor.running, spd, state.conveyor.reverse, state.conveyor.holdSec);
    if (isHardwareConnected) sendConveyorConfig();
  });

  chkRev.addEventListener('change', (e) => {
    state.conveyor.reverse = e.target.checked;
    robot3d.setConveyor(state.conveyor.running, state.conveyor.speed, state.conveyor.reverse, state.conveyor.holdSec);
    if (isHardwareConnected) sendConveyorConfig();
  });

  // Hold time stepper (- and +)
  btnMinus.addEventListener('click', () => {
    state.conveyor.holdSec = Math.max(0, state.conveyor.holdSec - 1);
    valHold.value = state.conveyor.holdSec;
    robot3d.setHoldSeconds(state.conveyor.holdSec);
    if (isHardwareConnected) sendConveyorConfig();
  });

  btnPlus.addEventListener('click', () => {
    state.conveyor.holdSec = Math.min(120, state.conveyor.holdSec + 1);
    valHold.value = state.conveyor.holdSec;
    robot3d.setHoldSeconds(state.conveyor.holdSec);
    if (isHardwareConnected) sendConveyorConfig();
  });
}

function sendConveyorConfig() {
  const p = state.conveyor.speed;
  const b = state.conveyor.reverse ? 1 : 0;
  const h = state.conveyor.holdSec;
  sendESP32Command(`/kcfg?p=${p}&b=${b}&h=${h}`);
}

function updateConveyorStatusUI() {
  const dot = document.getElementById('conv_dot');
  const txt = document.getElementById('conv_status_text');

  if (state.conveyor.running) {
    if (state.conveyor.holdTimer > 0) {
      dot.style.color = '#f59e0b';
      txt.textContent = `Berhenti (${state.conveyor.holdTimer} dtk lagi)`;
    } else {
      dot.style.color = '#10b981';
      txt.textContent = 'Berjalan';
    }
  } else {
    dot.style.color = '#64748b';
    txt.textContent = 'Berhenti';
  }
}

function updateSensorUI(isDetected) {
  const chip = document.getElementById('sensor_chip');
  const hudTxt = document.getElementById('hud_ir_text');

  if (isDetected) {
    chip.textContent = 'Sensor: ADA barang';
    chip.className = 'sensor-chip warn';
    if (hudTxt) hudTxt.textContent = 'Mendeteksi Objek (Stop)';
  } else {
    chip.textContent = 'Sensor kosong';
    chip.className = 'sensor-chip';
    if (hudTxt) hudTxt.textContent = 'Area Bersih';
  }
}

/* ========================================================
   3. SEQUENCER / URUTAN LANGKAH CRUD (Image 2)
   ======================================================== */
function setupSequencerControls() {
  const btnPlay = document.getElementById('btn_seq_play');
  const btnStop = document.getElementById('btn_seq_stop');
  const btnLoop = document.getElementById('btn_seq_loop');
  const slServoSpd = document.getElementById('sl_servo_spd');
  const valServoSpd = document.getElementById('val_servo_spd');
  const btnAddManual = document.getElementById('btn_add_manual');
  const btnClear = document.getElementById('btn_clear_steps');
  const inpDefaultDelay = document.getElementById('inp_default_delay');

  slServoSpd.addEventListener('input', (e) => {
    const spd = parseInt(e.target.value);
    state.sequencer.speed = spd;
    valServoSpd.textContent = `${spd} ms/°`;
    if (isHardwareConnected) sendESP32Command(`/cfg?spd=${spd}`);
  });

  inpDefaultDelay.addEventListener('input', (e) => {
    state.sequencer.defaultDelay = parseInt(e.target.value) || 800;
  });

  btnLoop.addEventListener('click', () => {
    state.sequencer.loop = !state.sequencer.loop;
    btnLoop.classList.toggle('active', state.sequencer.loop);
    if (isHardwareConnected) {
      sendESP32Command(`/loopset?loop=${state.sequencer.loop ? 1 : 0}`);
    }
  });

  btnPlay.addEventListener('click', () => {
    if (isHardwareConnected) {
      sendESP32Command(`/play?loop=${state.sequencer.loop ? 1 : 0}`);
    } else {
      startSimPlayback();
    }
  });

  btnStop.addEventListener('click', () => {
    if (isHardwareConnected) {
      sendESP32Command('/stop');
    } else {
      stopSimPlayback();
    }
  });

  btnAddManual.addEventListener('click', () => {
    // Add current active joint state
    addStepDirect(0, state.tgt.base);
  });

  btnClear.addEventListener('click', () => {
    if (confirm('Hapus SEMUA langkah?')) {
      state.sequencer.steps = [];
      renderStepsList();
      if (isHardwareConnected) sendESP32Command('/clear');
    }
  });
}

function addStepDirect(jointIdx, angle) {
  const delay = state.sequencer.defaultDelay;
  const newStep = [jointIdx, angle, 0, delay]; // [s, a, v, j]
  state.sequencer.steps.push(newStep);
  renderStepsList();

  if (isHardwareConnected) {
    sendESP32Command(`/add?s=${jointIdx}&a=${angle}&v=0&j=${delay}`);
  }
}

function renderStepsList() {
  const container = document.getElementById('steps_list');
  const counter = document.getElementById('step_counter');
  counter.textContent = `${state.sequencer.steps.length} langkah`;

  if (state.sequencer.steps.length === 0) {
    container.innerHTML = `
      <div class="steps-empty">
        Belum ada langkah.<br>Atur sudut lalu tekan <b>&oplus; Langkah</b> atau <b>+ Tambah</b>.
      </div>`;
    return;
  }

  container.innerHTML = state.sequencer.steps.map((st, idx) => {
    const jointKey = JOINTS[st[0]] || 'base';
    const jointName = JOINT_NAMES[jointKey];
    const angle = st[1];
    const delay = st[3];
    const isActive = state.sequencer.playing && state.sequencer.currentStepIdx === idx;

    return `
      <div class="step-item ${isActive ? 'active' : ''}">
        <div class="step-info">
          <div class="step-num">${idx + 1}</div>
          <span class="step-badge ${jointKey}">${jointName}</span>
          <div>
            <div class="step-val">${angle}&deg;</div>
            <div class="step-subtext">jeda ${delay} ms</div>
          </div>
        </div>
        <div class="step-btns">
          <button class="step-btn-act" title="Tes Langkah" onclick="window.testStep(${idx})">&#9654;</button>
          <button class="step-btn-act" title="Edit Sudut/Jeda" onclick="window.editStep(${idx})">&#9998;</button>
          <button class="step-btn-act" title="Naikkan" onclick="window.moveStep(${idx}, -1)">&uarr;</button>
          <button class="step-btn-act" title="Turunkan" onclick="window.moveStep(${idx}, 1)">&darr;</button>
          <button class="step-btn-act del" title="Hapus" onclick="window.deleteStep(${idx})">&#10005;</button>
        </div>
      </div>
    `;
  }).join('');
}

// Global CRUD handlers for steps
window.testStep = (idx) => {
  const st = state.sequencer.steps[idx];
  if (!st) return;
  const jointKey = JOINTS[st[0]];
  setJointAngle(jointKey, st[1]);
  if (isHardwareConnected) sendESP32Command(`/ke?n=${idx}`);
};

window.editStep = (idx) => {
  const st = state.sequencer.steps[idx];
  if (!st) return;
  const currentAngle = st[1];
  const newAngle = prompt(`Edit sudut ${JOINT_NAMES[JOINTS[st[0]]]} (0-${JOINT_MAX[JOINTS[st[0]]]}°):`, currentAngle);
  if (newAngle !== null && !isNaN(parseInt(newAngle))) {
    const val = Math.max(0, Math.min(JOINT_MAX[JOINTS[st[0]]], parseInt(newAngle)));
    st[1] = val;
    renderStepsList();
    if (isHardwareConnected) {
      sendESP32Command(`/edit?n=${idx}&s=${st[0]}&a=${val}&v=${st[2]}&j=${st[3]}`);
    }
  }
};

window.moveStep = (idx, dir) => {
  const targetIdx = idx + dir;
  if (targetIdx < 0 || targetIdx >= state.sequencer.steps.length) return;
  const temp = state.sequencer.steps[idx];
  state.sequencer.steps[idx] = state.sequencer.steps[targetIdx];
  state.sequencer.steps[targetIdx] = temp;
  renderStepsList();
  if (isHardwareConnected) sendESP32Command(`/mv?n=${idx}&d=${dir}`);
};

window.deleteStep = (idx) => {
  if (confirm(`Hapus langkah #${idx + 1}?`)) {
    state.sequencer.steps.splice(idx, 1);
    renderStepsList();
    if (isHardwareConnected) sendESP32Command(`/del?n=${idx}`);
  }
};

/* Simulator Step Playback (Offline Demo) */
function startSimPlayback() {
  if (state.sequencer.steps.length === 0) return;
  state.sequencer.playing = true;
  state.sequencer.currentStepIdx = 0;
  playNextSimStep();
}

function playNextSimStep() {
  if (!state.sequencer.playing) return;
  const steps = state.sequencer.steps;

  if (state.sequencer.currentStepIdx >= steps.length) {
    if (state.sequencer.loop) {
      state.sequencer.currentStepIdx = 0;
    } else {
      stopSimPlayback();
      return;
    }
  }

  const idx = state.sequencer.currentStepIdx;
  const st = steps[idx];
  renderStepsList();

  const jointKey = JOINTS[st[0]];
  setJointAngle(jointKey, st[1]);

  const stepDelay = (st[3] || 800) + 400;
  simPlayTimer = setTimeout(() => {
    state.sequencer.currentStepIdx++;
    playNextSimStep();
  }, stepDelay);
}

function stopSimPlayback() {
  state.sequencer.playing = false;
  state.sequencer.currentStepIdx = -1;
  clearTimeout(simPlayTimer);
  renderStepsList();
}

/* ========================================================
   4. ESP32 POLLING & HARDWARE SYNC
   ======================================================== */
function setupConnectionControls() {
  const ipInput = document.getElementById('ip_input');
  ipInput.value = esp32Url;

  ipInput.addEventListener('change', () => {
    let url = ipInput.value.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'http://' + url;
    }
    esp32Url = url;
    localStorage.setItem('esp32_url', url);
    checkConnection();
  });
}

function setupViewportTools() {
  document.getElementById('btn_reset_view').addEventListener('click', () => {
    robot3d.resetView();
  });

  document.getElementById('btn_reset_cargo').addEventListener('click', () => {
    robot3d.resetCargos();
  });
}

async function checkConnection() {
  const badge = document.getElementById('conn_badge');
  const text = document.getElementById('conn_text');

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(`${esp32Url}/api`, { signal: controller.signal });
    clearTimeout(id);

    if (res.ok) {
      isHardwareConnected = true;
      badge.className = 'conn-status';
      text.textContent = 'ESP32 Online';
      return;
    }
  } catch (err) {}

  isHardwareConnected = false;
  badge.className = 'conn-status offline';
  text.textContent = 'Demo Simulator (Offline)';
}

async function pollESP32() {
  if (!esp32Url) return;

  try {
    const res = await fetch(`${esp32Url}/api`);
    if (!res.ok) throw new Error();
    const data = await res.json();

    if (!isHardwareConnected) {
      isHardwareConnected = true;
      document.getElementById('conn_badge').className = 'conn-status';
      document.getElementById('conn_text').textContent = 'ESP32 Online';
    }

    // Sync angles
    if (data.pos && data.pos.length >= 4) {
      JOINTS.forEach((j, i) => {
        state.pos[j] = data.pos[i];
        state.tgt[j] = data.tgt ? data.tgt[i] : data.pos[i];
        const valElem = document.getElementById(`val_${j}`);
        const tgtElem = document.getElementById(`tgt_${j}`);
        const slElem = document.getElementById(`sl_${j}`);
        if (valElem) valElem.textContent = `${data.pos[i]}°`;
        if (tgtElem) tgtElem.textContent = `${state.tgt[j]}`;
        if (slElem && !slElem.matches(':active')) slElem.value = state.tgt[j];
      });
      robot3d.setActualAngles(data.pos[0], data.pos[1], data.pos[2], data.pos[3]);
      if (data.tgt) robot3d.setTargetAngles(data.tgt[0], data.tgt[1], data.tgt[2], data.tgt[3]);
    }

    // Sync conveyor
    if (typeof data.kr !== 'undefined') {
      state.conveyor.running = Boolean(data.kr);
      state.conveyor.sensor = Boolean(data.ks);
      state.conveyor.holdTimer = data.kt || 0;
      updateConveyorStatusUI();
      updateSensorUI(Boolean(data.ks));
    }

    // Sync steps
    if (data.steps && JSON.stringify(data.steps) !== JSON.stringify(state.sequencer.steps)) {
      state.sequencer.steps = data.steps;
      state.sequencer.playing = Boolean(data.play);
      state.sequencer.currentStepIdx = data.idx || 0;
      renderStepsList();
    }
  } catch (e) {
    if (isHardwareConnected) {
      isHardwareConnected = false;
      document.getElementById('conn_badge').className = 'conn-status offline';
      document.getElementById('conn_text').textContent = 'Demo Simulator (Offline)';
    }
  }
}

function sendESP32Command(path) {
  if (!isHardwareConnected && !esp32Url) return;
  fetch(`${esp32Url}${path}`).catch(() => {});
}
