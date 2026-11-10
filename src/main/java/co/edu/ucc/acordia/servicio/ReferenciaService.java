package co.edu.ucc.acordia.servicio;

import co.edu.ucc.acordia.dto.Dtos;
import co.edu.ucc.acordia.modelo.ProgresionReferencia;
import co.edu.ucc.acordia.repositorio.ProgresionReferenciaRepositorio;
import co.edu.ucc.acordia.util.NotacionAcordes;
import org.springframework.stereotype.Service;

import java.util.*;

/** Consulta las progresiones de Chordonomicon y las convierte a notación de guitarrista. */
@Service
public class ReferenciaService {

    private static final Map<String, String> NOMBRES_SECCION = Map.ofEntries(
            Map.entry("intro", "Intro"), Map.entry("verse", "Verso"), Map.entry("chorus", "Coro"),
            Map.entry("bridge", "Puente"), Map.entry("outro", "Final"), Map.entry("solo", "Solo"),
            Map.entry("interlude", "Interludio"), Map.entry("instrumental", "Instrumental"),
            Map.entry("pre-chorus", "Pre-coro"), Map.entry("prechorus", "Pre-coro"));

    private final ProgresionReferenciaRepositorio repositorio;

    public ReferenciaService(ProgresionReferenciaRepositorio repositorio) {
        this.repositorio = repositorio;
    }

    public Optional<Dtos.Referencia> porSpotifyId(String spotifyId) {
        return repositorio.findFirstBySpotifySongIdOrderByIdAsc(spotifyId)
                .map(p -> convertir(p.getSpotifySongId(), p.getGeneroPrincipal(), p.getFechaLanzamiento(), p.getAcordes()));
    }

    public long contar() {
        return repositorio.count();
    }

    /**
     * Convierte texto de acordes (de Chordonomicon o escrito por el usuario) en secciones.
     * Acepta marcas como &lt;verse_1&gt; o líneas tipo "[Coro]".
     */
    public Dtos.Referencia convertir(String spotifyId, String genero, String fecha, String texto) {
        List<Dtos.Seccion> secciones = new ArrayList<>();
        List<String> secuencia = new ArrayList<>();
        LinkedHashSet<String> simplificados = new LinkedHashSet<>();

        String nombreSeccion = "Canción";
        List<String> actual = new ArrayList<>();
        for (String token : texto.replace("|", " ").split("\\s+")) {
            if (token.isBlank()) {
                continue;
            }
            if ((token.startsWith("<") && token.endsWith(">")) || (token.startsWith("[") && token.endsWith("]"))) {
                if (!actual.isEmpty()) {
                    secciones.add(new Dtos.Seccion(nombreSeccion, actual));
                }
                nombreSeccion = nombreSeccion(token.substring(1, token.length() - 1));
                actual = new ArrayList<>();
                continue;
            }
            NotacionAcordes.AcordeLeido a = NotacionAcordes.leer(token);
            if (a == null) {
                continue; // Texto que no es acorde (letra, guiones...): se ignora.
            }
            String nombre = a.legible();
            actual.add(nombre);
            if (secuencia.isEmpty() || !secuencia.get(secuencia.size() - 1).equals(nombre)) {
                secuencia.add(nombre);
            }
            simplificados.add(a.simplificado());
        }
        if (!actual.isEmpty()) {
            secciones.add(new Dtos.Seccion(nombreSeccion, actual));
        }
        return new Dtos.Referencia(spotifyId, genero, fecha, secciones, secuencia, new ArrayList<>(simplificados));
    }

    private static String nombreSeccion(String marca) {
        String m = marca.toLowerCase(Locale.ROOT).trim();
        String numero = "";
        int guion = m.lastIndexOf('_');
        if (guion > 0) {
            numero = " " + m.substring(guion + 1);
            m = m.substring(0, guion);
        }
        String nombre = NOMBRES_SECCION.getOrDefault(m, marca.isEmpty() ? "Parte" :
                Character.toUpperCase(marca.charAt(0)) + marca.substring(1));
        return nombre + numero;
    }
}
