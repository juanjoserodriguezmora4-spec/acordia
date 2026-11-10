package co.edu.ucc.acordia.servicio;

import co.edu.ucc.acordia.dto.Dtos;
import co.edu.ucc.acordia.modelo.Cancion;
import co.edu.ucc.acordia.modelo.EventoAcorde;
import co.edu.ucc.acordia.modelo.FuenteAudio;
import co.edu.ucc.acordia.modelo.OrigenAcorde;
import co.edu.ucc.acordia.repositorio.CancionRepositorio;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Lógica de la biblioteca de canciones. */
@Service
public class CancionService {

    private static final Pattern YOUTUBE_ID = Pattern.compile(
            "(?:youtu\\.be/|youtube\\.com/(?:watch\\?(?:.*&)?v=|embed/|shorts/|live/))([A-Za-z0-9_-]{11})");

    private final CancionRepositorio repositorio;
    private final AlmacenamientoAudioService almacenamiento;
    private final ObjectMapper json;
    private final ModeloTransicionesService modelo;

    public CancionService(CancionRepositorio repositorio, AlmacenamientoAudioService almacenamiento, ObjectMapper json,
                          ModeloTransicionesService modelo) {
        this.repositorio = repositorio;
        this.almacenamiento = almacenamiento;
        this.json = json;
        this.modelo = modelo;
    }

    @Transactional(readOnly = true)
    public List<Dtos.CancionResumen> listar() {
        return repositorio.findAllByOrderByFechaActualizacionDesc().stream().map(this::aResumen).toList();
    }

    @Transactional(readOnly = true)
    public Dtos.CancionDetalle obtener(long id) {
        return aDetalle(buscar(id));
    }

    @Transactional
    public Dtos.CancionDetalle crearDesdeArchivo(MultipartFile archivo, String titulo, String artista, String spotifyId)
            throws IOException {
        if (archivo == null || archivo.isEmpty()) {
            throw new IllegalArgumentException("Falta el archivo de audio.");
        }
        Cancion c = new Cancion();
        c.setTitulo(textoONombreArchivo(titulo, archivo.getOriginalFilename()));
        c.setArtista(vacioANull(artista));
        c.setSpotifyId(vacioANull(spotifyId));
        c.setFuente(FuenteAudio.MP3);
        c.setNombreArchivo(almacenamiento.guardar(archivo));
        return aDetalle(repositorio.save(c));
    }

    @Transactional
    public Dtos.CancionDetalle crearDesdeYoutube(Dtos.NuevaCancionYoutube datos) {
        Cancion c = new Cancion();
        c.setTitulo(datos.titulo().trim());
        c.setArtista(vacioANull(datos.artista()));
        c.setSpotifyId(vacioANull(datos.spotifyId()));
        c.setFuente(FuenteAudio.YOUTUBE);
        c.setYoutubeId(extraerIdYoutube(datos.urlYoutube()));
        return aDetalle(repositorio.save(c));
    }

    @Transactional
    public Dtos.CancionDetalle actualizar(long id, Dtos.ActualizarCancion datos) {
        Cancion c = buscar(id);
        if (datos.titulo() != null && !datos.titulo().isBlank()) c.setTitulo(datos.titulo().trim());
        if (datos.artista() != null) c.setArtista(vacioANull(datos.artista()));
        if (datos.spotifyId() != null) c.setSpotifyId(vacioANull(datos.spotifyId()));
        if (datos.capo() != null) c.setCapo(Math.max(0, Math.min(11, datos.capo())));
        if (datos.transposicion() != null) c.setTransposicion(Math.max(-11, Math.min(11, datos.transposicion())));
        if (datos.desfase() != null) c.setDesfase(Math.max(-2.0, Math.min(2.0, datos.desfase())));
        if (datos.usarParaAprender() != null && datos.usarParaAprender() != c.isUsarParaAprender()) {
            if (datos.usarParaAprender() && c.getEventos().size() < 2) {
                throw new IllegalArgumentException("Esta canción todavía no tiene acordes de los que aprender.");
            }
            c.setUsarParaAprender(datos.usarParaAprender());
            repositorio.saveAndFlush(c);
            modelo.invalidar();
        }
        return aDetalle(c);
    }

    @Transactional
    public Dtos.CancionDetalle guardarAcordes(long id, Dtos.GuardarAcordes datos) {
        Cancion c = buscar(id);
        if (datos.bpm() != null) c.setBpm(datos.bpm());
        if (datos.tonalidad() != null) c.setTonalidad(datos.tonalidad());
        if (datos.duracionSeg() != null) c.setDuracionSeg(datos.duracionSeg());
        if (datos.pulsos() != null) c.setPulsos(aJson(datos.pulsos()));
        if (datos.primerTiempo() != null) c.setPrimerTiempo(Math.max(0, Math.min(3, datos.primerTiempo())));

        List<EventoAcorde> eventos = new ArrayList<>();
        for (Dtos.Evento e : datos.eventos()) {
            if (e.fin() < e.inicio()) {
                throw new IllegalArgumentException("Un acorde termina antes de empezar (" + e.acorde() + ").");
            }
            eventos.add(new EventoAcorde(e.inicio(), e.fin(), e.acorde().trim(),
                    e.origen() == null ? OrigenAcorde.MANUAL : e.origen()));
        }
        eventos.sort(Comparator.comparingDouble(EventoAcorde::getInicio));
        c.reemplazarEventos(eventos);
        repositorio.saveAndFlush(c);
        if (c.isUsarParaAprender()) {
            modelo.invalidar(); // lo aprendido de esta canción cambió
        }
        return aDetalle(c);
    }

    @Transactional
    public void eliminar(long id) {
        Cancion c = buscar(id);
        almacenamiento.borrar(c.getNombreArchivo());
        boolean ensenaba = c.isUsarParaAprender();
        repositorio.delete(c);
        if (ensenaba) {
            repositorio.flush();
            modelo.invalidar();
        }
    }

    @Transactional(readOnly = true)
    public Cancion buscar(long id) {
        return repositorio.findById(id)
                .orElseThrow(() -> new NoSuchElementException("No existe la canción con id " + id));
    }

    public long contar() {
        return repositorio.count();
    }

    // ---------- utilidades ----------

    static String extraerIdYoutube(String url) {
        if (url == null) {
            throw new IllegalArgumentException("Falta el link de YouTube.");
        }
        String u = url.trim();
        if (u.matches("[A-Za-z0-9_-]{11}")) {
            return u;
        }
        Matcher m = YOUTUBE_ID.matcher(u);
        if (!m.find()) {
            throw new IllegalArgumentException("No reconozco ese link de YouTube. Debe verse como https://www.youtube.com/watch?v=XXXXXXXXXXX");
        }
        return m.group(1);
    }

    private Dtos.CancionResumen aResumen(Cancion c) {
        // Los 4 acordes que más tiempo suenan, para mostrarlos en la tarjeta.
        Map<String, Double> tiempo = new HashMap<>();
        for (EventoAcorde e : c.getEventos()) {
            if (!"N".equals(e.getAcorde())) {
                tiempo.merge(e.getAcorde(), e.getFin() - e.getInicio(), Double::sum);
            }
        }
        List<String> principales = tiempo.entrySet().stream()
                .sorted(Map.Entry.<String, Double>comparingByValue().reversed())
                .limit(4).map(Map.Entry::getKey).toList();
        return new Dtos.CancionResumen(c.getId(), c.getTitulo(), c.getArtista(), c.getFuente().name(),
                c.getDuracionSeg(), c.getBpm(), c.getTonalidad(), c.getEventos().size(), principales,
                c.isUsarParaAprender(), c.getFechaActualizacion());
    }

    private Dtos.CancionDetalle aDetalle(Cancion c) {
        List<Dtos.Evento> eventos = c.getEventos().stream()
                .map(e -> new Dtos.Evento(e.getInicio(), e.getFin(), e.getAcorde(), e.getOrigen()))
                .toList();
        String url = c.getFuente() == FuenteAudio.MP3 ? "/api/canciones/" + c.getId() + "/audio" : null;
        return new Dtos.CancionDetalle(c.getId(), c.getTitulo(), c.getArtista(), c.getFuente().name(), url,
                c.getYoutubeId(), c.getSpotifyId(), c.getDuracionSeg(), c.getBpm(), c.getTonalidad(),
                c.getCapo(), c.getTransposicion(), c.getDesfase(), c.getPrimerTiempo(), c.isUsarParaAprender(), deJson(c.getPulsos()), eventos);
    }

    private String aJson(List<Double> valores) {
        try {
            // Se redondea a milisegundos para no guardar decimales de más.
            List<Double> redondeados = valores.stream().map(v -> Math.round(v * 1000) / 1000.0).toList();
            return json.writeValueAsString(redondeados);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    private List<Double> deJson(String texto) {
        if (texto == null || texto.isBlank()) {
            return List.of();
        }
        try {
            return json.readValue(texto, new TypeReference<List<Double>>() { });
        } catch (JsonProcessingException e) {
            return List.of();
        }
    }

    private static String vacioANull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static String textoONombreArchivo(String titulo, String nombreArchivo) {
        if (titulo != null && !titulo.isBlank()) {
            return titulo.trim();
        }
        if (nombreArchivo == null || nombreArchivo.isBlank()) {
            return "Canción sin título";
        }
        int punto = nombreArchivo.lastIndexOf('.');
        return punto > 0 ? nombreArchivo.substring(0, punto) : nombreArchivo;
    }
}
