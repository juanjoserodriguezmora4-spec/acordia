# Dibuja el diagrama de secuencia "Crear canción desde un archivo de audio con referencia".
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Rectangle

participantes = ['Usuario', 'Página\n(app.js)', 'Analizador\n(Web Worker)', 'API REST\n(Spring Boot)', 'Spotify\nWeb API', 'MySQL']
x = {p.split('\n')[0]: i * 2.6 for i, p in enumerate(participantes)}
mensajes = [  # (desde, hacia, texto, respuesta?)
    ('Usuario', 'Página', 'elige el MP3 y busca la canción', False),
    ('Página', 'API REST', 'GET /api/referencias/buscar?q=…', False),
    ('API REST', 'Spotify', 'search (token Client Credentials)', False),
    ('Spotify', 'API REST', 'hasta 10 pistas con su ID', True),
    ('API REST', 'MySQL', '¿cuáles IDs tienen progresión?', False),
    ('API REST', 'Página', 'resultados + "tieneAcordes"', True),
    ('Usuario', 'Página', 'elige un resultado', False),
    ('Página', 'API REST', 'GET /api/referencias/{spotifyId}', False),
    ('API REST', 'MySQL', 'SELECT progresion_referencia', False),
    ('API REST', 'Página', 'secciones y acordes (notación normal)', True),
    ('Usuario', 'Página', '«Crear y analizar»', False),
    ('Página', 'API REST', 'POST /api/canciones (multipart)', False),
    ('API REST', 'MySQL', 'INSERT cancion (audio a ./audios)', False),
    ('API REST', 'Página', 'canción creada (id)', True),
    ('Página', 'Página', 'decodifica: mono a 11.025 Hz', False),
    ('Página', 'API REST', 'GET /api/modelo/transiciones', False),
    ('API REST', 'Página', 'matriz 24×24', True),
    ('Página', 'Analizador', 'muestras + referencia + matriz', False),
    ('Analizador', 'Página', 'progreso (%)', True),
    ('Analizador', 'Página', 'pulsos, acordes, BPM, tono', True),
    ('Página', 'API REST', 'PUT /api/canciones/{id}/acordes', False),
    ('API REST', 'MySQL', 'reemplaza evento_acorde', False),
    ('Página', 'Usuario', 'reproductor con acordes sincronizados', True),
]
paso = 0.62
alto = len(mensajes) * paso + 2.4
fig, ax = plt.subplots(figsize=(15, alto * 0.62))
ax.set_xlim(-1.4, x['MySQL'] + 1.4); ax.set_ylim(-alto, 1.1); ax.axis('off')
ax.set_title('Diagrama de secuencia — crear una canción desde un archivo de audio', fontsize=15, pad=14)
for p in participantes:
    cx = x[p.split('\n')[0]]
    ax.add_patch(FancyBboxPatch((cx - 1.0, 0), 2.0, 0.9, boxstyle='round,pad=0.02,rounding_size=0.12',
                                fc='#fdf3e3' if p != 'Usuario' else '#eef5f4', ec='#b8781c' if p != 'Usuario' else '#2f7f72', lw=1.4))
    ax.text(cx, 0.45, p, ha='center', va='center', fontsize=10, fontweight='bold')
    ax.plot([cx, cx], [0, -alto + 0.4], ls=(0, (4, 4)), color='#999999', lw=1)
for i, (d, h, texto, resp) in enumerate(mensajes, start=1):
    y = -(i * paso) - 0.6
    if d == h:
        cx = x[d]
        ax.plot([cx + 0.05, cx + 0.45, cx + 0.45], [y + 0.08, y + 0.08, y - 0.2], color='#222222', lw=1.1)
        ax.annotate('', xy=(cx + 0.06, y - 0.2), xytext=(cx + 0.45, y - 0.2),
                    arrowprops=dict(arrowstyle='-|>', color='#222222', lw=1.1, mutation_scale=12), zorder=3)
        ax.text(cx + 0.55, y - 0.06, f'{i}. {texto}', fontsize=8.5, va='center')
        continue
    x1, x2 = x[d], x[h]
    desv = 0.08 if x2 > x1 else -0.08
    ax.annotate('', xy=(x2 - desv, y), xytext=(x1 + desv, y),
                arrowprops=dict(arrowstyle='->' if resp else '-|>', color='#555555' if resp else '#222222',
                                ls='--' if resp else '-', lw=1.1, mutation_scale=12), zorder=3)
    ax.text((x1 + x2) / 2, y + 0.09, f'{i}. {texto}', ha='center', va='bottom', fontsize=8.5,
            color='#444444' if resp else '#111111')
plt.savefig('secuencia.png', dpi=170, bbox_inches='tight', facecolor='white')
