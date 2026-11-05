/**
 * Robot3D Engine - High-Fidelity 3D Visualizer for 4-DOF Robot Arm & Conveyor
 * Built with Three.js (r160)
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
    this.target = { base: 90, shoulder: 90, elbow: 90, gripper: 0 };
    this.actual = { base: 90, shoulder: 90, elbow: 90, gripper: 0 };
    this.current = { base: 90, shoulder: 90, elbow: 90, gripper: 0 }; // interpolated

    // Conveyor state
    this.conveyor = {
      running: false,
      speed: 70,       // %
      reverse: false,
      beltOffset: 0
    };

    // Sensor & Cargo state
    this.cargoPos = 0.0;     // 0.0 (start) to 1.0 (end/sensor)
    this.cargoActive = true;
    this.sensorTriggered = false;
    this.onSensorChange = null;

    this.init();
  }

  init() {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 500;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    // Scene & Environment
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x090d16);
    this.scene.fog = new THREE.FogExp2(0x090d16, 0.008);

    try {
      const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
      const roomEnv = new RoomEnvironment();
      this.scene.environment = pmremGenerator.fromScene(roomEnv, 0.04).texture;
      pmremGenerator.dispose();
      roomEnv.dispose();
    } catch (err) {
      console.warn('RoomEnvironment skipped:', err);
    }

    // Camera
    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 300);
    this.camera.position.set(24, 20, 28);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.target.set(0, 7, 0);
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02; // Don't go below floor
    this.controls.minDistance = 8;
    this.controls.maxDistance = 80;

    // Materials
    this.initMaterials();

    // Lights
    this.initLights();

    // Environment & Floor
    this.initFloor();

    // Procedural Robot Arm (Primary & Target Ghost)
    this.robotArm = this.buildProceduralArm(false);
    this.ghostArm = this.buildProceduralArm(true);
    this.scene.add(this.robotArm.root);
    this.scene.add(this.ghostArm.root);

    // Conveyor Belt Assembly & Cargo
    this.initConveyor();

    // Resize observer
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.container);

    // Animation Loop
    this.clock = new THREE.Clock();
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  initMaterials() {
    // Industrial PBR Palette
    this.materials = {
      orange: new THREE.MeshPhysicalMaterial({
        color: 0xf59e0b,
        metalness: 0.25,
        roughness: 0.35,
        clearcoat: 0.85,
        clearcoatRoughness: 0.15,
        envMapIntensity: 1.2
      }),
      graphite: new THREE.MeshStandardMaterial({
        color: 0x1e2430,
        metalness: 0.8,
        roughness: 0.35,
        envMapIntensity: 1.0
      }),
      steel: new THREE.MeshStandardMaterial({
        color: 0xd1d5db,
        metalness: 0.95,
        roughness: 0.2,
        envMapIntensity: 1.5
      }),
      darkMetal: new THREE.MeshStandardMaterial({
        color: 0x111827,
        metalness: 0.7,
        roughness: 0.5
      }),
      rubber: new THREE.MeshStandardMaterial({
        color: 0x18181b,
        metalness: 0.05,
        roughness: 0.9
      }),
      glowGreen: new THREE.MeshStandardMaterial({
        color: 0x10b981,
        emissive: 0x10b981,
        emissiveIntensity: 2.5
      }),
      glowOrange: new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0xf59e0b,
        emissiveIntensity: 2.0
      }),
      glowRed: new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xef4444,
        emissiveIntensity: 3.0
      }),
      sensorOff: new THREE.MeshStandardMaterial({
        color: 0x374151,
        roughness: 0.5
      }),
      ghost: new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
        roughness: 0.3
      })
    };
  }

  initLights() {
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x111827, 0.7);
    this.scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(20, 32, 18);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 80;
    keyLight.shadow.camera.left = -22;
    keyLight.shadow.camera.right = 22;
    keyLight.shadow.camera.top = 22;
    keyLight.shadow.camera.bottom = -22;
    keyLight.shadow.bias = -0.0003;
    keyLight.shadow.radius = 2.5;
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.2);
    rimLight.position.set(-20, 15, -20);
    this.scene.add(rimLight);

    const warmFill = new THREE.PointLight(0xf59e0b, 1.5, 40, 1.5);
    warmFill.position.set(5, 4, 10);
    this.scene.add(warmFill);
  }

  initFloor() {
    // Circular dark stage
    const floorGeo = new THREE.CircleGeometry(42, 64);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0e131d,
      roughness: 0.85,
      metalness: 0.2
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Grid helper with subtle opacity
    const grid = new THREE.GridHelper(40, 40, 0x334155, 0x1e293b);
    grid.position.y = 0.01;
    grid.material.transparent = true;
    grid.material.opacity = 0.45;
    this.scene.add(grid);

    // Accent status circle around robot
    const ringGeo = new THREE.RingGeometry(4.8, 5.0, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide
    });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.scene.add(this.ring);
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

    const bev = Math.min(0.2, d / 4);
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

  buildProceduralArm(ghost = false, L1 = 7.5, L2 = 6.8) {
    const P = ghost
      ? { o: this.materials.ghost, g: this.materials.ghost, s: this.materials.ghost, r: this.materials.ghost, glow: this.materials.ghost }
      : { o: this.materials.orange, g: this.materials.graphite, s: this.materials.steel, r: this.materials.rubber, glow: this.materials.glowOrange };

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

    // 1. Robot Base Mount
    const basePlate = addMesh(new THREE.CylinderGeometry(4.2, 4.6, 0.8, 48), P.g, root);
    basePlate.position.y = 0.4;

    const baseHousing = addMesh(new THREE.CylinderGeometry(3.6, 4.0, 1.2, 48), P.o, root);
    baseHousing.position.y = 1.4;

    if (!ghost) {
      // Bolts on base
      for (let i = 0; i < 6; i++) {
        const b = addMesh(new THREE.CylinderGeometry(0.18, 0.18, 0.25, 12), P.s, root);
        const a = (i / 6) * Math.PI * 2;
        b.position.set(Math.cos(a) * 3.9, 0.85, Math.sin(a) * 3.9);
      }
    }

    // 2. Base Yaw Turntable (Joint 0)
    const yaw = new THREE.Group();
    yaw.position.y = 2.0;
    root.add(yaw);

    const turntable = addMesh(new THREE.CylinderGeometry(3.0, 3.4, 1.4, 48), P.g, yaw);
    turntable.position.y = 0.7;

    // Shoulder side struts
    for (const z of [-1.4, 1.4]) {
      const strutGeo = this.createRoundedBox(3.0, 4.8, 0.6, 0.8, -1.5);
      const strut = addMesh(strutGeo, P.o, yaw);
      strut.rotation.z = Math.PI / 2;
      strut.position.set(0, 3.4, z);
    }

    // 3. Shoulder / Siku (Joint 1 - Pitch)
    const shoulder = new THREE.Group();
    shoulder.position.y = 4.6;
    yaw.add(shoulder);

    // Shoulder main axle
    const shAxle = addMesh(new THREE.CylinderGeometry(1.1, 1.1, 3.6, 32), P.g, shoulder);
    shAxle.rotation.x = Math.PI / 2;

    // Shoulder side caps
    for (const z of [-1.85, 1.85]) {
      const cap = addMesh(new THREE.CylinderGeometry(0.7, 0.7, 0.25, 24), P.s, shoulder);
      cap.rotation.x = Math.PI / 2;
      cap.position.z = z;
    }

    // Upper Arm beam (Length = L1)
    const upperBeamGeo = this.createRoundedBox(L1 + 1.0, 2.0, 2.2, 0.8, -0.7);
    addMesh(upperBeamGeo, P.o, shoulder);

    if (!ghost) {
      // Accent metallic plate
      const trimGeo = this.createRoundedBox(L1 * 0.65, 0.3, 2.28, 0.15, L1 * 0.16);
      const trim = addMesh(trimGeo, P.g, shoulder);
      trim.position.y = 0.6;
    }

    // 4. Elbow / Lengan Atas (Joint 2 - Pitch)
    const elbow = new THREE.Group();
    elbow.position.x = L1;
    shoulder.add(elbow);

    // Elbow axle
    const elAxle = addMesh(new THREE.CylinderGeometry(0.95, 0.95, 2.8, 32), P.g, elbow);
    elAxle.rotation.x = Math.PI / 2;

    // Forearm beam (Length = L2)
    const foreBeamGeo = this.createRoundedBox(L2 + 0.6, 1.6, 1.8, 0.7, -0.5);
    addMesh(foreBeamGeo, P.s, elbow);

    if (!ghost) {
      const trimFore = addMesh(this.createRoundedBox(L2 * 0.55, 0.25, 1.86, 0.12, L2 * 0.2), P.o, elbow);
      trimFore.position.y = -0.45;
    }

    // 5. Wrist & Gripper / Capit (Joint 3)
    const wrist = new THREE.Group();
    wrist.position.x = L2;
    elbow.add(wrist);

    // Wrist mount
    const wrMount = addMesh(new THREE.CylinderGeometry(0.8, 0.8, 1.2, 24), P.g, wrist);
    wrMount.rotation.z = Math.PI / 2;
    wrMount.position.x = 0.45;

    // Gripper base palm
    const palm = addMesh(this.createRoundedBox(1.1, 1.8, 2.8, 0.35, 0.9), P.o, wrist);

    // Gripper fingers (Synchronized sliding/pivoting)
    const fingers = [];
    for (const side of [-1, 1]) {
      const fGroup = new THREE.Group();
      wrist.add(fGroup);

      // Finger claw
      const clawGeo = this.createRoundedBox(2.6, 0.75, 0.45, 0.2, 1.8);
      addMesh(clawGeo, P.g, fGroup);

      // Rubber grip pad on inner side
      const padGeo = this.createRoundedBox(1.5, 0.8, 0.16, 0.08, 2.5);
      const pad = addMesh(padGeo, P.r, fGroup);
      pad.position.z = -side * 0.26;

      fGroup.userData.side = side;
      fingers.push(fGroup);
    }

    return { root, yaw, shoulder, elbow, wrist, fingers };
  }

  initConveyor() {
    this.conveyorGroup = new THREE.Group();
    // Position conveyor adjacent to the robot arm
    this.conveyorGroup.position.set(-11, 0, 0);

    const length = 26;
    const width = 5.2;
    const height = 4.2;

    // Legs
    const legGeo = new THREE.CylinderGeometry(0.35, 0.45, height, 16);
    const legMat = this.materials.steel;
    const legX = [-length / 2 + 1.2, length / 2 - 1.2];
    const legZ = [-width / 2 + 0.5, width / 2 - 0.5];

    for (const x of legX) {
      for (const z of legZ) {
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(x, height / 2, z);
        leg.castShadow = true;
        leg.receiveShadow = true;
        this.conveyorGroup.add(leg);
      }
    }

    // Cross brace
    const braceGeo = new THREE.BoxGeometry(length - 2, 0.4, 0.4);
    const brace = new THREE.Mesh(braceGeo, this.materials.steel);
    brace.position.set(0, height * 0.3, 0);
    this.conveyorGroup.add(brace);

    // Side Rails
    const railGeo = new THREE.BoxGeometry(length, 0.9, 0.4);
    const railMat = this.materials.graphite;
    for (const z of [-width / 2, width / 2]) {
      const rail = new THREE.Mesh(railGeo, railMat);
      rail.position.set(0, height + 0.3, z);
      rail.castShadow = true;
      rail.receiveShadow = true;
      this.conveyorGroup.add(rail);
    }

    // Drive Rollers at ends
    const rollerGeo = new THREE.CylinderGeometry(0.7, 0.7, width - 0.8, 24);
    rollerGeo.rotateX(Math.PI / 2);
    const r1 = new THREE.Mesh(rollerGeo, this.materials.steel);
    r1.position.set(-length / 2 + 0.8, height + 0.1, 0);
    const r2 = new THREE.Mesh(rollerGeo, this.materials.steel);
    r2.position.set(length / 2 - 0.8, height + 0.1, 0);
    this.conveyorGroup.add(r1);
    this.conveyorGroup.add(r2);

    // Conveyor Belt surface with repeating stripe canvas texture
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1e242d';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#2d3748';
    for (let i = 0; i < 128; i += 16) {
      ctx.fillRect(0, i, 128, 4);
    }
    this.beltTexture = new THREE.CanvasTexture(canvas);
    this.beltTexture.wrapS = THREE.RepeatWrapping;
    this.beltTexture.wrapT = THREE.RepeatWrapping;
    this.beltTexture.repeat.set(10, 1);

    const beltMat = new THREE.MeshStandardMaterial({
      map: this.beltTexture,
      roughness: 0.8,
      metalness: 0.1
    });

    const beltGeo = new THREE.BoxGeometry(length - 1.6, 0.3, width - 0.9);
    this.beltMesh = new THREE.Mesh(beltGeo, beltMat);
    this.beltMesh.position.set(0, height + 0.35, 0);
    this.beltMesh.castShadow = true;
    this.beltMesh.receiveShadow = true;
    this.conveyorGroup.add(this.beltMesh);

    // Optical IR Sensor at pickup location (near robot, length/2 - 3)
    const sensorX = length / 2 - 3.2;
    const sensorHolder = new THREE.Group();
    sensorHolder.position.set(sensorX, height + 0.5, width / 2 + 0.4);

    // Sensor bracket & barrel
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 0.4), this.materials.steel);
    sensorHolder.add(bracket);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.4, 16), this.materials.darkMetal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.3, -0.6);
    sensorHolder.add(barrel);

    // Sensor Indicator LED (Top)
    this.sensorLed = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), this.materials.sensorOff);
    this.sensorLed.position.set(0, 0.9, 0);
    sensorHolder.add(this.sensorLed);

    this.conveyorGroup.add(sensorHolder);

    // Cargo Box (the payload moved by conveyor)
    const cargoGeo = new THREE.BoxGeometry(2.4, 2.4, 2.4);
    const cargoMat = new THREE.MeshStandardMaterial({
      color: 0x3b82f6,
      roughness: 0.3,
      metalness: 0.2
    });
    this.cargo = new THREE.Mesh(cargoGeo, cargoMat);
    this.cargo.castShadow = true;
    this.cargo.receiveShadow = true;
    this.cargoBaseY = height + 0.35 + 1.2;
    this.cargoStartX = -length / 2 + 2.5;
    this.cargoEndX = sensorX;
    this.cargo.position.set(this.cargoStartX, this.cargoBaseY, 0);
    this.conveyorGroup.add(this.cargo);

    this.scene.add(this.conveyorGroup);
  }

  // Load custom GLTF / GLB model
  loadCustomModel(fileOrUrl, onProgress = null) {
    const loader = new GLTFLoader();

    const handleLoaded = (gltf) => {
      if (this.customModel) {
        this.scene.remove(this.customModel);
      }
      this.customModel = gltf.scene;
      this.customModel.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
          if (node.material) {
            node.material.envMapIntensity = 1.2;
          }
        }
      });

      this.scene.add(this.customModel);
      this.robotArm.root.visible = false;
      this.useCustomModel = true;

      // Try finding joint nodes
      this.bindCustomJoints(this.customModel);
    };

    if (typeof fileOrUrl === 'string') {
      loader.load(fileOrUrl, handleLoaded, onProgress, (err) => {
        console.warn('Custom model URL failed, using procedural:', err);
      });
    } else {
      // File object
      const reader = new FileReader();
      reader.onload = (e) => {
        loader.parse(e.target.result, '', handleLoaded, (err) => {
          console.error('Failed parsing GLB file:', err);
        });
      };
      reader.readAsArrayBuffer(fileOrUrl);
    }
  }

  bindCustomJoints(root) {
    this.customJoints = { base: null, shoulder: null, elbow: null, gripper: [] };
    root.traverse((node) => {
      const name = (node.name || '').toLowerCase();
      if (name.includes('base') || name.includes('yaw')) this.customJoints.base = node;
      else if (name.includes('shoulder') || name.includes('siku') || name.includes('joint1')) this.customJoints.shoulder = node;
      else if (name.includes('elbow') || name.includes('lengan') || name.includes('joint2')) this.customJoints.elbow = node;
      else if (name.includes('capit') || name.includes('gripper') || name.includes('finger')) this.customJoints.gripper.push(node);
    });
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

  setConveyor(running, speed = 70, reverse = false) {
    this.conveyor.running = running;
    this.conveyor.speed = speed;
    this.conveyor.reverse = reverse;
  }

  resetCargo() {
    this.cargoPos = 0.0;
    this.cargoActive = true;
    this.sensorTriggered = false;
    this.sensorLed.material = this.materials.sensorOff;
    if (this.onSensorChange) this.onSensorChange(false);
  }

  resetView() {
    this.controls.reset();
    this.camera.position.set(24, 20, 28);
    this.controls.target.set(0, 7, 0);
  }

  applyAnglesToArm(arm, angles) {
    if (!arm) return;
    const deg2rad = Math.PI / 180;

    // Joint 0: Base Yaw (0-180 mapped around Y)
    arm.yaw.rotation.y = -(angles.base - 90) * deg2rad;

    // Joint 1: Shoulder Pitch (0-180)
    arm.shoulder.rotation.z = (angles.shoulder - 90) * deg2rad;

    // Joint 2: Elbow Pitch (0-180)
    arm.elbow.rotation.z = -(angles.elbow - 90) * deg2rad;

    // Joint 3: Gripper (0 = open, 100 or 180 = closed)
    const gripRatio = Math.min(1.0, Math.max(0.0, angles.gripper / 120.0));
    arm.fingers.forEach((f) => {
      const side = f.userData.side;
      // Synchronized closure: z offset from 0.85 (open) to 0.15 (closed)
      f.position.z = side * (0.85 - gripRatio * 0.7);
    });
  }

  animate() {
    requestAnimationFrame(this.animate);
    const dt = this.clock.getDelta();

    // 1. Lerp actual/current angles smoothly for visual feedback
    const lerpSpeed = Math.min(1.0, dt * 10);
    this.current.base += (this.actual.base - this.current.base) * lerpSpeed;
    this.current.shoulder += (this.actual.shoulder - this.current.shoulder) * lerpSpeed;
    this.current.elbow += (this.actual.elbow - this.current.elbow) * lerpSpeed;
    this.current.gripper += (this.actual.gripper - this.current.gripper) * lerpSpeed;

    // Apply to real arm
    this.applyAnglesToArm(this.robotArm, this.current);

    // Apply to ghost target arm
    this.applyAnglesToArm(this.ghostArm, this.target);

    // 2. Conveyor belt animation
    if (this.conveyor.running) {
      const dir = this.conveyor.reverse ? -1 : 1;
      const velocity = (this.conveyor.speed / 100) * 1.5 * dir;
      this.beltTexture.offset.x -= velocity * dt;

      // Move Cargo
      if (this.cargoActive) {
        this.cargoPos += (velocity * dt) / 10;
        if (this.cargoPos > 1.0) {
          this.cargoPos = 1.0;
          if (!this.sensorTriggered) {
            this.sensorTriggered = true;
            this.sensorLed.material = this.materials.glowRed;
            if (this.onSensorChange) this.onSensorChange(true);
          }
        } else if (this.cargoPos < 0.0) {
          this.cargoPos = 0.0;
        }

        // Interpolate Cargo X
        const curX = THREE.MathUtils.lerp(this.cargoStartX, this.cargoEndX, this.cargoPos);
        this.cargo.position.x = curX;
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
