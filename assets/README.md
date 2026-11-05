# Folder 3D Assets

Letakkan file model 3D kamu di dalam folder ini:
- **Format yang didukung**: `.glb` (disarankan) atau `.gltf`
- **Nama file default yang otomatis dimuat**: `robot_arm.glb`

## Struktur Penamaan Node Sendi (Rekomendasi untuk Robot 4-DOF):
Agar putaran sendi otomatis terhubung ke kontrol:
- Sendi Base / Putar Dasar: beri nama objek `base` atau `yaw`
- Sendi Siku / Shoulder: beri nama objek `shoulder` atau `siku`
- Sendi Lengan / Elbow: beri nama objek `elbow` atau `lengan`
- Capit / Gripper: beri nama objek `gripper`, `capit`, atau `finger`

*Jika file belum diletakkan di folder ini, aplikasi web akan otomatis menggunakan visualisasi prosedural High-PBR industrial robot.*
