package co.edu.ucc.acordia.modelo;

import jakarta.persistence.*;

/**
 * Un acorde que suena desde el segundo {@code inicio} hasta el segundo {@code fin}.
 * La lista ordenada de eventos forma la línea de tiempo de la canción.
 */
@Entity
@Table(name = "evento_acorde", indexes = @Index(name = "idx_evento_cancion", columnList = "cancion_id, orden"))
public class EventoAcorde {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "cancion_id")
    private Cancion cancion;

    @Column(nullable = false)
    private int orden;

    @Column(nullable = false)
    private double inicio;

    @Column(nullable = false)
    private double fin;

    /** Nombre del acorde, por ejemplo "Am", "G7" o "N" (silencio / sin acorde). */
    @Column(nullable = false, length = 16)
    private String acorde;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 12)
    private OrigenAcorde origen;

    public EventoAcorde() {
    }

    public EventoAcorde(double inicio, double fin, String acorde, OrigenAcorde origen) {
        this.inicio = inicio;
        this.fin = fin;
        this.acorde = acorde;
        this.origen = origen;
    }

    public Long getId() { return id; }
    public Cancion getCancion() { return cancion; }
    public void setCancion(Cancion cancion) { this.cancion = cancion; }
    public int getOrden() { return orden; }
    public void setOrden(int orden) { this.orden = orden; }
    public double getInicio() { return inicio; }
    public void setInicio(double inicio) { this.inicio = inicio; }
    public double getFin() { return fin; }
    public void setFin(double fin) { this.fin = fin; }
    public String getAcorde() { return acorde; }
    public void setAcorde(String acorde) { this.acorde = acorde; }
    public OrigenAcorde getOrigen() { return origen; }
    public void setOrigen(OrigenAcorde origen) { this.origen = origen; }
}
