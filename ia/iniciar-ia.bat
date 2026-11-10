@echo off
rem Acordia IA: instala lo necesario la primera vez y abre el servicio en http://127.0.0.1:5000
cd /d "%~dp0"
if exist .venv\Scripts\python.exe goto abrir

echo Primera vez: se instalan PyTorch, librosa y Beat This!. Tarda varios minutos y descarga cerca de 1 GB.
py -3.12 -m venv .venv 2>nul
if not exist .venv\Scripts\python.exe python -m venv .venv
if not exist .venv\Scripts\python.exe goto sinpython
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 goto error

:abrir
echo.
echo Deja esta ventana abierta mientras usas el analisis con IA en Acordia.
.venv\Scripts\python.exe servidor.py
pause
exit /b

:sinpython
echo No se encontro Python. Instala Python 3.12 desde https://www.python.org/downloads/ marcando "Add python.exe to PATH" y vuelve a abrir este archivo.
pause
exit /b

:error
echo La instalacion fallo. Revisa tu conexion a internet, borra la carpeta .venv y vuelve a intentar.
pause
