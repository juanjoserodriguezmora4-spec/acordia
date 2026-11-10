# Figura del proceso de detección de acordes (para el documento).
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
pasos = [
    ('1. Golpes', 'energía nueva\ncada 12 ms'),
    ('2. Tempo', 'autocorrelación +\ndoble o mitad'),
    ('3. Pulsos', 'programación\ndinámica'),
    ('4. Notas', 'FFT + mediana que\nborra la batería'),
    ('5. Croma', '12 notas por pulso\n(agudos y bajo)'),
    ('6. Compás', 'tiempo 1: cambio de\narmonía + bajo'),
    ('7. Tonalidad', 'plantillas de\n24 acordes'),
    ('8. Viterbi', 'secuencia más\nprobable'),
]
fig, ax = plt.subplots(figsize=(15, 5.2)); ax.set_xlim(0, 15); ax.set_ylim(0, 5.2); ax.axis('off')
ax.set_title('Proceso de detección de acordes (analizador.js)', fontsize=14, pad=8)
pos = [(0.3 + i * 3.65, 3.0) for i in range(4)] + [(0.3 + (3 - i) * 3.65, 0.6) for i in range(4)]
for (t, d), (px, py) in zip(pasos, pos):
    final = t.startswith('8')
    ax.add_patch(FancyBboxPatch((px, py), 2.9, 1.5, boxstyle='round,pad=0.03,rounding_size=0.15',
                                fc='#b8781c' if final else '#fdf3e3', ec='#b8781c', lw=1.5))
    ax.text(px + 1.45, py + 1.08, t, ha='center', fontsize=11.5, fontweight='bold', color='white' if final else '#2a1f17')
    ax.text(px + 1.45, py + 0.5, d, ha='center', va='center', fontsize=9.3, color='white' if final else '#4a3b2d')
for i in range(len(pos) - 1):
    (x1, y1), (x2, y2) = pos[i], pos[i + 1]
    if y1 == y2:
        a, b = ((x1 + 2.95, y1 + 0.75), (x2 - 0.05, y2 + 0.75)) if x2 > x1 else ((x1 - 0.05, y1 + 0.75), (x2 + 2.95, y2 + 0.75))
    else:
        a, b = (x1 + 1.45, y1 - 0.05), (x2 + 1.45, y2 + 1.55)
    ax.annotate('', xy=b, xytext=a, arrowprops=dict(arrowstyle='-|>', color='#555555', lw=1.4))
# entradas extra al Viterbi
ax.text(0.3 + 1.45, 0.25, '+ transiciones (Chordonomicon) + tonalidad\n+ posición en el compás + referencia (si hay)', ha='center', va='top',
        fontsize=9, color='#2f7f72', fontweight='bold')
plt.savefig('proceso-deteccion.png', dpi=170, bbox_inches='tight', facecolor='white')
