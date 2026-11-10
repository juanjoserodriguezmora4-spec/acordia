# Acordia — acordes de guitarra sincronizados con la canción

Página web donde subes una canción (MP3) o pegas un link de YouTube, y mientras suena van apareciendo
los acordes de guitarra con su diagrama, al estilo de los sitios de acordes sincronizados.

- **Detección automática** de pulsos y acordes desde el audio (en el navegador, sin servicios externos),
  tanto de archivos como de **videos de YouTube** (grabando el audio de la pestaña mientras suena).
- **Base de datos de acordes** (Chordonomicon, ~680.000 canciones) para mejorar la detección: si la canción
  está, el analizador solo elige entre sus acordes reales; si no está, usa lo aprendido de las 680.000 canciones
  sobre qué acorde suele venir después de cuál.
- **Tira de pulsos** que avanza con la canción, con el compás marcado, y vistas de **diagramas** o **parrilla**
  (animadas o en resumen).
- **Edición rápida**: seleccionas uno o varios pulsos (clic o arrastre) y eliges el acorde de una paleta;
  mover cambios, copiar y pegar, deshacer/rehacer, corregir el tono de toda la canción.
- Diagramas de **guitarra, ukelele o piano**, **transponer**, **cejilla**, **velocidad** (sin cambiar el tono),
  **bucle**, conteo **3, 2, 1**, volumen, notación **C D E** o **Do Re Mi** (con ♭ o ♯ según la tonalidad).
- **Ajuste de sincronía** (±500 ms) y corrección del tempo (**×2 / ×½**) y del inicio del compás.
- **Para practicar**: acordes esenciales con el % del tiempo que suena cada uno, la vuelta principal (con un botón que
  pone bucle y 0,75×), los cambios que más se repiten y un plan de 3 pasos. Nivel **Sencillo** (E7 → E, Am7 → Am).
- **Análisis con IA (opcional)**: un servicio en Python con dos redes neuronales, **BTC** para los acordes (170 tipos,
  incluidos 7, maj7, m7, sus, dim) y **Beat This!** para los pulsos. Ver `ia/LEEME.md`.
- **Biblioteca** guardada en MySQL, con buscador. Tema claro u oscuro.

El documento del proyecto (con diagramas UML) está en `docs/Documento_Acordia.docx`; las fuentes de los diagramas, en `docs/uml/`.

Tecnologías: Java 17 + Spring Boot 3 (backend REST), MySQL, HTML/CSS/JavaScript (frontend), Web Audio API.

---

## 1. Requisitos

| Programa | Versión | Para qué |
|---|---|---|
| JDK | 17 o superior | Compilar y ejecutar el backend |
| NetBeans | 17 o superior (trae Maven) | Abrir y correr el proyecto |
| MySQL | 8 (instalado directamente o con XAMPP) | Guardar canciones y la base de acordes |
| Navegador | Chrome, Edge o Firefox actualizados | La página y el análisis de audio |
| Internet | La primera vez | NetBeans descarga las librerías de Maven |

## 2. Ejecutar en NetBeans

1. **File → Open Project** y elige la carpeta `acordia` (la que tiene `pom.xml`).
2. Espera a que NetBeans descargue las dependencias (la primera vez tarda unos minutos).
3. Enciende MySQL. Si lo instalaste directamente queda como el servicio **MySQL80** (`services.msc` → Iniciar);
   con XAMPP es el botón *Start* de MySQL.
4. Escribe tu usuario y clave de MySQL en `src/main/resources/application.properties`:
   ```properties
   spring.datasource.username=root
   spring.datasource.password=tu_clave
   ```
   Con XAMPP la clave suele estar vacía. La base `acordia` y sus tablas se crean solas.
   Si al arrancar sale `Access denied for user 'root'`, la clave no coincide.
5. Botón verde **Run** (o clic derecho en `AcordiaApplication.java` → *Run File*).
6. Abre **http://localhost:8080** en el navegador.

### Encender la IA (opcional, recomendado)

Sin esto Acordia funciona igual, con el analizador del navegador. Con la IA reconoce más acordes (7, maj7, m7, sus…)
y encuentra mejor los pulsos.

1. Instala **Python 3.12** desde https://www.python.org/downloads/ y, en la primera pantalla del instalador,
   marca **«Add python.exe to PATH»**.
2. Descarga los pesos de Beat This!: abre https://cloud.cp.jku.at/index.php/s/7ik4RrBKTS273gp, descarga
   **final0.ckpt** y guárdalo en la carpeta `ia/modelos/` del proyecto (queda `ia/modelos/final0.ckpt`).
   No viene en el repositorio porque pesa unos 80 MB y es de otros autores.
3. Doble clic en **`ia/iniciar-ia.bat`**. La primera vez instala PyTorch y lo demás (cerca de 1 GB, varios minutos).
4. Deja esa ventana abierta. Está lista cuando dice `Acordia IA escuchando en http://127.0.0.1:5000`.
5. En Acordia abre una canción → **Más → Volver a analizar** → **Analizar con: IA** → **Analizar**.
   En la ventana de la IA debe salir una línea como `[Acordia IA] … pulsos con Beat This!`.

Cada vez que quieras usar la IA, abre otra vez `iniciar-ia.bat` (las siguientes veces arranca en segundos).
Si algo falla, mira «Problemas comunes» en `ia/LEEME.md`.

### Probar sin MySQL (modo demo)

Clic derecho al proyecto → **Run Maven → Ejecutar sin MySQL (modo demo)**.
Usa una base de datos H2 guardada en la carpeta `datos/`. Ideal para mostrar el proyecto en otro computador.

## 3. Importar la base de datos de acordes (Chordonomicon)

Sin este paso la página funciona, pero el analizador usa reglas básicas de teoría musical en vez de lo aprendido
de las canciones, y la búsqueda por nombre no encuentra acordes.

**Forma fácil:** en la biblioteca pulsa **Importar ahora (264 MB)**. El servidor descarga el archivo de Hugging Face a
la carpeta `datos-chordonomicon/` y lo importa en segundo plano; la página muestra el avance. Tarda entre 5 y 20 minutos.
Si se interrumpe, al volver a pulsar no descarga otra vez si el archivo ya quedó completo.

**Forma manual** (si tu red bloquea la descarga):

1. Descarga el archivo CSV del dataset desde
   https://huggingface.co/datasets/ailsntua/Chordonomicon (pestaña *Files and versions*). Pesa unos 264 MB.
2. En `application.properties` escribe la ruta del archivo (con `/`, también en Windows):
   ```properties
   acordia.importar.csv=C:/datos/chordonomicon.csv
   ```
3. Ejecuta el proyecto. En la consola verás el avance (`50000 canciones importadas...`).
   Con el archivo completo tarda varios minutos y la base ocupa unos cientos de MB.
4. Cuando termine, deja la línea vacía otra vez (si no, al arrancar solo avisa que ya está importado).

Para una prueba rápida: `acordia.importar.limite=50000`.

> **Licencia:** Chordonomicon es CC BY-NC 4.0: se puede usar en proyectos sin ánimo de lucro, citando a los autores
> (Kantarelis et al., 2024, *CHORDONOMICON: A Dataset of 666,000 Songs and their Chord Progressions*, arXiv:2410.22046).
> No guarda nombres de canciones, solo el ID de Spotify; por eso la búsqueda por nombre pasa por Spotify.

## 4. Configurar la búsqueda por nombre (Spotify, opcional)

Desde febrero de 2026, Spotify exige que **el dueño de la app tenga Spotify Premium**, y la búsqueda devuelve
máximo 10 resultados.

1. Entra a https://developer.spotify.com/dashboard con la cuenta Premium y crea una app
   (en *Redirect URI* puedes poner `http://127.0.0.1:8080/callback`; Acordia no lo usa). Marca *Web API*.
2. Copia el **Client ID** y el **Client Secret** en `application.properties`:
   ```properties
   spotify.client-id=tu_client_id
   spotify.client-secret=tu_client_secret
   ```
   O como variables de entorno `SPOTIFY_CLIENT_ID` y `SPOTIFY_CLIENT_SECRET` (mejor si subes el proyecto a GitHub).

Sin Spotify todo lo demás funciona; en vez de buscar, puedes **pegar los acordes** de un cancionero.

## 5. Cómo se usa

**Con un MP3:** *Nueva canción* → arrastra el archivo → (opcional) busca la canción en la base o pega sus acordes →
*Crear y analizar*. En unos segundos aparece el reproductor.

**Con YouTube:** *Subir canción* → *Video de YouTube* → pega el link → (opcional) referencia → *Crear*. Se abre
**Analizar los acordes del video** → *Analizar*. El navegador pide permiso para compartir: elige **esta pestaña** y
activa **«Compartir también el audio de la pestaña»**. El video suena completo una vez (tarda lo que dura la canción)
y al final aparecen los acordes, igual que con un MP3.

- Funciona en **Chrome y Edge de computador** (Firefox y los celulares no permiten grabar el audio de una pestaña).
- No cambies de pestaña, no silencies el video ni lo adelantes mientras se analiza. Con YouTube Premium no hay
  anuncios que interrumpan (si aparece un anuncio, Acordia lo detecta por el tiempo del video y lo descarta).
- El audio no se guarda en ninguna parte: solo se analiza en el navegador.
- Si los acordes quedan un poco corridos respecto al video, ajústalos con **Más → Sincronía**.
- También puedes hacerlo a mano con **Más → Marcar cambios en vivo**: das play y tocas la **barra espaciadora**
  cada vez que cambia el acorde.

**En el reproductor:**

| Acción | Cómo |
|---|---|
| Reproducir / pausar | Botón naranja o `Espacio` |
| Adelantar / atrasar 5 s | Flechas `←` `→` |
| Ir a una parte | Toca cualquier pulso de la tira o de la parrilla |
| Contar antes de empezar | Herramienta **3, 2, 1** (cuenta al ritmo de la canción) |
| Repetir una parte | **Bucle** → toca el pulso de inicio y el de fin; **Bucle** otra vez para quitarlo |
| Velocidad | ◀ ▶ de 50 % a 150 % (el tono no cambia) |
| Cejilla | ◀ ▶; los diagramas muestran la forma que debes tocar |
| Transponer | ▼ ▲ (se guarda) |
| Instrumento | Guitarra, ukelele o piano |
| Los acordes van adelantados o atrasados | **Más → Sincronía** (pasos de 10 ms, se guarda) |
| La casilla va a la mitad o al doble de la canción | **Más → Tempo ×2 / ×½** (o en *Detalles*) |
| El tempo no es exacto (sale 189 y es 188) | *Detalles → Tempo*: escribe el tempo real (acepta decimales) → **Aplicar**. Los pulsos se estiran a ese tempo sin mover el inicio ni los acordes. Si escribes el mismo número redondeado que ya tiene (63 y los pulsos van a 63,4), no se cambian: Chordify muestra el tempo sin decimales y volverlo exacto haría que se desfase. Si el cambio es grande (94 → 188), Acordia propone volver a analizar |
| Al principio va bien pero con el tiempo se desfasa | *Detalles → Tempo* → **+** si los acordes llegan cada vez más tarde, **−** si llegan antes. Cada toque afina 0,1 BPM sin mover el inicio. También sirve **Volver a analizar** con el tempo y **sin** marcar *Exacto* (y si lo marcas pero la canción no va pareja, Acordia sigue los golpes) |
| Traer los acordes de una captura (por ejemplo de Chordify) | **Más → Importar acordes de una imagen** (ver abajo) |
| El compás empieza donde no es | **Más → Mover tiempo 1** |
| Ajustar la detección | **Más → Volver a analizar**: referencia, tempo tocando al ritmo y "cambios más seguidos / más estables" |

**Editar acordes:**

| Acción | Cómo |
|---|---|
| Elegir pulsos | Clic en uno; arrastrar o `Shift`+clic para varios; `←` `→` para moverse |
| Poner un acorde | Clic en la paleta (los acordes de la canción) o teclas `1`–`9`; **+ Otro acorde** para cualquiera |
| Poner un acorde en un pulso | Dura hasta el siguiente cambio (como en Chordify) |
| Borrar un acorde | **Borrar** o `Supr`: se quita el cambio y sigue sonando el acorde anterior |
| Todos los acordes corridos unos pulsos | **Detalles → Desplazar**: escribe cuántos pulsos (por ejemplo 2) y pulsa → o ←. Ctrl+Z lo deshace |
| Marcar silencio | **Sin acorde** o `0`: no suena nada hasta el siguiente cambio |
| Correr un cambio un pulso | **← Mover cambio** / **Mover cambio →** |
| Copiar una parte a otro lugar | **Copiar**, elegir dónde, **Pegar** (`Ctrl`+`C` / `Ctrl`+`V`) |
| Oír la selección | **Escuchar** (la repite) |
| Deshacer / rehacer | `Ctrl`+`Z` / `Ctrl`+`Y` |
| Todos los acordes salieron corridos (por ejemplo, en la forma con capo) | **Corregir tono −½ / +½** |
| Terminar | **Guardar** o **Descartar** |

### Importar acordes de una imagen

Si tienes una captura de una parrilla de acordes (por ejemplo la de Chordify, o la de la misma Acordia), Acordia la
lee y pone esos acordes en tu canción, pulso por pulso:

1. Revisa que el tempo sea parecido al de la imagen (no el doble ni la mitad). Chordify lo muestra en sus detalles
   (por ejemplo 188 BPM); si no coincide, cámbialo en *Detalles → Tempo*.
2. **Más → Importar acordes de una imagen…** → **Elegir imagen** (o pega la captura con `Ctrl`+`V`). Si la canción
   no cabe en una captura, agrega varias en orden, sin repetir filas.
3. Acordia muestra lo que leyó como texto, junto a la imagen, para que lo compares y corrijas:
   `Mib . . . | Lab . . .` (el punto = sigue el acorde anterior, `N` = silencio, `_` = casilla gris antes o después
   de la canción, `?` = no se pudo leer).
   También puedes escribir o pegar el texto tú mismo.
4. **Poner en la canción**: Acordia busca solo dónde encaja comparando con lo que detectó en el audio (o, si eliges
   *Desde el pulso seleccionado*, empieza en el pulso que tocaste). Revisa con play y pulsa **Guardar**.

Cómo lee la imagen: encuentra las casillas blancas de la parrilla y las ordena en filas y columnas (completa las que
faltan, como la casilla resaltada); en cada casilla con texto lee el nombre del acorde con **Tesseract.js** (OCR,
incluido en el proyecto, funciona sin internet). El ♭ y el ♯ que dibuja Chordify son pequeños y claros, y el OCR no los
ve, así que Acordia los detecta por su forma (una marca angosta y más clara justo después de la nota). Con la captura
de "Por suerte" leyó bien las 19 casillas con texto, y en una canción de prueba con esa misma progresión los 110 pulsos
quedaron en su lugar exacto.

Para que la parrilla de Acordia **se vea igual que la imagen**, al poner los acordes también: los compases empiezan
donde empiezan en la imagen (las casillas grises del principio dicen en qué tiempo arranca), las filas de 4 compases
empiezan en el mismo compás, la tonalidad se calcula con los acordes importados (para escribir La♭ y no Sol♯) y, si la
imagen está en Do Re Mi, cambia a esa notación. También reconoce el símbolo de silencio (un trazo alto y angosto), el
superíndice de acordes como Sol⁷ y el bajo aunque el texto se salga de la casilla (Si♭/Re). Con la captura completa de
"Por suerte" (34 filas, 540 pulsos) las 540 casillas quedaron iguales en la parrilla.

### Para practicar y nivel Sencillo

Debajo de *Detalles de la canción* aparece **Para practicar** (se calcula con los acordes de la canción):

1. **Aprende los esenciales**: los acordes que más suenan, con el porcentaje del tiempo de cada uno, hasta cubrir el
   90 % (máximo 6).
2. **Encadena la vuelta**: la progresión de 2 a 8 acordes que más se repite (por ejemplo F → C → Am, «se repite 20
   veces y es el 69 % de la canción»). **Practicar la vuelta** pone un bucle sobre ella y la velocidad en 0,75×.
3. **Cambios para practicar**: los pasos de un acorde a otro que más se repiten fuera de la vuelta, para practicarlos
   primero sin música.

**Nivel Sencillo** (*Más → Nivel*, o el enlace al final del panel): muestra los acordes sin séptimas, novenas, sus ni
bajo (E7 → E, Am7 → Am, Cmaj7 → C, D/F♯ → D, Bdim → Bm). Cambia lo que se ve y los diagramas, no lo guardado; al
editar se ven los acordes completos.

### Analizar con IA (opcional)

Si abres el servicio de la carpeta `ia/` (doble clic en `ia/iniciar-ia.bat`; la primera vez instala PyTorch y tarda
varios minutos), en **Más → Volver a analizar** aparece **Analizar con: IA: BTC + Beat This!**:

- **BTC** (Park et al., ISMIR 2019) reconoce 170 acordes: mayor, menor, 7, maj7, m7, sus2, sus4, dim, aug, 6, m6,
  dim7, m7♭5 y m(maj7) en las 12 notas, más «sin acorde». El analizador del navegador solo distingue mayor y menor.
- **Beat This!** (Foscarin et al., ISMIR 2024) encuentra los pulsos y el tiempo 1 con una red neuronal.
- Funciona con MP3 y con YouTube (el audio grabado de la pestaña se envía al servicio).
- Si el servicio no está abierto, la opción aparece apagada y se usa el analizador del navegador.

En una canción de prueba con Cmaj7 – Am7 – Dm7 – G7 – C – E7 – Am – Dsus4, la IA escribió exactamente esos acordes;
el analizador del navegador, en la mayoría de las vueltas, C – Am – Dm – G – C – Em – Am – D (solo mayor o menor, y E7 confundido con Em). Detalles en `ia/LEEME.md`.

### Enseñarle a Acordia con tus canciones

Acordia aprende de las canciones que tú revisas, no de cualquier análisis (si aprendiera de sus propios
resultados, repetiría sus errores):

1. Abre una canción y corrige sus acordes hasta que estén bien. **Guardar**.
2. En **Detalles de la canción → Aprendizaje**, pulsa **Enseñar a Acordia**.
3. Desde ese momento, los cambios de acorde de esa canción se suman al modelo que usa el analizador.
   En la biblioteca verás **«Aprendió de N canciones tuyas»** y la tarjeta tendrá el sello **✓ Enseña**.

Cuánto pesa lo tuyo frente a Chordonomicon crece con cada canción revisada, sin pasar de la mitad:
1 canción = 8 %, 5 canciones = 25 %, 20 canciones = 40 %. Si editas una canción que ya enseña, lo aprendido se
actualiza al guardar; si la vuelves a analizar, deja de enseñar hasta que la revises de nuevo. **Quitar** la
saca del aprendizaje.

Lo que se aprende es relativo a la tonalidad ("de mayor a menor subiendo 9 semitonos"), así que una canción en
Sol ayuda igual a analizar una en Si bemol. Funciona mejor con canciones de un mismo estilo: si siempre tocas
baladas o vallenato, el analizador se va acostumbrando a esas progresiones.

## 6. Cómo funciona la detección

Todo el análisis corre en el navegador (`static/js/analizador.js`, en un Web Worker para no congelar la página):

1. El audio se pasa a mono a 11.025 Hz.
2. **Golpes**: flujo espectral cada 12 ms (energía nueva que aparece), total y en graves.
3. **Tempo**: autocorrelación de los golpes y elección entre el tempo, el doble y la mitad. Después, el tempo fino se
   calcula con una recta de mínimos cuadrados sobre todos los pulsos encontrados y se redondea al entero (las canciones
   de estudio se graban con metrónomo). Si casi todos los pulsos caen en una rejilla pareja con ese tempo entero, se usa
   esa rejilla (no se desfasa al final); si la canción acelera o frena, se dejan los pulsos que siguen los golpes.
4. **Pulsos**: programación dinámica (Ellis, 2007): cada pulso cae en un golpe fuerte y a ritmo parejo.
5. **Notas**: FFT larga (graves) y media (agudos) cada 46 ms, con una **mediana en el tiempo** que borra los golpes de
   batería. Se toman los **picos del espectro** con interpolación parabólica y se estima la **afinación** de la grabación.
6. **Cromagrama** por pulso (12 notas), separado en agudos y bajo.
7. **Compás**: el tiempo 1 es donde más cambia la armonía y donde suenan bajo y bombo.
8. **Tonalidad** (Krumhansl) y comparación de cada pulso con plantillas de los 24 acordes mayores y menores.
9. **Viterbi** (modelo oculto de Markov) elige la secuencia más probable combinando lo que suena, la matriz de
   transiciones aprendida de Chordonomicon (mezclada con las canciones que marcaste con **Enseñar a Acordia**), la preferencia por acordes de la tonalidad y la posición en el compás.
   Si hay referencia, prueba los 12 tonos para descubrir si tu versión está transpuesta (por ejemplo, acordes de
   cancionero "con capo 3"), y si la referencia no encaja con el audio, la descarta sola.

### Resultados de las pruebas

**Canciones realistas** (`node pruebas-analizador/probar-realista.js`): guitarra rasgueada, bajo, batería con caja en
2 y 4, voz con notas fuera del acorde, cambios anticipados, intro sin batería y pequeñas variaciones de tempo.
Progresiones inventadas, así que se sabe exactamente qué suena en cada momento.

| Caso | Tempo real → detectado | Pulsos a tiempo | Compás | Acordes |
|---|---|---|---|---|
| Pop en Mi♭, 100 BPM | 100 → 100 | 96 % | 98 % | 96,9 % |
| Balada en Sol, 72 BPM | 72 → 145 (doble) | 64 % | 64 % | 98,2 % |
| Rock en Mi, 128 BPM | 128 → 128 | 95 % | 95 % | 94,7 % |
| Menor en La m, 90 BPM, voz fuerte | 90 → 91 | 97 % | 97 % | 94,8 % |
| Pop en Fa♯, 115 BPM, muchas anticipaciones | 115 → 115 | 96 % | 97 % | 89,6 % |

Los pulsos detectados quedan, en promedio, entre 0 y 7 ms del pulso real. El error que queda es el de tempo doble o
mitad en canciones muy lentas (< 75 BPM) o muy rápidas (> 155 BPM); se corrige con **Tempo ×2 / ×½**.

**Pruebas básicas** (`node pruebas-analizador/probar-analizador.js`): audio limpio, rápido, desafinado o con ruido:
97–100 %; con una melodía fuerte encima: 87 % sin referencia y 97 % con referencia.

En canciones comerciales (mezclas densas, efectos, cambios de tempo) el acierto será menor que en estas pruebas.
Por eso existen la referencia de la base de datos, el ajuste de sincronía y la edición.

## 7. Estructura del proyecto

```
acordia/
├── pom.xml                          dependencias (Spring Boot, MySQL, H2, Commons CSV)
├── nbactions.xml                    botones de NetBeans
├── base-de-datos/acordia_mysql.sql  tablas y consultas útiles
├── pruebas-analizador/              pruebas del analizador y de los diagramas (Node.js)
├── ia/                              análisis con IA, opcional (Python: BTC + Beat This!, ver ia/LEEME.md)
└── src/
    ├── main/java/co/edu/ucc/acordia/
    │   ├── AcordiaApplication.java  punto de entrada
    │   ├── modelo/                  entidades JPA: Cancion, EventoAcorde, ProgresionReferencia, TransicionAcorde
    │   ├── repositorio/             acceso a datos (Spring Data JPA)
    │   ├── servicio/                lógica: canciones, audio, Spotify, referencias, modelo, importador
    │   ├── controlador/             API REST y manejo de errores
    │   ├── dto/                     objetos JSON que viajan entre página y servidor
    │   └── util/                    NotacionAcordes, MatrizTransiciones
    ├── main/resources/
    │   ├── application.properties   configuración (MySQL, Spotify, importación)
    │   └── static/                  la página: index.html, css/, js/ (app, acordes, analizador)
    └── test/java/                   pruebas JUnit
```

## 8. API REST

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/canciones` | Biblioteca |
| GET | `/api/canciones/{id}` | Canción con pulsos y acordes |
| POST | `/api/canciones` | Subir audio (multipart: `archivo`, `titulo`, `artista`, `spotifyId`) |
| POST | `/api/canciones/youtube` | Crear desde YouTube (JSON) |
| PUT | `/api/canciones/{id}` | Cambiar título, artista, capo, tono, sincronía (`desfase`) o si enseña (`usarParaAprender`) |
| PUT | `/api/canciones/{id}/acordes` | Guardar pulsos, tiempo 1 del compás (`primerTiempo`) y acordes |
| GET | `/api/canciones/{id}/audio` | Reproducir (permite adelantar) |
| DELETE | `/api/canciones/{id}` | Eliminar |
| GET | `/api/estado` | Qué está configurado |
| GET | `/api/referencias/buscar?q=` | Buscar en Spotify (indica cuáles tienen acordes) |
| GET | `/api/referencias/{spotifyId}` | Acordes de esa canción en Chordonomicon |
| POST | `/api/referencias/convertir` | Traducir acordes pegados (texto plano) |
| GET | `/api/modelo/transiciones` | Matriz 24×24 para el analizador (Chordonomicon + canciones revisadas) |
| GET | `/api/ia/estado` | ¿Está encendido el servicio de IA? |
| POST | `/api/ia/canciones/{id}/analizar` | Analizar el MP3 guardado con IA (`bpm`, `estabilidad` opcionales) |
| POST | `/api/ia/analizar` | Analizar con IA un audio enviado (multipart: `archivo`), por ejemplo el grabado de YouTube |
| POST | `/api/chordonomicon/importar` | Descargar e importar Chordonomicon en segundo plano |
| GET | `/api/chordonomicon/estado` | Avance de la importación |

## 9. Pruebas

- Backend: `mvn test` (o clic derecho al proyecto → *Test*). Prueba la traducción de acordes, la matriz y el aprendizaje con canciones propias.
- Analizador: `node pruebas-analizador/probar-analizador.js`
- Analizador con canciones realistas: `node pruebas-analizador/probar-realista.js` (agrega `-v` para ver los acordes).
- Importar desde imagen: `node pruebas-analizador/probar-importar.js` (parrilla dibujada, texto por pulsos y ubicación).
- IA: con el servicio instalado, `ia\.venv\Scripts\python ia\probar_ia.py` (8 acordes de piano, incluidos Dm7, G7, Cmaj7 y E7).
- Tempo: `node pruebas-analizador/probar-tempo.js` (30 canciones de 72 a 188 BPM, con y sin variación de tempo).
- Diagramas: `node pruebas-analizador/probar-digitaciones.js` y `node pruebas-analizador/probar-ukelele.js`
  (verifican que las 168 digitaciones de guitarra y las 168 de ukelele suenen exactamente las notas del acorde).

## 10. Limitaciones

- El analizador del navegador reconoce acordes **mayores y menores**; los de séptima, sus, etc. vienen de la IA
  (opcional), de la base de datos o de la edición manual.
- La IA necesita Python y unos 1,5 GB de espacio (PyTorch). Corre en el procesador, sin tarjeta gráfica: unos segundos
  por canción, más la primera vez. Sin internet la primera vez, los pulsos se sacan con librosa en vez de Beat This!.
  La IA se probó aquí con canciones sintéticas y una grabación real; en el computador del usuario no se pudo probar
  Beat This! con sus pesos reales (se descargan en la primera ejecución).
- La tira y la parrilla asumen compases de 4 tiempos (no 3/4 ni 6/8).
- En tempos muy lentos o muy rápidos el tempo puede salir al doble o a la mitad (se corrige con un clic).
- YouTube no deja leer el audio de sus videos directamente (ni con Premium); Acordia lo graba desde la pestaña
  con permiso del usuario, así que el análisis tarda lo que dura el video y solo funciona en Chrome/Edge de computador.
- Chordonomicon tiene sobre todo canciones en inglés: muchas canciones latinas no estarán.
- La búsqueda por nombre necesita una cuenta de Spotify Premium.
- Sin internet, la página usa fuentes del sistema (las tipografías vienen de Google Fonts).
- Importar de una imagen funciona con parrillas de casillas blancas separadas por rayas (como Chordify). Fotos
  tomadas con el celular a la pantalla, imágenes muy pequeñas o borrosas pueden leerse mal: por eso el resultado
  se muestra como texto para revisarlo antes de ponerlo.
- Tesseract.js (Apache 2.0) está incluido en `static/vendor/tesseract` (unos 11 MB).

## 11. Referencias

- Kantarelis, S. et al. (2024). *CHORDONOMICON: A Dataset of 666,000 Songs and their Chord Progressions*. arXiv:2410.22046.
- Ellis, D. (2007). *Beat Tracking by Dynamic Programming*. Journal of New Music Research, 36(1).
- Krumhansl, C. (1990). *Cognitive Foundations of Musical Pitch*. Oxford University Press (perfiles de tonalidad).
- Gómez, E. (2006). *Tonal Description of Music Audio Signals* (HPCP, croma por picos espectrales). Tesis doctoral, UPF.
- Park, J., Choi, K., Jeon, S., Kim, D. y Park, J. (2019). *A Bi-Directional Transformer for Musical Chord Recognition*. ISMIR 2019. Código y pesos: https://github.com/jayg996/BTC-ISMIR19 (MIT).
- Foscarin, F., Schlüter, J. y Widmer, G. (2024). *Beat This! Accurate Beat Tracking Without DBN Postprocessing*. ISMIR 2024. Código y pesos: https://github.com/CPJKU/beat_this (MIT).
