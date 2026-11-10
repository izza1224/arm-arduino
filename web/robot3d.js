/**
 * Robot3D Engine - Professional Cyan/White Industrial 4-DOF Robot Arm & Front Conveyor
 * Exact match with Industrial Digital Twin Reference
 */

import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';

export class Robot3D {
  constructor(container) {
    this.container = container;
    this.customModel = null;
    this.useCustomModel = false;

    // Kinematics state (degrees)
    this.target = { base: 0, shoulder: 0, elbow: 0, gripper: 0 };
    this.actual = { base: 0, shoulder: 0, elbow: 0, gripper: 0 };
    this.current = { base: 0, shoulder: 0, elbow: 0, gripper: 0 };

    // Conveyor state
    this.conveyor = {
      running: false,
      speed: 70,       // %
      reverse: false,
      holdSeconds: 5,  // seconds to hold on sensor trigger (0 = wait forever)
      holdTimer: 0,    // active countdown
      isHolding: false,
      state: 'JALAN'   // 'JALAN' | 'WAIT_PICK' | 'COUNTDOWN'
    };

    // Sensor & Cargo state
    this.sensorTriggered = false;
    this.onSensorChange = null;
    this.onHoldTimerTick = null;
    this.onConveyorStateChange = null;

    // Cargo blocks on conveyor
    this.cargos = [];
    this.isGrasping = false;
    this.placedCargo = null;

    this.init();
  }

  init() {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 500;

    // WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    // Scene & Dark Atmosphere (No Fog to prevent darkening when zoom out)
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c111c);

    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const roomEnv = new RoomEnvironment();
      this.scene.environment = pmrem.fromScene(roomEnv, 0.04).texture;
      pmrem.dispose();
      roomEnv.dispose();
    } catch (e) {
      console.warn('RoomEnvironment skipped:', e);
    }

    // Camera - comfortably framed to view both conveyor and robot arm
    this.camera = new THREE.PerspectiveCamera(34, w / h, 0.1, 400);
    this.camera.position.set(0, 16, 38);

    // Orbit Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.target.set(0, 4.0, 1.5);
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 140; // Allow wide zoom-out cleanly

    // Materials
    this.initMaterials();

    // Lights
    this.initLights();

    // Floor & Studio Grid
    this.initFloor();

    // Robot Arm - Positioned at balanced distance (z = -5.0)
    this.robotArm = this.buildRobotArm(false);
    this.ghostArm = this.buildRobotArm(true);
    this.robotArm.root.position.set(0, 0, -5.0);
    this.ghostArm.root.position.set(0, 0, -5.0);
    this.scene.add(this.robotArm.root);
    this.scene.add(this.ghostArm.root);

    // Conveyor - Positioned in Front of Robot Arm
    this.initFrontConveyor();

    // Responsive Resize Observer
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.container);

    // Klik balok kargo di canvas 3D untuk mengambil barang
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.container.addEventListener('pointerdown', (e) => {
      const rect = this.container.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const hits = this.raycaster.intersectObjects(this.cargos, true);
      if (hits.length > 0) {
        this.pickCargo();
      }
    });

    // Render loop
    this.clock = new THREE.Clock();
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  initMaterials() {
    this.materials = {
      // Professional Cyan Robot Enamel
      cyan: new THREE.MeshPhysicalMaterial({
        color: 0x06b6d4,
        metalness: 0.15,
        roughness: 0.28,
        clearcoat: 0.9,
        clearcoatRoughness: 0.12,
        envMapIntensity: 1.3
      }),
      // Pure Industrial White
      white: new THREE.MeshPhysicalMaterial({
        color: 0xf8fafc,
        metalness: 0.08,
        roughness: 0.3,
        clearcoat: 0.9,
        clearcoatRoughness: 0.15,
        envMapIntensity: 1.2
      }),
      // Matte Graphite / Black Metal
      graphite: new THREE.MeshStandardMaterial({
        color: 0x111827,
        metalness: 0.85,
        roughness: 0.35
      }),
      // Polished Steel Axles & Screws
      steel: new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        metalness: 0.95,
        roughness: 0.18
      }),
      // Conveyor Rubber Belt
      rubber: new THREE.MeshStandardMaterial({
        color: 0x1e2430,
        metalness: 0.05,
        roughness: 0.85
      }),
      // Anodized / Brushed Aluminum Frame
      aluminum: new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        metalness: 0.85,
        roughness: 0.28
      }),
      // Amber Optical Reflector
      amberReflector: new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0xd97706,
        emissiveIntensity: 0.4,
        roughness: 0.35
      }),
      // Safety Yellow Accents
      safetyYellow: new THREE.MeshStandardMaterial({
        color: 0xfacc15,
        metalness: 0.1,
        roughness: 0.4
      }),
      // Cargo Payload White Blocks
      cargoMat: new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0.05,
        roughness: 0.25,
        clearcoat: 0.6
      }),
      // LED Glowing Indicators
      irLedOff: new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.6 }),
      irLedOn: new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 3.0 }),
      irBeam: new THREE.MeshBasicMaterial({ color: 0xff2244, transparent: true, opacity: 0.45 }),
      // Ghost Target Preview (Cyan semi-transparent)
      ghost: new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        roughness: 0.4
      })
    };
  }

  initLights() {
    const ambient = new THREE.HemisphereLight(0xe0f2fe, 0x111827, 0.95);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(20, 32, 24);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 160;
    key.shadow.camera.left = -30;
    key.shadow.camera.right = 30;
    key.shadow.camera.top = 30;
    key.shadow.camera.bottom = -30;
    key.shadow.bias = -0.0003;
    key.shadow.radius = 3;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x06b6d4, 1.6);
    rim.position.set(-22, 16, -20);
    this.scene.add(rim);

    const softFill = new THREE.PointLight(0x38bdf8, 1.5, 60, 1.2);
    softFill.position.set(0, 12, 10);
    this.scene.add(softFill);

    // Wide fill light to prevent darkness at extreme zoom-out
    const zoomFill = new THREE.DirectionalLight(0xffffff, 0.7);
    zoomFill.position.set(0, 40, 40);
    this.scene.add(zoomFill);
  }

  initFloor() {
    // Clean Dark Floor Disc (Original style)
    const floorGeo = new THREE.CircleGeometry(55, 64);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0e131d,
      roughness: 0.85,
      metalness: 0.2
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Fine industrial floor grid
    const grid = new THREE.GridHelper(50, 50, 0x223047, 0x141d2b);
    grid.position.y = 0.01;
    grid.material.transparent = true;
    grid.material.opacity = 0.6;
    this.scene.add(grid);

    // Accent status circle around robot
    const ringGeo = new THREE.RingGeometry(4.8, 5.0, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.02, -5.0);
    this.scene.add(ring);
  }

  // Helper geometry builder
  createRoundedBox(len, h, d, r, x0 = 0) {
    const s = new THREE.Shape();
    const R = Math.min(r, len / 2, h / 2);
    s.moveTo(R, 0);
    s.lineTo(len - R, 0);
    s.quadraticCurveTo(len, 0, len, R);
    s.lineTo(len, h - R);
    s.quadraticCurveTo(len, h, len - R, h);
    s.lineTo(R, h);
    s.quadraticCurveTo(0, h, 0, h - R);
    s.lineTo(0, R);
    s.quadraticCurveTo(0, 0, R, 0);

    const bev = Math.min(0.25, d / 4);
    const geo = new THREE.ExtrudeGeometry(s, {
      depth: d - 2 * bev,
      bevelEnabled: true,
      bevelThickness: bev,
      bevelSize: bev,
      bevelSegments: 3,
      curveSegments: 8
    });
    geo.translate(x0, -h / 2, -(d - 2 * bev) / 2);
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Build High-Fidelity Professional 4-DOF Arm
   * Exact style: Cyan/White/Graphite, twin upright shoulder struts, horizontal gripper head
   */
  buildRobotArm(ghost = false) {
    const M = ghost
      ? { c: this.materials.ghost, w: this.materials.ghost, g: this.materials.ghost, s: this.materials.ghost }
      : { c: this.materials.cyan, w: this.materials.white, g: this.materials.graphite, s: this.materials.steel };

    const root = new THREE.Group();

    const addMesh = (geo, mat, parent, shadow = !ghost) => {
      const m = new THREE.Mesh(geo, mat);
      if (shadow) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
      parent.add(m);
      return m;
    };

    // 1. Base Plate & Mount (Bottom)
    const basePlate = addMesh(new THREE.CylinderGeometry(4.0, 4.4, 0.7, 48), M.g, root);
    basePlate.position.y = 0.35;

    // Cyan base circular hub
    const baseHub = addMesh(new THREE.CylinderGeometry(3.5, 3.8, 1.2, 48), M.c, root);
    baseHub.position.y = 1.25;

    // 2. Base Yaw Turntable (Joint 0: Base)
    const yaw = new THREE.Group();
    yaw.position.y = 1.85;
    root.add(yaw);

    const turntable = addMesh(new THREE.CylinderGeometry(3.1, 3.4, 0.9, 48), M.c, yaw);
    turntable.position.y = 0.45;

    // Twin Vertical White Shoulder Struts (Exactly as in Reference Image 3)
    const strutHeight = 5.2;
    for (const z of [-1.35, 1.35]) {
      const strutGeo = this.createRoundedBox(1.5, strutHeight, 0.65, 0.3, -0.75);
      const strut = addMesh(strutGeo, M.w, yaw);
      strut.position.set(0, strutHeight / 2 + 0.8, z);
    }

    // Horizontal crossbars between white struts
    for (const y of [2.0, 3.6]) {
      const bar = addMesh(new THREE.BoxGeometry(0.8, 0.35, 2.3), M.g, yaw);
      bar.position.set(0, y, 0);
    }

    // 3. Shoulder / Siku (Joint 1: Pitch)
    const shoulder = new THREE.Group();
    shoulder.position.set(0, 5.6, 0);
    yaw.add(shoulder);

    // Main Shoulder Cylindrical Axle & Caps
    const shAxle = addMesh(new THREE.CylinderGeometry(1.2, 1.2, 3.5, 32), M.g, shoulder);
    shAxle.rotation.x = Math.PI / 2;

    for (const z of [-1.9, 1.9]) {
      const cap = addMesh(new THREE.CylinderGeometry(0.8, 0.8, 0.35, 24), M.c, shoulder);
      cap.rotation.x = Math.PI / 2;
      cap.position.z = z;
    }

    // Upper Arm Main Cyan Beam (Length = L1 = 7.0)
    const L1 = 7.0;
    const upperGeo = this.createRoundedBox(1.6, L1 + 0.6, 1.6, 0.4, -0.8);
    const upperArm = addMesh(upperGeo, M.c, shoulder);
    upperArm.position.y = L1 / 2;

    // 4. Elbow / Lengan Atas (Joint 2: Pitch)
    const elbow = new THREE.Group();
    elbow.position.set(0, L1, 0);
    shoulder.add(elbow);

    // Elbow Joint Axle & Black side hub
    const elAxle = addMesh(new THREE.CylinderGeometry(1.0, 1.0, 2.5, 32), M.g, elbow);
    elAxle.rotation.x = Math.PI / 2;

    // Forearm / Head Boom extending forward horizontally (Length = L2 = 6.2)
    const L2 = 6.2;
    const foreGeo = this.createRoundedBox(L2, 1.6, 1.7, 0.4, 0);
    const foreArm = addMesh(foreGeo, M.c, elbow);
    foreArm.position.set(0, 0, 0);

    // White accent block on head
    const headBlock = addMesh(this.createRoundedBox(2.2, 1.7, 1.78, 0.35, L2 - 2.2), M.w, elbow);

    // 5. Gripper / Capit (Joint 3)
    const wrist = new THREE.Group();
    wrist.position.set(L2, 0, 0);
    elbow.add(wrist);

    // Gripper mount collar
    const collar = addMesh(new THREE.CylinderGeometry(0.7, 0.7, 1.2, 24), M.g, wrist);
    collar.rotation.z = Math.PI / 2;
    collar.position.x = 0.5;

    // Twin Gripper Jaws (Facing forward)
    const fingers = [];
    for (const side of [-1, 1]) {
      const fGroup = new THREE.Group();
      wrist.add(fGroup);

      // Jaw finger
      const jaw = addMesh(new THREE.BoxGeometry(1.6, 0.6, 0.4), M.w, fGroup);
      jaw.position.set(1.4, 0, side * 0.45);

      // Black tip pad
      const pad = addMesh(new THREE.BoxGeometry(0.4, 0.62, 0.42), M.g, fGroup);
      pad.position.set(2.0, 0, side * 0.45);

      fGroup.userData.side = side;
      fingers.push(fGroup);
    }

    // Kotak kargo yang menempel di capit saat diambil (active when grasping)
    let heldBox = null;
    if (!ghost) {
      heldBox = addMesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), this.materials.cargoMat, wrist);
      heldBox.position.set(1.55, 0, 0);
      heldBox.visible = false;
    }

    return { root, yaw, shoulder, elbow, wrist, fingers, heldBox };
  }

  /**
   * Build Front Conveyor Belt Assembly (Previous Clean Style, Slightly Elevated)
   * Placed horizontally along X-axis in front of the robot (z = 4.5)
   * Length = 28 (original width and length), height = 5.2 (elevated slightly for better pick alignment)
   */
  initFrontConveyor() {
    this.conveyorGroup = new THREE.Group();
    this.conveyorGroup.position.set(0, 0, 4.5);

    const length = 28;
    const width = 4.8;
    const height = 5.2;

    // 1. Four Black Support Legs with feet
    const legGeo = new THREE.CylinderGeometry(0.4, 0.48, height, 16);
    const legX = [-length / 2 + 2.0, length / 2 - 2.0];
    const legZ = [-width / 2 + 0.4, width / 2 - 0.4];

    for (const x of legX) {
      for (const z of legZ) {
        const leg = new THREE.Mesh(legGeo, this.materials.graphite);
        leg.position.set(x, height / 2, z);
        leg.castShadow = true;
        leg.receiveShadow = true;
        this.conveyorGroup.add(leg);
      }
    }

    // 2. Heavy Industrial Side Rails (Black & Steel Trim)
    const railGeo = new THREE.BoxGeometry(length, 0.85, 0.35);
    for (const z of [-width / 2, width / 2]) {
      const rail = new THREE.Mesh(railGeo, this.materials.graphite);
      rail.position.set(0, height + 0.25, z);
      rail.castShadow = true;
      rail.receiveShadow = true;
      this.conveyorGroup.add(rail);

      // Silver top guide lip
      const lip = new THREE.Mesh(new THREE.BoxGeometry(length, 0.15, 0.4), this.materials.steel);
      lip.position.set(0, height + 0.7, z);
      this.conveyorGroup.add(lip);
    }

    // 3. Rollers at Both Ends
    const rollerGeo = new THREE.CylinderGeometry(0.65, 0.65, width - 0.7, 32);
    rollerGeo.rotateX(Math.PI / 2);
    const leftRoller = new THREE.Mesh(rollerGeo, this.materials.steel);
    leftRoller.position.set(-length / 2 + 0.7, height + 0.2, 0);
    const rightRoller = new THREE.Mesh(rollerGeo, this.materials.steel);
    rightRoller.position.set(length / 2 - 0.7, height + 0.2, 0);
    this.conveyorGroup.add(leftRoller);
    this.conveyorGroup.add(rightRoller);

    // 4. Cyan Motor Unit on the Right Side
    const motorGeo = new THREE.CylinderGeometry(1.1, 1.1, 2.4, 32);
    motorGeo.rotateZ(Math.PI / 2);
    const motor = new THREE.Mesh(motorGeo, this.materials.cyan);
    motor.position.set(length / 2 + 1.2, height + 0.2, 0);
    motor.castShadow = true;
    this.conveyorGroup.add(motor);

    // 5. High-Quality Treaded Belt Texture
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1c232f';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#2d3748';
    for (let i = 0; i < 128; i += 12) {
      ctx.fillRect(i, 0, 3, 128); // transverse traction ridges
    }
    this.beltTexture = new THREE.CanvasTexture(canvas);
    this.beltTexture.wrapS = THREE.RepeatWrapping;
    this.beltTexture.wrapT = THREE.RepeatWrapping;
    this.beltTexture.repeat.set(14, 1);

    const beltMat = new THREE.MeshStandardMaterial({
      map: this.beltTexture,
      roughness: 0.82,
      metalness: 0.1
    });

    const beltGeo = new THREE.BoxGeometry(length - 1.4, 0.25, width - 0.8);
    this.beltMesh = new THREE.Mesh(beltGeo, beltMat);
    this.beltMesh.position.set(0, height + 0.42, 0);
    this.beltMesh.castShadow = true;
    this.beltMesh.receiveShadow = true;
    this.conveyorGroup.add(this.beltMesh);

    // 6. Professional Infrared Sensor (Di ujung kanan dekat motor)
    this.sensorStationX = 10.5;
    this.sensorGroup = new THREE.Group();
    this.sensorGroup.position.set(this.sensorStationX, height + 0.8, -width / 2 - 0.6);

    // Sensor mounting tower
    const sensorPost = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.8, 16), this.materials.steel);
    this.sensorGroup.add(sensorPost);

    // Sensor barrel
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.2, 16), this.materials.graphite);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.6, 0.6);
    this.sensorGroup.add(barrel);

    // Sensor Active Indicator LED
    this.sensorLed = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), this.materials.irLedOff);
    this.sensorLed.position.set(0, 1.0, 0.3);
    this.sensorGroup.add(this.sensorLed);

    // Subtle optical beam line across the belt
    const beamGeo = new THREE.CylinderGeometry(0.04, 0.04, width + 0.4, 8);
    beamGeo.rotateX(Math.PI / 2);
    this.beamLine = new THREE.Mesh(beamGeo, this.materials.irBeam);
    this.beamLine.position.set(0, 0.6, width / 2 + 0.2);
    this.sensorGroup.add(this.beamLine);

    this.conveyorGroup.add(this.sensorGroup);

    // 7. Single Payload White Cube (1 Kotak Kargo)
    const boxSize = 1.2;
    this.cargoY = height + 0.42 + boxSize / 2;
    this.conveyorMinX = -length / 2 + 2.5;
    this.conveyorMaxX = length / 2 - 2.0;

    const block = this.createCargoBlock(boxSize);
    block.position.set(this.conveyorMinX, this.cargoY, 0);
    this.conveyorGroup.add(block);
    this.cargos = [block];

    this.scene.add(this.conveyorGroup);
  }

  createCargoBlock(size = 1.1) {
    const geo = new THREE.BoxGeometry(size, size, size);
    const m = new THREE.Mesh(geo, this.materials.cargoMat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  setTargetAngles(base, shoulder, elbow, gripper) {
    this.target.base = base;
    this.target.shoulder = shoulder;
    this.target.elbow = elbow;
    this.target.gripper = gripper;
  }

  setActualAngles(base, shoulder, elbow, gripper) {
    this.actual.base = base;
    this.actual.shoulder = shoulder;
    this.actual.elbow = elbow;
    this.actual.gripper = gripper;
  }

  setConveyor(running, speed = 70, reverse = false, holdSeconds = 5) {
    this.conveyor.running = running;
    this.conveyor.speed = speed;
    this.conveyor.reverse = reverse;
    this.conveyor.holdSeconds = holdSeconds;
    if (running) {
      if (this.conveyor.state !== 'WAIT_PICK' && this.conveyor.state !== 'COUNTDOWN') {
        this.conveyor.state = 'JALAN';
        this.conveyor.isHolding = false;
      }
    } else {
      this.conveyor.state = 'JALAN';
      this.conveyor.isHolding = false;
    }
  }

  setHoldSeconds(sec) {
    this.conveyor.holdSeconds = Math.max(0, sec);
  }

  setView(mode) {
    const views = {
      iso: [24, 18, 30],
      front: [0, 14, 38],
      side: [38, 14, 2.0],
      top: [0.01, 46, 2.0]
    };
    const target = views[mode] || views.iso;
    this.cameraGoal = new THREE.Vector3(...target);
    this.controls.target.set(0, 4.0, 1.5);
  }

  resetView() {
    this.setView('iso');
  }

  resetCargos() {
    this.isGrasping = false;
    if (this.robotArm && this.robotArm.heldBox) {
      this.robotArm.heldBox.visible = false;
    }
    if (this.placedCargo) {
      this.placedCargo.visible = false;
    }
    if (this.cargos[0]) {
      this.cargos[0].position.set(this.conveyorMinX, this.cargoY, 0);
      this.cargos[0].visible = true;
    }
    this.sensorTriggered = false;
    this.sensorLed.material = this.materials.irLedOff;
    this.conveyor.state = 'JALAN';
    this.conveyor.isHolding = false;
    this.conveyor.holdTimer = 0;
    if (this.onSensorChange) this.onSensorChange(false);
    if (this.onHoldTimerTick) this.onHoldTimerTick(0);
    if (this.onConveyorStateChange) this.onConveyorStateChange('JALAN', 0);
  }

  pickCargo() {
    // Dipanggil saat barang diambil (oleh capit robot, klik balok, atau tombol)
    if (this.cargos[0]) {
      this.cargos[0].visible = false;
    }
    this.sensorTriggered = false;
    this.sensorLed.material = this.materials.irLedOff;
    if (this.onSensorChange) this.onSensorChange(false);

    if (this.conveyor.running && this.conveyor.holdSeconds > 0) {
      // Barang sudah diambil: MULAI HITUNG MUNDUR SEKARANG!
      this.conveyor.state = 'COUNTDOWN';
      this.conveyor.isHolding = true;
      this.conveyor.holdTimer = this.conveyor.holdSeconds;
      if (this.onHoldTimerTick) this.onHoldTimerTick(this.conveyor.holdTimer);
      if (this.onConveyorStateChange) this.onConveyorStateChange('COUNTDOWN', this.conveyor.holdTimer);
    } else {
      this.conveyor.state = 'JALAN';
      this.conveyor.isHolding = false;
      if (this.onConveyorStateChange) this.onConveyorStateChange('JALAN', 0);
    }
  }

  applyAnglesToArm(arm, angles) {
    if (!arm) return;
    const deg2rad = Math.PI / 180;

    // Joint 0: Base Yaw
    // 0 deg = Hadap KIRI (-X)
    // 90 deg = Hadap DEPAN (+Z, ke arah conveyor)
    // 180 deg = Hadap KANAN (+X)
    arm.yaw.rotation.y = (180 + angles.base) * deg2rad;

    // Joint 1: Siku (Shoulder Pitch)
    // 0 deg = Tegak lurus ke atas (upright)
    // >0 deg s/d 180 deg = Menekuk maju menghadap ke DEPAN conveyor
    arm.shoulder.rotation.z = -(angles.shoulder * deg2rad * 0.85);

    // Joint 2: Lengan Atas (Elbow Pitch)
    // 0 deg = Hadap lurus ke ATAS (vertikal tegak)
    // >0 deg s/d 180 deg = Menunduk/menghadap maju ke DEPAN conveyor
    arm.elbow.rotation.z = (90 - angles.elbow) * deg2rad;

    // Joint 3: Gripper (0 = open wide 1.6 unit gap, 120 = clamped onto 1.1 unit box)
    const gripRatio = Math.min(1.0, Math.max(0.0, angles.gripper / 120.0));
    arm.fingers.forEach((f) => {
      const side = f.userData.side;
      f.position.z = side * (0.8 - gripRatio * 0.65);
    });
  }

  animate() {
    requestAnimationFrame(this.animate);
    const dt = this.clock.getDelta();

    // 1. Smooth Kinematics Interpolation (Actual follows target)
    const lerpSpeed = Math.min(1.0, dt * 10);
    this.current.base += (this.actual.base - this.current.base) * lerpSpeed;
    this.current.shoulder += (this.actual.shoulder - this.current.shoulder) * lerpSpeed;
    this.current.elbow += (this.actual.elbow - this.current.elbow) * lerpSpeed;
    this.current.gripper += (this.actual.gripper - this.current.gripper) * lerpSpeed;

    this.applyAnglesToArm(this.robotArm, this.current);
    this.applyAnglesToArm(this.ghostArm, this.target);

    // 2. Grasping & Release Mechanics (Kotak nempel di capit saat diambil)
    const gripperWorldPos = new THREE.Vector3();
    if (this.robotArm && this.robotArm.wrist) {
      // Titik tengah jepitan capit di koordinat wrist (1.55, 0, 0)
      this.robotArm.wrist.localToWorld(gripperWorldPos.set(1.55, 0, 0));
    }

    // A. Ambil Kotak (Pick): Capit menjepit balok saat di dekat stasiun sensor
    if (!this.isGrasping && this.cargos[0] && this.cargos[0].visible) {
      const cargoWorldPos = new THREE.Vector3();
      this.cargos[0].getWorldPosition(cargoWorldPos);
      const distToCargo = gripperWorldPos.distanceTo(cargoWorldPos);

      // Capit berada di sekitar balok (jarak < 4.5) dan capit menutup (gripper >= 40)
      // atau saat lengan dalam posisi ambil di sensor (WAIT_PICK dan shoulder > 25 && gripper > 45)
      const isNearCargo = distToCargo < 4.5;
      const isClamping = this.current.gripper >= 40 || this.actual.gripper >= 40;
      const isPickPose = this.conveyor.state === 'WAIT_PICK' && this.actual.shoulder > 25 && this.actual.gripper > 45;

      if ((isNearCargo && isClamping) || isPickPose) {
        this.isGrasping = true;
        if (this.robotArm.heldBox) this.robotArm.heldBox.visible = true;
        this.cargos[0].visible = false;
        this.pickCargo(); // Beritahu sensor bahwa barang sudah diambil & mulai countdown
      }
    }

    // B. Taruh Kotak (Place / Release): Capit membuka dan melepaskan kotak ke conveyor
    if (this.isGrasping) {
      if (this.current.gripper <= 25 || this.actual.gripper <= 25) {
        this.isGrasping = false;
        if (this.robotArm.heldBox) this.robotArm.heldBox.visible = false;

        // Taruh kotak di atas conveyor pada titik jatuhnya capit
        const localDrop = this.conveyorGroup.worldToLocal(gripperWorldPos.clone());
        const dropX = Math.max(this.conveyorMinX, Math.min(this.conveyorMaxX, localDrop.x));
        const dropZ = Math.max(-1.8, Math.min(1.8, localDrop.z));

        if (this.cargos[0]) {
          this.cargos[0].position.set(dropX, this.cargoY, dropZ);
          this.cargos[0].visible = true;
        }
      }
    }

    // 3. Conveyor Animation & IR Sensor Collision Detection
    const dir = this.conveyor.reverse ? -1 : 1;
    const speedNorm = (this.conveyor.speed / 100) * 3.0 * dir;

    if (this.conveyor.running && this.conveyor.state === 'JALAN') {
      // Scroll belt texture
      this.beltTexture.offset.x -= (speedNorm * dt) / 5;

      // Move Cargo blocks
      let itemAtSensor = false;

      if (!this.isGrasping && this.cargos[0] && this.cargos[0].visible) {
        const cargo = this.cargos[0];
        cargo.position.x += speedNorm * dt;

        // Loop cargo if it falls off ends
        if (dir > 0 && cargo.position.x > this.conveyorMaxX) {
          cargo.position.x = this.conveyorMinX;
        } else if (dir < 0 && cargo.position.x < this.conveyorMinX) {
          cargo.position.x = this.conveyorMaxX;
        }

        // Check proximity to IR optical beam line
        const dist = Math.abs(cargo.position.x - this.sensorStationX);
        if (dist < 1.2) {
          itemAtSensor = true;
        }
      }

      // Handle Sensor Trigger & Automatic Stop
      if (itemAtSensor) {
        if (!this.sensorTriggered) {
          this.sensorTriggered = true;
          this.sensorLed.material = this.materials.irLedOn;
          if (this.onSensorChange) this.onSensorChange(true);

          if (this.conveyor.holdSeconds > 0) {
            // Masuk status WAIT_PICK: Conveyor mati total, timer BELUM berjalan!
            this.conveyor.state = 'WAIT_PICK';
            this.conveyor.isHolding = true;
            this.conveyor.holdTimer = this.conveyor.holdSeconds;
            if (this.onHoldTimerTick) this.onHoldTimerTick(this.conveyor.holdSeconds);
            if (this.onConveyorStateChange) this.onConveyorStateChange('WAIT_PICK', this.conveyor.holdSeconds);
          } else {
            // holdSeconds = 0: berhenti permanen sampai ditekan tombol Jalan
            this.conveyor.running = false;
            this.conveyor.isHolding = false;
            this.conveyor.state = 'JALAN';
            if (this.onConveyorStateChange) this.onConveyorStateChange('STOP', 0);
          }
        }
      } else {
        if (this.sensorTriggered) {
          this.sensorTriggered = false;
          this.sensorLed.material = this.materials.irLedOff;
          if (this.onSensorChange) this.onSensorChange(false);
        }
      }
    } else if (this.conveyor.state === 'WAIT_PICK') {
      // CONVEYOR MATI TOTAL, MENUNGGU BARANG DIAMBIL!
      // Hitungan timer BELUM berjalan.
      // Jika capit robot menjepit balok (ditangani di logika jepit di atas)
    } else if (this.conveyor.state === 'COUNTDOWN') {
      // BARANG SUDAH DIAMBIL: HITUNGAN MUNDUR BERJALAN!
      if (this.conveyor.holdSeconds > 0) {
        this.conveyor.holdTimer -= dt;
        const sisa = Math.max(0, Math.ceil(this.conveyor.holdTimer));
        if (this.onHoldTimerTick) this.onHoldTimerTick(sisa);
        if (this.onConveyorStateChange) this.onConveyorStateChange('COUNTDOWN', sisa);

        if (this.conveyor.holdTimer <= 0) {
          // Timer selesai: otomatis jalankan conveyor kembali!
          this.conveyor.state = 'JALAN';
          this.conveyor.isHolding = false;
          if (this.onConveyorStateChange) this.onConveyorStateChange('JALAN', 0);

          // Jika balok belum ditaruh robot dan tidak sedang digenggam, munculkan balok di pangkal conveyor
          if (!this.isGrasping && this.cargos[0] && !this.cargos[0].visible) {
            this.cargos[0].position.set(this.conveyorMinX, this.cargoY, 0);
            this.cargos[0].visible = true;
          }
        }
      } else {
        this.conveyor.state = 'JALAN';
        this.conveyor.isHolding = false;
        if (this.onConveyorStateChange) this.onConveyorStateChange('JALAN', 0);
      }
    }

    // Smooth Camera Transition to View Presets
    if (this.cameraGoal) {
      this.camera.position.lerp(this.cameraGoal, dt * 5);
      if (this.camera.position.distanceTo(this.cameraGoal) < 0.1) {
        this.camera.position.copy(this.cameraGoal);
        this.cameraGoal = null;
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w && h) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    }
  }
}
