package co.edu.ucc.acordia.servicio;

import co.edu.ucc.acordia.dto.Dtos;
import co.edu.ucc.acordia.modelo.Cancion;
import co.edu.ucc.acordia.modelo.FuenteAudio;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.ConnectException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Locale;
import java.util.UUID;

/**
 * Puente con el servicio de IA (carpeta ia/ del proyecto, en Python): Beat This! para los pulsos y BTC
 * para los acordes. Es opcional: si no está encendido, la página sigue usando el analizador del navegador.
 *
 * El servicio corre en este mismo computador (por defecto http://127.0.0.1:5000) y Acordia le manda el audio:
 * el MP3 guardado de la canción, o el audio grabado del video de YouTube que sube la página.
 */
@Service
public class AnalisisIaService {

    private final URI base;
    private final ObjectMapper json;
    private final CancionService canciones;
    private final AlmacenamientoAudioService almacenamiento;
    /**
     * HTTP/1.1: por defecto Java pide pasar a HTTP/2 ("Upgrade: h2c") y el servicio de Python no lo usa;
     * respondía bien igual, pero mostraba avisos de "Unsupported upgrade request" en su ventana.
     */
    private final HttpClient http = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(3))
            .build();

    public AnalisisIaService(@Value("${acordia.ia.url:http://127.0.0.1:5000}") String url,
                             ObjectMapper json, CancionService canciones, AlmacenamientoAudioService almacenamiento) {
        this.base = URI.create(url.endsWith("/") ? url : url + "/");
        this.json = json;
        this.canciones = canciones;
        this.almacenamiento = almacenamiento;
    }

    /** ¿Está encendido el servicio de IA y qué modelos tiene? Nunca lanza error: si no responde, disponible = false. */
    public Dtos.EstadoIa estado() {
        try {
            HttpRequest pedido = HttpRequest.newBuilder(base.resolve("estado")).timeout(Duration.ofSeconds(3)).GET().build();
            HttpResponse<String> r = http.send(pedido, HttpResponse.BodyHandlers.ofString());
            if (r.statusCode() != 200) {
                return new Dtos.EstadoIa(false, null, "El servicio de IA respondió con error " + r.statusCode() + ".");
            }
            JsonNode info = json.readTree(r.body());
            boolean listo = info.path("listo").asBoolean(false);
            String pulsos = info.path("pulsos").asText("librosa");
            String mensaje = listo
                    ? "Acordes con BTC, pulsos con " + pulsos + "."
                    : "El servicio de IA está encendido pero le faltan paquetes (revisa ia/LEEME.md).";
            return new Dtos.EstadoIa(listo, pulsos, mensaje);
        } catch (IOException e) {
            return new Dtos.EstadoIa(false, null, "El servicio de IA no está encendido (ábrelo con ia/iniciar-ia.bat).");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new Dtos.EstadoIa(false, null, "Se interrumpió la consulta al servicio de IA.");
        }
    }

    /** Analiza el audio guardado de una canción (las que se subieron como archivo). */
    public JsonNode analizarCancion(long id, Double bpm, Double estabilidad) throws IOException {
        Cancion c = canciones.buscar(id);
        if (c.getFuente() != FuenteAudio.MP3 || c.getNombreArchivo() == null) {
            throw new IllegalArgumentException("Esta canción no tiene un archivo de audio guardado; la página debe grabar el video y enviarlo.");
        }
        Resource audio = almacenamiento.cargar(c.getNombreArchivo());
        byte[] datos;
        try (InputStream entrada = audio.getInputStream()) {
            datos = entrada.readAllBytes();
        }
        return enviar(datos, c.getNombreArchivo(), bpm, estabilidad);
    }

    /** Analiza un audio que manda la página (por ejemplo, el grabado de un video de YouTube). */
    public JsonNode analizarAudio(byte[] datos, String nombre, Double bpm, Double estabilidad) throws IOException {
        if (datos == null || datos.length == 0) {
            throw new IllegalArgumentException("No llegó ningún audio para analizar.");
        }
        return enviar(datos, nombre == null || nombre.isBlank() ? "audio.wav" : nombre, bpm, estabilidad);
    }

    /** Arma un formulario multipart (archivo + bpm + estabilidad) y espera la respuesta del servicio. */
    private JsonNode enviar(byte[] audio, String nombre, Double bpm, Double estabilidad) throws IOException {
        String frontera = "acordia-" + UUID.randomUUID();
        byte[] cuerpo = armarFormulario(frontera, audio, nombre, bpm, estabilidad);

        HttpRequest pedido = HttpRequest.newBuilder(base.resolve("analizar"))
                .timeout(Duration.ofMinutes(10)) // la primera vez descarga y carga los modelos
                .header("Content-Type", "multipart/form-data; boundary=" + frontera)
                .POST(HttpRequest.BodyPublishers.ofByteArray(cuerpo))
                .build();
        HttpResponse<String> r;
        try {
            r = http.send(pedido, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (ConnectException e) {
            throw new IllegalStateException("El servicio de IA no está encendido. Ábrelo con ia/iniciar-ia.bat y vuelve a intentar.");
        } catch (HttpTimeoutException e) {
            throw new IllegalStateException("El servicio de IA tardó demasiado en responder.");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Se interrumpió el análisis con IA.");
        }
        if (r.statusCode() != 200) {
            String detalle = "error " + r.statusCode();
            try {
                detalle = json.readTree(r.body()).path("detail").asText(detalle);
            } catch (IOException ignorado) {
                // la respuesta no era JSON: queda el código de error
            }
            if (r.statusCode() == 400 || r.statusCode() == 413) {
                throw new IllegalArgumentException(detalle);
            }
            throw new IllegalStateException("El servicio de IA no pudo analizar el audio: " + detalle);
        }
        return json.readTree(r.body());
    }

    /** El cuerpo multipart/form-data: el archivo y, si vienen, el tempo y la estabilidad. */
    static byte[] armarFormulario(String frontera, byte[] audio, String nombre, Double bpm, Double estabilidad) {
        ByteArrayOutputStream cuerpo = new ByteArrayOutputStream(audio.length + 1024);
        String limpio = nombre.replaceAll("[\"\\r\\n]", "_");
        escribir(cuerpo, "--" + frontera + "\r\nContent-Disposition: form-data; name=\"archivo\"; filename=\"" + limpio + "\"\r\n"
                + "Content-Type: application/octet-stream\r\n\r\n");
        cuerpo.writeBytes(audio);
        escribir(cuerpo, "\r\n");
        if (bpm != null && bpm >= 40 && bpm <= 240) {
            campo(cuerpo, frontera, "bpm", String.format(Locale.ROOT, "%.2f", bpm));
        }
        if (estabilidad != null) {
            campo(cuerpo, frontera, "estabilidad", String.format(Locale.ROOT, "%.3f", estabilidad));
        }
        escribir(cuerpo, "--" + frontera + "--\r\n");
        return cuerpo.toByteArray();
    }

    private static void campo(ByteArrayOutputStream cuerpo, String frontera, String nombre, String valor) {
        escribir(cuerpo, "--" + frontera + "\r\nContent-Disposition: form-data; name=\"" + nombre + "\"\r\n\r\n" + valor + "\r\n");
    }

    private static void escribir(ByteArrayOutputStream cuerpo, String texto) {
        cuerpo.writeBytes(texto.getBytes(StandardCharsets.UTF_8));
    }
}
