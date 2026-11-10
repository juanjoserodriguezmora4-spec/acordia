package co.edu.ucc.acordia.controlador;

import co.edu.ucc.acordia.dto.Dtos;
import co.edu.ucc.acordia.servicio.CancionService;
import co.edu.ucc.acordia.servicio.ImportadorChordonomicon;
import co.edu.ucc.acordia.servicio.ModeloTransicionesService;
import co.edu.ucc.acordia.servicio.ReferenciaService;
import co.edu.ucc.acordia.servicio.SpotifyService;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.NoSuchElementException;

/**
 * API de la base de datos de acordes (Chordonomicon) y de Spotify.
 *
 * <pre>
 * GET  /api/estado                          qué está configurado
 * GET  /api/referencias/buscar?q=...        buscar canciones en Spotify
 * GET  /api/referencias/{spotifyId}         acordes de esa canción en Chordonomicon
 * POST /api/referencias/convertir           traducir acordes pegados por el usuario
 * GET  /api/modelo/transiciones             matriz de cambios de acorde para el analizador
 *                                           (Chordonomicon + lo aprendido de las canciones revisadas)
 * </pre>
 */
@RestController
@RequestMapping("/api")
public class ReferenciaController {

    private final SpotifyService spotify;
    private final ReferenciaService referencias;
    private final ModeloTransicionesService modelo;
    private final CancionService canciones;
    private final ImportadorChordonomicon importador;

    public ReferenciaController(SpotifyService spotify, ReferenciaService referencias,
                                ModeloTransicionesService modelo, CancionService canciones,
                                ImportadorChordonomicon importador) {
        this.spotify = spotify;
        this.referencias = referencias;
        this.modelo = modelo;
        this.canciones = canciones;
        this.importador = importador;
    }

    @GetMapping("/estado")
    public Dtos.Estado estado() {
        return new Dtos.Estado(spotify.estaConfigurado(), referencias.contar(), modelo.vieneDeLaBase(), canciones.contar(),
                modelo.cancionesAprendidas());
    }

    @GetMapping("/referencias/buscar")
    public List<Dtos.ResultadoSpotify> buscar(@RequestParam("q") String consulta) {
        return spotify.buscar(consulta);
    }

    @GetMapping("/referencias/{spotifyId}")
    public Dtos.Referencia porSpotifyId(@PathVariable String spotifyId) {
        return referencias.porSpotifyId(spotifyId)
                .orElseThrow(() -> new NoSuchElementException("Esa canción no está en la base de datos de acordes."));
    }

    /** Recibe texto plano (acordes copiados de un cancionero) y lo devuelve ordenado por secciones. */
    @PostMapping(value = "/referencias/convertir", consumes = "text/plain")
    public Dtos.Referencia convertir(@RequestBody String texto) {
        Dtos.Referencia r = referencias.convertir(null, null, null, texto);
        if (r.secuencia().isEmpty()) {
            throw new IllegalArgumentException("No encontré acordes en ese texto. Escríbelos separados por espacios, por ejemplo: G D Em C");
        }
        return r;
    }

    /** Empieza a descargar e importar Chordonomicon en segundo plano. */
    @PostMapping("/chordonomicon/importar")
    public ImportadorChordonomicon.Estado importarChordonomicon() {
        if (!importador.iniciar()) {
            throw new IllegalStateException("Ya hay una importación en curso.");
        }
        return importador.estado();
    }

    /** Avance de la descarga e importación. */
    @GetMapping("/chordonomicon/estado")
    public ImportadorChordonomicon.Estado estadoChordonomicon() {
        return importador.estado();
    }

    @GetMapping("/modelo/transiciones")
    public ResponseEntity<Dtos.ModeloTransiciones> transiciones() {
        return ResponseEntity.ok()
                // Sin caché: el modelo cambia cada vez que el usuario enseña una canción nueva.
                .cacheControl(CacheControl.noStore())
                .body(modelo.obtener());
    }
}
