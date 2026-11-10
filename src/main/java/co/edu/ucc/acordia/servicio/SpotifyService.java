package co.edu.ucc.acordia.servicio;

import co.edu.ucc.acordia.dto.Dtos;
import co.edu.ucc.acordia.repositorio.ProgresionReferenciaRepositorio;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

/**
 * Busca canciones en Spotify para conocer su ID, y con ese ID encontrar sus acordes en Chordonomicon.
 *
 * Usa el flujo "Client Credentials": no hace falta que el usuario inicie sesión, basta con el
 * Client ID y el Client Secret de una app creada en https://developer.spotify.com/dashboard.
 *
 * Desde febrero de 2026 Spotify exige que el dueño de esa app tenga Spotify Premium,
 * y la búsqueda devuelve máximo 10 resultados por consulta.
 */
@Service
public class SpotifyService {

    private static final int LIMITE_RESULTADOS = 10;

    private final String clientId;
    private final String clientSecret;
    private final ProgresionReferenciaRepositorio referencias;
    private final ObjectMapper json;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    private String token;
    private Instant tokenVence = Instant.EPOCH;

    public SpotifyService(@Value("${spotify.client-id:}") String clientId,
                          @Value("${spotify.client-secret:}") String clientSecret,
                          ProgresionReferenciaRepositorio referencias,
                          ObjectMapper json) {
        this.clientId = clientId == null ? "" : clientId.trim();
        this.clientSecret = clientSecret == null ? "" : clientSecret.trim();
        this.referencias = referencias;
        this.json = json;
    }

    public boolean estaConfigurado() {
        return !clientId.isEmpty() && !clientSecret.isEmpty();
    }

    public List<Dtos.ResultadoSpotify> buscar(String consulta) {
        if (!estaConfigurado()) {
            throw new IllegalStateException("Spotify no está configurado. Escribe tu Client ID y Client Secret en application.properties.");
        }
        if (consulta == null || consulta.isBlank()) {
            return List.of();
        }
        String url = "https://api.spotify.com/v1/search?type=track&limit=" + LIMITE_RESULTADOS
                + "&q=" + URLEncoder.encode(consulta.trim(), StandardCharsets.UTF_8);
        JsonNode respuesta = pedir(HttpRequest.newBuilder(URI.create(url))
                .header("Authorization", "Bearer " + obtenerToken())
                .timeout(Duration.ofSeconds(15))
                .GET().build());

        List<JsonNode> pistas = new ArrayList<>();
        respuesta.path("tracks").path("items").forEach(pistas::add);
        List<String> ids = pistas.stream().map(p -> p.path("id").asText()).toList();
        Set<String> conAcordes = ids.isEmpty() ? Set.of() : new HashSet<>(referencias.idsExistentes(ids));

        List<Dtos.ResultadoSpotify> resultados = new ArrayList<>();
        for (JsonNode p : pistas) {
            List<String> artistas = new ArrayList<>();
            p.path("artists").forEach(a -> artistas.add(a.path("name").asText()));
            JsonNode imagenes = p.path("album").path("images");
            String imagen = imagenes.size() > 0 ? imagenes.get(imagenes.size() - 1).path("url").asText(null) : null;
            String id = p.path("id").asText();
            resultados.add(new Dtos.ResultadoSpotify(id, p.path("name").asText(), String.join(", ", artistas),
                    p.path("album").path("name").asText(null), imagen,
                    p.hasNonNull("duration_ms") ? p.get("duration_ms").asInt() : null,
                    conAcordes.contains(id)));
        }
        // Primero las que sí tienen acordes en la base de datos.
        resultados.sort(Comparator.comparing(r -> !r.tieneAcordes()));
        return resultados;
    }

    private synchronized String obtenerToken() {
        if (token != null && Instant.now().isBefore(tokenVence)) {
            return token;
        }
        String credenciales = Base64.getEncoder()
                .encodeToString((clientId + ":" + clientSecret).getBytes(StandardCharsets.UTF_8));
        JsonNode r = pedir(HttpRequest.newBuilder(URI.create("https://accounts.spotify.com/api/token"))
                .header("Authorization", "Basic " + credenciales)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .timeout(Duration.ofSeconds(15))
                .POST(HttpRequest.BodyPublishers.ofString("grant_type=client_credentials"))
                .build());
        token = r.path("access_token").asText();
        // Se renueva un minuto antes de que venza.
        tokenVence = Instant.now().plusSeconds(Math.max(60, r.path("expires_in").asLong(3600) - 60));
        return token;
    }

    private JsonNode pedir(HttpRequest peticion) {
        try {
            HttpResponse<String> r = http.send(peticion, HttpResponse.BodyHandlers.ofString());
            if (r.statusCode() == 401 || r.statusCode() == 400) {
                token = null;
                throw new IllegalStateException("Spotify rechazó las credenciales. Revisa el Client ID y el Client Secret.");
            }
            if (r.statusCode() == 403) {
                throw new IllegalStateException("Spotify negó el acceso (403). El dueño de la app debe tener Spotify Premium activo.");
            }
            if (r.statusCode() == 429) {
                throw new IllegalStateException("Se hicieron demasiadas búsquedas seguidas en Spotify. Espera un momento.");
            }
            if (r.statusCode() >= 300) {
                throw new IllegalStateException("Spotify respondió con error " + r.statusCode() + ".");
            }
            return json.readTree(r.body());
        } catch (IOException e) {
            throw new IllegalStateException("No se pudo conectar con Spotify. ¿Hay internet?", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Búsqueda interrumpida.", e);
        }
    }
}
