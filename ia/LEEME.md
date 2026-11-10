# Acordia IA (opcional)

Un servicio pequeño en Python que analiza las canciones con dos redes neuronales publicadas en congresos de
análisis musical (ISMIR):

| Qué detecta | Modelo | De dónde sale |
|---|---|---|
| Acordes (170 tipos: mayor, menor, 7, maj7, m7, sus2, sus4, dim, aug, 6, m6, dim7, m7♭5, m(maj7) en las 12 notas + sin acorde) | **BTC**, *Bi-directional Transformer for Chord recognition* (Park et al., ISMIR 2019) | https://github.com/jayg996/BTC-ISMIR19 — licencia MIT. Los pesos ya vienen en `btc/`. |
| Pulsos y tiempo 1 de cada compás | **Beat This!** (Foscarin, Schlüter y Widmer, ISMIR 2024) | https://github.com/CPJKU/beat_this — licencia MIT. Los pesos (unos 80 MB) se descargan solos la primera vez. |

Es **opcional**: si no está encendido, Acordia sigue usando su analizador del navegador. Cuando está encendido,
en **Más → Volver a analizar** aparece la opción **IA: BTC + Beat This!**.

## Cómo usarlo (Windows)

1. Instala **Python 3.12** desde https://www.python.org/downloads/ y marca **«Add python.exe to PATH»**.
2. Abre la carpeta `ia` del proyecto y haz doble clic en **`iniciar-ia.bat`**.
   - La primera vez instala PyTorch, librosa y Beat This! (varios minutos, cerca de 1 GB).
   - La primera vez que analices, Beat This! descarga sus pesos (necesita internet una vez).
3. Deja esa ventana abierta (dice `Acordia IA escuchando en http://127.0.0.1:5000`).
4. En Acordia: abre una canción → **Más → Volver a analizar** → **Analizar con: IA** → **Analizar**.

En Mac o Linux es igual, con `./iniciar-ia.sh`.

Para probar que funciona sin abrir Acordia: `.venv\Scripts\python probar_ia.py` arma 8 acordes de piano
(C, G, Am, F, Dm7, G7, Cmaj7, E7), los analiza y dice cuáles reconoció.

## Cómo funciona

1. Spring Boot (`AnalisisIaService`) manda el audio al servicio: el MP3 guardado de la canción, o el audio grabado
   del video de YouTube que sube la página (WAV a 22.050 Hz).
2. **Pulsos**: Beat This! encuentra los pulsos y los tiempos 1. Si escribiste un tempo y salió al doble o a la mitad,
   se corrige. Si Beat This! no está (por ejemplo, sin internet la primera vez), se usa `librosa.beat` y la página lo dice.
3. **Acordes**: se calcula la transformada de Q constante (CQT, 144 bandas, 24 por octava) en bloques de 10 s, como en
   el entrenamiento de BTC, corrigiendo antes la afinación de la grabación. BTC da, cada ~0,09 s, la probabilidad de
   cada uno de los 170 acordes.
4. **Juntar**: se promedian esas probabilidades en el primer 75 % de cada pulso (el final suele traer ya el acorde
   siguiente) y se elige la secuencia con Viterbi: cambiar de acorde tiene un costo (la barra *Cambios de acorde* de la
   página lo sube o lo baja) y cuesta un poco menos en el tiempo 1.
5. El resultado tiene el mismo formato que el analizador del navegador, así que la página lo guarda igual.

## Archivos

- `servidor.py` — servicio web (FastAPI): `GET /estado` y `POST /analizar`. Solo escucha en este computador.
- `motor.py` — el análisis (pulsos, acordes, Viterbi, tonalidad).
- `btc/` — el modelo BTC copiado del repositorio original (licencia en `btc/LICENSE-BTC.txt`); el único cambio es que
  `np.float` (ya no existe en numpy 2) se cambió por `np.float64`.
- `requirements.txt` — versiones probadas.
- `probar_ia.py` — prueba rápida.

## Problemas comunes

- **«El servicio de IA no está encendido»** en Acordia: abre `iniciar-ia.bat` y deja la ventana abierta.
- **«pulsos con librosa»** en vez de Beat This!: no se pudieron descargar sus pesos. La ventana dice el motivo
  (línea «Motivo: ...»). Solución: abre https://cloud.cp.jku.at/index.php/s/7ik4RrBKTS273gp en el navegador, descarga
  **final0.ckpt** y guárdalo en `ia/modelos/final0.ckpt`. Cierra la ventana del servicio y vuelve a abrir
  `iniciar-ia.bat`: al analizar debe decir «Beat This! listo» y «pulsos con Beat This!». (También se puede poner la
  ruta del archivo en la variable `ACORDIA_BEAT_THIS`.)
- **Puerto ocupado**: cambia el puerto con la variable `ACORDIA_IA_PUERTO` y en `application.properties`
  (`acordia.ia.url`).
- La primera canción tarda más (carga los modelos); las siguientes, unos segundos por canción.
