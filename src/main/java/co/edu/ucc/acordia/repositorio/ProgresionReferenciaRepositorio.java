package co.edu.ucc.acordia.repositorio;

import co.edu.ucc.acordia.modelo.ProgresionReferencia;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface ProgresionReferenciaRepositorio extends JpaRepository<ProgresionReferencia, Long> {

    /** Puede haber varias versiones de la misma canción; se toma la primera. */
    Optional<ProgresionReferencia> findFirstBySpotifySongIdOrderByIdAsc(String spotifySongId);

    /** Devuelve cuáles de los IDs de Spotify dados existen en la base de datos. */
    @Query("select distinct p.spotifySongId from ProgresionReferencia p where p.spotifySongId in :ids")
    List<String> idsExistentes(@Param("ids") Collection<String> ids);
}
