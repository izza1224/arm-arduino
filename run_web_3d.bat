@echo off
title Arm Robot 3D Visualizer
echo ============================================================
echo   Arm Robot 4-DOF & Conveyor - 3D Digital Twin Launcher
echo ============================================================
echo.
echo Membuka web visualizer di browser...
start http://localhost:8000/web/
echo Menjalankan local web server di port 8000...
echo Tekan Ctrl+C untuk menghentikan server.
echo.
python -m http.server 8000
pause
