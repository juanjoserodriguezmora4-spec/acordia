package co.edu.ucc.acordia.servicio;

import co.edu.ucc.acordia.dto.Dtos;
import co.edu.ucc.acordia.modelo.Cancion;
import co.edu.ucc.acordia.modelo.EventoAcorde;
import co.edu.ucc.acordia.modelo.TransicionAcorde;
import co.edu.ucc.acordia.repositorio.CancionRepositorio;
import co.edu.ucc.acordia.repositorio.TransicionAcordeRepositorio;
import co.edu.ucc.acordia.util.MatrizTransiciones;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.List;
import java.util.stream.Collectors;

/**
 * Entrega la matriz de "qué acorde suele venir después de cuál" para los 24 acordes mayores y menores.
 *
 * La matriz se arma en dos partes:
 * <ol>
 *   <li><b>Base:</b> si ya se importó Chordonomicon, sale de contar los cambios de acorde en todas sus
 *       canciones. Si no, se usa una matriz basada en teoría musical básica.</li>
 *   <li><b>Lo aprendido del usuario:</b> los cambios de acorde de las canciones que el usuario revisó y
 *       marcó con "Enseñar a Acordia". Su peso crece con cada canción (hasta la mitad), así el
 *       analizador se va acostumbrando a la música que el usuario toca.</li>
 * </ol>
 * Solo se aprende de canciones revisadas: si se aprendiera de cualquier análisis, el sistema
 * repetiría sus propios errores.
 *
 * El analizador de audio usa esta matriz para corregir sus errores: un cambio raro necesita más
 * evidencia en el audio que un cambio común.
 */
@Service
public class ModeloTransicionesService {

    private final TransicionAcordeRepositorio repositorio;
    private final CancionRepositorio canciones;
    private volatile Dtos.ModeloTransiciones cache;

    public ModeloTransicionesService(TransicionAcordeRepositorio repositorio, CancionRepositorio canciones) {
        this.repositorio = repositorio;
        this.canciones = canciones;
    }

    @Transactional(readOnly = true)
    public Dtos.ModeloTransiciones obtener() {
        Dtos.ModeloTransiciones m = cache;
        if (m == null) {
            m = construir();
            cache = m;
        }
        return m;
    }

    /** Se llama después de importar o cuando cambia una canción de la que se aprende. */
    public void invalidar() {
        cache = null;
        // Si estamos dentro de una transacción, se borra otra vez al confirmarla, para que nadie
        // alcance a guardar en caché un modelo armado con datos todavía sin confirmar.
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    cache = null;
                }
            });
        }
    }

    public boolean vieneDeLaBase() {
        return repositorio.count() > 0;
    }

    public long cancionesAprendidas() {
        return canciones.countByUsarParaAprenderTrue();
    }

    private Dtos.ModeloTransiciones construir() {
        // 1. Base: Chordonomicon o teoría.
        List<TransicionAcorde> filas = repositorio.findAll();
        double[][] base;
        String fuente;
        long totalBase = 0;
        if (filas.isEmpty()) {
            base = MatrizTransiciones.aMatriz(MatrizTransiciones.conteosTeoricos());
            fuente = "teoria";
        } else {
            double[][][] conteos = new double[2][2][12];
            for (TransicionAcorde t : filas) {
                int d = "min".equals(t.getCalidadDesde()) ? 1 : 0;
                int h = "min".equals(t.getCalidadHacia()) ? 1 : 0;
                conteos[d][h][t.getIntervalo()] += t.getConteo();
                totalBase += t.getConteo();
            }
            base = MatrizTransiciones.aMatriz(conteos);
            fuente = "chordonomicon";
        }

        // 2. Lo aprendido de las canciones revisadas por el usuario.
        List<Cancion> propias = canciones.findByUsarParaAprenderTrue();
        long[][][] conteosPropios = new long[2][2][12];
        long usadas = 0;
        for (Cancion c : propias) {
            String acordes = c.getEventos().stream().map(EventoAcorde::getAcorde).collect(Collectors.joining(" "));
            long antes = MatrizTransiciones.total(conteosPropios);
            MatrizTransiciones.contar(acordes, conteosPropios);
            if (MatrizTransiciones.total(conteosPropios) > antes) usadas++;
        }
        long totalPropio = MatrizTransiciones.total(conteosPropios);
        if (usadas == 0) {
            return new Dtos.ModeloTransiciones(MatrizTransiciones.etiquetas(), base, fuente, totalBase, 0, 0, 0);
        }
        double peso = MatrizTransiciones.pesoPropio(usadas);
        double[][] propia = MatrizTransiciones.aMatriz(MatrizTransiciones.aDouble(conteosPropios));
        return new Dtos.ModeloTransiciones(MatrizTransiciones.etiquetas(),
                MatrizTransiciones.mezclar(base, propia, peso), fuente + "+usuario",
                totalBase, usadas, totalPropio, peso);
    }
}
