package co.edu.ucc.acordia.controlador;

import co.edu.ucc.acordia.dto.Dtos;
import co.edu.ucc.acordia.modelo.Cancion;
import co.edu.ucc.acordia.modelo.FuenteAudio;
import co.edu.ucc.acordia.servicio.AlmacenamientoAudioService;
import co.edu.ucc.acordia.servicio.CancionService;
import jakarta.validation.Valid;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;

/**
 * API de la biblioteca de canciones.
 *
 * <pre>
 * GET    /api/canciones               lista de canciones
 * GET    /api/canciones/{id}          una canción con sus acordes
 * POST   /api/canciones               subir un MP3 (multipart: archivo, titulo, artista, spotifyId)
 * POST   /api/canciones/youtube       crear desde un link de YouTube (JSON)
 * PUT    /api/canciones/{id}          cambiar título, artista, capo, transposición
 * PUT    /api/canciones/{id}/acordes  guardar la línea de tiempo de acordes
 * GET    /api/canciones/{id}/audio    reproducir el audio
 * DELETE /api/canciones/{id}          borrar
 * </pre>
 */
@RestController
@RequestMapping("/api/canciones")
public class CancionController {

    private final CancionService servicio;
    private final AlmacenamientoAudioService almacenamiento;

    public CancionController(CancionService servicio, AlmacenamientoAudioService almacenamiento) {
        this.servicio = servicio;
        this.almacenamiento = almacenamiento;
    }

    @GetMapping
    public List<Dtos.CancionResumen> listar() {
        return servicio.listar();
    }

    @GetMapping("/{id}")
    public Dtos.CancionDetalle obtener(@PathVariable long id) {
        return servicio.obtener(id);
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public Dtos.CancionDetalle subir(@RequestParam("archivo") MultipartFile archivo,
                                     @RequestParam(value = "titulo", required = false) String titulo,
                                     @RequestParam(value = "artista", required = false) String artista,
                                     @RequestParam(value = "spotifyId", required = false) String spotifyId)
            throws IOException {
        return servicio.crearDesdeArchivo(archivo, titulo, artista, spotifyId);
    }

    @PostMapping("/youtube")
    @ResponseStatus(HttpStatus.CREATED)
    public Dtos.CancionDetalle crearYoutube(@Valid @RequestBody Dtos.NuevaCancionYoutube datos) {
        return servicio.crearDesdeYoutube(datos);
    }

    @PutMapping("/{id}")
    public Dtos.CancionDetalle actualizar(@PathVariable long id, @Valid @RequestBody Dtos.ActualizarCancion datos) {
        return servicio.actualizar(id, datos);
    }

    @PutMapping("/{id}/acordes")
    public Dtos.CancionDetalle guardarAcordes(@PathVariable long id, @Valid @RequestBody Dtos.GuardarAcordes datos) {
        return servicio.guardarAcordes(id, datos);
    }

    /**
     * Devuelve el archivo de audio. Spring atiende solo los pedidos por partes ("Range"),
     * que es lo que usa el navegador para poder adelantar y retroceder la canción.
     */
    @GetMapping("/{id}/audio")
    public ResponseEntity<Resource> audio(@PathVariable long id) {
        Cancion c = servicio.buscar(id);
        if (c.getFuente() != FuenteAudio.MP3) {
            throw new IllegalArgumentException("Esta canción es de YouTube, no tiene archivo de audio.");
        }
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(almacenamiento.tipoContenido(c.getNombreArchivo())))
                .body(almacenamiento.cargar(c.getNombreArchivo()));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void eliminar(@PathVariable long id) {
        servicio.eliminar(id);
    }
}
