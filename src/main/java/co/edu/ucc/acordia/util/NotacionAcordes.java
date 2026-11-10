package co.edu.ucc.acordia.util;

import java.util.Locale;

/**
 * Traduce los acordes de Chordonomicon a la notación que usa un guitarrista.
 *
 * Chordonomicon escribe los sostenidos con "s" y los menores con "min":
 * <pre>
 *   Csmin   →  C#m
 *   Fs7     →  F#7
 *   Bbmin9  →  Bbm9
 *   Fsno3d  →  F#5   (quinta o "power chord")
 *   D/Fs    →  D/F#
 * </pre>
 * También simplifica cualquier acorde a mayor o menor (lo que entiende el analizador de audio).
 */
public final class NotacionAcordes {

    /** Nombres de las 12 notas, usando sostenidos. Índice 0 = Do (C). */
    public static final String[] NOTAS = {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"};

    private static final String[] LATINAS = {"Sol", "Do", "Re", "Mi", "Fa", "La", "Si"};
    private static final int[] NOTAS_LATINAS = {7, 0, 2, 4, 5, 9, 11};

    /** Lo que puede venir después de la raíz: maj7, min7, sus4, add9, 7b9, no3d... */
    private static final java.util.regex.Pattern CALIDAD_VALIDA = java.util.regex.Pattern.compile(
            "(maj|min(maj)?|dim|aug|no3d)?(\\d{1,2})?((sus|add)\\d{0,2})*([#b]\\d{1,2})*");

    private NotacionAcordes() {
    }

    /** Resultado de leer un acorde. */
    public record AcordeLeido(int raiz, String calidad, Integer bajo) {

        /** true si el acorde suena menor (m, m7, m9, dim...). */
        public boolean esMenor() {
            return calidad.startsWith("min") || calidad.startsWith("dim");
        }

        /** Etiqueta simplificada: "C", "C#m", "A"... */
        public String simplificado() {
            return NOTAS[raiz] + (esMenor() ? "m" : "");
        }

        /** Índice 0-23 de la etiqueta simplificada: 0-11 mayores, 12-23 menores. */
        public int indiceSimplificado() {
            return raiz + (esMenor() ? 12 : 0);
        }

        /** Nombre legible: "C#m7", "F#5", "D/F#"... */
        public String legible() {
            String q = calidad;
            if (q.startsWith("min")) {
                // "minmaj7" → "mmaj7", "min7" → "m7"
                q = "m" + q.substring(3);
            } else if (q.equals("no3d")) {
                q = "5";
            } else if (q.equals("maj")) {
                q = "";
            }
            String nombre = NOTAS[raiz] + q;
            if (bajo != null && bajo != raiz) {
                nombre += "/" + NOTAS[bajo];
            }
            return nombre;
        }
    }

    /**
     * Lee un acorde en notación de Chordonomicon (o en notación normal, también funciona).
     *
     * @return el acorde leído, o null si el texto no es un acorde.
     */
    public static AcordeLeido leer(String texto) {
        if (texto == null) {
            return null;
        }
        String t = texto.trim();
        if (t.isEmpty() || t.startsWith("<")) {
            return null;
        }
        String principal = t;
        String bajoTexto = null;
        int barra = t.indexOf('/');
        if (barra > 0) {
            principal = t.substring(0, barra);
            bajoTexto = t.substring(barra + 1);
        }
        // Se prueba primero la notación latina y luego la americana.
        // Ejemplo: "Fadd9" parece "Fa" + "dd9", pero eso no es válido, así que se lee como F add9.
        for (Raiz r : new Raiz[]{leerRaizLatina(principal), leerRaizAmericana(principal)}) {
            if (r == null) {
                continue;
            }
            String calidad = normalizarCalidad(principal.substring(r.largo()));
            if (!CALIDAD_VALIDA.matcher(calidad).matches()) {
                continue; // Por ejemplo la palabra "Bad": empieza con B pero no es un acorde.
            }
            Integer bajo = null;
            if (bajoTexto != null) {
                Raiz rb = leerRaiz(bajoTexto);
                if (rb != null) {
                    bajo = rb.nota();
                }
            }
            return new AcordeLeido(r.nota(), calidad, bajo);
        }
        return null;
    }

    private record Raiz(int nota, int largo) {
    }

    private static Raiz leerRaiz(String s) {
        Raiz latina = leerRaizLatina(s);
        return latina != null && latina.largo() == s.length() ? latina : leerRaizAmericana(s);
    }

    /** Do, Re, Mi, Fa, Sol, La, Si (con # o b opcional). */
    private static Raiz leerRaizLatina(String s) {
        if (s.isEmpty()) {
            return null;
        }
        for (int i = 0; i < LATINAS.length; i++) {
            String nombre = LATINAS[i];
            if (s.regionMatches(true, 0, nombre, 0, nombre.length())
                    && Character.isUpperCase(s.charAt(0))) {
                String resto = s.substring(nombre.length());
                int nota = NOTAS_LATINAS[i];
                if (resto.startsWith("#")) {
                    return new Raiz((nota + 1) % 12, nombre.length() + 1);
                }
                if (resto.startsWith("b")) {
                    return new Raiz((nota + 11) % 12, nombre.length() + 1);
                }
                return new Raiz(nota, nombre.length());
            }
        }
        return null;
    }

    /** C, D, E, F, G, A, B (con #, b o la "s" de sostenido que usa Chordonomicon). */
    private static Raiz leerRaizAmericana(String s) {
        if (s.isEmpty()) {
            return null;
        }
        int base = switch (Character.toUpperCase(s.charAt(0))) {
            case 'C' -> 0;
            case 'D' -> 2;
            case 'E' -> 4;
            case 'F' -> 5;
            case 'G' -> 7;
            case 'A' -> 9;
            case 'B' -> 11;
            default -> -1;
        };
        if (base < 0) {
            return null;
        }
        String resto = s.substring(1);
        // Ojo: "Csus4" empieza con "s" pero no es C#. "Cssus4" sí es C# sus4.
        if (resto.startsWith("#") || (resto.startsWith("s") && !resto.startsWith("sus"))) {
            return new Raiz((base + 1) % 12, 2);
        }
        if (resto.startsWith("b")) {
            return new Raiz((base + 11) % 12, 2);
        }
        return new Raiz(base, 1);
    }

    /** Pasa "m7", "min7", "-7"... a una forma única basada en "min". */
    private static String normalizarCalidad(String q) {
        String c = q.trim();
        if (c.isEmpty()) {
            return "maj";
        }
        String bajo = c.toLowerCase(Locale.ROOT);
        if (bajo.startsWith("min") || bajo.startsWith("dim") || bajo.startsWith("maj")
                || bajo.startsWith("aug") || bajo.startsWith("sus") || bajo.startsWith("add")
                || bajo.equals("no3d")) {
            return bajo.equals("maj") ? "maj" : bajo;
        }
        // Notación de guitarrista: "m", "m7" (pero no "maj7")
        if (c.startsWith("m") && !c.startsWith("maj")) {
            return "min" + c.substring(1);
        }
        if (c.equals("5")) {
            return "no3d";
        }
        return c;
    }

    /** Atajo: devuelve la etiqueta simplificada o null. */
    public static String simplificar(String texto) {
        AcordeLeido a = leer(texto);
        return a == null ? null : a.simplificado();
    }
}
