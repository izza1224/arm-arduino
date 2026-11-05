# Arm Robot ESP32 & Conveyor Controller + 3D Digital Twin

Proyek kontrol **Arm Robot 4-DOF** dan **Conveyor Belt** berbasis ESP32 dengan web interface interaktif dan **Visualisasi 3D Real-time (Digital Twin)** menggunakan Three.js.

---

## 🌟 Fitur Utama
- **3D Digital Twin Interaktif**: Visualisasi 3D robot arm 4-DOF dengan material PBR realistis, pencahayaan studio, bayangan halus, dan conveyor belt beranimasi.
- **Dual Visual Ghost Arm**: Menampilkan posisi aktual fisik robot (*Oranye*) dan target gerakan (*Biru transparan*) secara bersamaan.
- **Simulasi & Sensor IR**: Kotak muatan (cargo) dapat berjalan di conveyor dan memicu sensor IR secara otomatis di simulasi 3D.
- **Dual Mode (Hardware & Simulator)**:
  - **Online**: Sinkronisasi sudut sendi dan status conveyor langsung dengan ESP32 via WiFi REST API.
  - **Offline Demo**: Pengujian interaktif langsung di browser tanpa perlu menyambungkan hardware.
- **Dukungan Custom Model 3D**: Dapat memuat file `.glb` / `.gltf` kustom langsung melalui tombol *Upload 3D* atau diletakkan di folder `assets/`.
- **Teach & Repeat (Sequencer)**: Merekam urutan langkah gerakan servo dan menjalankannya secara otomatis.

---

## 🚀 Cara Menjalankan Visualisasi 3D Web

### Cara 1: Menggunakan Launcher (Paling Mudah)
Cukup **double-click** file:
```
run_web_3d.bat
```
Browser akan otomatis membuka `http://localhost:8000/web/`.

### Cara 2: Menjalankan via Terminal / CLI
```bash
cd "c:\semester 5\otomatisasi-industri\arm-arduino"
python -m http.server 8000
```
Lalu buka browser di **`http://localhost:8000/web/`**.

---

## 🛠️ Konfigurasi Pin Hardware (ESP32)

| Komponen | Pin ESP32 | Keterangan |
| :--- | :--- | :--- |
| Servo Base | GPIO 27 | Rotasi dasar (Yaw) |
| Servo Siku | GPIO 26 | Siku (Shoulder pitch) |
| Servo Lengan Atas | GPIO 25 | Lengan atas (Elbow pitch) |
| Servo Capit | GPIO 32 | Gripper / Capit |
| Conveyor ENA (PWM) | GPIO 18 | Kecepatan motor (L298N) |
| Conveyor IN1 | GPIO 19 | Kendali arah conveyor |
| Conveyor IN2 | GPIO 21 | Kendali arah conveyor |
| Sensor IR | GPIO 34 | Input deteksi objek (Aktif LOW) |

---

## 📁 Struktur Direktori
```
arm-arduino/
├── assets/                     # Letakkan file model 3D custom (.glb / .gltf)
├── web/                        # Aplikasi Web 3D Digital Twin
│   ├── index.html              # Tampilan antarmuka dashboard
│   ├── style.css               # Desain dark mode modern industrial
│   ├── app.js                  # Sinkronisasi kontrol & API ESP32
│   ├── robot3d.js              # Engine visualisasi 3D Three.js
│   └── vendor/                 # Library lokal (Three.js, OrbitControls, GLTFLoader)
├── arm_robot_esp32_conveyor_timer.ino # Firmware ESP32 (dilengkapi CORS support)
├── run_web_3d.bat              # Script sekali klik untuk menjalankan web
└── README.md
```
