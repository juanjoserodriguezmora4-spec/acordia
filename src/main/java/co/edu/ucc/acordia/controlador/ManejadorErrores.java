package co.edu.ucc.acordia.controlador;

import co.edu.ucc.acordia.dto.Dtos;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

import java.util.NoSuchElementException;

/** Convierte los errores en respuestas JSON con un mensaje claro en español. */
@RestControllerAdvice
public class ManejadorErrores {

    private static final Logger log = LoggerFactory.getLogger(ManejadorErrores.class);

    @ExceptionHandler(NoSuchElementException.class)
    public ResponseEntity<Dtos.Error> noEncontrado(NoSuchElementException e) {
        return respuesta(HttpStatus.NOT_FOUND, e.getMessage());
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Dtos.Error> datosInvalidos(IllegalArgumentException e) {
        return respuesta(HttpStatus.BAD_REQUEST, e.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Dtos.Error> validacion(MethodArgumentNotValidException e) {
        String campo = e.getBindingResult().getFieldErrors().stream()
                .map(f -> f.getField() + ": " + f.getDefaultMessage())
                .findFirst().orElse("datos inválidos");
        return respuesta(HttpStatus.BAD_REQUEST, "Revisa el campo " + campo);
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<Dtos.Error> archivoGrande(MaxUploadSizeExceededException e) {
        return respuesta(HttpStatus.PAYLOAD_TOO_LARGE, "El archivo es muy grande. El máximo es 40 MB.");
    }

    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Dtos.Error> servicioNoDisponible(IllegalStateException e) {
        return respuesta(HttpStatus.SERVICE_UNAVAILABLE, e.getMessage());
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Dtos.Error> inesperado(Exception e) {
        log.error("Error inesperado", e);
        return respuesta(HttpStatus.INTERNAL_SERVER_ERROR, "Ocurrió un error inesperado en el servidor.");
    }

    private static ResponseEntity<Dtos.Error> respuesta(HttpStatus estado, String mensaje) {
        return ResponseEntity.status(estado).body(new Dtos.Error(mensaje));
    }
}
