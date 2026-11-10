package co.edu.ucc.acordia;

import co.edu.ucc.acordia.util.NotacionAcordes;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/** Pruebas de la traducción de acordes de Chordonomicon a notación de guitarrista. */
class NotacionAcordesTest {

    private static String legible(String s) {
        NotacionAcordes.AcordeLeido a = NotacionAcordes.leer(s);
        return a == null ? null : a.legible();
    }

    @Test
    void sostenidosConLetraS() {
        assertEquals("C#m", legible("Csmin"));
        assertEquals("F#7", legible("Fs7"));
        assertEquals("G#", legible("Gs"));
    }

    @Test
    void susNoSeConfundeConSostenido() {
        assertEquals("Csus4", legible("Csus4"));
        assertEquals("C#sus4", legible("Cssus4"));
    }

    @Test
    void bemolesYExtensiones() {
        assertEquals("A#m9", legible("Bbmin9"));
        assertEquals("Cmaj7", legible("Cmaj7"));
        assertEquals("Cadd9", legible("Cadd9"));
        assertEquals("Fadd9", legible("Fadd9"));
    }

    @Test
    void quintasYBajos() {
        assertEquals("F#5", legible("Fsno3d"));
        assertEquals("D/F#", legible("D/Fs"));
        assertEquals("Am7/G", legible("Amin7/G"));
    }

    @Test
    void notacionLatina() {
        assertEquals("G", legible("Sol"));
        assertEquals("Am", legible("Lam"));
        assertEquals("F#m", legible("Fa#m"));
        assertEquals("D7", legible("Re7"));
    }

    @Test
    void palabrasQueNoSonAcordes() {
        assertNull(NotacionAcordes.leer("Bad"));
        assertNull(NotacionAcordes.leer("<verse_1>"));
        assertNull(NotacionAcordes.leer("hola"));
    }

    @Test
    void simplificacionParaElAnalizador() {
        assertEquals("C#m", NotacionAcordes.simplificar("Csmin7"));
        assertEquals("G", NotacionAcordes.simplificar("Gsus4"));
        assertEquals("F#", NotacionAcordes.simplificar("Fsno3d"));
        assertEquals("Bm", NotacionAcordes.simplificar("Bdim"));
    }
}
