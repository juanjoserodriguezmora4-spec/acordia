package co.edu.ucc.acordia.repositorio;

import co.edu.ucc.acordia.modelo.Cancion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface CancionRepositorio extends JpaRepository<Cancion, Long> {

    List<Cancion> findAllByOrderByFechaActualizacionDesc();

    /** Las canciones que el usuario revisó y marcó para que Acordia aprenda de ellas. */
    List<Cancion> findByUsarParaAprenderTrue();

    long countByUsarParaAprenderTrue();
}
