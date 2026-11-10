-- =====================================================================
--  ACORDIA - Base de datos MySQL
--  Nota: no es obligatorio ejecutar este script. Al arrancar, Spring Boot
--  (Hibernate) crea la base "acordia" y estas mismas tablas solo.
--  Sirve como documentación y para crearla a mano si el profesor lo pide.
-- =====================================================================

CREATE DATABASE IF NOT EXISTS acordia
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE acordia;

-- ---------------------------------------------------------------------
-- Canciones de la biblioteca del usuario
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cancion (
  id                  BIGINT       NOT NULL AUTO_INCREMENT,
  titulo              VARCHAR(200) NOT NULL,
  artista             VARCHAR(200) NULL,
  fuente              VARCHAR(10)  NOT NULL,          -- MP3 o YOUTUBE
  nombre_archivo      VARCHAR(100) NULL,              -- archivo dentro de la carpeta ./audios
  youtube_id          VARCHAR(20)  NULL,              -- las 11 letras del video
  spotify_id          VARCHAR(22)  NULL,              -- para encontrar su progresión en Chordonomicon
  duracion_seg        DOUBLE       NULL,
  bpm                 DOUBLE       NULL,
  tonalidad           VARCHAR(10)  NULL,              -- por ejemplo G o Em
  capo                INT          NOT NULL DEFAULT 0,
  transposicion       INT          NOT NULL DEFAULT 0,
  desfase             DOUBLE       NULL,              -- ajuste de sincronía en segundos
  primer_tiempo       INT          NULL,              -- índice del primer pulso que es tiempo 1
  usar_para_aprender  BIT(1)       NULL,              -- 1 = el usuario revisó los acordes y Acordia aprende de ellos
  pulsos              LONGTEXT     NULL,              -- arreglo JSON con el segundo de cada pulso
  fecha_creacion      DATETIME(6)  NOT NULL,
  fecha_actualizacion DATETIME(6)  NULL,
  PRIMARY KEY (id),
  CONSTRAINT ck_cancion_fuente CHECK (fuente IN ('MP3', 'YOUTUBE')),
  CONSTRAINT ck_cancion_capo CHECK (capo BETWEEN 0 AND 11)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- Línea de tiempo: qué acorde suena entre "inicio" y "fin" (en segundos)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evento_acorde (
  id         BIGINT      NOT NULL AUTO_INCREMENT,
  cancion_id BIGINT      NOT NULL,
  orden      INT         NOT NULL,
  inicio     DOUBLE      NOT NULL,
  fin        DOUBLE      NOT NULL,
  acorde     VARCHAR(16) NOT NULL,                    -- "Am7", "G", "N" = sin acorde
  origen     VARCHAR(12) NOT NULL,                    -- DETECTADO, BASE_DATOS o MANUAL
  PRIMARY KEY (id),
  INDEX idx_evento_cancion (cancion_id, orden),
  CONSTRAINT fk_evento_cancion FOREIGN KEY (cancion_id) REFERENCES cancion (id) ON DELETE CASCADE,
  CONSTRAINT ck_evento_origen CHECK (origen IN ('DETECTADO', 'BASE_DATOS', 'MANUAL')),
  CONSTRAINT ck_evento_tiempos CHECK (fin >= inicio)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- Progresiones importadas del dataset Chordonomicon (~680.000 canciones)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS progresion_referencia (
  id                BIGINT      NOT NULL,             -- el mismo id del CSV
  spotify_song_id   VARCHAR(22) NULL,
  spotify_artist_id VARCHAR(22) NULL,
  acordes           MEDIUMTEXT  NOT NULL,             -- notación original: <verse_1> G Emin C ...
  genero_principal  VARCHAR(40) NULL,
  fecha_lanzamiento VARCHAR(10) NULL,
  PRIMARY KEY (id),
  INDEX idx_progresion_spotify (spotify_song_id)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- Conocimiento aprendido: cuántas veces un acorde pasa a otro.
-- Relativo a la tonalidad: (mayor → menor, +9 semitonos) = C→Am, G→Em, D→Bm...
-- 2 calidades × 2 calidades × 12 intervalos = 48 filas.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transicion_acorde (
  id            BIGINT     NOT NULL AUTO_INCREMENT,
  calidad_desde VARCHAR(3) NOT NULL,                  -- maj o min
  calidad_hacia VARCHAR(3) NOT NULL,
  intervalo     INT        NOT NULL,                  -- 0 a 11
  conteo        BIGINT     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_transicion (calidad_desde, calidad_hacia, intervalo),
  CONSTRAINT ck_transicion_intervalo CHECK (intervalo BETWEEN 0 AND 11)
) ENGINE = InnoDB;


-- =====================================================================
--  CONSULTAS ÚTILES (para la sustentación)
-- =====================================================================

-- 1. Biblioteca: cada canción con cuántos cambios de acorde tiene
-- SELECT c.id, c.titulo, c.artista, c.fuente, c.bpm, c.tonalidad, COUNT(e.id) AS cambios
-- FROM cancion c LEFT JOIN evento_acorde e ON e.cancion_id = c.id
-- GROUP BY c.id ORDER BY c.fecha_actualizacion DESC;

-- 2. Los acordes que más tiempo suenan en una canción (cambia el 1 por el id)
-- SELECT acorde, ROUND(SUM(fin - inicio), 1) AS segundos
-- FROM evento_acorde WHERE cancion_id = 1 AND acorde <> 'N'
-- GROUP BY acorde ORDER BY segundos DESC;

-- 3. Cuánto se corrigió a mano el análisis automático
-- SELECT origen, COUNT(*) AS eventos FROM evento_acorde GROUP BY origen;

-- 4. Los cambios de acorde más comunes en las 680.000 canciones
-- SELECT calidad_desde, calidad_hacia, intervalo, conteo,
--        ROUND(100 * conteo / (SELECT SUM(conteo) FROM transicion_acorde), 2) AS porcentaje
-- FROM transicion_acorde ORDER BY conteo DESC LIMIT 10;
--
-- Canciones de las que Acordia está aprendiendo (marcadas con «Enseñar a Acordia»):
-- SELECT id, titulo, artista FROM cancion WHERE usar_para_aprender = 1;

-- 5. ¿Cuántas canciones de la base se pueden buscar por Spotify?
-- SELECT COUNT(*) FROM progresion_referencia WHERE spotify_song_id IS NOT NULL;
