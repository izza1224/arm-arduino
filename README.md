# Arm Robot ESP32 & Conveyor Controller

Proyek kontrol **Arm Robot 4-DOF** dan **Conveyor Belt** berbasis ESP32 dengan web interface terintegrasi melalui WiFi (Web Server & mDNS).

## 🚀 Fitur Utama
- **Web UI Control**: Kendali servo real-time dan pengaturan kecepatan langsung dari browser.
- **Arm Robot 4-DOF**: Kendali 4 servo (Base, Siku, Lengan Atas, Capit) menggunakan library `ESP32Servo`.
- **Teach & Repeat (Sequencer)**: Merekam urutan langkah gerakan servo dan menjalankannya secara otomatis atau looping.
- **Conveyor Belt Control**: Kendali arah dan PWM kecepatan conveyor melalui driver motor L298N.
- **Sensor IR Terintegrasi**: Deteksi objek pada conveyor untuk otomatisasi penghentian atau pemicu gerakan robot.
- **Penyimpanan Profil**: Konfigurasi dan urutan langkah disimpan pada flash ESP32 menggunakan library `Preferences`.

## 🛠️ Konfigurasi Pin Hardware

| Komponen | Pin ESP32 | Keterangan |
| :--- | :--- | :--- |
| Servo Base | GPIO 27 | Kendali rotasi dasar |
| Servo Siku | GPIO 26 | Kendali siku |
| Servo Lengan Atas | GPIO 25 | Kendali lengan atas |
| Servo Capit (Gripper) | GPIO 32 | Kendali capit / gripper |
| Conveyor ENA (PWM) | GPIO 18 | Kecepatan conveyor |
| Conveyor IN1 | GPIO 19 | Kendali arah motor |
| Conveyor IN2 | GPIO 21 | Kendali arah motor |
| Sensor IR | GPIO 34 | Input sensor deteksi barang |

## ⚙️ Persyaratan Library Arduino
- `ESP32Servo`
- `Preferences` (bawaan board ESP32)
- `WebServer` (bawaan board ESP32)
- `ESPmDNS` (bawaan board ESP32)
- `WiFi` (bawaan board ESP32)

---
*Dikembangkan untuk praktikum / proyek Otomatisasi Industri.*
