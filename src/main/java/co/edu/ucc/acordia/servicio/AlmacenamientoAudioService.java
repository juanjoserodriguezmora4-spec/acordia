package co.edu.ucc.acordia.servicio;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/**
 * Guarda los archivos de audio en una carpeta del disco.
 * En la base de datos solo queda el nombre del archivo, no el audio en sí.
 */
@Service
public class AlmacenamientoAudioService {

    private static final Set<String> EXTENSIONES = Set.of("mp3", "m4a", "wav", "ogg", "flac", "aac");

    private final Path carpeta;

    public AlmacenamientoAudioService(@Value("${acordia.audio.carpeta:./audios}") String carpeta) throws IOException {
        this.carpeta = Path.of(carpeta).toAbsolutePath().normalize();
        Files.createDirectories(this.carpeta);
    }

    /** Guarda el archivo con un nombre aleatorio y devuelve ese nombre. */
    public String guardar(MultipartFile archivo) throws IOException {
        String original = archivo.getOriginalFilename() == null ? "" : archivo.getOriginalFilename();
        String extension = original.contains(".")
                ? original.substring(original.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT)
                : "mp3";
        if (!EXTENSIONES.contains(extension)) {
            throw new IllegalArgumentException("Formato no soportado: ." + extension + ". Usa MP3, M4A, WAV, OGG o FLAC.");
        }
        String nombre = UUID.randomUUID() + "." + extension;
        try (InputStream entrada = archivo.getInputStream()) {
            Files.copy(entrada, carpeta.resolve(nombre), StandardCopyOption.REPLACE_EXISTING);
        }
        return nombre;
    }

    public Resource cargar(String nombre) {
        Path ruta = carpeta.resolve(nombre).normalize();
        if (!ruta.startsWith(carpeta) || !Files.exists(ruta)) {
            throw new IllegalArgumentException("No se encontró el archivo de audio.");
        }
        return new FileSystemResource(ruta);
    }

    public void borrar(String nombre) {
        if (nombre == null) {
            return;
        }
        try {
            Path ruta = carpeta.resolve(nombre).normalize();
            if (ruta.startsWith(carpeta)) {
                Files.deleteIfExists(ruta);
            }
        } catch (IOException ignorado) {
            // Si no se puede borrar el archivo no pasa nada grave: la canción ya no existe en la base.
        }
    }

    public String tipoContenido(String nombre) {
        String ext = nombre.substring(nombre.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        return switch (ext) {
            case "m4a", "aac" -> "audio/mp4";
            case "wav" -> "audio/wav";
            case "ogg" -> "audio/ogg";
            case "flac" -> "audio/flac";
            default -> "audio/mpeg";
        };
    }
}
