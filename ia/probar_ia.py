"""
Prueba rápida del motor de IA, sin Acordia ni internet (salvo la primera descarga de Beat This!).

Arma 24 segundos de audio con acordes de piano conocidos (C, G, Am, F, Dm7, G7, Cmaj7, E7) a 96 BPM,
lo analiza con motor.analizar y muestra si reconoció cada acorde.

Ejecutar:  .venv\\Scripts\\python probar_ia.py      (Windows)
           .venv/bin/python probar_ia.py           (Mac / Linux)
"""
import io
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

import motor  # noqa: E402

SR = 22050
BPM = 96
ACORDES = [('C', [48, 52, 55, 60, 64]), ('G', [43, 50, 55, 59, 62]), ('Am', [45, 52, 57, 60, 64]), ('F', [41, 48, 53, 57, 60]),
           ('Dm7', [50, 53, 57, 60, 65]), ('G7', [43, 50, 53, 59, 65]), ('Cmaj7', [48, 52, 55, 59, 64]), ('E7', [40, 47, 50, 56, 62])]


def piano(midi, dur):
    t = np.arange(int(dur * SR)) / SR
    f = 440 * 2 ** ((midi - 69) / 12)
    onda = sum(np.sin(2 * np.pi * f * h * t) * np.exp(-t * (1.5 + h)) / h for h in range(1, 6))
    return onda * np.minimum(1, t * 200)


def cancion():
    pulso = 60 / BPM
    y = np.zeros(int((len(ACORDES) * 4 * pulso + 1) * SR))
    for k, (_, notas) in enumerate(ACORDES):
        for b in range(4):                      # cuatro golpes por acorde (un compás)
            ini = int((k * 4 + b) * pulso * SR)
            golpe = sum(piano(m, pulso) for m in notas)
            golpe[:200] += np.random.default_rng(k * 4 + b).normal(0, 0.8, 200) * (1.5 if b == 0 else 0.7)  # ataque
            y[ini:ini + len(golpe)] += golpe
    return (y / np.abs(y).max() * 0.8).astype(np.float32)


if __name__ == '__main__':
    print('Estado:', motor.estado())
    buf = io.BytesIO()
    sf.write(buf, cancion(), SR, format='WAV')
    inicio = time.time()
    r = motor.analizar(buf.getvalue(), 'prueba.wav')
    print(f"Listo en {time.time() - inicio:.1f} s: {r['bpm']} BPM (real {BPM}), pulsos con {r['motorPulsos']}, tonalidad {r['tonalidad']}")
    pulso = 60 / BPM
    bien = 0
    for k, (esperado, _) in enumerate(ACORDES):
        t = (k * 4 + 2) * pulso                      # mitad del compás
        leido = next((e['acorde'] for e in r['eventos'] if e['inicio'] <= t < e['fin']), 'N')
        igual = leido == esperado
        bien += igual
        print(f'  compás {k + 1}: esperado {esperado:6s} leído {leido:6s} {"✓" if igual else "✗"}')
    print(f'{bien} de {len(ACORDES)} acordes exactos.')
