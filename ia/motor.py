"""
Acordia IA - motor de análisis con redes neuronales.

  * Pulsos y compases: Beat This! (Foscarin, Schlüter y Widmer, ISMIR 2024).
    https://github.com/CPJKU/beat_this  (licencia MIT; los pesos se descargan solos la primera vez)
    Si no está instalado o no se pudo descargar, se usa librosa.beat (más simple).
  * Acordes: BTC, Bi-directional Transformer for Chord recognition (Park et al., ISMIR 2019).
    https://github.com/jayg996/BTC-ISMIR19  (licencia MIT; los pesos vienen en la carpeta btc/)
    Vocabulario grande: 12 raíces x 14 tipos de acorde (mayor, menor, 7, maj7, m7, sus2, sus4,
    dim, aug, 6, m6, dim7, m7b5, mMaj7) + sin acorde.

Cómo se juntan: BTC da, cada ~0,09 s, la probabilidad de cada acorde. Se promedian esas
probabilidades dentro de cada pulso y se elige la secuencia de acordes por pulso con Viterbi:
cambiar de acorde "cuesta" (más o menos según la barra "Cambios de acorde" de la página) y
cuesta menos en el tiempo 1 del compás. El resultado tiene el mismo formato que el analizador
del navegador (analizador.js), así la página lo guarda igual.
"""
from __future__ import annotations

import io
import math
import os
import threading
import time
from collections import Counter

import numpy as np

CARPETA = os.path.dirname(os.path.abspath(__file__))
SR = 22050

# ----------------------------------------------------------------------------- BTC (acordes)
RAICES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
TIPOS_BTC = ['min', 'maj', 'dim', 'aug', 'min6', 'maj6', 'min7', 'minmaj7', 'maj7', '7', 'dim7', 'hdim7', 'sus2', 'sus4']
# Cómo se escribe cada tipo en Acordia (acordes.js entiende todos estos).
TIPO_ACORDIA = {'min': 'm', 'maj': '', 'dim': 'dim', 'aug': 'aug', 'min6': 'm6', 'maj6': '6', 'min7': 'm7',
                'minmaj7': 'mmaj7', 'maj7': 'maj7', '7': '7', 'dim7': 'dim7', 'hdim7': 'm7b5', 'sus2': 'sus2', 'sus4': 'sus4'}
INDICE_X, INDICE_N, NUM_ACORDES = 168, 169, 170   # X = acorde que el modelo no sabe nombrar, N = sin acorde

CONFIG_BTC = {  # run_config.yaml del repositorio original (vocabulario grande)
    'feature_size': 144, 'timestep': 108, 'num_chords': NUM_ACORDES, 'input_dropout': 0.2, 'layer_dropout': 0.2,
    'attention_dropout': 0.2, 'relu_dropout': 0.2, 'num_layers': 8, 'num_heads': 4, 'hidden_size': 128,
    'total_key_depth': 128, 'total_value_depth': 128, 'filter_size': 128, 'loss': 'ce', 'probs_out': False,
}
INST_LEN = 10.0      # segundos por bloque de CQT
HOP = 2048
BINS, BINS_OCTAVA = 144, 24
SEG_POR_CUADRO = INST_LEN / CONFIG_BTC['timestep']   # ~0,0926 s


def nombre_acorde(indice: int) -> str:
    """Índice de BTC -> nombre en Acordia ('N' = sin acorde)."""
    if indice >= INDICE_X:
        return 'N'
    return RAICES[indice // 14] + TIPO_ACORDIA[TIPOS_BTC[indice % 14]]


class _Modelos:
    """Los modelos se cargan una sola vez (la primera vez que se analiza), en un hilo a la vez."""

    def __init__(self):
        self.candado = threading.Lock()
        self.btc = None
        self.media = None
        self.desv = None
        self.beat_this = None
        self.error_beat_this = None
        self.intento_beat_this = False
        self.ultimo_motor_pulsos = None
        self.ultimo_intento = 0.0

    def cargar_btc(self):
        with self.candado:
            if self.btc is None:
                import torch
                from btc.btc_model import BTC_model
                ruta = os.path.join(CARPETA, 'btc', 'btc_model_large_voca.pt')
                # El archivo trae la media y la desviación de entrenamiento (números de numpy), por eso weights_only=False.
                datos = torch.load(ruta, map_location='cpu', weights_only=False)
                modelo = BTC_model(config=CONFIG_BTC)
                modelo.load_state_dict(datos['model'])
                modelo.eval()
                self.btc, self.media, self.desv = modelo, datos['mean'], datos['std']
        return self.btc

    def cargar_beat_this(self):
        """
        Carga Beat This!. Busca primero el archivo de pesos en ia/modelos/ (descargado a mano) y si no está,
        lo descarga de la nube de la universidad JKU. Si falla, lo dice en la ventana y lo vuelve a intentar
        en el siguiente análisis (pasados 2 minutos).
        """
        with self.candado:
            if self.beat_this is None and (not self.intento_beat_this or time.time() - self.ultimo_intento > 120):
                self.intento_beat_this = True
                self.ultimo_intento = time.time()
                ruta = ruta_pesos_beat_this()
                try:
                    from beat_this.inference import Audio2Beats
                    self.beat_this = Audio2Beats(checkpoint_path=ruta or 'final0', device='cpu', dbn=False)
                    self.error_beat_this = None
                    print(f'[Acordia IA] Beat This! listo ({ruta or "descargado en la caché de PyTorch"}).', flush=True)
                except Exception as e:
                    # beat_this envuelve el error real (sin internet, certificado, archivo dañado...) en un ValueError.
                    causa = e.__cause__ or e.__context__ or e
                    self.error_beat_this = f'{type(causa).__name__}: {causa}'
                    self.beat_this = None
                    print('[Acordia IA] No se pudo cargar Beat This!, así que los pulsos salen de librosa.\n'
                          f'  Motivo: {self.error_beat_this}\n'
                          '  Solución: descarga final0.ckpt desde https://cloud.cp.jku.at/index.php/s/7ik4RrBKTS273gp\n'
                          f'  y guárdalo en {os.path.join(CARPETA, "modelos")} (después cierra y vuelve a abrir esta ventana).', flush=True)
        return self.beat_this


def ruta_pesos_beat_this() -> str | None:
    """Pesos de Beat This! descargados a mano: variable ACORDIA_BEAT_THIS o ia/modelos/final0.ckpt."""
    propia = os.environ.get('ACORDIA_BEAT_THIS')
    if propia and os.path.isfile(propia):
        return propia
    for nombre in ('final0.ckpt', 'beat_this-final0.ckpt'):
        ruta = os.path.join(CARPETA, 'modelos', nombre)
        if os.path.isfile(ruta):
            return ruta
    return None


MODELOS = _Modelos()


def estado() -> dict:
    """Qué hay instalado, sin cargar los modelos (para que /estado responda rápido)."""
    info = {'torch': False, 'librosa': False, 'beatThis': False, 'btc': os.path.exists(os.path.join(CARPETA, 'btc', 'btc_model_large_voca.pt'))}
    for modulo, clave in (('torch', 'torch'), ('librosa', 'librosa'), ('beat_this', 'beatThis')):
        try:
            __import__(modulo)
            info[clave] = True
        except Exception:
            pass
    info['listo'] = info['torch'] and info['librosa'] and info['btc']
    info['pulsos'] = 'Beat This!' if info['beatThis'] and not MODELOS.error_beat_this else 'librosa'
    if MODELOS.ultimo_motor_pulsos:
        info['ultimoAnalisisPulsos'] = MODELOS.ultimo_motor_pulsos
    if MODELOS.error_beat_this:
        info['avisoBeatThis'] = MODELOS.error_beat_this
    return info


# ----------------------------------------------------------------------------- audio
def cargar_audio(datos: bytes, nombre: str = '') -> np.ndarray:
    """Lee MP3/WAV/OGG/FLAC/M4A desde bytes y lo deja en mono a 22.050 Hz."""
    import librosa
    import soundfile as sf
    try:
        y, sr = sf.read(io.BytesIO(datos), dtype='float32', always_2d=False)
    except Exception:
        # Formatos que soundfile no abre (por ejemplo M4A): se guardan en un archivo temporal para librosa/audioread.
        import tempfile
        ext = os.path.splitext(nombre)[1] or '.mp3'
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(datos)
            ruta = tmp.name
        try:
            y, sr = librosa.load(ruta, sr=None, mono=True)
        except Exception:
            raise ValueError('No se pudo leer el audio. Usa MP3, WAV, OGG o FLAC.')
        finally:
            os.unlink(ruta)
    if y.ndim == 2:
        y = y.mean(axis=1)
    if sr != SR:
        y = librosa.resample(y, orig_sr=sr, target_sr=SR)
    return np.ascontiguousarray(y, dtype=np.float32)


# ----------------------------------------------------------------------------- pulsos
def pulsos_y_compas(y: np.ndarray, bpm_sugerido: float | None):
    """Devuelve (pulsos en segundos, índices de los tiempos 1, motor usado)."""
    modelo = MODELOS.cargar_beat_this()
    if modelo is not None:
        beats, downbeats = modelo(y, SR)
        beats, downbeats = np.asarray(beats, dtype=float), np.asarray(downbeats, dtype=float)
        motor = 'Beat This!'
    else:
        import librosa
        tempo, cuadros = librosa.beat.beat_track(y=y, sr=SR, start_bpm=bpm_sugerido or 120, units='frames', trim=False)
        beats = librosa.frames_to_time(cuadros, sr=SR)
        downbeats = np.array([])
        motor = 'librosa'
    beats = np.sort(beats)
    if len(beats) < 4:
        raise ValueError('No se encontraron pulsos en el audio (¿está en silencio?).')

    # Si el usuario dijo el tempo y salió al doble o a la mitad, se corrige.
    if bpm_sugerido:
        actual = 60.0 / float(np.median(np.diff(beats)))
        if actual > bpm_sugerido * 1.5:            # salió al doble: se deja un pulso de cada dos
            fase = _fase_con_mas_tiempos_uno(beats, downbeats)
            beats = beats[fase::2]
        elif actual < bpm_sugerido / 1.5:          # salió a la mitad: se agrega el pulso del medio
            medios = (beats[:-1] + beats[1:]) / 2
            beats = np.sort(np.concatenate([beats, medios]))

    # Tiempo 1: el pulso más cercano a cada tiempo 1 detectado; se usa la posición (0-3) más común.
    if len(downbeats):
        indices = [int(np.argmin(np.abs(beats - d))) for d in downbeats]
        primer = Counter(i % 4 for i in indices).most_common(1)[0][0]
    else:
        primer = 0
    return beats, primer, motor


def _fase_con_mas_tiempos_uno(beats, downbeats):
    if not len(downbeats):
        return 0
    indices = [int(np.argmin(np.abs(beats - d))) for d in downbeats]
    pares = sum(1 for i in indices if i % 2 == 0)
    return 0 if pares >= len(indices) - pares else 1


def tempo_de(beats: np.ndarray) -> int:
    """Tempo con recta de mínimos cuadrados sobre los pulsos (como analizador.js), redondeado."""
    n = len(beats)
    a, b = int(n * 0.05), max(int(n * 0.95), int(n * 0.05) + 2)
    k = np.arange(a, b)
    periodo = np.polyfit(k, beats[a:b], 1)[0]
    return int(round(60.0 / periodo))


# ----------------------------------------------------------------------------- acordes
def probabilidades_btc(y: np.ndarray):
    """Probabilidad de cada uno de los 170 acordes cada ~0,09 s, y la afinación estimada (en cents)."""
    import librosa
    import torch
    modelo = MODELOS.cargar_btc()
    # Afinación: si la grabación está un poco arriba o abajo de La 440, se compensa en el CQT.
    semitonos = float(librosa.estimate_tuning(y=y, sr=SR, bins_per_octave=12))   # entre -0,5 y 0,5 semitonos
    afinacion = semitonos * BINS_OCTAVA / 12                                         # en casillas del CQT (1/24 de octava)
    largo = int(SR * INST_LEN)
    partes = []
    for ini in range(0, max(1, len(y)), largo):           # CQT por bloques de 10 s, como en el entrenamiento
        trozo = y[ini:ini + largo]
        if len(trozo) < HOP:
            break
        partes.append(librosa.cqt(trozo, sr=SR, n_bins=BINS, bins_per_octave=BINS_OCTAVA, hop_length=HOP, tuning=afinacion))
    cqt = np.concatenate(partes, axis=1)
    x = np.log(np.abs(cqt) + 1e-6).T                       # (cuadros, 144)
    x = (x - MODELOS.media) / MODELOS.desv
    T = CONFIG_BTC['timestep']
    n = x.shape[0]
    relleno = (-n) % T
    x = np.pad(x, ((0, relleno), (0, 0)))
    salida = []
    with torch.no_grad():
        tensor = torch.tensor(x, dtype=torch.float32).unsqueeze(0)
        for b in range(x.shape[0] // T):
            oculto, _ = modelo.self_attn_layers(tensor[:, b * T:(b + 1) * T, :])
            logits = modelo.output_layer.output_projection(oculto)
            salida.append(torch.softmax(logits, -1)[0].numpy())
    prob = np.concatenate(salida, axis=0)[:n]
    return prob, semitonos * 100.0


PARTE_DEL_PULSO = 0.75                                   # se mira el primer 75 % de cada pulso
FACTOR_POR_TIEMPO = {0: 0.9, 2: 0.97, 1: 1.03, 3: 1.03}   # cambiar en el tiempo 1 (o el 3) cuesta un poco menos


def acordes_por_pulso(prob: np.ndarray, pulsos: np.ndarray, duracion: float, primer: int, estabilidad: float):
    """Promedia las probabilidades al comienzo de cada pulso y elige la secuencia con Viterbi.

    Dos ajustes medidos con canciones de prueba (cambios en el tiempo 1, cada 2 pulsos, adelantados media
    corchea, en los tiempos 2 y 4, y con la rejilla de pulsos corrida hasta 0,09 s):
      - Solo se mira el primer 75 % de cada pulso. El final suele traer ya el acorde siguiente (cuando el
        cambio se adelanta) y ensuciaba la decisión.
      - Cambiar en el tiempo 1 sigue siendo un poco más fácil, pero mucho menos que antes (0,9 en vez de 0,55):
        con la preferencia fuerte, los cambios que caían en los tiempos 2 o 4 se corrían al tiempo 1.
    En esas pruebas los pulsos con el acorde equivocado bajaron de 61 a 15.
    """
    n_cuadros = prob.shape[0]
    tiempos = np.arange(n_cuadros) * SEG_POR_CUADRO
    limites = np.append(pulsos, duracion)
    emision = np.zeros((len(pulsos), NUM_ACORDES))
    for i in range(len(pulsos)):
        a = limites[i]
        b = a + PARTE_DEL_PULSO * max(limites[i + 1] - a, 1e-3)
        sel = (tiempos + SEG_POR_CUADRO / 2 >= a) & (tiempos + SEG_POR_CUADRO / 2 < b)   # centro de cada cuadro
        p = prob[sel].mean(axis=0) if sel.any() else prob[min(n_cuadros - 1, int(a / SEG_POR_CUADRO))]
        emision[i] = p
    emision[:, INDICE_X] = 0.0                     # "X" (no sé qué acorde es) no sirve para tocar
    emision /= emision.sum(axis=1, keepdims=True) + 1e-12
    log_e = np.log(emision + 1e-6)

    # Costo de cambiar de acorde: con la barra en "más estables" cuesta más.
    costo = max(0.5, 8.0 * (float(estabilidad) - 0.5))
    pos = [(i - primer) % 4 for i in range(len(pulsos))]
    factor = FACTOR_POR_TIEMPO

    n, k = log_e.shape
    puntaje = log_e[0].copy()
    atras = np.zeros((n, k), dtype=np.int32)
    for i in range(1, n):
        c = costo * factor[pos[i]]
        mejor_prev = int(np.argmax(puntaje))
        cambiar = puntaje[mejor_prev] - c
        quedarse = puntaje
        elegir_cambio = cambiar > quedarse
        atras[i] = np.where(elegir_cambio, mejor_prev, np.arange(k))
        puntaje = np.where(elegir_cambio, cambiar, quedarse) + log_e[i]
    camino = [int(np.argmax(puntaje))]
    for i in range(n - 1, 0, -1):
        camino.append(int(atras[i][camino[-1]]))
    camino.reverse()
    confianza = [float(emision[i][camino[i]]) for i in range(n)]
    return [nombre_acorde(c) for c in camino], confianza


# ----------------------------------------------------------------------------- tonalidad
def tonalidad_de(acordes: list[str]) -> str | None:
    """La tonalidad con más pulsos de acordes de su escala (I ii iii IV V vi), como app.js."""
    cuenta = Counter()
    for a in acordes:
        if a == 'N':
            continue
        raiz = RAICES.index(a[:2]) if a[:2] in RAICES else RAICES.index(a[0])
        resto = a[len(RAICES[raiz]):]
        menor = resto.startswith('m') and not resto.startswith('maj') or resto.startswith('dim')
        cuenta[(raiz, menor)] += 1
    if sum(cuenta.values()) < 8:
        return None
    c = lambda r, m=False: cuenta[(r % 12, m)]
    mejor = max(range(12), key=lambda t: c(t) + c(t + 2, True) + c(t + 4, True) + c(t + 5) + c(t + 7) + c(t + 9, True)
                + 0.5 * max(c(t), c(t + 9, True)))
    if c(mejor + 9, True) > c(mejor):
        return RAICES[(mejor + 9) % 12] + 'm'
    return RAICES[mejor]


# ----------------------------------------------------------------------------- todo junto
def analizar(datos: bytes, nombre: str = '', bpm: float | None = None, estabilidad: float = 0.82) -> dict:
    y = cargar_audio(datos, nombre)
    duracion = len(y) / SR
    if duracion < 3:
        raise ValueError('El audio es demasiado corto para analizarlo.')
    pulsos, primer, motor_pulsos = pulsos_y_compas(y, bpm)
    MODELOS.ultimo_motor_pulsos = motor_pulsos
    # Pulsos antes del primero y después del último (intro y final sin golpes claros), como analizador.js.
    periodo = float(np.median(np.diff(pulsos)))
    antes = list(np.arange(pulsos[0] - periodo, 0.02, -periodo))[::-1]
    despues = list(np.arange(pulsos[-1] + periodo, duracion - 0.05, periodo))
    primer = (primer + len(antes)) % 4
    pulsos = np.round(np.array(antes + list(pulsos) + despues), 3)

    prob, cents = probabilidades_btc(y)
    acordes, confianza = acordes_por_pulso(prob, pulsos, duracion, primer, estabilidad)

    eventos = []
    for i, a in enumerate(acordes):
        fin = float(pulsos[i + 1]) if i + 1 < len(pulsos) else duracion
        if eventos and eventos[-1]['acorde'] == a:
            eventos[-1]['fin'] = round(fin, 3)
            eventos[-1]['_c'].append(confianza[i])
        else:
            eventos.append({'inicio': 0.0 if i == 0 else float(pulsos[i]), 'fin': round(fin, 3), 'acorde': a,
                            'origen': 'DETECTADO', '_c': [confianza[i]]})
    for e in eventos:
        e['confianza'] = round(float(np.mean(e.pop('_c'))), 2)

    return {
        'motor': 'ia',
        'motorPulsos': motor_pulsos,
        'motorAcordes': 'BTC',
        'duracion': round(duracion, 3),
        'bpm': tempo_de(pulsos) if len(pulsos) >= 8 else (round(bpm) if bpm else None),
        'pulsos': [float(p) for p in pulsos],
        'primerTiempo': int(primer),
        'compases': list(range(int(primer), len(pulsos), 4)),
        'acordesPorPulso': acordes,
        'eventos': eventos,
        'tonalidad': tonalidad_de(acordes),
        'afinacionCents': int(round(cents)),
        'transposicionReferencia': 0,
        'referenciaConfiable': None,
    }
