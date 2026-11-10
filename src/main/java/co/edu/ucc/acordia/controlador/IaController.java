package co.edu.ucc.acordia.controlador;

import co.edu.ucc.acordia.dto.Dtos;
import co.edu.ucc.acordia.servicio.AnalisisIaService;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;

/**
 * Análisis con IA (opcional). El resultado tiene el mismo formato que el analizador del navegador,
 * así que la página lo guarda con PUT /api/canciones/{id}/acordes como siempre.
 *
 * <pre>
 * GET  /api/ia/estado                      ¿está encendido el servicio de IA?
 * POST /api/ia/canciones/{id}/analizar     analiza el MP3 guardado (parámetros bpm y estabilidad opcionales)
 * POST /api/ia/analizar                    analiza un audio enviado (multipart: archivo, bpm, estabilidad)
 * </pre>
 */
@RestController
@RequestMapping("/api/ia")
public class IaController {

    private final AnalisisIaService ia;

    public IaController(AnalisisIaService ia) {
        this.ia = ia;
    }

    @GetMapping("/estado")
    public Dtos.EstadoIa estado() {
        return ia.estado();
    }

    @PostMapping("/canciones/{id}/analizar")
    public JsonNode analizarCancion(@PathVariable long id,
                                    @RequestParam(value = "bpm", required = false) Double bpm,
                                    @RequestParam(value = "estabilidad", required = false) Double estabilidad) throws IOException {
        return ia.analizarCancion(id, bpm, estabilidad);
    }

    @PostMapping(value = "/analizar", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public JsonNode analizarAudio(@RequestParam("archivo") MultipartFile archivo,
                                  @RequestParam(value = "bpm", required = false) Double bpm,
                                  @RequestParam(value = "estabilidad", required = false) Double estabilidad) throws IOException {
        return ia.analizarAudio(archivo.getBytes(), archivo.getOriginalFilename(), bpm, estabilidad);
    }
}
