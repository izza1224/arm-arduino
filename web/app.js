/**
 * Main Application Logic for Arm Robot 3D Web Visualizer
 */

import { Robot3D } from './robot3d.js';

let robot3d = null;
let isHardwareConnected = false;
let esp32Url = localStorage.getItem('esp32_url') || 'http://armrobot.local';
let pollTimer = null;

// Local Simulator State
const state = {
  angles: { base: 90, shoulder: 90, elbow: 90, gripper: 0 },
  conveyor: { running: false, speed: 70, reverse: false },
  sensor: false
};

window.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('canvas3d');
  robot3d = new Robot3D(container);

  // Hook sensor callback from 3D simulator
  robot3d.onSensorChange = (detected) => {
    state.sensor = detected;
    updateSensorUI(detected);
  };

  // Setup UI bindings
  setupJointSliders();
  setupConveyorControls();
  setupConnectionControls();
  setupPresets();
  setupCustomModelUpload();

  // Try checking for default custom model in assets/
  fetch('../assets/robot_arm.glb', { method: 'HEAD' })
    .then((res) => {
      if (res.ok) {
        console.log('Detected custom robot_arm.glb in assets, loading...');
        robot3d.loadCustomModel('../assets/robot_arm.glb');
      }
    })
    .catch(() => {});

  // Start polling ESP32
  checkConnection();
  pollTimer = setInterval(pollESP32, 700);
});

function setupJointSliders() {
  const joints = ['base', 'shoulder', 'elbow', 'gripper'];

  joints.forEach((joint) => {
    const slider = document.getElementById(`sl_${joint}`);
    const valDisplay = document.getElementById(`val_${joint}`);

    slider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      state.angles[joint] = val;
      valDisplay.textContent = `${val}°`;

      // Update 3D target & actual
      robot3d.setTargetAngles(
        state.angles.base,
        state.angles.shoulder,
        state.angles.elbow,
        state.angles.gripper
      );

      // If in demo mode, actual follows target directly
      if (!isHardwareConnected) {
        robot3d.setActualAngles(
          state.angles.base,
          state.angles.shoulder,
          state.angles.elbow,
          state.angles.gripper
        );
      } else {
        // Send to ESP32
        const servoIdx = { base: 0, shoulder: 1, elbow: 2, gripper: 3 }[joint];
        sendESP32Command(`/set?i=${servoIdx}&a=${val}`);
      }
    });
  });
}

function setupConveyorControls() {
  const btnRun = document.getElementById('btn_conv_run');
  const btnStop = document.getElementById('btn_conv_stop');
  const spdSlider = document.getElementById('sl_conv_spd');
  const spdVal = document.getElementById('val_conv_spd');
  const chkRev = document.getElementById('chk_conv_rev');
  const btnResetCargo = document.getElementById('btn_reset_cargo');

  btnRun.addEventListener('click', () => {
    state.conveyor.running = true;
    robot3d.setConveyor(true, state.conveyor.speed, state.conveyor.reverse);
    if (isHardwareConnected) sendESP32Command('/kv?on=1');
  });

  btnStop.addEventListener('click', () => {
    state.conveyor.running = false;
    robot3d.setConveyor(false, state.conveyor.speed, state.conveyor.reverse);
    if (isHardwareConnected) sendESP32Command('/kv?on=0');
  });

  spdSlider.addEventListener('input', (e) => {
    const spd = parseInt(e.target.value);
    state.conveyor.speed = spd;
    spdVal.textContent = `${spd}%`;
    robot3d.setConveyor(state.conveyor.running, spd, state.conveyor.reverse);
    if (isHardwareConnected) sendESP32Command(`/kcfg?p=${spd}&b=${state.conveyor.reverse ? 1 : 0}`);
  });

  chkRev.addEventListener('change', (e) => {
    state.conveyor.reverse = e.target.checked;
    robot3d.setConveyor(state.conveyor.running, state.conveyor.speed, state.conveyor.reverse);
    if (isHardwareConnected) sendESP32Command(`/kcfg?p=${state.conveyor.speed}&b=${state.conveyor.reverse ? 1 : 0}`);
  });

  btnResetCargo.addEventListener('click', () => {
    robot3d.resetCargo();
  });
}

function updateSensorUI(isDetected) {
  const badge = document.getElementById('ir_badge');
  const text = document.getElementById('ir_text');
  if (isDetected) {
    badge.classList.add('active');
    text.textContent = 'Objek Terdeteksi';
  } else {
    badge.classList.remove('active');
    text.textContent = 'Area Kosong';
  }
}

function setupPresets() {
  const presets = {
    home: { base: 90, shoulder: 90, elbow: 90, gripper: 0 },
    pick: { base: 35, shoulder: 125, elbow: 55, gripper: 100 },
    drop: { base: 145, shoulder: 85, elbow: 105, gripper: 10 }
  };

  document.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = presets[btn.dataset.preset];
      if (!p) return;

      Object.keys(p).forEach((joint) => {
        state.angles[joint] = p[joint];
        const slider = document.getElementById(`sl_${joint}`);
        const valDisplay = document.getElementById(`val_${joint}`);
        if (slider) slider.value = p[joint];
        if (valDisplay) valDisplay.textContent = `${p[joint]}°`;
      });

      robot3d.setTargetAngles(p.base, p.shoulder, p.elbow, p.gripper);
      if (!isHardwareConnected) {
        robot3d.setActualAngles(p.base, p.shoulder, p.elbow, p.gripper);
      } else {
        sendESP32Command(`/set?i=0&a=${p.base}`);
        sendESP32Command(`/set?i=1&a=${p.shoulder}`);
        sendESP32Command(`/set?i=2&a=${p.elbow}`);
        sendESP32Command(`/set?i=3&a=${p.gripper}`);
      }
    });
  });

  // Reset 3D View button
  document.getElementById('btn_reset_view').addEventListener('click', () => {
    robot3d.resetView();
  });
}

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

    // Sync hardware angles into 3D actual
    if (data.pos && data.pos.length >= 4) {
      robot3d.setActualAngles(data.pos[0], data.pos[1], data.pos[2], data.pos[3]);
    }

    // Sync conveyor state
    if (typeof data.kr !== 'undefined') {
      const isRunning = Boolean(data.kr);
      robot3d.setConveyor(isRunning, data.kp || state.conveyor.speed, Boolean(data.kb));
    }

    // Sync hardware IR sensor
    if (typeof data.ks !== 'undefined') {
      updateSensorUI(Boolean(data.ks));
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

function setupCustomModelUpload() {
  const fileInput = document.getElementById('fileInput');
  const btnUpload = document.getElementById('btn_upload_model');

  btnUpload.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      console.log('Loading user custom model file:', file.name);
      robot3d.loadCustomModel(file);
      document.getElementById('model_name_hud').textContent = file.name;
    }
  });

  // Support Drag & Drop onto viewport
  const viewport = document.getElementById('canvas3d');
  viewport.addEventListener('dragover', (e) => e.preventDefault());
  viewport.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.glb') || file.name.endsWith('.gltf')) {
        robot3d.loadCustomModel(file);
        document.getElementById('model_name_hud').textContent = file.name;
      }
    }
  });
}
