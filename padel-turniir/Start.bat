@echo off
cd /d "C:\Users\janar.meho\Documents\padel-turniir"
echo Kaust: %cd%
if not exist "index.html" (
  echo VIGA: index.html ei leitud siit kaustast. Palun anna sellest teada.
  pause
  exit /b 1
)
start "" http://localhost:8000
python -m http.server 8000
pause
