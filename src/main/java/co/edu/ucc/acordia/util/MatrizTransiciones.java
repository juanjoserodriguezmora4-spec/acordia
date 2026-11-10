package co.edu.ucc.acordia.util;

import java.util.ArrayList;
import java.util.List;

/**
 * Cálculos de la matriz de cambios de acorde (sin depender de Spring, para poder probarlos fácil).
 *
 * Los conteos se guardan de forma relativa: conteos[calidadDesde][calidadHacia][intervalo],
 * donde calidad 0 = mayor, 1 = menor, e intervalo = semitonos entre las raíces (0 a 11).
 * Ejemplo: C → Am es "mayor a menor, 9 semitonos". G → Em también. Por eso lo que se aprende
 * en una tonalidad sirve para todas.
 */
public final class MatrizTransiciones {

    private MatrizTransiciones() {
    }

    /** Las 24 etiquetas: C, C#, ..., B, Cm, C#m, ..., Bm. */
    public static List<String> etiquetas() {
        List<String> e = new ArrayList<>(24);
        for (String n : NotacionAcordes.NOTAS) e.add(n);
        for (String n : NotacionAcordes.NOTAS) e.add(n + "m");
        return e;
    }

    /** Suma al conteo cada cambio de un acorde a otro distinto (ignorando las marcas de sección). */
    public static void contar(String acordes, long[][][] conteos) {
        int anterior = -1;
        for (String token : acordes.split("\\s+")) {
            NotacionAcordes.AcordeLeido a = NotacionAcordes.leer(token);
            if (a == null) {
                continue;
            }
            int actual = a.indiceSimplificado();
            if (anterior >= 0 && actual != anterior) {
                int intervalo = ((actual % 12) - (anterior % 12) + 12) % 12;
                conteos[anterior / 12][actual / 12][intervalo]++;
            }
            anterior = actual;
        }
    }

    /** Pasa los conteos relativos a una matriz 24x24 de probabilidades (cada fila suma 1, sin la diagonal). */
    public static double[][] aMatriz(double[][][] conteos) {
        double[][] m = new double[24][24];
        for (int i = 0; i < 24; i++) {
            int raizI = i % 12, calI = i / 12;
            double suma = 0;
            for (int j = 0; j < 24; j++) {
                if (i == j) continue;
                int raizJ = j % 12, calJ = j / 12;
                int intervalo = (raizJ - raizI + 12) % 12;
                // +1 de "suavizado": ningún cambio queda con probabilidad cero.
                m[i][j] = conteos[calI][calJ][intervalo] + 1;
                suma += m[i][j];
            }
            for (int j = 0; j < 24; j++) {
                m[i][j] = i == j ? 0 : m[i][j] / suma;
            }
        }
        return m;
    }

    /**
     * Mezcla dos matrices: (1 - peso) * base + peso * propia.
     * Cada fila sigue sumando 1 porque las dos matrices la cumplen.
     */
    public static double[][] mezclar(double[][] base, double[][] propia, double peso) {
        double[][] m = new double[24][24];
        for (int i = 0; i < 24; i++)
            for (int j = 0; j < 24; j++)
                m[i][j] = (1 - peso) * base[i][j] + peso * propia[i][j];
        return m;
    }

    /**
     * Cuánto pesan las canciones del usuario frente a la base: crece con cada canción
     * revisada pero nunca pasa de la mitad, para no olvidar lo aprendido de Chordonomicon.
     * 1 canción = 8 %, 5 canciones = 25 %, 20 canciones = 40 %.
     */
    public static double pesoPropio(long canciones) {
        return canciones <= 0 ? 0 : 0.5 * canciones / (canciones + 5.0);
    }

    /** Suma todos los conteos (para mostrar cuántos cambios se contaron). */
    public static long total(long[][][] conteos) {
        long t = 0;
        for (long[][] a : conteos) for (long[] b : a) for (long v : b) t += v;
        return t;
    }

    /** Pasa conteos enteros a double. */
    public static double[][][] aDouble(long[][][] conteos) {
        double[][][] c = new double[2][2][12];
        for (int d = 0; d < 2; d++)
            for (int h = 0; h < 2; h++)
                for (int k = 0; k < 12; k++)
                    c[d][h][k] = conteos[d][h][k];
        return c;
    }

    /**
     * Pesos aproximados según la teoría, para cuando todavía no se ha importado Chordonomicon.
     * Desde un acorde mayor lo más común es ir al IV, al V y al vi; desde uno menor, a su
     * relativo mayor, al iv y al VI/VII.
     */
    public static double[][][] conteosTeoricos() {
        double[][][] c = new double[2][2][12];
        for (int d = 0; d < 2; d++)
            for (int h = 0; h < 2; h++)
                for (int k = 0; k < 12; k++)
                    c[d][h][k] = 3;
        // mayor → mayor
        c[0][0][5] = 100;  // I → IV   (C → F)
        c[0][0][7] = 100;  // I → V    (C → G)
        c[0][0][10] = 35;  // I → bVII (C → Bb)
        c[0][0][2] = 25;   // I → II   (C → D)
        c[0][0][8] = 20;   // I → bVI  (C → Ab)
        c[0][0][3] = 12;   // I → bIII (C → Eb)
        c[0][0][4] = 10;   // I → III  (C → E)
        c[0][0][9] = 10;   // I → VI   (C → A)
        // mayor → menor
        c[0][1][9] = 80;   // I → vi   (C → Am)
        c[0][1][2] = 55;   // I → ii   (C → Dm)
        c[0][1][4] = 40;   // I → iii  (C → Em)
        c[0][1][11] = 10;  // (C → Bm)
        c[0][1][7] = 10;   // I → v    (C → Gm)
        c[0][1][5] = 8;    // I → iv   (C → Fm)
        // menor → mayor
        c[1][0][3] = 80;   // vi → I   (Am → C)
        c[1][0][8] = 80;   // vi → IV  (Am → F)
        c[1][0][10] = 70;  // vi → V   (Am → G)
        c[1][0][7] = 45;   // i → V    (Am → E)
        c[1][0][5] = 40;   // ii → V   (Dm → G)
        c[1][0][1] = 10;   // iii → IV (Em → F)
        // menor → menor
        c[1][1][5] = 55;   // vi → ii / i → iv (Am → Dm)
        c[1][1][7] = 45;   // vi → iii / i → v (Am → Em)
        c[1][1][2] = 15;   // (Em → F#m)
        c[1][1][10] = 15;  // (Am → Gm)
        return c;
    }
}
