package co.edu.ucc.acordia.modelo;

/** Cómo se obtuvo un acorde de la línea de tiempo. */
public enum OrigenAcorde {
    /** Lo encontró el analizador de audio. */
    DETECTADO,
    /** Viene de la progresión guardada en la base de datos (Chordonomicon). */
    BASE_DATOS,
    /** Lo escribió o corrigió el usuario. */
    MANUAL
}
