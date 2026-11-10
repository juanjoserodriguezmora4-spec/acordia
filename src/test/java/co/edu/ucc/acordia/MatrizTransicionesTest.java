package co.edu.ucc.acordia;

import co.edu.ucc.acordia.util.MatrizTransiciones;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/** Pruebas del conteo de cambios de acorde y de la matriz de probabilidades. */
class MatrizTransicionesTest {

    @Test
    void cuentaCambiosIgnorandoSeccionesYRepeticiones() {
        long[][][] c = new long[2][2][12];
        // Progresión inventada para la prueba
        MatrizTransiciones.contar("<intro_1> G G Emin C D <verse_1> G Emin", c);
        assertEquals(2, c[0][1][9]); // G → Em (mayor a menor, +9), aparece 2 veces
        assertEquals(1, c[1][0][8]); // Em → C (menor a mayor, +8)
        assertEquals(1, c[0][0][2]); // C → D (+2)
        assertEquals(1, c[0][0][5]); // D → G (+5)
        assertEquals(0, c[0][0][0]); // G → G no cuenta como cambio
    }

    @Test
    void cadaFilaDeLaMatrizSumaUno() {
        double[][] m = MatrizTransiciones.aMatriz(MatrizTransiciones.conteosTeoricos());
        for (int i = 0; i < 24; i++) {
            double suma = 0;
            for (double v : m[i]) suma += v;
            assertEquals(1.0, suma, 1e-9);
            assertEquals(0.0, m[i][i]);
        }
    }

    @Test
    void laTeoriaPrefiereCambiosComunes() {
        double[][] m = MatrizTransiciones.aMatriz(MatrizTransiciones.conteosTeoricos());
        // C → G es mucho más común que C → C#
        assertTrue(m[0][7] > m[0][1] * 10);
        // C → Am (índice 12 + 9 = 21) es más común que C → C#m (13)
        assertTrue(m[0][21] > m[0][13] * 10);
    }

    @Test
    void aprendeDeLasCancionesDelUsuario() {
        double[][] base = MatrizTransiciones.aMatriz(MatrizTransiciones.conteosTeoricos());
        // Canción revisada por el usuario con un cambio poco común en la teoría: C → E
        long[][][] c = new long[2][2][12];
        MatrizTransiciones.contar("C E Am F Fm C N C E Am F Fm C", c);
        double[][] propia = MatrizTransiciones.aMatriz(MatrizTransiciones.aDouble(c));

        double antes = base[0][4];
        double conUna = MatrizTransiciones.mezclar(base, propia, MatrizTransiciones.pesoPropio(1))[0][4];
        double conVeinte = MatrizTransiciones.mezclar(base, propia, MatrizTransiciones.pesoPropio(20))[0][4];
        assertTrue(conUna > antes, "una canción ya sube la probabilidad de C → E");
        assertTrue(conVeinte > conUna, "más canciones, más peso");

        // Las filas siguen sumando 1 y lo propio nunca pesa más de la mitad.
        double[][] m = MatrizTransiciones.mezclar(base, propia, MatrizTransiciones.pesoPropio(1000));
        for (double[] fila : m) {
            double suma = 0;
            for (double v : fila) suma += v;
            assertEquals(1.0, suma, 1e-9);
        }
        assertTrue(MatrizTransiciones.pesoPropio(1_000_000) <= 0.5);
        assertEquals(0.0, MatrizTransiciones.pesoPropio(0));
    }
}
