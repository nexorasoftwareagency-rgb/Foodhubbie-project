@echo off
cd /d "D:\Foodhubbie Project"
node tools\wa-sales-agent.cjs send --copy owner --n 25 --cap 25 >> "%TEMP%\opencode\drip.log" 2>&1
