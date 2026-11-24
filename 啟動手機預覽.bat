@echo off
chcp 65001 >nul
title 多益互動教材 - 手機同 Wi-Fi 預覽伺服器
echo ========================================================
echo   新制多益互動教材（台灣繁體 PWA 版）本機預覽伺服器
echo ========================================================
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /R /C:"IPv4"') do (
  for /f "tokens=* delims= " %%b in ("%%a") do (
    echo   手機連同一個 Wi-Fi 請開啟： http://%%b:8080/
  )
)
echo   電腦本機請開啟：           http://localhost:8080/
echo.
echo   (注意：正式離線 App 安裝請依《手機安裝與免費部署指南.md》使用 HTTPS)
echo   按 Ctrl+C 可關閉伺服器。
echo ========================================================
echo.
cd /d "%~dp0pwa_deploy"
python -m http.server 8080 --bind 0.0.0.0
pause
