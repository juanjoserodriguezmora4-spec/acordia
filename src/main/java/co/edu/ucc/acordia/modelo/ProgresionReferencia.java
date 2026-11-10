package co.edu.ucc.acordia.modelo;

import jakarta.persistence.*;

/**
 * Una fila importada del dataset Chordonomicon: la progresión de acordes de una canción.
 *
 * Chordonomicon no guarda el nombre de la canción, solo su ID de Spotify. Por eso para
 * encontrar una canción por nombre primero se busca en Spotify y con el ID se consulta aquí.
 */
@Entity
@Table(name = "progresion_referencia",
        indexes = @Index(name = "idx_progresion_spotify", columnList = "spotify_song_id"))
public class ProgresionReferencia {

    /** El mismo id que trae el CSV de Chordonomicon. */
    @Id
    private Long id;

    @Column(name = "spotify_song_id", length = 22)
    private String spotifySongId;

    @Column(name = "spotify_artist_id", length = 22)
    private String spotifyArtistId;

    /** Acordes en la notación original de Chordonomicon, con marcas de sección (&lt;verse_1&gt;, &lt;chorus_1&gt;...). */
    @Lob
    @Column(nullable = false, columnDefinition = "MEDIUMTEXT")
    private String acordes;

    @Column(name = "genero_principal", length = 40)
    private String generoPrincipal;

    @Column(name = "fecha_lanzamiento", length = 10)
    private String fechaLanzamiento;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getSpotifySongId() { return spotifySongId; }
    public void setSpotifySongId(String spotifySongId) { this.spotifySongId = spotifySongId; }
    public String getSpotifyArtistId() { return spotifyArtistId; }
    public void setSpotifyArtistId(String spotifyArtistId) { this.spotifyArtistId = spotifyArtistId; }
    public String getAcordes() { return acordes; }
    public void setAcordes(String acordes) { this.acordes = acordes; }
    public String getGeneroPrincipal() { return generoPrincipal; }
    public void setGeneroPrincipal(String generoPrincipal) { this.generoPrincipal = generoPrincipal; }
    public String getFechaLanzamiento() { return fechaLanzamiento; }
    public void setFechaLanzamiento(String fechaLanzamiento) { this.fechaLanzamiento = fechaLanzamiento; }
}
