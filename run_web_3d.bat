@echo off
title Arm Robot 3D Visualizer
cd /d "%~dp0"

echo ============================================================
echo   Arm Robot 4-DOF & Conveyor - 3D Digital Twin Launcher
echo ============================================================
echo.
echo Menjalankan local web server di port 8000...
echo Tekan Ctrl+C di jendela ini jika ingin mematikan server.
echo.

:: Buka browser setelah jeda 1.5 detik agar server siap menerima koneksi
start "" powershell -NoProfile -Command "Start-Sleep -Milliseconds 1500; Start-Process 'http://localhost:8000/web/'"

:: Jalankan python HTTP server
python -m http.server 8000
pause
