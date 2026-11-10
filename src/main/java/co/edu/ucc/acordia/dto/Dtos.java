package co.edu.ucc.acordia.dto;

import co.edu.ucc.acordia.modelo.OrigenAcorde;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Objetos que viajan entre la página web y el servidor (en formato JSON).
 * Se usan "records" de Java: clases pequeñas que solo guardan datos.
 */
public final class Dtos {

    private Dtos() {
    }

    /** Resumen de una canción para la biblioteca. */
    public record CancionResumen(
            Long id,
            String titulo,
            String artista,
            String fuente,
            Double duracionSeg,
            Double bpm,
            String tonalidad,
            int cantidadAcordes,
            List<String> acordesPrincipales,
            boolean usarParaAprender,
            LocalDateTime fechaActualizacion) {
    }

    /** Canción completa, con su línea de tiempo. */
    public record CancionDetalle(
            Long id,
            String titulo,
            String artista,
            String fuente,
            String urlAudio,
            String youtubeId,
            String spotifyId,
            Double duracionSeg,
            Double bpm,
            String tonalidad,
            int capo,
            int transposicion,
            double desfase,
            int primerTiempo,
            /** true si Acordia aprende de los acordes de esta canción. */
            boolean usarParaAprender,
            List<Double> pulsos,
            List<Evento> eventos) {
    }

    public record Evento(
            @NotNull Double inicio,
            @NotNull Double fin,
            @NotBlank @Size(max = 16) String acorde,
            OrigenAcorde origen) {
    }

    /** Datos para crear una canción de YouTube. */
    public record NuevaCancionYoutube(
            @NotBlank @Size(max = 200) String titulo,
            @Size(max = 200) String artista,
            @NotBlank String urlYoutube,
            String spotifyId) {
    }

    /** Datos editables de una canción. */
    public record ActualizarCancion(
            @Size(max = 200) String titulo,
            @Size(max = 200) String artista,
            String spotifyId,
            Integer capo,
            Integer transposicion,
            /** Ajuste de sincronía en segundos (-2 a 2). */
            Double desfase,
            /** Marcar o desmarcar la canción para que Acordia aprenda de ella. */
            Boolean usarParaAprender) {
    }

    /** Lo que envía la página cuando guarda la línea de tiempo de acordes. */
    public record GuardarAcordes(
            Double bpm,
            String tonalidad,
            Double duracionSeg,
            List<Double> pulsos,
            /** Índice del primer pulso que es tiempo 1 del compás. */
            Integer primerTiempo,
            @NotNull @Valid List<Evento> eventos) {
    }

    /** Una canción encontrada en Spotify. */
    public record ResultadoSpotify(
            String spotifyId,
            String titulo,
            String artista,
            String album,
            String imagen,
            Integer duracionMs,
            boolean tieneAcordes) {
    }

    /** Una parte de la canción (intro, verso, coro...) con sus acordes. */
    public record Seccion(String nombre, List<String> acordes) {
    }

    /** Progresión de una canción tomada de Chordonomicon, ya traducida a notación normal. */
    public record Referencia(
            String spotifyId,
            String generoPrincipal,
            String fechaLanzamiento,
            List<Seccion> secciones,
            /** Todos los acordes en orden, sin repeticiones seguidas. */
            List<String> secuencia,
            /** Los acordes distintos, simplificados a mayor/menor (lo que usa el analizador). */
            List<String> acordesSimplificados) {
    }

    /** Estado general: qué está configurado y cuántos datos hay. */
    public record Estado(
            boolean spotifyConfigurado,
            long progresionesEnBase,
            boolean modeloDesdeBase,
            long cancionesGuardadas,
            /** Canciones revisadas por el usuario de las que el modelo está aprendiendo. */
            long cancionesAprendidas) {
    }

    /**
     * Estado del servicio de IA (opcional).
     * @param disponible true si está encendido y tiene lo necesario para analizar
     * @param pulsos     con qué detecta los pulsos: "Beat This!" o "librosa"
     * @param mensaje    explicación para mostrar en la página
     */
    public record EstadoIa(boolean disponible, String pulsos, String mensaje) {
    }

    /**
     * Matriz de probabilidades de cambio entre los 24 acordes mayores y menores.
     * matriz[i][j] = probabilidad de que, si se cambia de acorde, después de etiquetas[i] venga etiquetas[j].
     */
    public record ModeloTransiciones(
            List<String> etiquetas,
            double[][] matriz,
            String fuente,
            long transicionesContadas,
            /** Cuántas canciones propias (revisadas por el usuario) entran al modelo. */
            long cancionesPropias,
            /** Cambios de acorde contados en esas canciones. */
            long transicionesPropias,
            /** Cuánto pesan las canciones propias en la matriz final (0 a 0,5). */
            double pesoPropio) {
    }

    public record Error(String mensaje) {
    }
}
