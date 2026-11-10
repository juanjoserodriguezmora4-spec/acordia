#!/bin/bash
# Acordia IA (Mac / Linux): instala lo necesario la primera vez y abre el servicio en http://127.0.0.1:5000
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "Primera vez: se instalan PyTorch, librosa y Beat This! (varios minutos, cerca de 1 GB)."
  python3 -m venv .venv && .venv/bin/python -m pip install --upgrade pip && .venv/bin/python -m pip install -r requirements.txt || exit 1
fi
exec .venv/bin/python servidor.py
