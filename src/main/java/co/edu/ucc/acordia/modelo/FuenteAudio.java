package co.edu.ucc.acordia.modelo;

/** De dónde sale el audio de una canción. */
public enum FuenteAudio {
    /** Archivo MP3 que el usuario subió. Se puede analizar automáticamente. */
    MP3,
    /** Video de YouTube. Solo se reproduce; los acordes vienen de la base de datos o se escriben a mano. */
    YOUTUBE
}
