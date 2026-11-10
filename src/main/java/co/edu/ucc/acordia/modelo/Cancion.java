package co.edu.ucc.acordia.modelo;

import jakarta.persistence.*;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Una canción guardada en la biblioteca del usuario, con su línea de tiempo de acordes.
 */
@Entity
@Table(name = "cancion")
public class Cancion {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 200)
    private String titulo;

    @Column(length = 200)
    private String artista;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private FuenteAudio fuente;

    /** Nombre del archivo MP3 dentro de la carpeta de audios (solo si fuente = MP3). */
    @Column(name = "nombre_archivo", length = 100)
    private String nombreArchivo;

    /** ID del video (las 11 letras después de v=), solo si fuente = YOUTUBE. */
    @Column(name = "youtube_id", length = 20)
    private String youtubeId;

    /** ID de la canción en Spotify, si se encontró su progresión en la base de datos. */
    @Column(name = "spotify_id", length = 22)
    private String spotifyId;

    @Column(name = "duracion_seg")
    private Double duracionSeg;

    private Double bpm;

    /** Tonalidad estimada, por ejemplo "G" o "Em". */
    @Column(length = 10)
    private String tonalidad;

    /** Traste donde el usuario pone el capotraste (0 = sin capo). */
    private int capo;

    /** Semitonos que el usuario subió (+) o bajó (-) la canción. */
    private int transposicion;

    /**
     * Ajuste de sincronía en segundos: cuánto se corren los acordes para que coincidan con lo que se oye.
     * Positivo = los acordes aparecen más tarde.
     */
    private Double desfase;

    /** Índice del primer pulso que es tiempo 1 del compás (para dibujar los compases). */
    @Column(name = "primer_tiempo")
    private Integer primerTiempo;

    /**
     * true si el usuario revisó los acordes y quiere que Acordia aprenda de esta canción.
     * Sus cambios de acorde se suman al modelo que usa el analizador.
     */
    @Column(name = "usar_para_aprender")
    private Boolean usarParaAprender;

    /**
     * Momentos (en segundos) de cada pulso de la canción, como arreglo JSON.
     * Sirve para dibujar la cuadrícula por compases. Puede ser null en canciones de YouTube.
     */
    @Lob
    @Column(columnDefinition = "LONGTEXT")
    private String pulsos;

    @Column(name = "fecha_creacion", nullable = false)
    private LocalDateTime fechaCreacion;

    @Column(name = "fecha_actualizacion")
    private LocalDateTime fechaActualizacion;

    @OneToMany(mappedBy = "cancion", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("orden ASC")
    private List<EventoAcorde> eventos = new ArrayList<>();

    @PrePersist
    void alCrear() {
        fechaCreacion = LocalDateTime.now();
        fechaActualizacion = fechaCreacion;
    }

    @PreUpdate
    void alActualizar() {
        fechaActualizacion = LocalDateTime.now();
    }

    /** Reemplaza toda la línea de tiempo de acordes. */
    public void reemplazarEventos(List<EventoAcorde> nuevos) {
        eventos.clear();
        for (int i = 0; i < nuevos.size(); i++) {
            EventoAcorde e = nuevos.get(i);
            e.setCancion(this);
            e.setOrden(i);
            eventos.add(e);
        }
    }

    // ----- getters y setters -----

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getTitulo() { return titulo; }
    public void setTitulo(String titulo) { this.titulo = titulo; }
    public String getArtista() { return artista; }
    public void setArtista(String artista) { this.artista = artista; }
    public FuenteAudio getFuente() { return fuente; }
    public void setFuente(FuenteAudio fuente) { this.fuente = fuente; }
    public String getNombreArchivo() { return nombreArchivo; }
    public void setNombreArchivo(String nombreArchivo) { this.nombreArchivo = nombreArchivo; }
    public String getYoutubeId() { return youtubeId; }
    public void setYoutubeId(String youtubeId) { this.youtubeId = youtubeId; }
    public String getSpotifyId() { return spotifyId; }
    public void setSpotifyId(String spotifyId) { this.spotifyId = spotifyId; }
    public Double getDuracionSeg() { return duracionSeg; }
    public void setDuracionSeg(Double duracionSeg) { this.duracionSeg = duracionSeg; }
    public Double getBpm() { return bpm; }
    public void setBpm(Double bpm) { this.bpm = bpm; }
    public String getTonalidad() { return tonalidad; }
    public void setTonalidad(String tonalidad) { this.tonalidad = tonalidad; }
    public int getCapo() { return capo; }
    public void setCapo(int capo) { this.capo = capo; }
    public int getTransposicion() { return transposicion; }
    public void setTransposicion(int transposicion) { this.transposicion = transposicion; }
    public double getDesfase() { return desfase == null ? 0 : desfase; }
    public void setDesfase(Double desfase) { this.desfase = desfase; }
    public int getPrimerTiempo() { return primerTiempo == null ? 0 : primerTiempo; }
    public void setPrimerTiempo(Integer primerTiempo) { this.primerTiempo = primerTiempo; }
    public boolean isUsarParaAprender() { return Boolean.TRUE.equals(usarParaAprender); }
    public void setUsarParaAprender(Boolean usarParaAprender) { this.usarParaAprender = usarParaAprender; }
    public String getPulsos() { return pulsos; }
    public void setPulsos(String pulsos) { this.pulsos = pulsos; }
    public LocalDateTime getFechaCreacion() { return fechaCreacion; }
    public LocalDateTime getFechaActualizacion() { return fechaActualizacion; }
    public List<EventoAcorde> getEventos() { return eventos; }
}
