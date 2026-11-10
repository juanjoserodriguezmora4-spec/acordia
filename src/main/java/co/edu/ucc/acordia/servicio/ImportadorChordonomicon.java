package co.edu.ucc.acordia.servicio;

import co.edu.ucc.acordia.util.MatrizTransiciones;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.io.*;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Importa el dataset Chordonomicon (~680.000 canciones) a la base de datos.
 *
 * Se puede usar de dos formas:
 * <ul>
 *   <li><b>Botón "Importar ahora"</b> en la página: el servidor descarga el CSV de Hugging Face
 *       (264 MB) a la carpeta {@code ./datos-chordonomicon} y luego lo importa, en segundo plano.</li>
 *   <li><b>Archivo ya descargado</b>: con la propiedad {@code acordia.importar.csv} se importa al arrancar.</li>
 * </ul>
 * Hace dos cosas:
 * <ol>
 *   <li>Guarda cada canción en la tabla progresion_referencia (para buscarla por ID de Spotify).</li>
 *   <li>Cuenta todos los cambios de acorde y los guarda en transicion_acorde (el "conocimiento"
 *       que usa el analizador para corregir errores).</li>
 * </ol>
 */
@Component
public class ImportadorChordonomicon implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(ImportadorChordonomicon.class);
    private static final int TAMANO_LOTE = 2000;
    /** Cantidad aproximada de canciones del dataset (solo para mostrar el avance). */
    private static final long FILAS_APROX = 680_000;

    /** Fases del proceso, para mostrarlas en la página. */
    public enum Fase { INACTIVO, DESCARGANDO, IMPORTANDO, LISTO, ERROR }

    /** Foto del avance que consulta la página. */
    public record Estado(Fase fase, long bytesDescargados, long bytesTotales, long cancionesImportadas,
                         double avance, String mensaje) {
    }

    private final JdbcTemplate jdbc;
    private final ModeloTransicionesService modelo;
    private final String rutaCsv;
    private final String urlDescarga;
    private final Path carpetaDescarga;
    private final long limite;
    private final boolean reemplazar;

    private final ExecutorService hilo = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "importador-chordonomicon");
        t.setDaemon(true);
        return t;
    });
    private final AtomicBoolean trabajando = new AtomicBoolean(false);
    private volatile Estado estado = new Estado(Fase.INACTIVO, 0, 0, 0, 0, "");

    public ImportadorChordonomicon(JdbcTemplate jdbc, ModeloTransicionesService modelo,
                                   @Value("${acordia.importar.csv:}") String rutaCsv,
                                   @Value("${acordia.importar.url:https://huggingface.co/datasets/ailsntua/Chordonomicon/resolve/main/chordonomicon_v2.csv}") String urlDescarga,
                                   @Value("${acordia.importar.carpeta:./datos-chordonomicon}") String carpetaDescarga,
                                   @Value("${acordia.importar.limite:0}") long limite,
                                   @Value("${acordia.importar.reemplazar:false}") boolean reemplazar) {
        this.jdbc = jdbc;
        this.modelo = modelo;
        this.rutaCsv = rutaCsv == null ? "" : rutaCsv.trim();
        this.urlDescarga = urlDescarga;
        this.carpetaDescarga = Path.of(carpetaDescarga).toAbsolutePath().normalize();
        this.limite = limite;
        this.reemplazar = reemplazar;
    }

    // ------------------------------------------------------------ al arrancar (archivo ya descargado)

    @Override
    public void run(String... args) {
        if (rutaCsv.isEmpty()) {
            return;
        }
        Path ruta = Path.of(rutaCsv);
        if (!Files.exists(ruta)) {
            log.warn("No se encontró el archivo de Chordonomicon en {}. No se importa nada.", ruta.toAbsolutePath());
            return;
        }
        long existentes = contarProgresiones();
        if (existentes > 0 && !reemplazar) {
            log.info("La base ya tiene {} progresiones. Para volver a importar pon acordia.importar.reemplazar=true", existentes);
            return;
        }
        if (trabajando.compareAndSet(false, true)) {
            hilo.submit(() -> trabajar(ruta, false));
        }
    }

    // ------------------------------------------------------------ desde la página

    public Estado estado() {
        return estado;
    }

    /**
     * Empieza a descargar (si hace falta) e importar en segundo plano.
     * @return false si ya había una importación en curso.
     */
    public boolean iniciar() {
        if (!trabajando.compareAndSet(false, true)) {
            return false;
        }
        estado = new Estado(Fase.DESCARGANDO, 0, 0, 0, 0, "Conectando con Hugging Face…");
        hilo.submit(() -> trabajar(carpetaDescarga.resolve("chordonomicon_v2.csv"), true));
        return true;
    }

    private void trabajar(Path ruta, boolean descargarSiFalta) {
        try {
            if (descargarSiFalta && !archivoCompleto(ruta)) {
                descargar(ruta);
            }
            importar(ruta);
        } catch (Exception e) {
            log.error("Falló la importación de Chordonomicon", e);
            estado = new Estado(Fase.ERROR, estado.bytesDescargados(), estado.bytesTotales(), estado.cancionesImportadas(),
                    estado.avance(), mensajeDeError(e));
        } finally {
            trabajando.set(false);
        }
    }

    private static String mensajeDeError(Exception e) {
        if (e instanceof java.net.ConnectException || e instanceof java.net.UnknownHostException) {
            return "No se pudo conectar con Hugging Face. Revisa la conexión a internet y vuelve a intentar.";
        }
        if (e instanceof IOException && e.getMessage() != null && e.getMessage().startsWith("HTTP")) {
            return "Hugging Face respondió " + e.getMessage() + ". Descarga el archivo a mano (mira el README) y vuelve a intentar.";
        }
        String m = e.getMessage();
        return "La importación se detuvo: " + (m == null ? e.getClass().getSimpleName() : m);
    }

    /** El archivo existe y tiene el tamaño que dice el marcador guardado al terminar la descarga. */
    private boolean archivoCompleto(Path ruta) {
        try {
            Path marca = ruta.resolveSibling(ruta.getFileName() + ".completo");
            return Files.exists(ruta) && Files.exists(marca)
                    && Long.parseLong(Files.readString(marca).trim()) == Files.size(ruta);
        } catch (Exception e) {
            return false;
        }
    }

    private void descargar(Path destino) throws IOException, InterruptedException {
        Files.createDirectories(destino.getParent());
        Path temporal = destino.resolveSibling(destino.getFileName() + ".parcial");
        HttpClient http = HttpClient.newBuilder()
                .followRedirects(HttpClient.Redirect.ALWAYS) // Hugging Face redirige a su CDN
                .connectTimeout(Duration.ofSeconds(20))
                .build();
        HttpRequest pedido = HttpRequest.newBuilder(URI.create(urlDescarga)).GET().build();
        log.info("Descargando Chordonomicon desde {} ...", urlDescarga);
        HttpResponse<InputStream> r = http.send(pedido, HttpResponse.BodyHandlers.ofInputStream());
        if (r.statusCode() >= 300) {
            r.body().close();
            throw new IOException("HTTP " + r.statusCode());
        }
        long total = r.headers().firstValueAsLong("content-length").orElse(-1);
        long leidos = 0, ultimoAviso = 0;
        try (InputStream entrada = r.body(); OutputStream salida = new BufferedOutputStream(Files.newOutputStream(temporal))) {
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = entrada.read(buf)) > 0) {
                salida.write(buf, 0, n);
                leidos += n;
                if (leidos - ultimoAviso > 1_000_000) {
                    ultimoAviso = leidos;
                    double avance = total > 0 ? 0.5 * leidos / total : 0;
                    estado = new Estado(Fase.DESCARGANDO, leidos, total, 0, avance,
                            String.format("Descargando: %d de %s MB", leidos / 1_000_000, total > 0 ? String.valueOf(total / 1_000_000) : "?"));
                }
            }
        }
        if (total > 0 && leidos != total) {
            throw new IOException("la descarga quedó incompleta (" + leidos + " de " + total + " bytes)");
        }
        Files.move(temporal, destino, StandardCopyOption.REPLACE_EXISTING);
        Files.writeString(destino.resolveSibling(destino.getFileName() + ".completo"), String.valueOf(leidos));
        log.info("Descarga lista: {} MB", leidos / 1_000_000);
    }

    // ------------------------------------------------------------ importación

    public void importar(Path ruta) throws IOException {
        log.info("Importando Chordonomicon desde {} ...", ruta.toAbsolutePath());
        long tamano = Files.size(ruta);
        estado = new Estado(Fase.IMPORTANDO, tamano, tamano, 0, 0.5, "Borrando lo que había…");
        jdbc.update("delete from progresion_referencia");
        jdbc.update("delete from transicion_acorde");

        long[][][] conteos = new long[2][2][12];
        List<Object[]> lote = new ArrayList<>(TAMANO_LOTE);
        long filas = 0;
        long inicio = System.currentTimeMillis();
        String sql = "insert into progresion_referencia "
                + "(id, spotify_song_id, spotify_artist_id, acordes, genero_principal, fecha_lanzamiento) "
                + "values (?, ?, ?, ?, ?, ?)";

        CSVFormat formato = CSVFormat.DEFAULT.builder().setHeader().setSkipHeaderRecord(true).build();
        try (BufferedReader lector = new BufferedReader(new InputStreamReader(Files.newInputStream(ruta), StandardCharsets.UTF_8), 1 << 16);
             CSVParser csv = formato.parse(lector)) {
            for (CSVRecord r : csv) {
                String acordes = r.get("chords");
                if (acordes == null || acordes.isBlank()) {
                    continue;
                }
                MatrizTransiciones.contar(acordes, conteos);
                filas++;
                lote.add(new Object[]{
                        idDe(r, filas),
                        recortar(nulo(campo(r, "spotify_song_id")), 22),
                        recortar(nulo(campo(r, "spotify_artist_id")), 22),
                        acordes,
                        recortar(nulo(campo(r, "main_genre")), 40),
                        recortar(nulo(campo(r, "release_date")), 10)});
                if (lote.size() == TAMANO_LOTE) {
                    jdbc.batchUpdate(sql, lote);
                    lote.clear();
                    double avance = 0.5 + 0.5 * Math.min(1, (double) filas / FILAS_APROX);
                    estado = new Estado(Fase.IMPORTANDO, tamano, tamano, filas, avance,
                            String.format("Importando: %,d canciones", filas));
                }
                if (filas % 50_000 == 0) {
                    log.info("  {} canciones importadas...", filas);
                }
                if (limite > 0 && filas >= limite) {
                    break;
                }
            }
        }
        if (!lote.isEmpty()) {
            jdbc.batchUpdate(sql, lote);
        }

        List<Object[]> transiciones = new ArrayList<>();
        String[] calidades = {"maj", "min"};
        for (int d = 0; d < 2; d++)
            for (int h = 0; h < 2; h++)
                for (int k = 0; k < 12; k++)
                    transiciones.add(new Object[]{calidades[d], calidades[h], k, conteos[d][h][k]});
        jdbc.batchUpdate("insert into transicion_acorde (calidad_desde, calidad_hacia, intervalo, conteo) values (?, ?, ?, ?)",
                transiciones);
        modelo.invalidar();
        long segundos = (System.currentTimeMillis() - inicio) / 1000;
        estado = new Estado(Fase.LISTO, tamano, tamano, filas, 1,
                String.format("Listo: %,d canciones importadas en %d min %d s", filas, segundos / 60, segundos % 60));
        log.info("Listo: {} canciones importadas en {} s.", filas, segundos);
    }

    private long contarProgresiones() {
        Long n = jdbc.queryForObject("select count(*) from progresion_referencia", Long.class);
        return n == null ? 0 : n;
    }

    /** El id del CSV; si no es un número, se usa el número de fila. */
    private static long idDe(CSVRecord r, long fila) {
        String id = campo(r, "id");
        try {
            return id == null ? fila : Long.parseLong(id.trim());
        } catch (NumberFormatException e) {
            return fila;
        }
    }

    private static String campo(CSVRecord r, String nombre) {
        return r.isMapped(nombre) && r.isSet(nombre) ? r.get(nombre) : null;
    }

    private static String nulo(String s) {
        return s == null || s.isBlank() || s.equalsIgnoreCase("null") ? null : s.trim();
    }

    private static String recortar(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max);
    }
}
