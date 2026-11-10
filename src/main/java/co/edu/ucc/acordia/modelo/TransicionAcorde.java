package co.edu.ucc.acordia.modelo;

import jakarta.persistence.*;

/**
 * Cuántas veces, en todas las canciones de Chordonomicon, un acorde pasó a otro.
 *
 * Se guarda de forma relativa (independiente de la tonalidad): por ejemplo
 * "de mayor a menor subiendo 9 semitonos" (C → Am, G → Em, D → Bm...).
 * Así el conocimiento sirve para cualquier tonalidad.
 */
@Entity
@Table(name = "transicion_acorde",
        uniqueConstraints = @UniqueConstraint(name = "uk_transicion", columnNames = {"calidad_desde", "calidad_hacia", "intervalo"}))
public class TransicionAcorde {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** "maj" o "min". */
    @Column(name = "calidad_desde", nullable = false, length = 3)
    private String calidadDesde;

    /** "maj" o "min". */
    @Column(name = "calidad_hacia", nullable = false, length = 3)
    private String calidadHacia;

    /** Semitonos entre la raíz del primer acorde y la del segundo (0 a 11). */
    @Column(nullable = false)
    private int intervalo;

    @Column(nullable = false)
    private long conteo;

    public TransicionAcorde() {
    }

    public TransicionAcorde(String calidadDesde, String calidadHacia, int intervalo, long conteo) {
        this.calidadDesde = calidadDesde;
        this.calidadHacia = calidadHacia;
        this.intervalo = intervalo;
        this.conteo = conteo;
    }

    public Long getId() { return id; }
    public String getCalidadDesde() { return calidadDesde; }
    public String getCalidadHacia() { return calidadHacia; }
    public int getIntervalo() { return intervalo; }
    public long getConteo() { return conteo; }
    public void setConteo(long conteo) { this.conteo = conteo; }
}
